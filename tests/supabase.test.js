import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {databaseConfiguration,openPostgresStore} from '../packages/db/postgres.js';
import {postgresTestStore} from './helpers/store.js';
import {seed} from '../packages/db/seed.js';
import {verifyDatabase} from '../scripts/verify-database.js';

test('deployment database verification fails closed and always closes its connection',async()=>{
  const env={DATABASE_PROVIDER:'supabase',SUPABASE_DATABASE_URL:'postgres://fixture.invalid/postgres'};
  let closed=0;
  const state={schema:'regulars',tables:29,rls:true,restricted:true,anon_access:false,authenticated_access:false};
  const open=()=>({get:async()=>state,close:async()=>{closed++;}});
  assert.deepEqual(await verifyDatabase({}),{skipped:true});
  assert.deepEqual(await verifyDatabase(env,open),{verified:true,tables:29});assert.equal(closed,1);
  for(const [key,value] of [['schema','public'],['tables',0],['rls',false],['restricted',false],['anon_access',true],['authenticated_access',true]]){
    const original=state[key];state[key]=value;await assert.rejects(verifyDatabase(env,open),/isolation/);state[key]=original;
  }
  await assert.rejects(verifyDatabase(env,()=>({get:async()=>{throw Error('connection failure');},close:async()=>{closed++;}})),/connection failure/);
  assert.equal(closed,8);
  await assert.rejects(verifyDatabase({...env,SUPABASE_DATABASE_URL:''},open),/SUPABASE_DATABASE_URL/);
});

test('database selection is explicit and cannot fall back to another provider',async()=>{
  assert.equal(databaseConfiguration({DATABASE_URL:'neon'}).connectionString,'neon');
  const env={DATABASE_PROVIDER:'supabase',SUPABASE_DATABASE_URL:'supabase',DATABASE_URL:'neon'};
  assert.deepEqual(databaseConfiguration(env),{connectionString:'supabase',provider:'supabase',schema:'regulars',ca:undefined});
  assert.equal(databaseConfiguration(env,{pilot:true}).schema,'regulars_pilot');
  assert.equal(databaseConfiguration({...env,REGULARS_DB_SCHEMA:'regulars_pilot'}).schema,'regulars_pilot');
  assert.throws(()=>databaseConfiguration({...env,SUPABASE_DATABASE_URL:''}),/SUPABASE_DATABASE_URL/);
  assert.throws(()=>databaseConfiguration({...env,REGULARS_DB_SCHEMA:'public'}),/private/);
  assert.throws(()=>databaseConfiguration({DATABASE_PROVIDER:'unknown'}),/provider/);
  assert.throws(()=>openPostgresStore('test',{provider:'unknown'}),/provider/);
  assert.throws(()=>openPostgresStore('test',{provider:'supabase'}),/private/);
  assert.throws(()=>openPostgresStore('https://example.com',{provider:'supabase',schema:'regulars'}),/protocol/);
  const parse=pg.types.getTypeParser(20);assert.equal(parse('1700000000000'),1700000000000);assert.throws(()=>parse('9007199254740992'),/safe range/);
});

test('private Regulars schema persists data, rolls back changes and shields every table with RLS',async t=>{
  const store=await postgresTestStore('regulars');t.after(()=>store.close());
  await seed(store);assert.equal((await store.get('SELECT count(*) n FROM venues')).n,2);
  assert.equal((await store.get('SELECT current_schema() name')).name,'regulars');
  await store.run('CREATE TABLE public.users(id text)');
  await store.run("INSERT INTO users(id,phone,created_at) VALUES('isolation','+12025550199',1700000000000)");
  assert.equal((await store.get('SELECT count(*) n FROM public.users')).n,0);
  await assert.rejects(store.transaction(async()=>{await store.run("UPDATE users SET name='rolled back' WHERE id='isolation'");throw Error('abort');}),/abort/);
  assert.equal((await store.get("SELECT name FROM users WHERE id='isolation'")).name,'');
  await store.migrate();assert.equal((await store.get('SELECT count(*) n FROM venues')).n,2);
  const tables=await store.all("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='regulars'");
  assert.equal(tables.length,29);assert.ok(tables.every(table=>table.rowsecurity));
  await store.run('CREATE ROLE untrusted_regulars_reader');
  const access=await store.get("SELECT has_schema_privilege('untrusted_regulars_reader','regulars','USAGE') allowed");
  assert.equal(access.allowed,false);
});
