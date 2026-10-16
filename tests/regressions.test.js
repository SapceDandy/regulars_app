import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/fixture.js';
import { configuration,clientAddress } from '../apps/web/config.js';
import { createApplication } from '../apps/web/server.js';
import { Payments } from '../packages/integrations/payments.js';
import { Wallets } from '../packages/integrations/wallets.js';

function make(t){const f=fixture();t.after(()=>f.s.close());return f;}
test('live startup cannot reuse a database containing synthetic venues',t=>{const f=make(t);const c=configuration({APP_MODE:'demo'});c.mode='live';assert.throws(()=>createApplication({config:c,store:f.s,seedData:false}),/fresh live database/);});
test('manual renewal preserves the start of an uninterrupted paid membership',t=>{const f=make(t);const m=f.member();f.advance(24*86_400_000);const o=f.app.createOrder(f.uid,{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'},'renew');f.paid(o);assert.equal(f.app.membershipSnapshot(m.id).starts_at,m.starts_at);});
test('a provider refund that is still pending does not become a settled refund locally',async t=>{const f=make(t);const o=f.ticket();f.paid(o);f.app.cancelOrder(f.uid,o.id);const p=new Payments(f.s,f.app,{mode:'live',env:{STRIPE_SECRET_KEY:'test'}},{request:async()=>({json:async()=>({status:'pending'})})});await assert.rejects(()=>p.refund(o.id),/not settled/);assert.equal(f.app.order(f.uid,o.id).state,'refund_pending');});
test('Apple update tags advance globally across distinct memberships',t=>{const f=make(t);const one=f.member();const two=f.member(f.other);assert.ok(two.revision>one.revision);const w=new Wallets(f.s,f.app,{mode:'demo',env:{}});w.register('test-device-one',one.id,'a'.repeat(64));w.register('test-device-two',two.id,'b'.repeat(64));f.app.touch(one.id);const revision=f.app.membershipSnapshot(one.id).revision;assert.ok(revision>two.revision);assert.throws(()=>w.authorizeApple(one.id,'ApplePass wrong'),/authorization/);const secret=f.s.get('SELECT pass_auth FROM memberships WHERE id=?',one.id).pass_auth;assert.equal(w.authorizeApple(one.id,`ApplePass ${secret}`).id,one.id);});
test('forwarded client IPs are honored only from an explicitly trusted proxy',()=>{const req={socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'1.2.3.4, 198.51.100.8'}};assert.equal(clientAddress(req,{trustedProxyIps:[]}), '127.0.0.1');assert.equal(clientAddress(req,{trustedProxyIps:['127.0.0.1']}),'198.51.100.8');});
test('one Wallet provider failure does not prevent attempts to refresh the other',async t=>{const f=make(t);const m=f.member();const w=new Wallets(f.s,f.app,{mode:'live',env:{}});w.readiness=()=>({apple:true,google:true});w.register('test-device',m.id,'a'.repeat(64));let pushed=0;w.updateGoogle=async()=>{throw new Error('Google temporarily unavailable');};w.pushApple=async()=>{pushed++;};await assert.rejects(()=>w.update(m.id),/temporarily unavailable/);assert.equal(pushed,1);});
