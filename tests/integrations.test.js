import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac,createHash,generateKeyPairSync,verify } from 'node:crypto';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fixture } from './helpers/fixture.js';
import { Payments,verifyStripeSignature } from '../packages/integrations/payments.js';
import { Wallets,googleDocument,appleDocument } from '../packages/integrations/wallets.js';
import { Jobs } from '../packages/integrations/jobs.js';
import { Auth } from '../packages/integrations/auth.js';
import { configuration } from '../apps/web/config.js';

const liveConfig={mode:'live',origin:'https://regulars.example',env:{STRIPE_SECRET_KEY:'test_only',STRIPE_WEBHOOK_SECRET:'test_secret',APPLE_PASS_TYPE_ID:'pass.example.regulars',APPLE_TEAM_ID:'TESTTEAM01',GOOGLE_ISSUER_ID:'123456',GOOGLE_CLASS_ID:'123456.members',GOOGLE_SERVICE_ACCOUNT_EMAIL:'test@example.invalid'}};
function fxt(t){const f=fixture();t.after(()=>f.s.close());return f;}
function rawWebhook(f,order,type='checkout.session.completed',extra={}){return Buffer.from(JSON.stringify({id:'evt_valid',type,data:{object:{id:'cs_test',metadata:{order_id:order.id},payment_status:'paid',amount_total:order.amount_cents,currency:'usd',payment_intent:'pi_test',...extra}}}));}
function signature(raw,now){const timestamp=Math.floor(now/1000);return `t=${timestamp},v1=${createHmac('sha256','test_secret').update(`${timestamp}.`).update(raw).digest('hex')}`;}

