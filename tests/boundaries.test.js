import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {types} from '@neondatabase/serverless';
import {createPostgresStore,openPostgresStore} from '../packages/db/postgres.js';
import {configuration,clientAddress} from '../apps/web/config.js';
import {phone,equal,text,overlap,escapeHtml} from '../packages/core/rules.js';
import {crc32,zip} from '../packages/integrations/zip.js';
import {demoConfig,seed} from '../packages/db/seed.js';
import {testStore} from './helpers/store.js';
import {fixture} from './helpers/fixture.js';
import {Regulars} from '../packages/core/regulars.js';
import {Auth} from '../packages/integrations/auth.js';
import {Jobs} from '../packages/integrations/jobs.js';
import {Payments} from '../packages/integrations/payments.js';
import {vercelHandler} from '../apps/web/vercel.js';
import entry,{config as entryConfig} from '../api/index.js';

async function fxt(t){const f=await fixture();t.after(()=>f.s.close());return f;}
function response(){return{headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(body){this.body=body;}};}

test('configuration validates proxies, embed origins and missing request addresses',()=>{
  assert.equal(configuration().mode,'demo');const c=configuration({EMBED_ORIGINS:'https://venue.example/path, https://other.example',TRUSTED_PROXY_IPS:'127.0.0.1, ::1'});assert.deepEqual(c.embedOrigins,['https://venue.example','https://other.example']);
  assert.throws(()=>configuration({EMBED_ORIGINS:'http://insecure.example'}));assert.throws(()=>configuration({TRUSTED_PROXY_IPS:'untrusted-host'}));
  assert.equal(clientAddress({socket:{},headers:{}},c),'unknown');
  assert.equal(clientAddress({socket:{remoteAddress:'::1'},headers:{}},c),'::1');
  assert.equal(clientAddress({socket:{remoteAddress:'::1'},headers:{'x-forwarded-for':'forged, invalid'}},c),'::1');
  assert.equal(clientAddress({socket:{remoteAddress:'::1'},headers:{'x-forwarded-for':'forged, 203.0.113.5'}},c),'203.0.113.5');
});

test('phone normalization, text bounds, interval edges, HTML encoding and ZIP CRC match contracts',()=>{
  assert.equal(phone('(202) 555-0101'),'+12025550101');assert.equal(phone('12025550101'),'+12025550101');assert.equal(phone('+442079460123'),'+442079460123');assert.throws(()=>phone());
  assert.equal(equal(null,undefined),true);assert.equal(equal('one','two'),false);assert.equal(text('  ready  ','name'),'ready');assert.throws(()=>text('x'.repeat(121),'name'));
  assert.equal(overlap(0,10,10,20),false);assert.equal(overlap(10,20,0,10),false);assert.equal(overlap(0,10,9,20),true);
  assert.equal(escapeHtml(null),'');assert.equal(escapeHtml('&<>"\''),'&amp;&lt;&gt;&quot;&#39;');assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);const bytes=zip({'sample.txt':'123456789'});assert.equal(bytes.readUInt32LE(14),0xcbf43926);assert.equal(zip({}).readUInt32LE(0),0x06054b50);
});

