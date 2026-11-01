import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture} from './helpers/fixture.js';
import {serverFixture} from './helpers/http.js';
import {Payments} from '../packages/integrations/payments.js';
import {Square} from '../packages/integrations/square.js';

async function setup(t){const f=await fixture();t.after(()=>f.s.close());return f;}
function stripeSigned(f,event){const raw=Buffer.from(JSON.stringify(event));const ts=Math.floor(f.now()/1000);return [raw,`t=${ts},v1=${createHmac('sha256','fixture').update(`${ts}.`).update(raw).digest('hex')}`];}
function stripe(f,type,object,id=type){return new Payments(f.s,f.app,{mode:'live',env:{STRIPE_WEBHOOK_SECRET:'fixture'}}).webhook(...stripeSigned(f,{id,type,data:{object}}));}
const squareEnv={SQUARE_WEBHOOK_SIGNATURE_KEY:'synthetic',SQUARE_WEBHOOK_URL:'https://regulars.example/api/webhooks/square',SQUARE_MERCHANT_ID:'regulars-merchant',SQUARE_LOCATION_ID:'regulars-location',SQUARE_VENUE_ID:'v_copper'};
const payment=(f,changes={})=>({id:'sq-payment',location_id:'regulars-location',status:'COMPLETED',amount_money:{amount:1000,currency:'USD'},created_at:new Date(f.now()).toISOString(),...changes});
const squareEvent=(f,p=payment(f))=>({event_id:'sq-event',merchant_id:'regulars-merchant',type:'payment.updated',data:{id:p.id,object:{payment:p}}});
function squareSigned(event,env=squareEnv){const raw=Buffer.from(typeof event==='string'?event:JSON.stringify(event));return [raw,createHmac('sha256',env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_URL).update(raw).digest('base64')];}

test('dispute reports are append-only, duplicate-safe and never mutate benefits or money',async t=>{
  const f=await setup(t),m=await f.member(),o=await f.app.order(f.uid,m.order_id);
  const d={id:'du_fixture',payment_intent:`pi_${o.id}`,amount:o.amount_cents+5,currency:'usd',status:'needs_response',evidence_details:{due_by:f.now()/1000+86400},evidence:{customer_email_address:'must-not-store@example.invalid'}};
  const result=await stripe(f,'charge.dispute.created',d,'dispute-created');assert.equal(result.reconcile,true);
  assert.deepEqual(await stripe(f,'charge.dispute.created',d,'dispute-created'),{duplicate:true});
  let cases=await f.app.paymentCases('v_copper');assert.equal(cases.length,1);assert.equal(cases[0].due_at,f.now()+86400000);assert.equal(JSON.stringify(cases).includes('must-not-store'),false);
  const note={note:'Verified in Stripe; operator will handle response.'};await f.app.reviewPaymentCase(f.manager,'dispute-created',note);assert.deepEqual(await f.app.reviewPaymentCase(f.manager,'dispute-created',note),{duplicate:true});await assert.rejects(f.app.reviewPaymentCase(f.manager,'dispute-created',{note:'different'}),{status:409});
  // A closed report followed by an older created report must not reopen an order or pretend to be current status.
  await stripe(f,'charge.dispute.closed',{...d,status:'won',evidence_details:null},'dispute-closed');
  await stripe(f,'charge.dispute.created',d,'late-created');cases=await f.app.paymentCases('v_copper');assert.equal(cases.length,3);assert.equal(cases.filter(c=>c.reviewed_at===null).length,2);
  assert.equal((await f.app.order(f.uid,o.id)).state,'paid');assert.equal((await f.app.membershipSnapshot(m.id)).revision,m.revision);assert.equal((await f.app.staffDashboard(f.manager,'v_copper')).report.paidCents,o.amount_cents);
  assert.equal(JSON.stringify(await f.app.account(f.uid)).includes(note.note),false);
});

