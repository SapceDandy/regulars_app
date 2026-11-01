import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture} from './helpers/fixture.js';
import {Payments} from '../packages/integrations/payments.js';

async function setup(t){const f=await fixture();t.after(()=>f.s.close());const p=new Payments(f.s,f.app,{mode:'live',origin:'https://regulars.example',env:{STRIPE_WEBHOOK_SECRET:'scenario-secret'}});return {...f,p};}
function deliver(f,type,object,eventId){const raw=Buffer.from(JSON.stringify({id:eventId,type,data:{object}})),stamp=Math.floor(f.now()/1000);return f.p.webhook(raw,`t=${stamp},v1=${createHmac('sha256','scenario-secret').update(`${stamp}.`).update(raw).digest('hex')}`);}
const session=o=>({id:`cs_${o.id}`,metadata:{order_id:o.id},payment_status:'paid',payment_intent:`pi_${o.id}`,amount_total:o.amount_cents,currency:o.currency});
const refund=o=>({payment_intent:`pi_${o.id}`,metadata:{order_id:o.id},amount:o.amount_cents,amount_refunded:o.amount_cents,currency:o.currency});

test('delayed success after cancellation or refund cannot reopen an order or duplicate its refund job',async t=>{
  const f=await setup(t),o=await f.ticket();await deliver(f,'checkout.session.completed',session(o),'paid');await f.app.cancelOrder(f.uid,o.id);
  assert.deepEqual(await deliver(f,'checkout.session.async_payment_succeeded',session(o),'paid-delayed'),{duplicate:true});
  assert.equal((await f.s.get("SELECT count(*) n FROM outbox WHERE kind='refund'")).n,1);
  await deliver(f,'charge.refunded',refund(o),'refunded');
  assert.deepEqual(await deliver(f,'checkout.session.completed',session(o),'paid-after-refund'),{duplicate:true});
  assert.equal((await f.app.order(f.uid,o.id)).state,'refunded');assert.equal((await f.s.get("SELECT count(*) n FROM outbox WHERE kind='refund'")).n,1);
});

test('a full refund arriving before checkout confirmation releases held lockers and blocks later entitlement',async t=>{
  const f=await setup(t),o=await f.app.createOrder(f.uid,{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'},'refund-first');
  await deliver(f,'charge.refunded',refund(o),'refund-first');
  assert.equal((await f.app.order(f.uid,o.id)).state,'refunded');
  assert.equal((await f.s.get('SELECT state FROM locker_allocations WHERE order_id=?',o.id)).state,'released');
  await deliver(f,'checkout.session.completed',session(o),'paid-later');
  assert.equal((await f.app.account(f.uid)).memberships.length,0);
  assert.equal((await f.s.get("SELECT count(*) n FROM outbox WHERE kind='refund'")).n,0);
});

test('conflicting payment identity or refund totals are rejected without corrupting a paid booking',async t=>{
  const f=await setup(t),o=await f.ticket();await deliver(f,'checkout.session.completed',session(o),'paid');
  await assert.rejects(deliver(f,'checkout.session.completed',{...session(o),payment_intent:'pi_other'},'other-payment'),{status:409});
  for(const [i,change] of [{amount:o.amount_cents+1,amount_refunded:o.amount_cents+1},{currency:'eur'},{payment_intent:'pi_other'}].entries())await assert.rejects(deliver(f,'charge.refunded',{...refund(o),...change},`bad-refund-${i}`),{status:409});
  assert.equal((await f.app.order(f.uid,o.id)).state,'paid');assert.equal((await f.s.get('SELECT state FROM reservations WHERE order_id=?',o.id)).state,'confirmed');
});

test('async failure and checkout expiry release only matching unpaid inventory and replay safely',async t=>{
  const f=await setup(t);
  for(const [i,type] of ['checkout.session.async_payment_failed','checkout.session.expired'].entries()){
    const o=await f.ticket();await f.s.run('UPDATE orders SET stripe_session=? WHERE id=?',`cs_${o.id}`,o.id);
    await assert.rejects(deliver(f,type,{...session(o),id:'wrong-session'},`wrong-${i}`),{status:409});
    await deliver(f,type,{...session(o),payment_status:'unpaid'},`failed-${i}`);
    assert.equal((await f.app.order(f.uid,o.id)).state,'cancelled');assert.equal((await f.s.get('SELECT state FROM reservations WHERE order_id=?',o.id)).state,'released');
    assert.deepEqual(await deliver(f,type,session(o),`failed-${i}`),{duplicate:true});
    await deliver(f,type,session(o),`failed-again-${i}`);
  }
  const paid=await f.ticket();await deliver(f,'checkout.session.completed',session(paid),'paid');await deliver(f,'checkout.session.async_payment_failed',session(paid),'failure-after-paid');assert.equal((await f.app.order(f.uid,paid.id)).state,'paid');
  await assert.rejects(deliver(f,'checkout.session.expired',{...session(paid),metadata:{order_id:'missing'}},'unknown-expiry'),{status:404});
});

test('refund metadata is propagated to the payment and unknown external charges do not touch other orders',async t=>{
  const f=await setup(t),o=await f.ticket();let fields;f.p.request=async(url,options)=>{fields=options.body;return{json:async()=>({id:`cs_${o.id}`,url:'https://checkout.stripe.com/fixture'})};};await f.p.checkout(o);
  assert.equal(fields.get('payment_intent_data[metadata][order_id]'),o.id);assert.equal(fields.has('payment_method_types[0]'),false);
  assert.deepEqual(await deliver(f,'charge.refunded',{payment_intent:'unrelated',amount:500,amount_refunded:500,currency:'usd'},'unrelated'),{received:true});
  assert.equal((await f.app.order(f.uid,o.id)).state,'held');
});
