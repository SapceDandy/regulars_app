import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {serverFixture} from './helpers/http.js';

async function member(f,cookie){const r=await f.call('/api/memberships/guest',{method:'POST',cookie,body:{venueId:'v_copper',planId:'v_copper_guest'}});assert.equal(r.status,201);return f.store.get('SELECT * FROM memberships WHERE id=?',r.data.membershipId);}

test('Apple registration protocol enforces pass authorization, validates tags and unregisters idempotently',async t=>{
  const f=await serverFixture(t),cookie=await f.login(),m=await member(f,cookie);f.config.env.APPLE_PASS_TYPE_ID='pass.test.regulars';
  const base='/api/wallet/apple/v1/devices/device/registrations/pass.test.regulars',path=`${base}/${m.id}`,headers={authorization:`ApplePass ${m.pass_auth}`},body={pushToken:'a'.repeat(64)};
  assert.equal((await f.call(path,{method:'POST',body})).status,401);
  assert.equal((await f.call(path,{method:'POST',headers,body:{pushToken:'bad'}})).status,400);
  assert.equal((await f.call(path,{method:'POST',headers,body})).status,201);
  assert.equal((await f.call(path,{method:'POST',headers,body})).status,200);
  const update=await f.call(base);assert.equal(update.status,200);assert.deepEqual(update.data.serialNumbers,[m.id]);
  assert.equal((await f.call(`${base}?passesUpdatedSince=${update.data.lastUpdated}`)).status,204);
  for(const tag of ['-1','invalid','1.5','9007199254740992'])assert.equal((await f.call(`${base}?passesUpdatedSince=${tag}`)).status,400);
  assert.equal((await f.call(base.replace('pass.test.regulars','pass.wrong'))).status,404);
  assert.equal((await f.call(path.replace('pass.test.regulars','pass.wrong'),{method:'POST',headers,body})).status,404);
  assert.equal((await f.call(path,{method:'PUT',headers,body})).status,404);
  for(let i=0;i<2;i++)assert.equal((await f.call(path,{method:'DELETE',headers})).status,200);
  assert.equal((await f.call(base)).status,204);
  assert.equal((await f.call('/api/wallet/apple/v1/log',{method:'POST',raw:'device log',headers:{'content-type':'text/plain'}})).status,200);
});

test('Wallet download and conditional Apple updates use owner authorization and revision tags',async t=>{
  const f=await serverFixture(t),cookie=await f.login(),m=await member(f,cookie);f.config.env.APPLE_PASS_TYPE_ID='pass.test.regulars';
  f.wallets.apple=async mid=>{assert.equal(mid,m.id);return Buffer.from('signed-pass-fixture');};f.wallets.google=async()=> 'https://pay.google.com/test-fixture';
  const download=await f.call(`/api/wallet/apple/${m.id}`,{cookie});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/regulars.pkpass/);assert.equal(download.data,'signed-pass-fixture');
  assert.equal((await f.call(`/api/wallet/google/${m.id}`,{cookie})).data.url,'https://pay.google.com/test-fixture');
  const path=`/api/wallet/apple/v1/passes/pass.test.regulars/${m.id}`,headers={authorization:`ApplePass ${m.pass_auth}`};
  assert.equal((await f.call(path.replace('pass.test.regulars','pass.wrong'),{headers})).status,404);
  const pass=await f.call(path,{headers});assert.equal(pass.status,200);assert.equal(pass.headers.get('etag'),`"${m.revision}"`);
  assert.equal((await f.call(path,{headers:{...headers,'if-none-match':pass.headers.get('etag')}})).status,304);
  assert.equal((await f.call(path,{headers:{...headers,'if-modified-since':new Date(m.pass_updated_at+1000).toUTCString()}})).status,304);
  assert.equal((await f.call(path,{headers:{...headers,'if-modified-since':'not a date'}})).status,200);
  assert.equal((await f.call(path,{headers:{...headers,'if-none-match':'"old"'}})).status,200);
});

