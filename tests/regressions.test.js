import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/fixture.js';
import { configuration,clientAddress } from '../apps/web/config.js';
import { createApplication } from '../apps/web/server.js';
import { Payments } from '../packages/integrations/payments.js';
import { Wallets } from '../packages/integrations/wallets.js';
import { HOLD_MS } from '../packages/core/regulars.js';

async function make(t){const f=(await fixture());t.after(async ()=>(await f.s.close()));return f;}
test('expiry and free re-enrollment cannot revive service rights for a former locker bottle',async t=>{
  const f=await make(t),m=await f.member();
  const b=await f.app.addBottle(f.manager,m.id,{name:'Expiry fixture',capacityMl:750},'receive-expiry');
  await f.app.adjustBottle(f.manager,b.id,{deltaMl:-45,reason:'Service before expiry'},'before-expiry');
  f.setTime(m.ends_at);
  assert.equal((await f.app.memberForStaff(f.manager,'v_copper',m.pass_token)).active,false);
  await assert.rejects(f.app.adjustBottle(f.manager,b.id,{deltaMl:-45,reason:'Expired service'},'expired'),e=>e.status===409);
  await assert.rejects(f.app.addBottle(f.manager,m.id,{name:'Late receipt',capacityMl:750},'late-receive'),e=>e.status===409);
  await f.app.account(f.uid);
  await f.app.enrollGuest(f.uid,'v_copper','v_copper_guest');
  const guest=await f.app.membershipSnapshot(m.id);assert.equal(guest.active,true);assert.equal(guest.locker,null);
  await assert.rejects(f.app.adjustBottle(f.manager,b.id,{deltaMl:-45,reason:'Guest service'},'guest-pour'),e=>e.status===409);
  assert.equal((await f.app.membershipSnapshot(m.id)).bottles[0].remaining_ml,705);
  assert.equal((await f.s.get('SELECT count(*) n FROM bottle_log WHERE bottle_id=?',b.id)).n,2);
  const renewed=await f.member();assert.equal(renewed.id,m.id);assert.equal(renewed.pass_token,m.pass_token);
  await f.app.adjustBottle(f.manager,b.id,{deltaMl:-45,reason:'Renewed locker service'},'renewed-pour');
  assert.equal((await f.app.membershipSnapshot(m.id)).bottles[0].remaining_ml,660);
});

for(const outcome of ['cancelled','expired'])test(`renewal checkout marked ${outcome} leaves current access and stock intact without extending the term`,async t=>{
  const f=await make(t),m=await f.member();
  const b=await f.app.addBottle(f.manager,m.id,{name:'Renewal fixture',capacityMl:750},'receive-renewal');
  f.setTime(m.ends_at-3*86400000);
  const renewal=await f.app.createOrder(f.uid,{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'},'renewal-hold');
  if(outcome==='cancelled')await f.app.cancelOrder(f.uid,renewal.id);else{f.advance(HOLD_MS);await f.app.cleanup();}
  const current=await f.app.membershipSnapshot(m.id);
  assert.equal(current.active,true);assert.equal(current.ends_at,m.ends_at);assert.equal(current.locker.label,m.locker.label);
  assert.equal(current.bottles[0].remaining_ml,750);assert.equal((await f.app.order(f.uid,renewal.id)).state,outcome);
  assert.equal((await f.s.get('SELECT state FROM locker_allocations WHERE order_id=?',renewal.id)).state,'released');
  await f.app.adjustBottle(f.manager,b.id,{deltaMl:-45,reason:'Still within paid term'},'current-term');
  f.setTime(m.ends_at);assert.equal((await f.app.account(f.uid)).memberships[0].active,false);
  assert.equal((await f.s.get("SELECT count(*) n FROM locker_allocations WHERE membership_id=? AND state='active'",m.id)).n,0);
});
test('live startup cannot reuse a database containing synthetic venues',async t=>{const f=(await make(t));const c=configuration({APP_MODE:'demo'});c.mode='live';(await assert.rejects(async ()=>(await createApplication({config:c,store:f.s,seedData:false})),/fresh live database/));});
test('manual renewal preserves the start of an uninterrupted paid membership',async t=>{const f=(await make(t));const m=(await f.member());f.advance(24*86_400_000);const o=(await f.app.createOrder(f.uid,{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'},'renew'));(await f.paid(o));assert.equal((await f.app.membershipSnapshot(m.id)).starts_at,m.starts_at);});
test('a provider refund that is still pending does not become a settled refund locally',async t=>{const f=(await make(t));const o=(await f.ticket());(await f.paid(o));(await f.app.cancelOrder(f.uid,o.id));const p=new Payments(f.s,f.app,{mode:'live',env:{STRIPE_SECRET_KEY:'test'}},{request:async()=>({json:async()=>({status:'pending'})})});await assert.rejects(async ()=>(await p.refund(o.id)),/not settled/);assert.equal((await f.app.order(f.uid,o.id)).state,'refund_pending');});
test('Apple update tags advance globally across distinct memberships',async t=>{const f=(await make(t));const one=(await f.member());const two=(await f.member(f.other));assert.ok(two.revision>one.revision);const w=new Wallets(f.s,f.app,{mode:'demo',env:{}});(await w.register('test-device-one',one.id,'a'.repeat(64)));(await w.register('test-device-two',two.id,'b'.repeat(64)));(await f.app.touch(one.id));const revision=(await f.app.membershipSnapshot(one.id)).revision;assert.ok(revision>two.revision);(await assert.rejects(async ()=>(await w.authorizeApple(one.id,'ApplePass wrong')),/authorization/));const secret=(await f.s.get('SELECT pass_auth FROM memberships WHERE id=?',one.id)).pass_auth;assert.equal((await w.authorizeApple(one.id,`ApplePass ${secret}`)).id,one.id);});
test('forwarded client IPs are honored only from an explicitly trusted proxy',()=>{const req={socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'1.2.3.4, 198.51.100.8'}};assert.equal(clientAddress(req,{trustedProxyIps:[]}), '127.0.0.1');assert.equal(clientAddress(req,{trustedProxyIps:['127.0.0.1']}),'198.51.100.8');});
test('one Wallet provider failure does not prevent attempts to refresh the other',async t=>{const f=(await make(t));const m=(await f.member());const w=new Wallets(f.s,f.app,{mode:'live',env:{}});w.readiness=()=>({apple:true,google:true});(await w.register('test-device',m.id,'a'.repeat(64)));let pushed=0;w.updateGoogle=async()=>{throw new Error('Google temporarily unavailable');};w.pushApple=async()=>{pushed++;};await assert.rejects(async ()=>(await w.update(m.id)),/temporarily unavailable/);assert.equal(pushed,1);});