test('unmatched and mismatched Stripe events are durable, private and can link after delayed settlement',async t=>{
  const f=await setup(t),o=await f.ticket();const p=`pi_${o.id}`;
  await stripe(f,'charge.dispute.updated',{id:'du_early',payment_intent:p,amount:100,currency:'usd',status:'under_review'},'early');assert.equal((await f.app.paymentCases('v_copper')).length,0);
  await assert.rejects(f.app.reviewPaymentCase(f.manager,'early',{note:'operator only'}),{status:403});await f.paid(o);assert.equal((await f.app.paymentCases('v_copper')).length,1);
  await assert.rejects(stripe(f,'charge.refunded',{id:'ch_wrong',payment_intent:p,metadata:{order_id:'other-order'},amount:o.amount_cents+1,currency:'usd',amount_refunded:10},'mismatch'),{status:409});
  assert.equal((await f.s.get('SELECT kind FROM payment_cases WHERE id=?','mismatch')).kind,'payment_mismatch');assert.equal((await f.app.order(f.uid,o.id)).state,'paid');
  assert.deepEqual(await stripe(f,'charge.refunded',{payment_intent:'unknown',amount:100,amount_refunded:100,currency:'usd'},'unknown'),{received:true,reconcile:true});
  assert.equal((await f.s.get('SELECT order_id FROM payment_cases WHERE id=?','unknown')).order_id,null);
  const other=await f.user('+12025550108');await f.s.run('INSERT INTO staff VALUES(?,?,?)',other,'v_social','manager');await f.s.run('INSERT INTO staff VALUES(?,?,?)',f.other,'v_copper','staff');
  for(const u of [f.uid,f.other,other])await assert.rejects(f.app.reviewPaymentCase(u,'early',{note:'denied'}),{status:403});
  assert.deepEqual((await f.app.staffDashboard(f.other,'v_copper')).paymentCases,[]);assert.deepEqual((await f.app.staffDashboard(other,'v_social')).paymentCases,[]);
  await assert.rejects(f.app.reviewPaymentCase(f.manager,'absent',{note:'missing'}),{status:404});await assert.rejects(f.app.reviewPaymentCase(f.manager,'early',{note:' '}),{status:400});
  for(const input of [{amount:-1},{amount:1.1},{dueAt:-1},{dueAt:1.5},{eventId:''},{reference:''},{kind:''}])await assert.rejects(f.app.recordPaymentCase({eventId:'invalid',kind:'dispute',reference:'du_x',...input}),{status:400});
  await f.app.recordPaymentCase({eventId:'metadata-fallback',kind:'payment_mismatch',reference:'cs_x',orderId:o.id});
  assert.equal((await f.app.paymentCases('v_copper')).length,3);
});

test('malformed Stripe reports are rejected and a single payment cannot buy two orders',async t=>{
  const f=await setup(t),p=new Payments(f.s,f.app,{env:{STRIPE_WEBHOOK_SECRET:'fixture'}});
  for(const event of [null,{}, {id:'bad',type:'x'},{id:'bad',type:'x',data:{object:null}},{id:'bad',type:'charge.dispute.created',data:{object:{id:'du',currency:'usd'}}}])await assert.rejects(p.webhook(...stripeSigned(f,event)),{status:400});
  const o=await f.ticket();await f.paid(o);const second=await f.app.createOrder(f.other,{venueId:'v_copper',kind:'ticket',eventId:f.games[1].id,resourceId:f.resource.id,partySize:2},'another');
  await assert.rejects(f.app.settle({eventId:'same-payment',orderId:second.id,amount:second.amount_cents,currency:'usd',paymentIntent:`pi_${o.id}`}),{status:409});assert.equal((await f.app.order(f.other,second.id)).state,'held');
  await assert.rejects(stripe(f,'checkout.session.completed',{id:'cs_missing',payment_status:'paid',amount_total:100,currency:'usd',payment_intent:'pi_missing'},'missing-order'),{status:404});
  assert.equal((await f.s.get('SELECT kind FROM payment_cases WHERE id=?','missing-order')).kind,'payment_mismatch');
  await assert.rejects(stripe(f,'checkout.session.expired',{id:'cs_missing'},'missing-expired'),{status:404});
});

