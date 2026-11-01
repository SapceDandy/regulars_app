import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration } from '../apps/web/config.js';
import {serverFixture} from './helpers/http.js';


test('discovery pages expose metadata but private APIs require phone sign-in',async t=>{
  const f=await serverFixture(t);const page=await f.call('/v/copper-room');assert.equal(page.status,200);assert.match(page.data,/<title>The Copper Room/);assert.match(page.data,/noindex,nofollow/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.equal((await f.call('/api/account')).status,401);assert.equal((await f.call('/api/staff/copper-room')).status,401);
});
test('SMS consent, code expiry, attempt limits and one-time consumption are enforced',async t=>{
  const f=await serverFixture(t);const p='+12025550111';assert.equal((await f.call('/api/auth/start',{method:'POST',body:{phone:p}})).status,400);
  const start=await f.call('/api/auth/start',{method:'POST',body:{phone:p,smsConsent:true}});assert.match(start.data.demoCode,/^\d{6}$/);
  const verified=await f.call('/api/auth/verify',{method:'POST',body:{phone:p,code:start.data.demoCode}});assert.equal(verified.status,200);const cookie=verified.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.equal((await f.call('/api/auth/verify',{method:'POST',body:{phone:p,code:start.data.demoCode}})).status,401);
  const p2='+12025550112';const sent=await f.call('/api/auth/start',{method:'POST',body:{phone:p2,smsConsent:true}});for(let i=0;i<5;i++)assert.equal((await f.call('/api/auth/verify',{method:'POST',body:{phone:p2,code:'000000'}})).status,401);assert.equal((await f.call('/api/auth/verify',{method:'POST',body:{phone:p2,code:sent.data.demoCode}})).status,401);
});
test('origin checks prevent cross-site writes even with a valid session cookie',async t=>{
  const f=await serverFixture(t);const cookie=await f.login();assert.equal((await f.call('/api/memberships/guest',{method:'POST',origin:false,cookie,body:{venueId:'v_copper',planId:'v_copper_guest'}})).status,403);assert.equal((await f.store.get('SELECT count(*) n FROM memberships')).n,0);
});
test('full guest journey: sign in, buy, see booking, add guest pass, logout',async t=>{
  const f=await serverFixture(t);const cookie=await f.login();const venue=(await f.call('/api/venues/copper-room')).data;const body={venueId:venue.venue.id,kind:'ticket',resourceId:venue.resources[0].id,eventId:venue.events[0].id,partySize:1};
  const order=await f.call('/api/orders',{method:'POST',cookie,body,key:'test_checkout'});assert.equal(order.status,201);assert.equal(order.data.demo,true);
  assert.equal((await f.call(`/api/orders/${order.data.orderId}/demo-pay`,{method:'POST',cookie,body:{}})).status,200);
  assert.equal((await f.call('/api/memberships/guest',{method:'POST',cookie,body:{venueId:'v_copper',planId:'v_copper_guest'}})).status,201);
  const a=await f.call('/api/account',{cookie});assert.equal(a.data.reservations[0].state,'confirmed');assert.equal(a.data.memberships.length,1);assert.equal(a.data.memberships[0].pass_auth,undefined);
  await f.call('/api/auth/logout',{method:'POST',cookie,body:{}});assert.equal((await f.call('/api/account',{cookie})).status,401);
});
test('member data, orders and Wallet downloads are scoped to the authenticated owner',async t=>{
  const f=await serverFixture(t);const first=await f.login('+12025550113');await f.call('/api/memberships/guest',{method:'POST',cookie:first,body:{venueId:'v_copper',planId:'v_copper_guest'}});const a=(await f.call('/api/account',{cookie:first})).data;const second=await f.login('+12025550114');assert.equal((await f.call(`/api/wallet/google/${a.memberships[0].id}`,{cookie:second})).status,404);assert.equal((await f.call('/api/staff/copper-room',{cookie:second})).status,403);assert.equal((await f.call('/api/account',{cookie:second})).data.memberships.length,0);
});
test('venue staff can record service while ordinary members cannot',async t=>{
  const f=await serverFixture(t);const member=await f.login('+12025550115');const r=await f.call('/api/orders',{method:'POST',cookie:member,key:'membership',body:{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'}});await f.call(`/api/orders/${r.data.orderId}/demo-pay`,{method:'POST',cookie:member,body:{}});const mid=(await f.call('/api/account',{cookie:member})).data.memberships[0].id;
  assert.equal((await f.call(`/api/staff/members/${mid}/bottles`,{method:'POST',cookie:member,key:'bad',body:{name:'Synthetic bottle',capacityMl:750}})).status,403);
  const manager=await f.login('+12025550100');const bottle=await f.call(`/api/staff/members/${mid}/bottles`,{method:'POST',cookie:manager,key:'receive',body:{name:'Synthetic bottle',capacityMl:750}});assert.equal(bottle.status,201);
  const served=await f.call(`/api/staff/bottles/${bottle.data.id}`,{method:'POST',cookie:manager,key:'serve',body:{deltaMl:-45,reason:'Service'}});assert.equal(served.data.remainingMl,705);assert.equal((await f.call('/api/account',{cookie:member})).data.memberships[0].bottles[0].remaining_ml,705);
});
test('unconfigured Wallet buttons cannot return a fake native pass',async t=>{
  const f=await serverFixture(t);const cookie=await f.login('+12025550116');await f.call('/api/memberships/guest',{method:'POST',cookie,body:{venueId:'v_copper',planId:'v_copper_guest'}});const a=(await f.call('/api/account',{cookie})).data;assert.equal((await f.call(`/api/wallet/google/${a.memberships[0].id}`,{cookie})).status,503);assert.equal((await f.call('/api/config')).data.wallets.apple,false);
});
test('account queue can load its venue by ID and buy the enabled priority option',async t=>{
  const f=await serverFixture(t);const cookie=await f.login('+12025550117');const q=await f.call('/api/queue',{method:'POST',cookie,body:{venueId:'v_copper',partySize:2}});assert.equal(q.status,201);const account=(await f.call('/api/account',{cookie})).data;const venue=await f.call(`/api/venues/${account.queue[0].venue_id}`);assert.equal(venue.status,200);assert.equal(venue.data.queue.priceCents,2500);const order=await f.call('/api/orders',{method:'POST',cookie,key:'priority_test',body:{kind:'priority',venueId:'v_copper',queueId:q.data.queueId}});assert.equal(order.status,201);await f.call(`/api/orders/${order.data.orderId}/demo-pay`,{method:'POST',cookie,body:{}});assert.equal((await f.call('/api/account',{cookie})).data.queue[0].lane,'priority');
});
test('static asset paths are allowlisted and a venue slug cannot traverse files',async t=>{
  const f=await serverFixture(t);assert.equal((await f.call('/assets/../../package.json')).status,404);assert.equal((await f.call('/.env')).status,404);assert.equal((await f.call('/api/venues/not-a-venue')).status,404);const js=await f.call('/app.js');assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);
});
test('production refuses demo auth and live mode refuses missing providers or HTTP',()=>{
  assert.throws(()=>configuration({NODE_ENV:'production',APP_MODE:'demo'}),/Production cannot/);assert.throws(()=>configuration({APP_MODE:'live'}),/Configure/);assert.throws(()=>configuration({APP_MODE:'demo',HOST:'0.0.0.0'}),/localhost/);
});

test('pilot personas and viewport tools are unavailable unless the runtime is explicitly a pilot',async t=>{
  const f=await serverFixture(t);
  assert.equal((await f.call('/api/pilot/session',{method:'POST',body:{role:'manager'}})).status,404);
  assert.equal((await f.call('/pilot')).status,404);
  f.config.pilot=true;
  assert.equal((await f.call('/api/pilot/session',{method:'POST',body:{role:'owner'}})).status,400);
  assert.equal((await f.call('/api/pilot/session',{method:'POST',origin:false,body:{role:'manager'}})).status,403);
  const guest=await f.call('/api/pilot/session',{method:'POST',body:{role:'guest'}});
  assert.equal(guest.status,200);const guestCookie=guest.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call('/api/staff/copper-room',{cookie:guestCookie})).status,403);
  const manager=await f.call('/api/pilot/session',{method:'POST',body:{role:'manager'}});
  assert.equal(manager.status,200);const managerCookie=manager.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call('/api/staff/copper-room',{cookie:managerCookie})).status,200);
  const viewport=await f.call('/pilot?width=390&page=https://evil.example');
  assert.match(viewport.data,/src="\/" width="390"/);assert.doesNotMatch(viewport.data,/evil.example/);
});

