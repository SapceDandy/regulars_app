import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {fixture} from './helpers/fixture.js';
import {serverFixture} from './helpers/http.js';
import {Payments} from '../packages/integrations/payments.js';

async function setup(t){const f=await fixture();t.after(()=>f.s.close());return f;}
function refund(f,o,refundedAmount,eventId='partial'){return f.app.recordRefund({eventId,orderId:o.id,paymentIntent:`pi_${o.id}`,amount:o.amount_cents,currency:o.currency,refundedAmount});}

test('partial refunds persist cumulative amounts, reduce manager totals and preserve benefits through reordered delivery',async t=>{
  const f=await setup(t),m=await f.member(),o=await f.app.order(f.uid,m.order_id);const revision=m.revision;
  assert.deepEqual(await refund(f,o,500),{reconcile:true});assert.equal((await f.app.membershipSnapshot(m.id)).active,true);assert.equal((await f.app.membershipSnapshot(m.id)).revision,revision);
  let dashboard=await f.app.staffDashboard(f.manager,'copper-room');assert.equal(dashboard.report.paidCents,o.amount_cents-500);assert.equal(dashboard.refundReviews[0].status,'open');
  assert.equal((await f.app.account(f.uid)).orders[0].refunded_cents,500);
  for(const [amount,eventId] of [[500,'partial'],[500,'same-new-id'],[100,'older']])assert.deepEqual(await refund(f,o,amount,eventId),{duplicate:true});
  assert.equal((await f.s.get("SELECT count(*) n FROM audit WHERE action='payment.partial_refund'")).n,1);
  await refund(f,o,800,'larger');dashboard=await f.app.staffDashboard(f.manager,'copper-room');assert.equal(dashboard.refundReviews.length,1);assert.equal(dashboard.report.paidCents,o.amount_cents-800);
  await refund(f,o,o.amount_cents,'full');assert.equal((await f.app.membershipSnapshot(m.id)).active,false);assert.equal((await f.app.staffDashboard(f.manager,'copper-room')).report.paidCents,0);assert.equal((await f.s.get('SELECT status FROM refund_reviews')).status,'closed');
  await refund(f,o,600,'old-after-full');assert.equal((await f.s.get('SELECT status FROM refund_reviews')).status,'closed');
});

test('only the correct manager can record a current review and a larger refund reopens it with audit history',async t=>{
  const f=await setup(t),o=await f.ticket();await f.paid(o);await refund(f,o,300);const staff=await f.user('+12025550104');await f.s.run('INSERT INTO staff VALUES(?,?,?)',staff,'v_copper','staff');await f.s.run('INSERT INTO staff VALUES(?,?,?)',f.other,'v_social','manager');const input={refundedCents:300,note:'Verified with guest <fixture>.'};
  for(const uid of [f.uid,f.other,staff])await assert.rejects(f.app.reviewRefund(uid,o.id,input),{status:403});assert.deepEqual((await f.app.staffDashboard(staff,'copper-room')).refundReviews,[]);
  await assert.rejects(f.app.reviewRefund(f.manager,'missing',input),{status:404});await assert.rejects(f.app.reviewRefund(f.manager,o.id,{...input,note:' '}),{status:400});await assert.rejects(f.app.reviewRefund(f.manager,o.id,{...input,refundedCents:200}),{status:409});
  assert.deepEqual(await f.app.reviewRefund(f.manager,o.id,input),{reviewed:true});assert.deepEqual(await f.app.reviewRefund(f.manager,o.id,input),{duplicate:true});await assert.rejects(f.app.reviewRefund(f.manager,o.id,{...input,note:'A different review'}),{status:409});
  assert.equal((await f.s.get('SELECT reviewed_by FROM refund_reviews')).reviewed_by,f.manager);assert.equal((await f.app.account(f.uid)).orders[0].note,undefined);
  await refund(f,o,300,'same-after-review');assert.equal((await f.s.get('SELECT status FROM refund_reviews')).status,'reviewed');
  await refund(f,o,600,'new-refund');const reopened=await f.s.get('SELECT * FROM refund_reviews');assert.equal(reopened.status,'open');assert.equal(reopened.note,'');assert.equal(reopened.reviewed_by,null);
  await assert.rejects(f.app.reviewRefund(f.manager,o.id,input),{status:409});assert.equal((await f.s.get("SELECT count(*) n FROM audit WHERE action='payment.refund_reviewed'")).n,1);
  await refund(f,o,o.amount_cents,'full');await assert.rejects(f.app.reviewRefund(f.manager,o.id,{...input,refundedCents:o.amount_cents}),{status:409});
});