test('Square binds signature to URL and body, merchant and location; synthetic/demo ingress remains disabled',async t=>{
  const f=await setup(t),config={mode:'live',env:{...squareEnv}},sq=new Square(f.app,config);const e=squareEvent(f);
  await assert.rejects(new Square(f.app,{mode:'demo',env:squareEnv}).webhook(...squareSigned(e)),{status:404});await assert.rejects(new Square(f.app,{mode:'live',pilot:true,env:squareEnv}).webhook(...squareSigned(e)),{status:404});
  await assert.rejects(new Square(f.app,{mode:'live',env:{}}).webhook(...squareSigned(e)),{status:503});await assert.rejects(sq.webhook(squareSigned(e)[0]),{status:400});
  await assert.rejects(sq.webhook(...squareSigned(e,{...squareEnv,SQUARE_WEBHOOK_URL:'https://wrong.invalid/'})),{status:400});
  await assert.rejects(sq.webhook(...squareSigned('{')),{status:400});
  for(const bad of [null,{...e,event_id:''},{...e,merchant_id:'kudjo'},{...e,data:{}},{...e,data:{id:'wrong',object:{payment:payment(f)}}},squareEvent(f,payment(f,{location_id:'other'}))])await assert.rejects(sq.webhook(...squareSigned(bad)),{status:400});
  assert.deepEqual(await sq.webhook(...squareSigned({...e,type:'unsubscribed'})),{received:true});assert.deepEqual(await sq.webhook(...squareSigned(squareEvent(f,payment(f,{status:'APPROVED'})))),{received:true});assert.equal((await f.s.get('SELECT count(*) n FROM pos_payments')).n,0);
  assert.deepEqual(await sq.webhook(...squareSigned(e)),{received:true});assert.deepEqual(await sq.webhook(...squareSigned({...e,event_id:'different-event'})),{duplicate:true});
  assert.equal((await f.s.get('SELECT count(*) n FROM bottle_log')).n,0);assert.equal((await f.s.get('SELECT count(*) n FROM pos_payments')).n,1);
  for(const changes of [{amount_money:null},{amount_money:{amount:2.5,currency:'USD'}},{amount_money:{amount:100,currency:'EUR'}},{created_at:'invalid'}])await assert.rejects(sq.webhook(...squareSigned(squareEvent(f,payment(f,changes)))),{status:400});
  await assert.rejects(sq.webhook(...squareSigned(squareEvent(f,payment(f,{amount_money:{amount:2000,currency:'USD'}})))),{status:409});
});

