import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './helpers/fixture.js';
import {operatorAction} from '../packages/core/operations.js';
const script=new URL('../scripts/operator.js',import.meta.url).pathname;
function work(t){const dir=mkdtempSync(join(tmpdir(),'regulars-operator-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('operator report isolates unmatched reports and reviewed cases without storing provider evidence',async t=>{
  const f=await fixture();t.after(()=>f.s.close());const o=await f.ticket();await f.paid(o);
  await f.app.recordPaymentCase({eventId:'unmatched',kind:'unmatched_refund',reference:'ch_unknown'});await f.app.recordPaymentCase({eventId:'matched',kind:'dispute',reference:'du_known',orderId:o.id});await f.app.enqueue('wallet','fixture');await f.s.run("UPDATE outbox SET status='failed'");
  let report=await operatorAction(f.app,'report');assert.equal(report.unmatchedPayments.length,1);assert.equal(report.failedJobs.length,1);assert.equal(report.staff.length,1);assert.equal(report.unmatchedPayments[0].id,'unmatched');
  await operatorAction(f.app,'review',{caseId:'unmatched',reason:'Checked provider; unrelated to Regulars.'});report=await operatorAction(f.app,'report');assert.equal(report.unmatchedPayments.length,0);assert.equal((await f.s.get("SELECT count(*) n FROM audit WHERE action='operator.payment_reviewed'")).n,1);
  await assert.rejects(operatorAction(f.app,'review',{caseId:'unmatched',reason:'again'}),{status:409});await assert.rejects(operatorAction(f.app,'review',{caseId:'missing',reason:'missing'}),{status:404});await assert.rejects(operatorAction(f.app,'wrong'),{status:400});await assert.rejects(operatorAction(f.app,'staff'),{status:400});
});

test('operator staff provisioning audits changes, preserves customer records and protects the last manager',async t=>{
  const f=await fixture();t.after(()=>f.s.close());const base={venueId:'v_copper',userId:f.other,role:'staff',reason:'Authorized synthetic shift.'};
  await operatorAction(f.app,'staff',base);assert.equal((await f.app.staff(f.other,'v_copper')).role,'staff');
  await assert.rejects(operatorAction(f.app,'staff',{...base,userId:f.manager,role:'none'}),{status:409});
  await operatorAction(f.app,'staff',{...base,role:'manager'});await operatorAction(f.app,'staff',{...base,userId:f.manager,role:'staff'});await operatorAction(f.app,'staff',{...base,userId:f.manager,role:'none'});
  assert.equal((await f.app.staff(f.other,'v_copper',true)).role,'manager');assert.ok(await f.app.user(f.manager));await assert.rejects(f.app.staff(f.manager,'v_copper'),{status:403});
  await assert.rejects(operatorAction(f.app,'staff',{...base,role:'owner'}),{status:400});await assert.rejects(operatorAction(f.app,'staff',{...base,userId:'unknown'}),{status:404});
  assert.equal((await f.s.get("SELECT count(*) n FROM audit WHERE action='operator.staff_changed'")).n,4);
});

test('operator CLI requires an explicit existing database and processes private input without leaking it',async t=>{
  const dir=work(t),path=join(dir,'fixture.sqlite'),f=await fixture(path);const uid=f.other;await f.s.close();
  const run=(args,extra={})=>spawnSync(process.execPath,[script,...args],{cwd:dir,env:{PATH:process.env.PATH,DATABASE_PATH:path,...(process.env.NODE_V8_COVERAGE?{NODE_V8_COVERAGE:process.env.NODE_V8_COVERAGE}:{}),...extra},encoding:'utf8',timeout:15000});
  let result=run(['report']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).staff.length,1);
  const input=join(dir,'private-input.json');writeFileSync(input,JSON.stringify({venueId:'v_copper',userId:uid,role:'staff',reason:'Private provisioning reason.'}),{mode:0o600});result=run(['staff',input]);assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{updated:true});
  result=run(['staff']);assert.notEqual(result.status,0);assert.doesNotMatch(result.stderr,/Private provisioning reason/);
  const missing=join(dir,'missing.sqlite');result=run(['report'],{DATABASE_PATH:missing});assert.notEqual(result.status,0);assert.equal(existsSync(missing),false);
});

test('operator PostgreSQL command uses the explicitly selected schema and closes on success and failure',async t=>{
  const f=await fixture();t.after(()=>f.s.close());let closed=0;const calls=[];
  const openHosted=(url,options)=>{calls.push({url,...options});return {...f.s,close:async()=>{closed++;}};};
  const {runOperator}=await import('../scripts/operator.js');await assert.rejects(runOperator({},['report']),{status:400});
  const report=await runOperator({DATABASE_URL:'postgres://fixture.invalid/test'},['report'],openHosted);assert.equal(report.staff.length,1);assert.equal(calls[0].schema,'public');
  await assert.rejects(runOperator({DATABASE_URL:'postgres://fixture.invalid/test',REGULARS_DB_SCHEMA:'regulars_pilot'},['bad'],openHosted),{status:400});assert.equal(calls[1].schema,'regulars_pilot');assert.equal(closed,2);
  await runOperator({DATABASE_PROVIDER:'supabase',SUPABASE_DATABASE_URL:'postgres://supabase.invalid/postgres',DATABASE_URL:'wrong-neon'},['report'],openHosted);
  assert.equal(calls[2].url,'postgres://supabase.invalid/postgres');assert.equal(calls[2].schema,'regulars');assert.equal(calls[2].provider,'supabase');assert.equal(closed,3);
  await assert.rejects(runOperator({DATABASE_PROVIDER:'supabase',DATABASE_PATH:'ignored'},['report'],openHosted),/SUPABASE_DATABASE_URL/);assert.equal(closed,3);
});
