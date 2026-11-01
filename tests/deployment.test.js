import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/fixture.js';
import { Jobs } from '../packages/integrations/jobs.js';
import { postgresSql } from '../packages/db/postgres.js';
import { vercelHandler, authorizedCron } from '../apps/web/vercel.js';
import { clientAddress } from '../apps/web/config.js';

test('PostgreSQL placeholders preserve question marks inside SQL strings', () => {
  assert.equal(postgresSql("SELECT ?, 'Why?', 'it''s ?' WHERE x=?"), "SELECT $1, 'Why?', 'it''s ?' WHERE x=$2");
});

test('concurrent asynchronous allocations have one winner and rollback is complete', async t => {
  const f = await fixture();t.after(() => f.s.close());
  const result = await Promise.allSettled([f.ticket(f.uid), f.ticket(f.other)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.status, 409);
  await assert.rejects(f.s.transaction(async () => {
    await f.s.run('UPDATE users SET name=? WHERE id=?', 'Rolled back', f.uid);
    await Promise.resolve();throw new Error('abort');
  }), /abort/);
  assert.equal((await f.s.get('SELECT name FROM users WHERE id=?', f.uid)).name, 'Test Member');
});

test('two workers claim one delivery and recover a stale lease', async t => {
  const f = await fixture();t.after(() => f.s.close());
  await f.s.run("INSERT INTO outbox(id,kind,subject_id,payload,attempts,next_at,status,created_at) VALUES('job','wallet','member','{}',0,?,'pending',?)", f.now(), f.now());
  let release, entered;
  const started = new Promise(resolve => {entered = resolve;});
  const blocked = new Promise(resolve => {release = resolve;});
  let calls = 0;
  const services = {wallets: {update: async () => {calls++;entered();await blocked;}}, payments: {}};
  const first = new Jobs(f.s, f.app, services).tick();await started;
  await new Jobs(f.s, f.app, services).tick();assert.equal(calls, 1);
  release();await first;
  assert.equal((await f.s.get("SELECT status FROM outbox WHERE id='job'")).status, 'done');
  await f.s.run("UPDATE outbox SET status='pending' WHERE id='job'");
  await f.s.run("INSERT INTO job_leases VALUES('job','crashed',?)", f.now()-1);
  await new Jobs(f.s, f.app, services).tick();assert.equal(calls, 2);
  assert.equal((await f.s.all('SELECT * FROM job_leases')).length, 0);
});

function response() {
  return {headersSent: false, setHeader() {}, writeHead(status) {this.status=status;this.headersSent=true;}, end(body) {this.body=body;}};
}

test('a slow worker cannot mark a reclaimed delivery done after the new worker fails',async t=>{
  const f=await fixture();t.after(()=>f.s.close());
  await f.s.run("INSERT INTO outbox(id,kind,subject_id,payload,attempts,next_at,status,created_at) VALUES('fenced','wallet','member','{}',0,?,'pending',?)",f.now(),f.now());
  let started,release;
  const entered=new Promise(resolve=>{started=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
  const first=new Jobs(f.s,f.app,{wallets:{update:async()=>{started();await blocked;}},payments:{}}).tick();
  await entered;f.advance(300001);
  try{
    await new Jobs(f.s,f.app,{wallets:{update:async()=>{throw new Error('retry later');}},payments:{}}).tick();
  }finally{release();await first;}
  const job=await f.s.get("SELECT * FROM outbox WHERE id='fenced'");
  assert.equal(job.status,'pending');assert.equal(job.attempts,1);assert.ok(job.next_at>f.now());
});
const env = {DATABASE_URL: 'test', SESSION_SECRET: 'x'.repeat(32), PUBLIC_ORIGIN: 'https://regulars.example', TWILIO_ACCOUNT_SID: 'test', TWILIO_AUTH_TOKEN: 'test', TWILIO_VERIFY_SERVICE_SID: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'test', VENUE_CONFIG_JSON: '{"venues":[]}', CRON_SECRET: 'cron-test'};

test('cron rejects missing credentials before opening the database', async () => {
  assert.equal(authorizedCron('Bearer wrong', 'secret'), false);
  assert.equal(authorizedCron('Bearer secret', 'secret'), true);
  let opened = false;const res = response();
  await vercelHandler({env, openStore: () => {opened=true;}})({url: '/api/cron', method: 'GET', headers: {}}, res);
  assert.equal(res.status, 401);assert.equal(opened, false);
});

test('Vercel closes invocation pools on startup failure and hides internal errors', async () => {
  let closed = false;const res = response();
  await vercelHandler({env, openStore: () => ({migrate: async () => {}, close: async () => {closed=true;}}), createApp: async () => {throw new Error('private credential');}})({url:'/',headers:{}},res);
  assert.equal(res.status, 503);assert.equal(closed, true);assert.doesNotMatch(res.body,/private credential/);
});

test('Vercel runs authorized jobs and keeps the original request body stream', async () => {
  let ticks = 0, closed = 0;const req = {url:'/api/webhooks/stripe',headers:{},body:undefined};
  const handler = vercelHandler({env, openStore: () => ({migrate: async () => {},close:async()=>{closed++;}}),createApp:async()=>({handler:async r=>assert.equal(r,req),jobs:{tick:async()=>{ticks++;}}})});
  await handler(req,response());
  const res=response();await handler({url:'/api/cron',method:'GET',headers:{authorization:'Bearer cron-test'}},res);
  assert.equal(res.status,200);assert.equal(ticks,1);assert.equal(closed,2);
});

test('Vercel client IP is trusted only when running on Vercel', () => {
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{'x-vercel-forwarded-for':'203.0.113.3'}};
  assert.equal(clientAddress(req,{env:{VERCEL:'1'}}),'203.0.113.3');
  assert.equal(clientAddress(req,{env:{}}),'127.0.0.1');
});

test('Vercel provider preview selects Supabase and fails closed if its secret is missing',async()=>{
  let opened=0,selected;
  const providerEnv={...env,DATABASE_PROVIDER:'supabase',SUPABASE_DATABASE_URL:'postgres://regulars.example/postgres',VERCEL_ENV:'preview'};
  const openStore=(url,options)=>{opened++;selected={url,...options};return{migrate:async()=>{},close:async()=>{}};};
  const createApp=async()=>({handler:async(_req,res)=>{res.writeHead(200);res.end('ok');}});
  const first=response();await vercelHandler({env:providerEnv,openStore,createApp})({url:'/',headers:{}},first);
  assert.equal(first.status,200);assert.equal(selected.url,providerEnv.SUPABASE_DATABASE_URL);assert.equal(selected.schema,'regulars');assert.equal(selected.provider,'supabase');
  const second=response();await vercelHandler({env:{...providerEnv,SUPABASE_DATABASE_URL:''},openStore,createApp})({url:'/',headers:{}},second);
  assert.equal(second.status,503);assert.equal(opened,1);
});
