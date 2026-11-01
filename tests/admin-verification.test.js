import test from 'node:test';
import assert from 'node:assert/strict';
import {serverFixture} from './helpers/http.js';
import {fixture} from './helpers/fixture.js';
import {operatorAction} from '../packages/core/operations.js';

test('client-supplied roles and user IDs cannot grant manager access or modify another account',async t=>{
  const f=await serverFixture(t),guest=await f.login(),manager=await f.login('+12025550100');
  const guestId=(await f.auth.session(guest)).id,managerId=(await f.auth.session(manager)).id;
  const originalManager=(await f.call('/api/account',{cookie:manager})).data.user;
  const forged={name:'Synthetic guest edit',marketingOptIn:true,userId:managerId,id:managerId,role:'manager',venueId:'v_copper',staffVenues:[{id:'v_copper',role:'manager'}]};
  assert.equal((await f.call('/api/account',{method:'PATCH',cookie:guest,body:forged})).status,200);
  const account=(await f.call('/api/account',{cookie:guest})).data;
  assert.equal(account.user.id,guestId);assert.equal(account.user.name,forged.name);assert.deepEqual(account.staffVenues,[]);
  assert.deepEqual((await f.call('/api/account',{cookie:manager})).data.user,originalManager);
  assert.equal((await f.call('/api/staff/copper-room',{cookie:guest,headers:{'x-user-id':managerId,'x-role':'manager'}})).status,403);
  const revoke=`/api/staff/copper-room/access/${managerId}/revoke`;
  assert.equal((await f.call(revoke,{method:'POST',cookie:guest,body:{...forged,reason:'Forged authority'}})).status,403);
  assert.equal((await f.call('/api/staff/copper-room',{cookie:manager})).status,200);
  assert.equal((await f.store.get("SELECT count(*) n FROM audit WHERE action='staff.revoked'")).n,0);
});

test('competing manager revocations leave one authorized manager and invalidate only the removed user sessions',async t=>{
  const f=await serverFixture(t),first=await f.login('+12025550100'),second=await f.login('+12025550120');
  const ids=[(await f.auth.session(first)).id,(await f.auth.session(second)).id],cookies=[first,second];
  await f.store.run('INSERT INTO staff VALUES(?,?,?)',ids[1],'v_copper','manager');
  const results=await Promise.all(ids.map((actor,i)=>f.call(`/api/staff/copper-room/access/${ids[1-i]}/revoke`,{method:'POST',cookie:cookies[i],body:{reason:'Concurrent synthetic shift handoff'}})));
  assert.equal(results.filter(r=>r.status===200).length,1);
  assert.equal(results.filter(r=>[401,403].includes(r.status)).length,1);
  const managers=await f.store.all("SELECT user_id FROM staff WHERE venue_id='v_copper' AND role='manager'");
  assert.equal(managers.length,1);const survivor=ids.indexOf(managers[0].user_id),removed=1-survivor;
  assert.equal((await f.call('/api/staff/copper-room',{cookie:cookies[survivor]})).status,200);
  assert.equal((await f.call('/api/staff/copper-room',{cookie:cookies[removed]})).status,401);
  assert.equal((await f.store.get('SELECT count(*) n FROM sessions WHERE user_id=?',ids[removed])).n,0);
  assert.equal((await f.store.get("SELECT count(*) n FROM audit WHERE action='staff.revoked'")).n,1);
  assert.equal((await f.call(`/api/staff/copper-room/access/${ids[survivor]}/revoke`,{method:'POST',cookie:cookies[survivor],body:{reason:'Self removal'}})).status,409);
});

test('concurrent privileged operator demotions cannot remove the last venue manager',async t=>{
  const f=await fixture();t.after(()=>f.s.close());
  await operatorAction(f.app,'staff',{venueId:'v_copper',userId:f.other,role:'manager',reason:'Synthetic replacement manager'});
  const results=await Promise.allSettled([f.manager,f.other].map(userId=>operatorAction(f.app,'staff',{venueId:'v_copper',userId,role:'staff',reason:'Competing synthetic demotion'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const denied=results.find(r=>r.status==='rejected');assert.equal(denied.reason.status,409);
  const roles=await f.s.all("SELECT user_id,role FROM staff WHERE venue_id='v_copper' ORDER BY role");
  assert.deepEqual(roles.map(r=>r.role),['manager','staff']);
  assert.equal((await f.s.get("SELECT count(*) n FROM audit WHERE action='operator.staff_changed'")).n,2);
});

test('a revoked worker cannot submit stale Square service or stock forms after signing back in',async t=>{
  const f=await serverFixture(t),guest=await f.login(),manager=await f.login('+12025550100'),worker=await f.login('+12025550121');
  const guestId=(await f.auth.session(guest)).id,managerId=(await f.auth.session(manager)).id,workerId=(await f.auth.session(worker)).id;
  await f.store.run('INSERT INTO staff VALUES(?,?,?)',workerId,'v_copper','staff');
  const order=await f.app.createOrder(guestId,{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'},'stale-admin-member');
  await f.app.settle({eventId:'stale-admin-paid',orderId:order.id,amount:order.amount_cents,currency:'usd',paymentIntent:'pi_stale_admin'});
  const member=(await f.app.account(guestId)).memberships[0],bottle=await f.app.addBottle(managerId,member.id,{name:'Synthetic stale form bottle',capacityMl:750},'stale-admin-bottle');
  await f.app.recordSquarePayment({id:'stale-admin-square',venueId:'v_copper',amount:1000,currency:'USD',createdAt:f.app.now()});
  assert.equal((await f.call('/api/staff/copper-room',{cookie:worker})).data.posPayments.length,1);
  const body={action:'serve',bottleId:bottle.id,ml:45,note:'Stale worker form'};
  assert.equal((await f.call(`/api/staff/copper-room/access/${workerId}/revoke`,{method:'POST',cookie:manager,body:{reason:'Synthetic shift finished'}})).status,200);
  assert.equal((await f.call('/api/staff/pos-payments/stale-admin-square',{method:'POST',cookie:worker,body})).status,401);
  const signedBackIn=await f.login('+12025550121');
  assert.equal((await f.call('/api/staff/pos-payments/stale-admin-square',{method:'POST',cookie:signedBackIn,body})).status,403);
  assert.equal((await f.call(`/api/staff/bottles/${bottle.id}`,{method:'POST',cookie:signedBackIn,key:'stale-stock',body:{deltaMl:-45,reason:'Stale stock form',role:'manager',actorId:managerId}})).status,403);
  assert.equal((await f.store.get('SELECT status FROM pos_payments WHERE id=?','stale-admin-square')).status,'open');
  assert.equal((await f.call('/api/account',{cookie:guest})).data.memberships[0].bottles[0].remaining_ml,750);
  assert.equal((await f.store.get("SELECT count(*) n FROM audit WHERE action='square.payment_handled'")).n,0);
  assert.equal((await f.call('/api/staff/pos-payments/stale-admin-square',{method:'POST',cookie:manager,body})).data.recorded,true);
  assert.equal((await f.call('/api/account',{cookie:guest})).data.memberships[0].bottles[0].remaining_ml,705);
});
