// Opt-in, disposable-data rehearsal. Never imported by an HTTP route.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {databaseConfiguration,openPostgresStore} from '../../packages/db/postgres.js';
import {seed} from '../../packages/db/seed.js';
import {Regulars} from '../../packages/core/regulars.js';
import {operatorAction} from '../../packages/core/operations.js';
import {Jobs} from '../../packages/integrations/jobs.js';

const schema='regulars_pilot';
const tables=[...readFileSync(new URL('../../packages/db/schema.postgres.sql',import.meta.url),'utf8').matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\(/g)].map(x=>x[1]);
const meta=new Set(['schema_version','wallet_revision']);
function configuration(env) {
  assert.equal(env.DATABASE_PROVIDER,'supabase');
  assert.equal(env.VERCEL_ENV,'preview');
  assert.equal(env.VERCEL_GIT_COMMIT_REF,'codex/provider-pilot');
  assert.match(env.REGULARS_HOSTED_REHEARSAL,/^[a-z]{20}$/);
  const config=databaseConfiguration(env,{pilot:true}),url=new URL(config.connectionString);
  assert.equal(url.username,`regulars_runtime.${env.REGULARS_HOSTED_REHEARSAL}`);
  assert.match(url.hostname,/\.pooler\.supabase\.com$/);assert.equal(url.port,'6543');
  return config;
}
const open=config=>openPostgresStore(config.connectionString,config);
async function action(store,input) {
  const app=new Regulars(store,{now:()=>input.now});
  if(input.action==='order')return app.createOrder(input.user,input.body,input.key);
  if(input.action==='stock')return app.adjustBottle(input.actor,input.bottle,input.body,input.key);
  if(input.action==='square')return app.resolveSquarePayment(input.actor,input.payment,input.body);
  if(input.action==='operator')return operatorAction(app,'staff',input.body);
  if(input.action==='jobs'){
    // Deliberately synthetic transports. Never instantiate a payment, SMS or Wallet client.
    const deliver=async subject=>{if(input.fail)throw Object.assign(Error('synthetic outage'),{status:503});await app.audit(null,null,'rehearsal.delivered',subject,{});};
    await new Jobs(store,app,{wallets:{update:deliver},payments:{refund:deliver}}).tick();return {processed:true};
  }
  throw Error('Unknown rehearsal action');
}
async function worker(config) {
  const store=open(config);
  try {
    assert.equal((await store.get('SELECT current_schema() AS name')).name,schema);
    process.send({ready:true});
    const input=await new Promise(resolve=>process.once('message',resolve));
    try {process.send({ok:true,value:await action(store,input)});}
    catch(error){process.send({ok:false,status:error.status??500});}
  } finally {await store.close();process.disconnect();}
}
async function race(inputs) {
  const children=inputs.map(()=>fork(fileURLToPath(import.meta.url),['--worker'],{stdio:['ignore','ignore','ignore','ipc']}));
  try {
    await Promise.all(children.map(child=>new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Worker startup timed out')),15_000);
      child.once('message',message=>{clearTimeout(timeout);message.ready?resolve():reject(Error('Worker not ready'));});
      child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('Worker startup failed'));});
    })));
    const responses=children.map(child=>new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Worker action timed out')),30_000);
      child.once('message',message=>{clearTimeout(timeout);resolve(message);});
      child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('Worker failed'));});
    }));
    children.forEach((child,index)=>child.send(inputs[index]));
    const result=await Promise.all(responses);
    await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve))));
    return result;
  } finally {for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');}
}
async function snapshot(store){const rows={};for(const table of tables)rows[table]=await store.all(`SELECT * FROM ${schema}.${table}`);return rows;}
function canonical(rows){return Object.fromEntries(tables.map(table=>[table,rows[table].map(row=>JSON.stringify(row)).sort()]));}
async function clear(store){await store.run(`TRUNCATE TABLE ${tables.map(t=>`${schema}.${t}`).join(',')}`);}
async function restore(store,rows){await store.transaction(async()=>{await clear(store);for(const table of tables)for(const row of rows[table]){const columns=Object.keys(row);assert.ok(columns.every(c=>/^\w+$/.test(c)));await store.run(`INSERT INTO ${schema}.${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,...Object.values(row));}});}
async function protectedCounts(store){const counts={};for(const table of tables)counts[table]=(await store.get(`SELECT count(*) n FROM regulars.${table}`)).n;return counts;}

async function run(config) {
  const store=open(config),now=Date.now();let owned=false,step='schema preflight';const passed=[];
  const pass=name=>{passed.push(name);console.log(`HOSTED PASS: ${name}`);};
  let baseline;
  try {
    const state=await store.get("SELECT current_user AS role,current_schema() AS schema,(SELECT count(*) FROM pg_tables WHERE schemaname='regulars_pilot' AND rowsecurity) AS protected_tables,has_schema_privilege('anon','regulars_pilot','USAGE') AS anon_access,has_schema_privilege('authenticated','regulars_pilot','USAGE') AS authenticated_access");
    assert.equal(state.role,'regulars_runtime');assert.equal(state.schema,schema);assert.equal(state.protected_tables,tables.length);assert.equal(state.anon_access,false);assert.equal(state.authenticated_access,false);
    baseline=await protectedCounts(store);
    await store.transaction(async()=>{
      for(const table of tables)if(!meta.has(table))assert.equal((await store.get(`SELECT count(*) n FROM ${schema}.${table}`)).n,0,'Refuse to overwrite nonempty rehearsal data');
      await store.run("INSERT INTO rate_limits VALUES('hosted_rehearsal_owner',1,?)",now+3600000);
    });owned=true;
    await seed(store,{now});
    const app=new Regulars(store,{now:()=>now});
    for(const [id,phone] of [['hosted_guest_a','+12025550101'],['hosted_guest_b','+12025550102']])await store.run('INSERT INTO users(id,phone,name,created_at) VALUES(?,?,?,?)',id,phone,'Synthetic hosted test',now);
    const manager=(await store.get("SELECT id FROM users WHERE phone='+12025550100'")).id;
    const games=await store.all("SELECT * FROM events WHERE venue_id='v_copper' ORDER BY starts_at"),resource=(await store.get("SELECT id FROM resources WHERE venue_id='v_copper' AND kind='table' ORDER BY label LIMIT 1")).id;
    const ticket={kind:'ticket',venueId:'v_copper',eventId:games[0].id,resourceId:resource,partySize:2};
    step='competing last-seat booking';let results=await race(['hosted_guest_a','hosted_guest_b'].map(user=>({action:'order',user,body:ticket,key:`race-${user}`,now})));
    assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).status,409);assert.equal((await store.get('SELECT count(*) n FROM reservations')).n,1);pass(step);
    step='duplicate checkout retry';const retry={action:'order',user:'hosted_guest_a',body:{...ticket,eventId:games[1].id},key:'same-checkout',now};results=await race([retry,retry]);assert.ok(results.every(r=>r.ok));assert.equal(results[0].value.id,results[1].value.id);pass(step);
    const order=await app.createOrder('hosted_guest_a',{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'},'hosted-member');
    await app.settle({eventId:'synthetic_hosted_paid',orderId:order.id,amount:order.amount_cents,currency:'usd',paymentIntent:'synthetic_hosted_payment'});
    const membership=(await app.account('hosted_guest_a')).memberships[0];const bottle=await app.addBottle(manager,membership.id,{name:'Synthetic bottle',capacityMl:750},'hosted-bottle');
    step='duplicate bottle service';const service={action:'stock',actor:manager,bottle:bottle.id,body:{deltaMl:-45,reason:'Synthetic service'},key:'same-pour',now};results=await race([service,service]);assert.ok(results.every(r=>r.ok));assert.equal((await store.get('SELECT remaining_ml FROM bottles WHERE id=?',bottle.id)).remaining_ml,705);pass(step);
    step='concurrent overdraw prevention';results=await race(['a','b'].map(key=>({...service,key:`large-${key}`,body:{deltaMl:-500,reason:'Synthetic overdraw race'}})));assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).status,409);assert.equal((await store.get('SELECT remaining_ml FROM bottles WHERE id=?',bottle.id)).remaining_ml,205);pass(step);
    step='Square service matching replay';await app.recordSquarePayment({id:'synthetic_hosted_square',venueId:'v_copper',amount:500,currency:'USD',createdAt:now});const square={action:'square',actor:manager,payment:'synthetic_hosted_square',body:{action:'serve',bottleId:bottle.id,ml:45,note:'Synthetic POS service'},now};results=await race([square,square]);assert.ok(results.every(r=>r.ok));assert.equal((await store.get('SELECT remaining_ml FROM bottles WHERE id=?',bottle.id)).remaining_ml,160);assert.equal((await store.get("SELECT count(*) n FROM audit WHERE action='square.payment_handled'")).n,1);pass(step);
    step='transaction rollback and connection recovery';await assert.rejects(store.transaction(async()=>{await store.run("UPDATE users SET name='rollback sentinel' WHERE id='hosted_guest_a'");throw Error('abort');}),/abort/);assert.equal((await store.get("SELECT name FROM users WHERE id='hosted_guest_a'")).name,'Synthetic hosted test');pass(step);
    step='last-manager protection under contention';await operatorAction(app,'staff',{venueId:'v_copper',userId:'hosted_guest_b',role:'manager',reason:'Synthetic second manager'});results=await race([manager,'hosted_guest_b'].map(userId=>({action:'operator',body:{venueId:'v_copper',userId,role:'staff',reason:'Synthetic simultaneous demotion'},now})));assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).status,409);assert.equal((await store.get("SELECT count(*) n FROM staff WHERE venue_id='v_copper' AND role='manager'")).n,1);pass(step);
    await store.run("UPDATE outbox SET status='done'");await app.enqueue('wallet','hosted-lease');
    step='two workers deliver one leased job';results=await race([{action:'jobs',now},{action:'jobs',now}]);assert.ok(results.every(r=>r.ok));assert.equal((await store.get("SELECT count(*) n FROM audit WHERE action='rehearsal.delivered'")).n,1);assert.equal((await store.get('SELECT count(*) n FROM job_leases')).n,0);pass(step);
    const job=await store.get("SELECT id FROM outbox WHERE subject_id='hosted-lease'");await store.run("UPDATE outbox SET status='pending' WHERE id=?",job.id);await store.run('INSERT INTO job_leases VALUES(?,?,?)',job.id,'expired-worker',now-1);
    step='expired worker lease recovery';results=await race([{action:'jobs',now}]);assert.ok(results[0].ok);assert.equal((await store.get("SELECT count(*) n FROM audit WHERE action='rehearsal.delivered'")).n,2);pass(step);
    await store.run("UPDATE outbox SET status='pending' WHERE id=?",job.id);
    step='delivery outage and retry recovery';await race([{action:'jobs',now,fail:true}]);assert.equal((await store.get('SELECT attempts FROM outbox WHERE id=?',job.id)).attempts,1);await race([{action:'jobs',now:now+60001}]);assert.equal((await store.get('SELECT status FROM outbox WHERE id=?',job.id)).status,'done');pass(step);
    step='logical snapshot and restore';const saved=await snapshot(store);await restore(store,saved);assert.deepEqual(canonical(await snapshot(store)),canonical(saved));assert.equal((await app.membershipSnapshot(membership.id)).bottles[0].remaining_ml,160);pass(step);
    step='provider schema unchanged';assert.deepEqual(await protectedCounts(store),baseline);pass(step);
  } catch {throw Error(`Hosted rehearsal failed at: ${step}`);}
  finally {
    try {if(owned){await store.transaction(async()=>{await clear(store);await store.run('INSERT INTO schema_version VALUES(1)');await store.run('INSERT INTO wallet_revision VALUES(1,0)');});for(const table of tables)if(!meta.has(table))assert.equal((await store.get(`SELECT count(*) n FROM ${schema}.${table}`)).n,0);console.log('HOSTED CLEANUP: disposable fixture rows removed; provider schema untouched.');}}finally{await store.close();}
  }
  return {passed:passed.length,workers:'independent Node processes and PostgreSQL pools',externalProviders:'not called'};
}

try {
  if(!process.env.REGULARS_HOSTED_REHEARSAL)console.log('Hosted rehearsal skipped: explicit opt-in is absent.');
  else {
    const config=configuration(process.env);
    if(process.argv[2]==='--worker')await worker(config);
    else console.log(JSON.stringify(await run(config)));
  }
} catch(error) {console.error(error.message.startsWith('Hosted rehearsal failed at:')?error.message:'Hosted rehearsal refused or cleanup failed; inspect isolation prerequisites.');process.exitCode=1;if(process.connected)process.disconnect();}
