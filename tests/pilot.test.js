import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotConfiguration,blockPilotProvider} from '../apps/web/pilot.js';
import {postgresTestStore} from './helpers/store.js';
import {Auth} from '../packages/integrations/auth.js';
import {fixture} from './helpers/fixture.js';
import {seed} from '../packages/db/seed.js';

const env={VERCEL:'1',VERCEL_ENV:'preview',PILOT_TESTING_ENABLED:'true',SESSION_SECRET:'s'.repeat(40),VERCEL_URL:'pilot.example',STRIPE_SECRET_KEY:'must-never-reach-provider'};
test('synthetic pilot refuses production, local execution and missing opt-in',()=>{
  for(const change of [{VERCEL_ENV:'production'},{VERCEL_ENV:'development'},{VERCEL:'0'},{PILOT_TESTING_ENABLED:''}])assert.throws(()=>pilotConfiguration({...env,...change}),/restricted/);
  const c=pilotConfiguration(env);assert.equal(c.mode,'demo');assert.equal(c.pilot,true);assert.equal(c.env.STRIPE_SECRET_KEY,undefined);assert.equal(c.origin,'https://pilot.example');
});
test('synthetic pilot blocks external calls and real phone numbers',async t=>{
  const f=await fixture();t.after(()=>f.s.close());
  const auth=new Auth(f.s,pilotConfiguration(env),{now:f.now,request:blockPilotProvider});
  await assert.rejects(auth.start({phone:'+15125551234',smsConsent:true},'test'),/synthetic pilot/);
  const result=await auth.start({phone:'+12025550105',smsConsent:true},'test');assert.match(result.demoCode,/^\d{6}$/);
  await assert.rejects(blockPilotProvider(),/disabled/);
});
test('pilot PostgreSQL schema holds demo records without creating public venue tables',async t=>{
  const s=await postgresTestStore('regulars_pilot');t.after(()=>s.close());await seed(s);
  assert.equal((await s.get('SELECT count(*) n FROM venues')).n,2);
  assert.equal((await s.get("SELECT to_regclass('public.venues') AS name")).name,null);
  assert.equal((await s.get('SELECT current_schema() AS name')).name,'regulars_pilot');
});