test('Stripe rejects forged and stale signatures before changing inventory',t=>{
  const f=fxt(t);const order=f.ticket();const raw=rawWebhook(f,order);assert.throws(()=>verifyStripeSignature(raw,'t=1,v1=bad','test_secret',f.now()),/signature/);assert.throws(()=>verifyStripeSignature(raw,signature(raw,f.now()-600_000),'test_secret',f.now()),/signature/);assert.equal(verifyStripeSignature(raw,signature(raw,f.now()),'test_secret',f.now()).id,'evt_valid');
});
test('a signed Stripe webhook activates a held booking once; unpaid checkout does not',t=>{
  const f=fxt(t);const order=f.ticket();const p=new Payments(f.s,f.app,liveConfig);const unpaid=rawWebhook(f,order,'checkout.session.completed',{payment_status:'unpaid'});p.webhook(unpaid,signature(unpaid,f.now()));assert.equal(f.app.order(f.uid,order.id).state,'held');const raw=rawWebhook(f,order);p.webhook(raw,signature(raw,f.now()));p.webhook(raw,signature(raw,f.now()));assert.equal(f.app.order(f.uid,order.id).state,'paid');assert.equal(f.s.get('SELECT count(*) n FROM payment_events').n,1);
});
test('Stripe checkout uses server-held amounts and stable provider idempotency keys',async t=>{
  const f=fxt(t);const o=f.ticket();const calls=[];const p=new Payments(f.s,f.app,liveConfig,{request:async(url,options)=>{calls.push({url,options});return {json:async()=>({id:'cs_test',url:'https://checkout.stripe.com/test'})};}});await p.checkout(o);await p.checkout(f.app.order(f.uid,o.id));assert.equal(calls.length,1);assert.equal(calls[0].options.body.get('line_items[0][price_data][unit_amount]'),String(o.amount_cents));assert.equal(calls[0].options.headers['idempotency-key'],`checkout:${o.id}`);assert.equal(calls[0].options.body.get('mode'),'payment');
});
test('Twilio live flow validates the provider response and never returns the SMS code',async t=>{
  const f=fxt(t);const calls=[];const c={...configuration({APP_MODE:'demo'}),mode:'live',env:{TWILIO_ACCOUNT_SID:'ACtest',TWILIO_AUTH_TOKEN:'test',TWILIO_VERIFY_SERVICE_SID:'VAtest'}};
  const auth=new Auth(f.s,c,{now:f.now,request:async(url,options)=>{calls.push({url,options});return{json:async()=>({status:url.endsWith('VerificationCheck')?'approved':'pending'})};}});
  const started=await auth.start({phone:'+12025550150',smsConsent:true},'test-ip');assert.equal(started.demoCode,undefined);const session=await auth.verify({phone:'+12025550150',code:'123456'},'test-ip');assert.ok(session.token);assert.match(calls[0].url,/Verifications$/);assert.match(calls[1].url,/VerificationCheck$/);assert.equal(calls[1].options.body.get('Code'),'123456');
});
test('both native pass payloads reflect current stock and inactive membership status',t=>{
  const f=fxt(t);const m=f.member();const b=f.app.addBottle(f.manager,m.id,{name:'Sample bottle',capacityMl:750},'receive');f.app.adjustBottle(f.manager,b.id,{deltaMl:-45,reason:'Service'},'pour');const current=f.app.membershipSnapshot(m.id);const apple=appleDocument(current,'test_auth_token_long_enough',liveConfig);const google=googleDocument(current,liveConfig);assert.match(apple.storeCard.backFields.find(x=>x.key==='stock').value,/705 \/ 750 mL/);assert.match(google.textModulesData.find(x=>x.id==='stock').body,/705 \/ 750 mL/);assert.equal(apple.barcodes[0].message,current.pass_token);assert.equal(google.barcode.value,current.pass_token);f.setTime(m.ends_at+1);f.app.cleanup();assert.equal(appleDocument(f.app.membershipSnapshot(m.id),'test',liveConfig).voided,true);assert.equal(googleDocument(f.app.membershipSnapshot(m.id),liveConfig).state,'EXPIRED');
});
test('Google save link is an RS256 JWT signed by the configured service account',t=>{
  const f=fxt(t);const m=f.member();const dir=mkdtempSync(join(tmpdir(),'regulars-google-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const keyPath=join(dir,'key.pem');writeFileSync(keyPath,privateKey.export({type:'pkcs8',format:'pem'}));const c={...liveConfig,env:{...liveConfig.env,GOOGLE_PRIVATE_KEY_PATH:keyPath}};const wallets=new Wallets(f.s,f.app,c);const link=wallets.google(m.id);const token=link.split('/').at(-1);const [head,body,sig]=token.split('.');assert.equal(JSON.parse(Buffer.from(head,'base64url')).alg,'RS256');assert.equal(verify('RSA-SHA256',Buffer.from(`${head}.${body}`),publicKey,Buffer.from(sig,'base64url')),true);const claims=JSON.parse(Buffer.from(body,'base64url'));assert.equal(claims.aud,'google');assert.equal(claims.payload.genericObjects[0].id,`123456.${m.id}`);
});
function readZip(bytes){const files={};let offset=0;while(bytes.readUInt32LE(offset)===0x04034b50){const length=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);const name=bytes.subarray(offset+30,offset+30+nameLength).toString();const start=offset+30+nameLength+extra;files[name]=bytes.subarray(start,start+length);offset=start+length;}return files;}
test('Apple pass package contains a verifiable detached PKCS7 signature and correct manifest hashes',t=>{
  const f=fxt(t);const m=f.member();const dir=mkdtempSync(join(tmpdir(),'regulars-apple-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=Regulars Test Only','-days','1'],{stdio:'pipe'});
  const c={...liveConfig,env:{...liveConfig.env,APPLE_KEY_PATH:key,APPLE_CERT_PATH:cert,APPLE_WWDR_PATH:cert}};const w=new Wallets(f.s,f.app,c);const files=readZip(w.apple(m.id));const manifest=JSON.parse(files['manifest.json']);for(const [name,hash] of Object.entries(manifest))assert.equal(createHash('sha1').update(files[name]).digest('hex'),hash);writeFileSync(join(dir,'manifest.json'),files['manifest.json']);writeFileSync(join(dir,'signature'),files.signature);execFileSync('openssl',['smime','-verify','-binary','-inform','DER','-in',join(dir,'signature'),'-content',join(dir,'manifest.json'),'-noverify'],{stdio:'pipe'});assert.equal(JSON.parse(files['pass.json']).serialNumber,m.id);assert.equal(files['icon.png'].subarray(1,4).toString(),'PNG');
});
test('Wallet update failure retries without rolling back a successful bottle service',async t=>{
  const f=fxt(t);const m=f.member();const b=f.app.addBottle(f.manager,m.id,{name:'Sample',capacityMl:750},'receive');f.app.adjustBottle(f.manager,b.id,{deltaMl:-45,reason:'Service'},'pour');const jobs=new Jobs(f.s,f.app,{wallets:{update:async()=>{throw new Error('Provider unavailable');}},payments:{refund:async()=>{}}});await jobs.tick();assert.equal(f.s.get('SELECT remaining_ml FROM bottles WHERE id=?',b.id).remaining_ml,705);assert.ok(f.s.get("SELECT count(*) n FROM outbox WHERE status='pending' AND attempts=1").n>0);assert.match(f.s.get('SELECT last_error FROM outbox LIMIT 1').last_error,/Delivery failed/);
});
test('scheduled expiry refreshes the next reservation on the Wallet pass',t=>{
  const f=fxt(t);const m=f.member();const order=f.ticket();f.paid(order);const revision=f.app.membershipSnapshot(m.id).revision;f.setTime(f.games[0].ends_at+1);f.app.cleanup();assert.ok(f.app.membershipSnapshot(m.id).revision>revision);
});
test('refund outbox completes a demo cancellation without inventing a live charge',async t=>{
  const f=fxt(t);const o=f.ticket();f.paid(o);f.app.cancelOrder(f.uid,o.id);const payments=new Payments(f.s,f.app,{mode:'demo'});const jobs=new Jobs(f.s,f.app,{wallets:{update:async()=>{}},payments});await jobs.tick();assert.equal(f.app.order(f.uid,o.id).state,'refunded');
});
