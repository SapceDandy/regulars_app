import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../apps/web/server.js';
import { configuration } from '../apps/web/config.js';
import { openStore } from '../packages/db/store.js';

async function serverFixture(t) {
  const config=configuration({APP_MODE:'demo',PUBLIC_ORIGIN:'http://127.0.0.1:3000'});const store=openStore();const r=createApplication({config,store});await new Promise(resolve=>r.server.listen(0,'127.0.0.1',resolve));config.origin=`http://127.0.0.1:${r.server.address().port}`;
  t.after(async()=>{r.server.closeAllConnections();await new Promise(resolve=>r.server.close(resolve));store.close();});
  const call=async(path,{method='GET',body,cookie,origin=true,key}={})=>{
    const response=await fetch(config.origin+path,{method,headers:{...(origin?{origin:config.origin}:{}),...(method!=='GET'?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(key?{'idempotency-key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const content=response.headers.get('content-type')??'';return {status:response.status,headers:response.headers,data:content.includes('json')?await response.json():await response.text()};
  };
  const login=async(phone='+12025550101')=>{const start=await call('/api/auth/start',{method:'POST',body:{phone,smsConsent:true}});assert.equal(start.status,200);const verify=await call('/api/auth/verify',{method:'POST',body:{phone,code:start.data.demoCode,name:'Test Patron'}});assert.equal(verify.status,200);return verify.headers.get('set-cookie').split(';')[0];};
  return {...r,call,login};
}

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
  const f=await serverFixture(t);const cookie=await f.login();assert.equal((await f.call('/api/memberships/guest',{method:'POST',origin:false,cookie,body:{venueId:'v_copper',planId:'v_copper_guest'}})).status,403);assert.equal(f.store.get('SELECT count(*) n FROM memberships').n,0);
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
