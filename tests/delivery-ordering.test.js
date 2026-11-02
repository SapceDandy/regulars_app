import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/fixture.js';
import {Jobs} from '../packages/integrations/jobs.js';

async function setup(t) {const f=await fixture();t.after(()=>f.s.close());return f;}

test('slow Wallet delivery cannot overwrite a newer bottle balance; other members still sync',async t=>{
  const f=await setup(t),member=await f.member(),other=await f.member(f.other);
  const bottle=await f.app.addBottle(f.manager,member.id,{name:'Ordering fixture',capacityMl:750},'receive');
  await f.s.run("UPDATE outbox SET status='done'");
  await f.app.adjustBottle(f.manager,bottle.id,{deltaMl:-45,reason:'First service'},'first');
  const entered=Promise.withResolvers(),release=Promise.withResolvers();
  let first=true,remoteBalance;const delivered=[];
  const wallets={update:async mid=>{
    const snapshot=await f.app.membershipSnapshot(mid);
    if(mid===member.id&&first){first=false;entered.resolve();await release.promise;}
    if(mid===member.id)remoteBalance=snapshot.bottles[0].remaining_ml;
    delivered.push(mid);
  }};
  const worker=()=>new Jobs(f.s,f.app,{wallets,payments:{}});
  const slow=worker().tick();
  let whileBlocked;
  try {
    await entered.promise;
    await f.app.adjustBottle(f.manager,bottle.id,{deltaMl:-45,reason:'Second service'},'second');
    await f.app.touch(other.id);
    await worker().tick();
    whileBlocked=[...delivered];
  } finally {release.resolve();await slow;}
  assert.equal(remoteBalance,660,'The final provider snapshot must include both pours');
  assert.deepEqual(whileBlocked,[other.id],'Only the unrelated member can finish while the first delivery is leased');
  assert.equal(delivered.filter(mid=>mid===member.id).length,2);
  assert.equal((await f.s.get("SELECT count(*) n FROM outbox WHERE status='pending'")).n,0);
});

test('an expired subject lease permits recovery and a different delivery kind is not blocked',async t=>{
  const f=await setup(t),subject='synthetic-subject';
  await f.app.enqueue('wallet',subject);
  const original=await f.s.get('SELECT id FROM outbox');
  await f.s.run('INSERT INTO job_leases VALUES(?,?,?)',original.id,'stalled-worker',f.now()+300_000);
  await f.app.enqueue('wallet',subject);
  await f.app.enqueue('refund',subject);
  const delivered=[];
  const jobs=new Jobs(f.s,f.app,{wallets:{update:async mid=>delivered.push(`wallet:${mid}`)},payments:{refund:async oid=>delivered.push(`refund:${oid}`)}});
  await jobs.tick();
  assert.deepEqual(delivered,[`refund:${subject}`]);
  assert.equal((await f.s.get("SELECT count(*) n FROM outbox WHERE status='pending'")).n,2);
  f.advance(300_000);await jobs.tick();
  assert.equal(delivered.filter(x=>x===`wallet:${subject}`).length,2);
  assert.equal((await f.s.get('SELECT count(*) n FROM job_leases')).n,0);
  assert.equal((await f.s.get("SELECT count(*) n FROM outbox WHERE status='pending'")).n,0);
});