test('PostgreSQL adapter rolls back schema-scoped errors, preserves original errors and releases clients',async()=>{
  const statements=[];let released=0,ended=0,broken=false;const error=new Error('query failed');
  const pool={query:async()=>({rows:[{ok:true}]}),connect:async()=>({query:async(sql)=>{statements.push(sql);if(broken&&(sql==='SELECT broken'||sql==='ROLLBACK'))throw error;return{rows:[{ok:true}]};},release(){released++;}}),end:async()=>{ended++;}};
  const s=createPostgresStore(pool,{schema:'regulars_pilot'});assert.deepEqual(await s.all('SELECT ok'),[{ok:true}]);assert.equal((await s.run('UPDATE value')).changes,0);
  assert.deepEqual(statements.slice(0,4),['BEGIN','SET LOCAL search_path TO regulars_pilot','SELECT ok','COMMIT']);
  broken=true;await assert.rejects(s.get('SELECT broken'),e=>e===error);assert.equal(statements.at(-1),'ROLLBACK');
  await assert.rejects(s.transaction(async()=>{await s.get('SELECT broken');}),e=>e===error);
  broken=false;await assert.rejects(s.transaction(()=>s.transaction(()=>{})),/Nested/);assert.equal(released,5);await s.close();assert.equal(ended,1);
  assert.throws(()=>createPostgresStore(pool,{schema:'unsafe'}));assert.throws(()=>openPostgresStore());assert.throws(()=>openPostgresStore('test',{schema:'unsafe'}));
  const safe=openPostgresStore('postgres://fixture:fixture@localhost:1/test');await safe.close(); // A lazy pool does not connect until queried.
  const parse=types.getTypeParser(20);assert.equal(parse('9007199254740991'),Number.MAX_SAFE_INTEGER);assert.throws(()=>parse('9007199254740992'),/safe range/);
});