test('Square service requires explicit staff selection and records a single stock debit under concurrent retries',async t=>{
  const f=await setup(t),m=await f.member(),b=await f.app.addBottle(f.manager,m.id,{name:'Fixture',capacityMl:750},'square-bottle');await f.s.run('INSERT INTO staff VALUES(?,?,?)',f.other,'v_copper','staff');
  const sq=new Square(f.app,{mode:'live',env:squareEnv});await sq.webhook(...squareSigned(squareEvent(f)));const body={action:'serve',bottleId:b.id,ml:45,note:'Physical service confirmed.'};
  for(const user of [f.uid,await f.user('+12025550109')])await assert.rejects(f.app.resolveSquarePayment(user,'sq-payment',body),{status:403});
  await assert.rejects(f.app.resolveSquarePayment(f.manager,'missing',body),{status:404});await assert.rejects(f.app.resolveSquarePayment(f.manager,'sq-payment',{...body,action:'invalid'}),{status:400});
  for(const changes of [{ml:0},{ml:1.5},{ml:6001},{bottleId:''},{note:''}])await assert.rejects(f.app.resolveSquarePayment(f.manager,'sq-payment',{...body,...changes}),{status:400});
  await assert.rejects(f.app.resolveSquarePayment(f.manager,'sq-payment',{...body,bottleId:'missing'}),{status:404});await assert.rejects(f.app.resolveSquarePayment(f.manager,'sq-payment',{...body,ml:751}),{status:409});
  const results=await Promise.all([f.app.resolveSquarePayment(f.other,'sq-payment',body),f.app.resolveSquarePayment(f.other,'sq-payment',body)]);assert.equal(results.filter(x=>x.recorded).length,1);assert.equal(results.filter(x=>x.duplicate).length,1);
  assert.equal((await f.s.get('SELECT remaining_ml FROM bottles WHERE id=?',b.id)).remaining_ml,705);assert.equal((await f.s.get("SELECT count(*) n FROM audit WHERE action='square.payment_handled'")).n,1);
  await assert.rejects(f.app.resolveSquarePayment(f.other,'sq-payment',{...body,ml:90}),{status:409});await assert.rejects(f.app.resolveSquarePayment(f.other,'sq-payment',{action:'dismiss',note:'wrong'}),{status:409});
  await f.app.recordSquarePayment({id:'other-payment',venueId:'v_social',amount:500,currency:'USD',createdAt:f.now()});await f.s.run('INSERT INTO staff VALUES(?,?,?)',f.manager,'v_social','manager');await assert.rejects(f.app.resolveSquarePayment(f.manager,'other-payment',body),{status:404});
  await f.app.resolveSquarePayment(f.manager,'other-payment',{action:'dismiss',note:'Food only.'});assert.deepEqual(await f.app.resolveSquarePayment(f.manager,'other-payment',{action:'dismiss',note:'Food only.'}),{duplicate:true});
  await f.app.recordSquarePayment({id:'expired-member',venueId:'v_copper',amount:500,currency:'USD',createdAt:f.now()});f.advance(31*86400000);await assert.rejects(f.app.resolveSquarePayment(f.manager,'expired-member',body),{status:409});assert.equal((await f.s.get('SELECT status FROM pos_payments WHERE id=?','expired-member')).status,'open');
});

test('manager revocation invalidates all sessions, preserves purchases and cannot remove own access',async t=>{
  const f=await setup(t),m=await f.member(f.other);await f.s.run('INSERT INTO staff VALUES(?,?,?)',f.other,'v_copper','staff');await f.s.run('INSERT INTO staff VALUES(?,?,?)',f.other,'v_social','manager');await f.s.run('INSERT INTO sessions VALUES(?,?,?)','synthetic-session',f.other,f.now()+100000);
  await assert.rejects(f.app.revokeStaff(f.uid,'v_copper',f.other,{reason:'x'}),{status:403});await assert.rejects(f.app.revokeStaff(f.other,'v_copper',f.manager,{reason:'x'}),{status:403});await assert.rejects(f.app.revokeStaff(f.manager,'v_copper',f.manager,{reason:'x'}),{status:409});await assert.rejects(f.app.revokeStaff(f.manager,'v_copper','missing',{reason:'x'}),{status:404});await assert.rejects(f.app.revokeStaff(f.manager,'v_copper',f.other,{reason:''}),{status:400});
  await f.app.revokeStaff(f.manager,'v_copper',f.other,{reason:'End of pilot shift access.'});assert.equal((await f.s.get('SELECT count(*) n FROM sessions WHERE user_id=?',f.other)).n,0);await assert.rejects(f.app.staffDashboard(f.other,'v_copper'),{status:403});assert.equal((await f.app.membershipSnapshot(m.id)).active,true);assert.equal((await f.app.staff(f.other,'v_social',true)).role,'manager');
  assert.equal((await f.s.get("SELECT count(*) n FROM audit WHERE action='staff.revoked'")).n,1);
});