test('profile edits persist only to the signed-in user and reject blank names',async t=>{
  const f=await serverFixture(t);const first=await f.login('+12025550131'),second=await f.login('+12025550132');
  const saved=await f.call('/api/account',{method:'PATCH',cookie:first,body:{name:'Pilot Updated',marketingOptIn:true}});
  assert.equal(saved.status,200);
  const account=(await f.call('/api/account',{cookie:first})).data;
  assert.equal(account.user.name,'Pilot Updated');assert.equal(account.user.marketingOptIn,true);
  assert.equal((await f.call('/api/account',{cookie:second})).data.user.name,'Test Patron');
  assert.equal((await f.call('/api/account',{method:'PATCH',cookie:first,body:{name:'   ',marketingOptIn:false}})).status,400);
  assert.equal((await f.call('/api/account',{cookie:first})).data.user.marketingOptIn,true);
  assert.equal((await f.call('/api/account',{method:'PATCH',cookie:first,body:{name:'Pilot Updated',marketingOptIn:false}})).status,200);
  assert.equal((await f.call('/api/account',{cookie:first})).data.user.marketingOptIn,false);
});

test('arrival HTTP flow enforces staff scope, opening time, grace deadline and single processing',async t=>{
  let clock=Date.now();const f=await serverFixture(t,{now:()=>clock});
  const guest=await f.login('+12025550141'),manager=await f.login('+12025550100'),outsider=await f.login('+12025550142');
  await f.store.run('INSERT INTO staff VALUES(?,?,?)',(await f.auth.session(outsider)).id,'v_social','manager');
  const page=(await f.call('/api/venues/copper-room')).data,game=page.events[0];
  const resources=await f.store.all("SELECT * FROM resources WHERE venue_id='v_copper' ORDER BY label LIMIT 2");
  const reservations=[];
  for(const resource of resources){
    const order=await f.call('/api/orders',{method:'POST',cookie:guest,key:`arrival-${resource.id}`,body:{kind:'ticket',venueId:'v_copper',eventId:game.id,resourceId:resource.id,partySize:1}});
    assert.equal(order.status,201);assert.equal((await f.call(`/api/orders/${order.data.orderId}/demo-pay`,{method:'POST',cookie:guest,body:{}})).status,200);
    reservations.push(await f.store.get('SELECT * FROM reservations WHERE order_id=?',order.data.orderId));
  }
  const [arrived,late]=reservations;
  const action=(r,cookie,value)=>f.call(`/api/staff/reservations/${r.id}`,{method:'POST',cookie,body:{action:value}});
  clock=arrived.starts_at-3600001;
  assert.equal((await action(arrived,manager,'attended')).status,409);
  clock++;
  assert.equal((await action(arrived,guest,'attended')).status,403);
  assert.equal((await action(arrived,outsider,'attended')).status,403);
  assert.equal((await action(arrived,manager,'attended')).status,200);
  assert.equal((await action(arrived,manager,'attended')).status,409);
  assert.equal((await f.call(`/api/orders/${arrived.order_id}/cancel`,{method:'POST',cookie:guest,body:{}})).status,409);
  clock=late.checkin_deadline;
  assert.equal((await action(late,manager,'no_show')).status,409);
  clock++;
  assert.equal((await action(late,manager,'no_show')).status,200);
  assert.equal((await action(late,manager,'attended')).status,409);
  const dashboard=(await f.call('/api/staff/copper-room',{cookie:manager})).data;
  assert.equal(dashboard.report.confirmed,0);assert.equal(dashboard.report.attended,1);
  const account=(await f.call('/api/account',{cookie:guest})).data;
  assert.deepEqual(account.reservations.map(r=>r.state).sort(),['attended','no_show']);
  assert.ok(account.orders.every(o=>o.state==='paid'));
});

