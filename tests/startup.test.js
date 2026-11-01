import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {configuration} from '../apps/web/config.js';
import {openStore} from '../packages/db/store.js';

const pools=[];let migrateFails=false;
class Pool extends EventEmitter{
  constructor(options){super();this.options=options;this.closed=false;pools.push(this);}
  async query(sql){if(migrateFails&&sql.includes('CREATE TABLE'))throw Error('fixture migration failure');return{rows:[],rowCount:0};}
  async connect(){return{query:this.query.bind(this),release:()=>{this.released=true;}};}
  async end(){this.closed=true;}
}
test.before(async()=>{
  test.mock.module('@neondatabase/serverless',{namedExports:{Pool,neonConfig:{},types:{setTypeParser(){}}}});
  test.mock.module('pg',{defaultExport:{Pool,types:{setTypeParser(){}}}});
});
function workspace(t){const dir=mkdtempSync(join(tmpdir(),'regulars-startup-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('application startup opens SQLite itself, refuses missing hosted databases and cleans failed migrations',async t=>{
  const {createApplication}=await import('../apps/web/server.js');const dir=workspace(t),c=configuration({DATABASE_PATH:join(dir,'local.sqlite')});const app=await createApplication({config:c});assert.equal((await app.app.catalog()).length,2);await app.store.close();
  await assert.rejects(createApplication({config:configuration({VERCEL:'1'})}),/DATABASE_URL/);
  const postgres=configuration({DATABASE_URL:'postgres://fixture.invalid/test'});migrateFails=true;await assert.rejects(createApplication({config:postgres,seedData:false}),/migration failure/);assert.equal(pools.at(-1).closed,true);migrateFails=false;
  const hosted=await createApplication({config:postgres,seedData:false});assert.equal(hosted.store.dialect,'postgres');assert.equal(pools.at(-1).options.max,4);t.mock.method(console,'error',()=>{});pools.at(-1).emit('error',Error('private database secret'));assert.equal(console.error.mock.calls[0].arguments[0],'PostgreSQL connection failed');await hosted.store.close();
});

test('Supabase startup uses the private schema and verified TLS, ignoring a Neon URL',async t=>{
  const {createApplication}=await import('../apps/web/server.js');
  const {openPostgresStore}=await import('../packages/db/postgres.js');
  const env={DATABASE_PROVIDER:'supabase',SUPABASE_DATABASE_URL:'postgresql://regulars:fixture@db.example/postgres?sslmode=no-verify&sslrootcert=/private&ssl=false&sslkey=/key&sslcert=/cert',DATABASE_URL:'postgres://wrong.example/neon'};
  const app=await createApplication({config:configuration(env),seedData:false});
  const options=pools.at(-1).options;
  assert.equal(options.max,1);assert.deepEqual(options.ssl,{rejectUnauthorized:true});
  assert.equal(options.connectionString,'postgresql://regulars:fixture@db.example/postgres');
  await app.store.close();assert.equal(pools.at(-1).closed,true);
  const caStore=openPostgresStore(env.SUPABASE_DATABASE_URL,{provider:'supabase',schema:'regulars',ca:'trusted-root'});
  assert.deepEqual(pools.at(-1).options.ssl,{rejectUnauthorized:true,ca:'trusted-root'});await caStore.close();
  const count=pools.length;
  await assert.rejects(createApplication({config:configuration({...env,SUPABASE_DATABASE_URL:''}),seedData:false}),/SUPABASE_DATABASE_URL/);
  assert.equal(pools.length,count);
});

test('request handling ends a disconnected response and rejects writes without JSON headers',async t=>{
  const {createApplication}=await import('../apps/web/server.js'),store=openStore(':memory:');t.after(()=>store.close());const app=await createApplication({store});t.mock.method(console,'error',()=>{});
  const req={url:'/api/config',method:'GET',socket:{},headers:{}};let ends=0;const res={headersSent:false,setHeader(){},writeHead(){this.headersSent=true;throw Error('disconnected');},end(){ends++;}};await app.handler(req,res);assert.equal(ends,1);
  let status;const clean={setHeader(){},writeHead(code){status=code;},end(){}};await app.handler({...req,method:'POST',headers:{origin:app.config.origin}},clean);assert.equal(status,415);
});

async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function childReady(child,pattern){let text='';for await(const part of child.stdout){text+=part;if(pattern.test(text))return text;}throw Error(`Server exited before startup: ${text}`);}
test('local entrypoint serves requests, reports job failures and closes gracefully on both signals',{timeout:20000},async t=>{
  const dir=workspace(t),script=new URL('../apps/web/server.js',import.meta.url),preload=new URL('./helpers/fast-jobs.js',import.meta.url);
  for(const signal of ['SIGTERM','SIGINT']){
    const database=join(dir,`${signal}.sqlite`),port=await freePort();const child=spawn(process.execPath,['--import',preload.href,script.pathname],{cwd:dir,env:{PATH:process.env.PATH,APP_MODE:'demo',DATABASE_PATH:database,PORT:String(port),...(process.env.NODE_V8_COVERAGE?{NODE_V8_COVERAGE:process.env.NODE_V8_COVERAGE}:{})},stdio:['ignore','pipe','pipe']});
    t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});const exited=once(child,'exit');await childReady(child,/Regulars demo:/);
    const response=await fetch(`http://127.0.0.1:${port}/healthz`);assert.deepEqual(await response.json(),{ok:true});
    if(signal==='SIGTERM'){
      const db=openStore(database);await db.run('DROP TABLE outbox');await db.close();
      await new Promise((resolve,reject)=>{if(stderr.includes('Background job failed'))return resolve();const deadline=setTimeout(()=>reject(Error('job failure not reported')),2000);child.stderr.on('data',()=>{if(stderr.includes('Background job failed')){clearTimeout(deadline);resolve();}});});assert.doesNotMatch(stderr,/SELECT|private/);
    }
    child.kill(signal);const [code]=await exited;assert.equal(code,0,stderr);
  }
});

test('application injects the pilot provider block into every integration',async t=>{
  const {createApplication}=await import('../apps/web/server.js');const store=openStore(':memory:');t.after(()=>store.close());const request=async()=>{throw Error('synthetic provider block');};const app=await createApplication({store,request});for(const integration of [app.auth,app.payments,app.wallets])assert.equal(integration.request,request);
});
