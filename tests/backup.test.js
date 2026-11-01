import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture} from './helpers/fixture.js';
import {openStore} from '../packages/db/store.js';
import {Regulars} from '../packages/core/regulars.js';

const script=fileURLToPath(new URL('../scripts/backup.js',import.meta.url));
function workspace(t){const dir=mkdtempSync(join(tmpdir(),'regulars-backup-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function run(dir,path,extra={}){return spawnSync(process.execPath,[script],{cwd:dir,env:{PATH:process.env.PATH,APP_MODE:'demo',DATABASE_PATH:path,...(process.env.NODE_V8_COVERAGE?{NODE_V8_COVERAGE:process.env.NODE_V8_COVERAGE}:{}),...extra},encoding:'utf8',timeout:15000});}

test('backup refuses a missing source instead of creating an empty successful backup',t=>{
  const dir=workspace(t),source=join(dir,'missing.sqlite');const result=run(dir,source);
  assert.notEqual(result.status,0);assert.equal(existsSync(source),false);assert.equal(existsSync(join(dir,'backups')),false);
});
test('SQLite backup refuses PostgreSQL configuration without creating a misleading local backup',t=>{
  const dir=workspace(t),source=join(dir,'wrong.sqlite');const result=run(dir,source,{DATABASE_URL:'postgres://fixture.invalid/regulars'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/PostgreSQL/);assert.equal(existsSync(source),false);
});
test('online SQLite backup restores memberships, stock, bookings, audit and pending jobs',async t=>{
  const dir=workspace(t),source=join(dir,'live.sqlite');const f=await fixture(source);
  let restored;
  try{
    const m=await f.member();const bottle=await f.app.addBottle(f.manager,m.id,{name:'Restore fixture',capacityMl:750},'receive');
    await f.app.adjustBottle(f.manager,bottle.id,{deltaMl:-45,reason:'Service'},'pour');
    const order=await f.ticket();await f.paid(order);
    const expected=await f.app.account(f.uid);
    const result=run(dir,source);assert.equal(result.status,0,result.stderr);
    const backup=join(dir,'backups',readdirSync(join(dir,'backups'))[0]);
    assert.equal(statSync(backup).mode&0o777,0o600);
    restored=openStore(backup);const app=new Regulars(restored,{now:f.now});
    assert.equal((await restored.get('PRAGMA integrity_check')).integrity_check,'ok');
    assert.equal((await restored.all('PRAGMA foreign_key_check')).length,0);
    assert.deepEqual(await app.account(f.uid),expected);
    assert.equal((await app.membershipSnapshot(m.id)).bottles[0].remaining_ml,705);
    for(const table of ['audit','bottle_log','outbox','payment_events'])assert.deepEqual(await restored.all(`SELECT * FROM ${table} ORDER BY id`),await f.s.all(`SELECT * FROM ${table} ORDER BY id`));
    await assert.rejects(app.createOrder(f.other,{kind:'ticket',venueId:'v_copper',eventId:f.games[0].id,resourceId:f.resource.id,partySize:2},'after-restore'),error=>error.status===409);
  }finally{if(restored)await restored.close();await f.s.close();}
});