test('a partial refund before confirmation remains visible after settlement and a queued full refund closes its review',async t=>{
  const f=await setup(t),o=await f.ticket();await refund(f,o,500);assert.equal((await f.app.order(f.uid,o.id)).state,'held');assert.equal((await f.s.get('SELECT state FROM reservations WHERE order_id=?',o.id)).state,'held');
  await f.paid(o);assert.equal((await f.app.staffDashboard(f.manager,'copper-room')).report.paidCents,o.amount_cents-500);await f.app.cancelOrder(f.uid,o.id);
  const p=new Payments(f.s,f.app,{mode:'demo'});await p.refund(o.id);assert.equal((await f.s.get('SELECT status FROM refund_reviews')).status,'closed');assert.equal((await f.app.account(f.uid)).orders[0].refunded_cents,o.amount_cents);
  await f.app.completeRefund(o.id);await f.app.completeRefund('missing');assert.equal((await f.app.order(f.uid,o.id)).state,'refunded');
});

test('invalid partial refund payloads cannot alter totals, consume event IDs or create review tasks',async t=>{
  const f=await setup(t),o=await f.ticket();await f.paid(o);const base={eventId:'invalid',orderId:o.id,paymentIntent:`pi_${o.id}`,amount:o.amount_cents,currency:'usd',refundedAmount:500};
  for(const changes of [{refundedAmount:0},{refundedAmount:-1},{refundedAmount:1.5},{refundedAmount:o.amount_cents+1},{currency:'eur'},{amount:1},{paymentIntent:null},{paymentIntent:''},{paymentIntent:'another'},{orderId:'another'}])await assert.rejects(f.app.recordRefund({...base,...changes}),{status:409});
  assert.equal((await f.s.get('SELECT count(*) n FROM refund_reviews')).n,0);assert.equal(await f.s.get('SELECT id FROM payment_events WHERE id=?','invalid'),undefined);
  assert.deepEqual(await f.app.recordRefund({...base,eventId:'unrelated',paymentIntent:'unrelated',orderId:undefined}),{received:true});assert.equal((await f.app.staffDashboard(f.manager,'copper-room')).report.paidCents,o.amount_cents);
  await refund(f,o,o.amount_cents,'direct-full');assert.equal((await f.app.account(f.uid)).orders[0].refunded_cents,o.amount_cents);assert.equal((await f.s.get('SELECT count(*) n FROM refund_reviews')).n,0);
});

test('additive refund-review schema can initialize and rerun without changing existing bookings',async t=>{
  const f=await setup(t),o=await f.ticket();await f.paid(o);await f.s.run('DROP TABLE refund_reviews');
  const migrate=async()=>{if(f.s.dialect==='postgres')await f.s.migrate();else f.s.db.exec(readFileSync(new URL('../packages/db/schema.sql',import.meta.url),'utf8'));};
  await migrate();assert.equal((await f.app.order(f.uid,o.id)).state,'paid');await refund(f,o,500);await migrate();assert.equal((await f.s.get('SELECT refunded_cents FROM refund_reviews WHERE order_id=?',o.id)).refunded_cents,500);
});

test('signed partial-refund HTTP delivery reaches the manager queue and authorized review is durable',async t=>{
  const f=await serverFixture(t),guest=await f.login(),manager=await f.login('+12025550100'),uid=(await f.auth.session(guest)).id;const o=await f.app.createOrder(uid,{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'},'http-review');await f.app.settle({eventId:'paid',orderId:o.id,amount:o.amount_cents,currency:'usd',paymentIntent:'pi_http'});f.config.mode='live';f.config.env.STRIPE_WEBHOOK_SECRET='fixture';
  const raw=JSON.stringify({id:'partial-http',type:'charge.refunded',data:{object:{payment_intent:'pi_http',amount:o.amount_cents,currency:'usd',amount_refunded:500}}}),stamp=Math.floor(f.app.now()/1000),signature=`t=${stamp},v1=${createHmac('sha256','fixture').update(`${stamp}.${raw}`).digest('hex')}`;
  assert.equal((await f.call('/api/webhooks/stripe',{method:'POST',origin:false,raw,headers:{'stripe-signature':signature}})).data.reconcile,true);
  const path=`/api/staff/refund-reviews/${o.id}`,body={refundedCents:500,note:'Checked the provider and agreed unchanged benefits.'};assert.equal((await f.call(path,{method:'POST',cookie:guest,body})).status,403);assert.equal((await f.call(path,{method:'POST',cookie:manager,origin:false,body})).status,403);
  assert.equal((await f.call('/api/staff/copper-room',{cookie:manager})).data.refundReviews[0].status,'open');assert.equal((await f.call(path,{method:'POST',cookie:manager,body})).data.reviewed,true);assert.equal((await f.call('/api/staff/copper-room',{cookie:manager})).data.refundReviews[0].note,body.note);
  const customer=(await f.call('/api/account',{cookie:guest})).data;assert.equal(customer.orders[0].refunded_cents,500);assert.equal(customer.memberships[0].active,true);assert.equal(JSON.stringify(customer).includes(body.note),false);
});