test('queue HTTP transitions, pass lookup and campaign approval enforce venue roles',async t=>{
  const f=await serverFixture(t),guest=await f.login(),manager=await f.login('+12025550100'),m=await member(f,guest);
  const lookup=await f.call('/api/staff/copper-room/lookup',{method:'POST',cookie:manager,body:{token:m.pass_token}});assert.equal(lookup.status,200);assert.equal(lookup.data.id,m.id);assert.equal(lookup.data.pass_auth,undefined);
  const q=await f.call('/api/queue',{method:'POST',cookie:guest,body:{venueId:'v_copper',partySize:2}});const path=`/api/staff/queue/${q.data.queueId}`;
  assert.equal((await f.call(path,{method:'POST',cookie:guest,body:{action:'called'}})).status,403);
  for(const action of ['called','seated'])assert.equal((await f.call(path,{method:'POST',cookie:manager,body:{action}})).data.state,action);
  assert.equal((await f.call(path,{method:'POST',cookie:manager,body:{action:'called'}})).status,409);
  assert.equal((await f.call('/api/staff/queue/missing',{method:'POST',cookie:manager,body:{action:'called'}})).status,404);
  const q2=await f.call('/api/queue',{method:'POST',cookie:guest,body:{venueId:'v_copper',partySize:1}});
  assert.equal((await f.call(`/api/queue/${q2.data.queueId}/leave`,{method:'POST',cookie:guest,body:{}})).status,200);
  assert.equal((await f.call('/api/queue/missing/leave',{method:'POST',cookie:guest,body:{}})).status,404);
  const campaign=await f.store.get("SELECT id FROM campaigns WHERE venue_id='v_copper' LIMIT 1"),approve=`/api/staff/campaigns/${campaign.id}/approve`;
  assert.equal((await f.call(approve,{method:'POST',cookie:guest,body:{}})).status,403);
  assert.equal((await f.call(approve,{method:'POST',cookie:manager,body:{}})).data.approved,true);
  assert.equal((await f.store.get('SELECT state FROM campaigns WHERE id=?',campaign.id)).state,'approved');
  assert.equal((await f.call('/api/staff/campaigns/missing/approve',{method:'POST',cookie:manager,body:{}})).status,404);
});

test('policy answers and partner inquiries validate data and persist only valid submissions',async t=>{
  const f=await serverFixture(t);
  for(const question of ['When can I check in?','How do lockers work?','What is priority?','Can I cancel?','What is the weather?']){const r=await f.call('/api/venues/copper-room/ask',{method:'POST',body:{question}});assert.equal(r.status,200);assert.equal(typeof r.data.source,'string');assert.ok(r.data.answer.length);}
  const body={venueName:'Synthetic pilot',name:'Test operator',email:'test@example.invalid'};
  assert.equal((await f.call('/api/partners',{method:'POST',body:{...body,email:'invalid'}})).status,400);
  assert.equal((await f.call('/api/partners',{method:'POST',body})).status,201);assert.equal((await f.store.get('SELECT count(*) n FROM leads')).n,1);
});

