import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../packages/db/store.js';
import {demoConfig} from '../packages/db/seed.js';
const script=new URL('../scripts/seed.js',import.meta.url).pathname;
function workspace(t){const dir=mkdtempSync(join(tmpdir(),'regulars-seed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function run(dir,env={}){return spawnSync(process.execPath,[script],{cwd:dir,env:{PATH:process.env.PATH,...(process.env.NODE_V8_COVERAGE?{NODE_V8_COVERAGE:process.env.NODE_V8_COVERAGE}:{}),...env},encoding:'utf8',timeout:15000});}
test('local seed refuses hosted configuration before creating SQLite data',t=>{
  const dir=workspace(t);
  for(const env of [{DATABASE_URL:'postgres://fixture.invalid'},{SUPABASE_DATABASE_URL:'postgres://fixture.invalid'},{DATABASE_PROVIDER:'supabase'}]){
    const result=run(dir,env);assert.notEqual(result.status,0);assert.match(result.stderr,/only seeds SQLite/);assert.equal(existsSync(join(dir,'data')),false);
  }
});
test('seed and backup commands work with default local paths and preserve existing inventory',async t=>{
  const dir=workspace(t);for(let i=0;i<2;i++){const result=run(dir);assert.equal(result.status,0,result.stderr);}
  const s=openStore(join(dir,'data/regulars.sqlite'));assert.equal((await s.get('SELECT count(*) n FROM venues')).n,2);await s.close();
  const result=spawnSync(process.execPath,[new URL('../scripts/backup.js',import.meta.url).pathname],{cwd:dir,env:{PATH:process.env.PATH,...(process.env.NODE_V8_COVERAGE?{NODE_V8_COVERAGE:process.env.NODE_V8_COVERAGE}:{})},encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);assert.equal(readdirSync(join(dir,'backups')).length,1);
});
test('live seed command accepts the same reviewed JSON configuration as server startup',async t=>{
  const dir=workspace(t),venue=demoConfig().venues[0];Object.assign(venue,{demo:false,approved:true,plans:[{key:'guest',name:'Guest',priceCents:0,durationDays:30}]});
  const result=run(dir,{APP_MODE:'live',PUBLIC_ORIGIN:'https://regulars.example',SESSION_SECRET:'s'.repeat(40),TWILIO_ACCOUNT_SID:'fixture',TWILIO_AUTH_TOKEN:'fixture',TWILIO_VERIFY_SERVICE_SID:'fixture',STRIPE_SECRET_KEY:'fixture',STRIPE_WEBHOOK_SECRET:'fixture',VENUE_CONFIG_JSON:JSON.stringify({venues:[venue]})});assert.equal(result.status,0,result.stderr);const s=openStore(join(dir,'data/regulars.sqlite'));assert.equal((await s.get('SELECT demo FROM venues')).demo,0);await s.close();
});