test('HTTP journeys expose reviewed cases, Square service and manager revocation with Origin and venue protection',async t=>{
  const f=await serverFixture(t),guest=await f.login(),manager=await f.login('+12025550100'),worker=await f.login('+12025550104'),uid=(await f.auth.session(guest)).id,workerId=(await f.auth.session(worker)).id;await f.store.run('INSERT INTO staff VALUES(?,?,?)',workerId,'v_copper','staff');
  const o=await f.app.createOrder(uid,{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'},'http-ops');await f.app.settle({eventId:'paid',orderId:o.id,amount:o.amount_cents,currency:'usd',paymentIntent:'pi_http_ops'});const m=(await f.app.account(uid)).memberships[0];const b=await f.app.addBottle((await f.auth.session(manager)).id,m.id,{name:'HTTP fixture',capacityMl:750},'http-bottle');
  f.config.mode='live';Object.assign(f.config.env,squareEnv,{STRIPE_WEBHOOK_SECRET:'fixture'});const paymentEvent=squareEvent({now:f.app.now}),signed=squareSigned(paymentEvent);
  const incoming=await f.call('/api/webhooks/square',{method:'POST',origin:false,raw:signed[0],headers:{'x-square-hmacsha256-signature':signed[1]}});assert.equal(incoming.status,200);
  const sqPath='/api/staff/pos-payments/sq-payment',sqBody={action:'serve',bottleId:b.id,ml:45,note:'Confirmed guest and pour.'};assert.equal((await f.call(sqPath,{method:'POST',cookie:guest,body:sqBody})).status,403);assert.equal((await f.call(sqPath,{method:'POST',cookie:worker,origin:false,body:sqBody})).status,403);assert.equal((await f.call(sqPath,{method:'POST',cookie:worker,body:sqBody})).data.recorded,true);
  const event={id:'evt_http_case',type:'charge.dispute.created',data:{object:{id:'du_http',payment_intent:'pi_http_ops',amount:100,currency:'usd',status:'needs_response'}}},signedStripe=stripeSigned({now:f.app.now},event);
  assert.equal((await f.call('/api/webhooks/stripe',{method:'POST',origin:false,raw:signedStripe[0],headers:{'stripe-signature':signedStripe[1]}})).status,200);
  const path='/api/staff/payment-cases/evt_http_case';assert.equal((await f.call(path,{method:'POST',cookie:worker,body:{note:'no'}})).status,403);assert.equal((await f.call(path,{method:'POST',cookie:manager,body:{note:'Owner checking Stripe.'}})).data.reviewed,true);
  const access=`/api/staff/copper-room/access/${workerId}/revoke`;assert.equal((await f.call(access,{method:'POST',cookie:worker,body:{reason:'no'}})).status,403);assert.equal((await f.call(access,{method:'POST',cookie:manager,body:{reason:'Test complete.'}})).data.revoked,true);assert.equal((await f.call('/api/staff/copper-room',{cookie:worker})).status,401);
  assert.equal((await f.call('/api/account',{cookie:guest})).data.memberships[0].bottles[0].remaining_ml,705);
});

test('Square refunds retain the highest cumulative amount without restoring liquid or repeating service',async t=>{
  const f=await setup(t),m=await f.member(),b=await f.app.addBottle(f.manager,m.id,{name:'Refund fixture',capacityMl:750},'receive-refund'),sq=new Square(f.app,{mode:'live',env:squareEnv});
  const p=payment(f,{total_money:{amount:1200,currency:'USD'},refunded_money:{amount:100,currency:'USD'}});await sq.webhook(...squareSigned(squareEvent(f,p)));assert.equal((await f.s.get('SELECT amount_cents FROM pos_payments')).amount_cents,1200);
  await f.app.resolveSquarePayment(f.manager,p.id,{action:'serve',bottleId:b.id,ml:45,note:'Served before refund.'});
  await sq.webhook(...squareSigned(squareEvent(f,{...p,refunded_money:{amount:1200,currency:'USD'}})));await sq.webhook(...squareSigned(squareEvent(f,p)));
  const stored=await f.s.get('SELECT * FROM pos_payments');assert.equal(stored.refunded_cents,1200);assert.equal(stored.status,'serve');assert.equal((await f.s.get('SELECT remaining_ml FROM bottles WHERE id=?',b.id)).remaining_ml,705);
  for(const refund of [{amount:1300,currency:'USD'},{amount:-1,currency:'USD'},{amount:1,currency:'EUR'}])await assert.rejects(sq.webhook(...squareSigned(squareEvent(f,{...p,refunded_money:refund}))),{status:400});
});
