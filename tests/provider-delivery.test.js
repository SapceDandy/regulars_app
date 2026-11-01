import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHmac,generateKeyPairSync,verify} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture} from './helpers/fixture.js';
import {Payments,verifyStripeSignature} from '../packages/integrations/payments.js';
import {Wallets,passFields} from '../packages/integrations/wallets.js';
import {providerFetch} from '../packages/integrations/http.js';
import {Problem} from '../packages/core/rules.js';

const config={mode:'live',origin:'https://regulars.example',env:{STRIPE_WEBHOOK_SECRET:'test-secret',GOOGLE_SERVICE_ACCOUNT_EMAIL:'test@example.invalid',GOOGLE_ISSUER_ID:'test-issuer',GOOGLE_CLASS_ID:'test-issuer.members',APPLE_PASS_TYPE_ID:'pass.test.regulars',APPLE_TEAM_ID:'TEST'}};
async function fxt(t){const f=await fixture();t.after(()=>f.s.close());return f;}
function signed(f,type,object,id='evt_refund'){
  const raw=Buffer.from(JSON.stringify({id,type,data:{object}}));const stamp=Math.floor(f.now()/1000);return [raw,`t=${stamp},v1=${createHmac('sha256','test-secret').update(`${stamp}.`).update(raw).digest('hex')}`];
}
function keys(t){const dir=mkdtempSync(join(tmpdir(),'regulars-delivery-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const path=join(dir,'key.pem');writeFileSync(path,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});return{publicKey,config:{...config,env:{...config.env,GOOGLE_PRIVATE_KEY_PATH:path,APPLE_CERT_PATH:path,APPLE_KEY_PATH:path,APPLE_WWDR_PATH:path}}};}

test('provider HTTP errors redact response bodies and preserve caller cancellation',async t=>{
  let input;t.mock.method(globalThis,'fetch',async(...args)=>{input=args;return{ok:true};});const signal=new AbortController().signal;
  assert.deepEqual(await providerFetch('https://provider.invalid/test',{signal}),{ok:true});assert.equal(input[1].signal,signal);
  await providerFetch('https://provider.invalid/test');assert.ok(input[1].signal instanceof AbortSignal);
  t.mock.method(globalThis,'fetch',async()=>({ok:false,status:503,text:async()=>{throw Error('must not read private body');}}));
  await assert.rejects(providerFetch('https://provider.invalid/test'),e=>e.status===502&&e.message==='Provider request failed (503).');
});

test('external full refunds refresh affected passes and replay without duplicate audit or revisions',async t=>{
  const f=await fxt(t),member=await f.member(),order=await f.ticket();await f.paid(order);
  const p=new Payments(f.s,f.app,config),before=await f.app.membershipSnapshot(member.id);
  const args=signed(f,'charge.refunded',{payment_intent:`pi_${order.id}`,amount:order.amount_cents,currency:'usd',amount_refunded:order.amount_cents});
  await p.webhook(...args);const after=await f.app.membershipSnapshot(member.id);
  assert.equal((await f.app.order(f.uid,order.id)).state,'refunded');assert.equal((await f.s.get('SELECT state FROM reservations WHERE order_id=?',order.id)).state,'cancelled');
  assert.ok(after.revision>before.revision,'removing the next game must queue a pass refresh');
  await p.webhook(...args);assert.equal((await f.app.membershipSnapshot(member.id)).revision,after.revision);
  assert.equal((await f.s.get("SELECT count(*) n FROM audit WHERE action='payment.refunded' AND subject_id=?",order.id)).n,1);
});

test('partial refunds preserve entitlements; full current membership refunds release lockers',async t=>{
  const f=await fxt(t),member=await f.member();const order=await f.app.order(f.uid,member.order_id),p=new Payments(f.s,f.app,config);
  const refund={payment_intent:`pi_${order.id}`,amount:order.amount_cents,currency:'usd',amount_refunded:1};
  assert.deepEqual(await p.webhook(...signed(f,'charge.refunded',refund)),{reconcile:true});assert.equal((await f.app.membershipSnapshot(member.id)).active,true);
  await p.webhook(...signed(f,'charge.refunded',{...refund,currency:'usd',amount_refunded:order.amount_cents},'evt_full_refund'));const current=await f.app.membershipSnapshot(member.id);assert.equal(current.active,false);assert.equal(current.locker,null);
  await p.webhook(...signed(f,'charge.refunded',{...refund,payment_intent:'unknown',currency:'usd',amount_refunded:order.amount_cents},'unknown-refund'));
});

test('refunds preserve attended bookings and renewed memberships while releasing unused priority',async t=>{
  const f=await fxt(t),member=await f.member(),p=new Payments(f.s,f.app,config);
  const order=await f.ticket();await f.paid(order);const reservation=await f.s.get('SELECT * FROM reservations WHERE order_id=?',order.id);f.setTime(reservation.starts_at);await f.app.checkIn(f.manager,reservation.id,'attended');
  f.setTime(member.ends_at-86400000);const renewal=await f.app.createOrder(f.uid,{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'},'renew');await f.paid(renewal);
  const old=await f.app.order(f.uid,member.order_id);await p.webhook(...signed(f,'charge.refunded',{payment_intent:`pi_${old.id}`,amount:old.amount_cents,currency:'usd',amount_refunded:old.amount_cents},'refund-old'));
  assert.equal((await f.app.membershipSnapshot(member.id)).active,true);
  await p.webhook(...signed(f,'charge.refunded',{payment_intent:`pi_${order.id}`,amount:order.amount_cents,currency:'usd',amount_refunded:order.amount_cents},'refund-attended'));assert.equal((await f.s.get('SELECT state FROM reservations WHERE id=?',reservation.id)).state,'attended');
  const q=await f.app.joinQueue(f.uid,'v_copper',2),priority=await f.app.createOrder(f.uid,{kind:'priority',venueId:'v_copper',queueId:q.queueId},'priority');await f.paid(priority);
  await p.webhook(...signed(f,'charge.refunded',{payment_intent:`pi_${priority.id}`,amount:priority.amount_cents,currency:'usd',amount_refunded:priority.amount_cents},'refund-priority'));const released=await f.s.get('SELECT * FROM queue_entries WHERE id=?',q.queueId);assert.equal(released.lane,'standard');assert.equal(released.order_id,null);
});

test('refund provider retries use one idempotency key and only accept settled refunds',async t=>{
  const f=await fxt(t),o=await f.ticket();await f.paid(o);await f.app.cancelOrder(f.uid,o.id);const calls=[];let status='pending';
  const p=new Payments(f.s,f.app,config,{request:async(url,options)=>{calls.push({url,options});return{json:async()=>({status})};}});
  await assert.rejects(p.refund(o.id),{status:409});assert.equal((await f.app.order(f.uid,o.id)).state,'refund_pending');status='succeeded';await p.refund(o.id);await p.refund(o.id);await p.refund('missing');assert.equal(calls.length,2);assert.equal(calls[0].options.headers['idempotency-key'],calls[1].options.headers['idempotency-key']);assert.equal((await f.app.order(f.uid,o.id)).state,'refunded');
  await f.s.run("UPDATE orders SET state='refund_pending',payment_intent=NULL WHERE id=?",o.id);await assert.rejects(p.refund(o.id),/Missing payment reference/);
});

test('signed malformed JSON, absent signatures and asynchronous payments follow validation',async t=>{
  const f=await fxt(t);assert.throws(()=>verifyStripeSignature(Buffer.from('{}'),undefined,'test'),{status:400});const raw=Buffer.from('{'),stamp=Math.floor(f.now()/1000),signature=`t=${stamp},v1=${createHmac('sha256','test-secret').update(`${stamp}.`).update(raw).digest('hex')}`;assert.throws(()=>verifyStripeSignature(raw,signature,'test-secret',f.now()),/Invalid webhook JSON/);
  const p=new Payments(f.s,f.app,config),o=await f.ticket();await p.webhook(...signed(f,'checkout.session.async_payment_succeeded',{id:'cs_async',metadata:{order_id:o.id},payment_status:'paid',amount_total:o.amount_cents,currency:'usd',payment_intent:'pi_async'},'evt_async'));assert.equal((await f.app.order(f.uid,o.id)).state,'paid');
});

test('Google OAuth assertion is signed, token is cached and malformed responses fail closed',async t=>{
  const f=await fxt(t),k=keys(t);const calls=[];let response={access_token:'test-access',expires_in:3600};
  const w=new Wallets(f.s,f.app,k.config,{request:async(url,options)=>{calls.push({url,options});return{json:async()=>response};}});
  assert.equal(await w.googleAccess(),'test-access');assert.equal(await w.googleAccess(),'test-access');assert.equal(calls.length,1);
  const [h,b,s]=calls[0].options.body.get('assertion').split('.');assert.equal(verify('RSA-SHA256',Buffer.from(`${h}.${b}`),k.publicKey,Buffer.from(s,'base64url')),true);const claims=JSON.parse(Buffer.from(b,'base64url'));assert.equal(claims.aud,'https://oauth2.googleapis.com/token');assert.equal(claims.exp-claims.iat,3600);
  w.access.expires=0;response={access_token:'new-access',expires_in:1};assert.equal(await w.googleAccess(),'new-access');assert.ok(w.access.expires<=Date.now());
  response={};await assert.rejects(w.googleAccess(),{status:502});assert.notEqual(w.access?.token,undefined);
});

test('Google updates current balances, creates missing objects and reports provider errors',async t=>{
  const f=await fxt(t),m=await f.member(),k=keys(t);const w=new Wallets(f.s,f.app,k.config);w.access={token:'fixture',expires:Date.now()+60000};const calls=[];let status=200;
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return{status,ok:status===200};});
  await w.updateGoogle(m.id);assert.equal(calls[0].options.method,'PATCH');assert.equal(JSON.parse(calls[0].options.body).id,`test-issuer.${m.id}`);
  status=404;t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return options.method==='PATCH'?{status:404,ok:false}:{status:200,ok:true};});await w.updateGoogle(m.id);assert.equal(calls.at(-1).options.method,'POST');
  t.mock.method(globalThis,'fetch',async()=>({status:500,ok:false}));await assert.rejects(w.updateGoogle(m.id),{status:502});
  assert.equal(passFields({...m,locker:{label:'L09',mode:'private'},bottles:[]},{title:'Game',resource_label:'Seat'}).next,'Game · Seat');
});

function transport(run){
  const session=new EventEmitter(),req=new EventEmitter();let timeout;
  session.setTimeout=(ms,fn)=>{assert.equal(ms,12000);timeout=fn;};session.close=()=>{session.closed=(session.closed??0)+1;};session.request=headers=>{session.headers=headers;return req;};req.end=body=>{assert.equal(body,'{}');queueMicrotask(()=>run({session,req,timeout:()=>timeout()}));};
  return{session,connect:()=>session};
}
test('Apple push handles success, invalid tokens, transport failures and duplicate terminal events',async t=>{
  const f=await fxt(t),m=await f.member(),k=keys(t),token='a'.repeat(64);
  for(const scenario of ['success','gone','status','session','request','timeout']){
    await f.s.run('INSERT INTO apple_registrations VALUES(?,?,?) ON CONFLICT(device_id,membership_id) DO UPDATE SET push_token=excluded.push_token','device',m.id,token);
    const tr=transport(({session,req,timeout})=>{if(scenario==='success'){req.emit('response',{':status':200});req.emit('data',Buffer.from('{}'));req.emit('end');req.emit('error',new Error('late'));}if(scenario==='gone'){req.emit('response',{':status':410});req.emit('end');}if(scenario==='status'){req.emit('response',{':status':403});req.emit('end');}if(scenario==='session')session.emit('error',new Error('session'));if(scenario==='request')req.emit('error',new Error('request'));if(scenario==='timeout')timeout();});
    const w=new Wallets(f.s,f.app,k.config,{connect:tr.connect});
    if(['success','gone'].includes(scenario))await w.pushApple(token);else await assert.rejects(w.pushApple(token));
    assert.equal(tr.session.closed,1);assert.equal(tr.session.headers[':path'],`/3/device/${token}`);assert.equal(tr.session.headers['apns-topic'],'pass.test.regulars');
    assert.equal((await f.s.all('SELECT * FROM apple_registrations')).length,scenario==='gone'?0:1);
  }
});

test('Apple invalid-token cleanup failures are retryable and both Wallet transports must complete',async t=>{
  const f=await fxt(t),m=await f.member(),k=keys(t);const tr=transport(({req})=>{req.emit('response',{':status':410});req.emit('end');});
  const w=new Wallets({...f.s,run:async()=>{throw Error('database unavailable');}},f.app,k.config,{connect:tr.connect});await assert.rejects(w.pushApple('b'.repeat(64)),/database unavailable/);
  const normal=new Wallets(f.s,f.app,k.config);await normal.register('device',m.id,'c'.repeat(64));let pushed=0,updated=0;normal.updateGoogle=async()=>{updated++;};normal.pushApple=async()=>{pushed++;};await normal.update(m.id);assert.equal(updated,1);assert.equal(pushed,1);
  normal.pushApple=async()=>{throw new Problem(502,'Retry push');};await assert.rejects(normal.update(m.id),/Retry push/);assert.equal(updated,2);
  await assert.rejects(new Wallets(f.s,f.app,{mode:'live',env:{}}).update(m.id),{status:503});await new Wallets(f.s,f.app,{mode:'demo',env:{}}).update(m.id);
});

test('priority checkout fallback label and a new refund event for a settled refund are idempotent',async t=>{
  const f=await fxt(t),q=await f.app.joinQueue(f.uid,'v_copper',1),o=await f.app.createOrder(f.uid,{kind:'priority',venueId:'v_copper',queueId:q.queueId},'priority-label');let label;
  const p=new Payments(f.s,f.app,config,{request:async(url,options)=>{label=options.body.get('line_items[0][price_data][product_data][name]');return{json:async()=>({id:'cs_priority',url:'https://checkout.stripe.com/fixture'})};}});await p.checkout(o);assert.equal(label,'Regulars · Priority access');
  await f.app.settle({eventId:'evt_priority',orderId:o.id,amount:o.amount_cents,currency:'usd',paymentIntent:'pi_priority',sessionId:'cs_priority'});
  const refund={payment_intent:'pi_priority',amount:o.amount_cents,currency:'usd',amount_refunded:o.amount_cents};await p.webhook(...signed(f,'charge.refunded',refund,'refund-first'));assert.deepEqual(await p.webhook(...signed(f,'charge.refunded',refund,'refund-second')),{duplicate:true});assert.equal((await f.s.get("SELECT count(*) n FROM audit WHERE action='payment.refunded'")).n,1);
});