test('approved venue import supports explicit inventory, optional fields, existing staff and atomic failure',async t=>{
  const store=await testStore();t.after(()=>store.close());const v=demoConfig().venues[0];delete v.games;delete v.staff;delete v.priorityBaseCents;
  Object.assign(v,{approved:true,demo:false,plans:[{key:'guest',name:'Guest',priceCents:0,durationDays:30}]});
  const dir=mkdtempSync(join(tmpdir(),'regulars-config-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'venues.json');writeFileSync(path,JSON.stringify({venues:[v]}));await seed(store,{mode:'live',configPath:path});assert.equal((await store.get('SELECT count(*) n FROM lockers')).n,0);assert.equal((await store.get('SELECT count(*) n FROM resources')).n,0);assert.equal((await store.get('SELECT priority_base_cents FROM venues')).priority_base_cents,2500);
  const second={...v,id:'second',slug:'second',staff:[{phone:'+12025550199',name:'Test Staff'}],lockers:[{label:'S1',mode:'shared',positions:2}],resources:[{label:'Table',kind:'table',capacity:4}]};const third={...second,id:'third',slug:'third'};
  await seed(store,{mode:'live',configJson:JSON.stringify({venues:[second,third]})});assert.equal((await store.get('SELECT count(*) n FROM users')).n,1);assert.equal((await store.get('SELECT role FROM staff LIMIT 1')).role,'staff');
  for(const change of [{approved:false},{demo:true},{slug:'bad slug'},{lockers:[{label:'Bad',mode:'private',positions:2}]},{plans:undefined}]){
    const bad={...v,id:'bad',slug:'bad',...change};await assert.rejects(seed(store,{mode:'live',configJson:JSON.stringify({venues:[bad]})}));assert.equal(await store.get("SELECT id FROM venues WHERE id='bad'"),undefined);
  }
});

test('auth handles rate-window reset, resend cooldown, invalid codes and missing sessions',async t=>{
  const f=await fxt(t),c=configuration({APP_MODE:'demo'}),a=new Auth(f.s,c,{now:f.now});
  assert.ok(new Auth(f.s,c).now()>0);assert.ok(new Regulars(f.s).now()>0);
  await a.limit('test',1,1000);await assert.rejects(a.limit('test',1,1000),{status:429});f.advance(1000);await a.limit('test',1,1000);
  const input={phone:'+12025550165',smsConsent:true};const first=await a.start(input,'fixture');await assert.rejects(a.start(input,'fixture'),{status:429});f.advance(60001);const second=await a.start(input,'fixture');assert.match(second.demoCode,/^\d{6}$/);
  await assert.rejects(a.verify({phone:input.phone},'fixture'),{status:400});const result=await a.verify({phone:input.phone,code:second.demoCode,marketingOptIn:true},'fixture');assert.equal((await f.s.get('SELECT marketing_opt_in FROM users WHERE id=?',result.userId)).marketing_opt_in,1);
  assert.equal(await a.session('regulars_session='+'x'.repeat(101)),null);assert.equal(await a.session('regulars_session=unknown'),null);await a.revoke();await a.revoke('other=value');
  const live=new Auth(f.s,{...c,mode:'live'},{now:f.now,request:async()=>{throw Error('provider unavailable');}});await assert.rejects(live.start({phone:'+12025550166',smsConsent:true},'fixture'),/provider/);assert.equal(await f.s.get('SELECT phone FROM challenges WHERE phone=?','+12025550166'),undefined);
});

test('domain edge cases preserve guest identity, priority bounds and pass revisions',async t=>{
  const f=await fxt(t);await f.app.touch('missing');const guest=await f.app.enrollGuest(f.uid,'v_copper','v_copper_guest');assert.equal((await f.app.enrollGuest(f.uid,'v_copper','v_copper_guest')).membershipId,guest.membershipId);
  const m=await f.app.membershipSnapshot(guest.membershipId);f.setTime(m.ends_at);await f.app.enrollGuest(f.uid,'v_copper','v_copper_guest');assert.equal((await f.app.membershipSnapshot(m.id)).active,true);
  for(let i=0;i<4;i++){const uid=await f.user(`+1202555018${i}`),q=await f.app.joinQueue(uid,'v_copper',1);assert.equal((await f.app.joinQueue(uid,'v_copper',1)).queueId,q.queueId);const order=await f.app.createOrder(uid,{kind:'priority',venueId:'v_copper',queueId:q.queueId},`priority-${i}`);await f.paid(order);if(i===0)await assert.rejects(f.app.leaveQueue(uid,q.queueId),{status:409});}
  assert.equal((await f.app.venuePage('v_copper')).queue.priceCents,null);assert.match((await f.app.answer('v_copper','How do I book a table?')).answer,/published game/);
});

test('stock receive retry cannot move a bottle between members and staff views omit manager reports',async t=>{
  const f=await fxt(t),m=await f.member(),other=await f.member(f.other);await f.app.addBottle(f.manager,m.id,{name:'Test',capacityMl:750},'same-key');await assert.rejects(f.app.addBottle(f.manager,other.id,{name:'Test',capacityMl:750},'same-key'),{status:409});
  await f.s.run('INSERT INTO staff VALUES(?,?,?)',f.other,'v_copper','staff');const dashboard=await f.app.staffDashboard(f.other,'v_copper');assert.equal(dashboard.report,null);assert.deepEqual(dashboard.campaigns,[]);
  const ticket=await f.ticket();await f.s.run('UPDATE orders SET stripe_session=? WHERE id=?','cs_expected',ticket.id);await assert.rejects(f.app.settle({eventId:'wrong-session',orderId:ticket.id,amount:ticket.amount_cents,currency:'usd',paymentIntent:'pi',sessionId:'wrong'}),{status:409});
  await f.app.settle({eventId:'right-session',orderId:ticket.id,amount:ticket.amount_cents,currency:'usd',paymentIntent:'pi',sessionId:'cs_expected'});const before=(await f.app.membershipSnapshot(m.id)).revision;await f.app.cancelOrder(f.uid,ticket.id);assert.ok((await f.app.membershipSnapshot(m.id)).revision>before);
});

test('one Jobs instance ignores overlapping ticks and unknown delivery kinds remain retryable',async t=>{
  const f=await fxt(t);await f.app.enqueue('unknown','missing');let release,entered;const ready=new Promise(r=>entered=r),blocked=new Promise(r=>release=r);const app={now:f.now,cleanup:async()=>{entered();await blocked;}};const j=new Jobs(f.s,app,{wallets:{},payments:{}});const first=j.tick();await ready;await j.tick();release();await first;assert.equal(j.busy,false);assert.equal((await f.s.get('SELECT attempts FROM outbox')).attempts,1);
});

test('Vercel entry and startup guards close pools and retry failed migrations on the next invocation',async t=>{
  t.mock.method(console,'error',()=>{});assert.deepEqual(entryConfig,{api:{bodyParser:false}});const noAuth=response();await entry({url:'/api/cron',headers:{},method:'POST'},noAuth);assert.equal(noAuth.status,401);
  const base={DATABASE_URL:'fixture',SESSION_SECRET:'s'.repeat(40),VERCEL_ENV:'preview',VERCEL_URL:'pilot.example',VERCEL:'1',PILOT_TESTING_ENABLED:'true'};let migrations=0,closed=0,ticks=0;
  const h=vercelHandler({env:base,openStore:()=>({migrate:async()=>{if(++migrations===1)throw Error('migration');},close:async()=>{closed++;}}),createApp:async()=>({handler:async(req,res)=>{res.end('ok');},jobs:{tick:async()=>{ticks++;}}})});
  const failed=response();await h({url:'/',method:'GET',headers:{}},failed);assert.equal(failed.status,503);await h({url:'/',method:'POST',headers:{}},response());assert.equal(migrations,2);assert.equal(closed,2);assert.equal(ticks,1);
  for(const env of [{},{DATABASE_URL:'test',VERCEL_ENV:'preview'},{DATABASE_URL:'test',VERCEL_ENV:'preview',STRIPE_SECRET_KEY:'sk_live_fixture'},{DATABASE_URL:'test'}]){const r=response();await vercelHandler({env})({url:'/',headers:{}},r);assert.equal(r.status,503);}
  const liveEnv={DATABASE_URL:'test',VERCEL_ENV:'preview',VERCEL_URL:'preview.example',STRIPE_SECRET_KEY:'sk_test_fixture',SESSION_SECRET:'s'.repeat(40),TWILIO_ACCOUNT_SID:'test',TWILIO_AUTH_TOKEN:'test',TWILIO_VERIFY_SERVICE_SID:'test',STRIPE_WEBHOOK_SECRET:'test',VENUE_CONFIG_JSON:'{}'};
  const live=vercelHandler({env:liveEnv,openStore:()=>({migrate:async()=>{},close:async()=>{}}),createApp:async({config})=>{assert.equal(config.origin,'https://preview.example');return{handler:async(req,res)=>{res.writeHead(200);throw Error('after headers');}};}});const r=response();await live({url:'/',method:'GET',headers:{}},r);assert.equal(r.status,200);
});

test('PostgreSQL direct queries and successful rollback paths release connections',async()=>{
  const calls=[];const pool={query:async(sql)=>{calls.push(sql);return{rows:[{value:1}],rowCount:2};},connect:async()=>({query:async(sql)=>{calls.push(sql);if(sql==='BROKEN')throw Error('original');return{rows:[],affectedRows:3};},release:()=>calls.push('release')}),end:async()=>{}};
  const direct=createPostgresStore(pool);assert.deepEqual(await direct.all('SELECT ?'),[{value:1}]);assert.equal((await direct.run('UPDATE ?')).changes,2);
  const pilot=createPostgresStore(pool,{schema:'regulars_pilot'});await assert.rejects(pilot.get('BROKEN'),/original/);assert.deepEqual(calls.slice(-2),['ROLLBACK','release']);
  await assert.rejects(direct.transaction(()=>{throw Error('transaction');}),/transaction/);assert.deepEqual(calls.slice(-2),['ROLLBACK','release']);assert.equal((await pilot.run('UPDATE fixture')).changes,3);
});

test('priority cancellation refunds waiting groups but protects already-called service',async t=>{
  const f=await fxt(t);const q=await f.app.joinQueue(f.uid,'v_copper',2);let o=await f.app.createOrder(f.uid,{kind:'priority',venueId:'v_copper',queueId:q.queueId},'waiting');await f.paid(o);assert.deepEqual(await f.app.cancelOrder(f.uid,o.id),{refundPending:true});
  o=await f.app.createOrder(f.uid,{kind:'priority',venueId:'v_copper',queueId:q.queueId},'called');await f.paid(o);await f.app.queueAction(f.manager,q.queueId,'called');await assert.rejects(f.app.cancelOrder(f.uid,o.id),{status:409});
  assert.match(new Auth(f.s,{secure:true}).cookie('fixture'),/; Secure$/);
});