test('HTTP parsing, metadata and static methods enforce boundary contracts',async t=>{
  const f=await serverFixture(t);
  for(const raw of ['{','[]','null','"text"'])assert.equal((await f.call('/api/auth/start',{method:'POST',raw})).status,400);
  assert.equal((await f.call('/api/auth/start',{method:'POST',raw:'x'.repeat(128*1024+1)})).status,413);
  assert.equal((await f.call('/api/auth/start',{method:'POST',headers:{'content-type':'text/plain'},raw:'{}'})).status,415);
  assert.equal((await f.call('/api/auth/start',{method:'POST'})).status,400);
  assert.equal((await f.call('/api/config',{method:'OPTIONS'})).status,405);
  assert.equal((await f.call('/venues',{method:'POST',body:{}})).status,405);
  assert.equal((await f.call('/healthz')).data.ok,true);
  for(const path of ['/app.js','/styles.css','/assets/mark.svg','/assets/icon.png','/assets/icon@2x.png','/venues'])assert.equal((await f.call(path,{method:'HEAD'})).data,'');
  assert.match((await f.call('/robots.txt')).data,/Disallow: \/\n/);assert.match((await f.call('/sitemap.xml')).data,/copper-room/);
  f.config.mode='live';f.config.secure=true;f.config.embedOrigins=['https://venue.example'];
  const page=await f.call('/');assert.equal(page.headers.get('x-frame-options'),null);assert.match(page.headers.get('content-security-policy'),/https:\/\/venue.example/);assert.ok(page.headers.get('strict-transport-security'));assert.doesNotMatch(page.data,/noindex/);assert.match((await f.call('/account')).data,/noindex/);assert.match((await f.call('/robots.txt')).data,/Sitemap:/);
  f.app.catalog=async()=>{throw Error('private-provider-secret');};t.mock.method(console,'error',()=>{});const error=await f.call('/api/venues');assert.equal(error.status,500);assert.doesNotMatch(JSON.stringify(error.data),/private-provider-secret/);
});

test('raw Stripe webhook route verifies signed bytes and rejects demo settlement in live mode',async t=>{
  const f=await serverFixture(t),cookie=await f.login(),venue=(await f.call('/api/venues/copper-room')).data;
  const order=await f.call('/api/orders',{method:'POST',cookie,key:'route-payment',body:{venueId:'v_copper',kind:'ticket',resourceId:venue.resources[0].id,eventId:venue.events[0].id,partySize:1}});const oid=order.data.orderId;
  assert.equal((await f.call(`/api/orders/${oid}`,{cookie})).status,200);assert.equal((await f.call(`/api/orders/${oid}/resume`,{method:'POST',cookie,body:{}})).status,200);
  assert.equal((await f.call('/api/webhooks/stripe',{method:'POST',raw:'{}'})).status,404);
  f.config.mode='live';f.config.env.STRIPE_WEBHOOK_SECRET='fixture-secret';const stored=await f.app.order((await f.auth.session(cookie)).id,oid);
  const raw=JSON.stringify({id:'evt_route',type:'checkout.session.completed',data:{object:{id:'cs_route',payment_status:'paid',metadata:{order_id:oid},amount_total:stored.amount_cents,currency:'usd',payment_intent:'pi_route'}}}),stamp=Math.floor(f.app.now()/1000),signature=`t=${stamp},v1=${createHmac('sha256','fixture-secret').update(`${stamp}.${raw}`).digest('hex')}`;
  assert.equal((await f.call('/api/webhooks/stripe',{method:'POST',origin:false,raw,headers:{'stripe-signature':signature}})).data.paid,true);
  assert.equal((await f.call(`/api/orders/${oid}/demo-pay`,{method:'POST',cookie,body:{}})).status,404);
});

test('manager job retry handles refund subjects, missing jobs and deleted subjects',async t=>{
  const f=await serverFixture(t),cookie=await f.login('+12025550100');
  assert.equal((await f.call('/api/staff/jobs/missing/retry',{method:'POST',cookie,body:{}})).status,404);
  await f.app.enqueue('refund','missing-order');const job=await f.store.get('SELECT * FROM outbox LIMIT 1');assert.equal((await f.call(`/api/staff/jobs/${job.id}/retry`,{method:'POST',cookie,body:{}})).status,404);
  const venue=(await f.call('/api/venues/copper-room')).data,uid=(await f.auth.session(cookie)).id;
  const order=await f.app.createOrder(uid,{kind:'ticket',venueId:'v_copper',eventId:venue.events[0].id,resourceId:venue.resources[0].id,partySize:1},'job-subject');await f.store.run('UPDATE outbox SET subject_id=? WHERE id=?',order.id,job.id);
  assert.equal((await f.call(`/api/staff/jobs/${job.id}/retry`,{method:'POST',cookie,body:{}})).status,200);
});