test('failed delivery exhausts retries, hides provider secrets and recovers only through a venue manager',async t=>{
  let clock=Date.now();const f=await serverFixture(t,{now:()=>clock});
  const guest=await f.login('+12025550143'),manager=await f.login('+12025550100'),staff=await f.login('+12025550144'),outsider=await f.login('+12025550145');
  await f.store.run('INSERT INTO staff VALUES(?,?,?)',(await f.auth.session(staff)).id,'v_copper','staff');
  await f.store.run('INSERT INTO staff VALUES(?,?,?)',(await f.auth.session(outsider)).id,'v_social','manager');
  await f.call('/api/memberships/guest',{method:'POST',cookie:guest,body:{venueId:'v_copper',planId:'v_copper_guest'}});
  f.wallets.update=async()=>{throw new Error('private-provider-detail');};
  for(let i=0;i<8;i++){
    await f.jobs.tick();const job=await f.store.get('SELECT * FROM outbox LIMIT 1');
    assert.equal(job.attempts,i+1);assert.equal(job.status,i===7?'failed':'pending');clock=job.next_at;
  }
  const job=await f.store.get('SELECT * FROM outbox LIMIT 1');
  const listed=await f.call('/api/staff/copper-room/jobs',{cookie:manager});assert.equal(listed.status,200);assert.doesNotMatch(JSON.stringify(listed.data),/private-provider-detail/);
  assert.equal((await f.call('/api/staff/copper-room/jobs',{cookie:staff})).status,403);
  for(const cookie of [guest,staff,outsider])assert.equal((await f.call(`/api/staff/jobs/${job.id}/retry`,{method:'POST',cookie,body:{}})).status,403);
  assert.equal((await f.call(`/api/staff/jobs/${job.id}/retry`,{method:'POST',cookie:manager,body:{}})).status,200);
  let delivered=0;f.wallets.update=async()=>{delivered++;};await f.jobs.tick();await f.jobs.tick();
  assert.equal(delivered,1);assert.equal((await f.store.get('SELECT status FROM outbox WHERE id=?',job.id)).status,'done');
  assert.deepEqual((await f.call('/api/staff/copper-room/jobs',{cookie:manager})).data,[]);
  assert.equal((await f.call('/api/account',{cookie:guest})).data.memberships[0].active,true);
});
