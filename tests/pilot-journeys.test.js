import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,verify} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {serverFixture} from './helpers/http.js';

async function actors(t){
  const f=await serverFixture(t),customer=await f.login(),manager=await f.login('+12025550100'),staff=await f.login('+12025550102'),outsider=await f.login('+12025550103');
  const staffId=(await f.auth.session(staff)).id,outsiderId=(await f.auth.session(outsider)).id;
  await f.store.run('INSERT INTO staff VALUES(?,?,?)',staffId,'v_copper','staff');await f.store.run('INSERT INTO staff VALUES(?,?,?)',outsiderId,'v_social','manager');
  f.config.mode='live';f.config.env.STRIPE_WEBHOOK_SECRET='journey-secret';
  f.payments.request=async(url,options)=>{assert.ok(url.endsWith('/checkout/sessions'));const oid=options.body.get('metadata[order_id]');return{json:async()=>({id:`cs_${oid}`,url:`https://checkout.stripe.com/fixture-${oid}`})};};
  return {...f,customer,manager,staff,outsider};
}
async function event(f,type,object,id){const raw=JSON.stringify({id,type,data:{object}}),stamp=Math.floor(f.app.now()/1000);return f.call('/api/webhooks/stripe',{method:'POST',origin:false,raw,headers:{'stripe-signature':`t=${stamp},v1=${createHmac('sha256','journey-secret').update(`${stamp}.${raw}`).digest('hex')}`}});}
async function pay(f,oid){const o=await f.store.get('SELECT * FROM orders WHERE id=?',oid);const r=await event(f,'checkout.session.completed',{id:`cs_${oid}`,metadata:{order_id:oid},payment_status:'paid',payment_intent:`pi_${oid}`,amount_total:o.amount_cents,currency:o.currency},`evt_${oid}`);assert.equal(r.status,200);return o;}
function signingFixture(t,f){
  const dir=mkdtempSync(join(tmpdir(),'regulars-journey-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=Regulars Synthetic Test Only','-days','1'],{stdio:'pipe'});
  Object.assign(f.config.env,{APPLE_PASS_TYPE_ID:'pass.test.regulars',APPLE_TEAM_ID:'TESTTEAM01',APPLE_KEY_PATH:key,APPLE_CERT_PATH:cert,APPLE_WWDR_PATH:cert,GOOGLE_ISSUER_ID:'test-issuer',GOOGLE_CLASS_ID:'test-issuer.members',GOOGLE_SERVICE_ACCOUNT_EMAIL:'fixture@example.invalid',GOOGLE_PRIVATE_KEY_PATH:key});return {dir,cert};
}
function unzip(bytes){const files={};let offset=0;while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+length+extra;files[bytes.subarray(offset+30,offset+30+length).toString()]=bytes.subarray(start,start+size);offset=start+size;}return files;}
async function passes(f,k,mid){
  const response=await fetch(`${f.config.origin}/api/wallet/apple/${mid}`,{headers:{cookie:f.customer}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/vnd.apple.pkpass');const files=unzip(Buffer.from(await response.arrayBuffer()));
  for(const [name,hash] of Object.entries(JSON.parse(files['manifest.json'])))assert.equal(createHash('sha1').update(files[name]).digest('hex'),hash);
  writeFileSync(join(k.dir,'manifest'),files['manifest.json']);writeFileSync(join(k.dir,'signature'),files.signature);execFileSync('openssl',['smime','-verify','-binary','-inform','DER','-in',join(k.dir,'signature'),'-content',join(k.dir,'manifest'),'-noverify'],{stdio:'pipe'});
  const google=await f.call(`/api/wallet/google/${mid}`,{cookie:f.customer});assert.equal(google.status,200);const [head,body,sig]=google.data.url.split('/').at(-1).split('.');assert.equal(verify('RSA-SHA256',Buffer.from(`${head}.${body}`),readFileSync(k.cert),Buffer.from(sig,'base64url')),true);
  return {apple:JSON.parse(files['pass.json']),google:JSON.parse(Buffer.from(body,'base64url')).payload.genericObjects[0]};
}

test('customer purchase, native pass creation, staff service and manager correction stay consistent through a refund',async t=>{
  const f=await actors(t),k=signingFixture(t,f);
  const purchase=await f.call('/api/orders',{method:'POST',cookie:f.customer,key:'member-purchase',body:{kind:'membership',venueId:'v_copper',planId:'v_copper_shared',amount_cents:1,role:'manager'}});assert.equal(purchase.status,201);const oid=purchase.data.orderId;
  assert.equal((await f.call('/api/account',{cookie:f.customer})).data.memberships.length,0);
  assert.equal((await f.call(`/account?order=${oid}`,{cookie:f.customer})).status,200);assert.equal((await f.call('/api/account',{cookie:f.customer})).data.memberships.length,0,'return page must never grant benefits');
  const order=await pay(f,oid);assert.ok(order.amount_cents>1);const account=(await f.call('/api/account',{cookie:f.customer})).data,m=account.memberships[0];assert.equal(account.staffVenues.length,0);
  let pair=await passes(f,k,m.id);assert.equal(pair.apple.voided,false);assert.equal(pair.google.state,'ACTIVE');assert.equal(pair.apple.barcodes[0].message,pair.google.barcode.value);
  for(const provider of ['apple','google'])assert.equal((await f.call(`/api/wallet/${provider}/${m.id}`,{cookie:f.outsider})).status,404);
  const lookup={method:'POST',body:{token:m.pass_token}};assert.equal((await f.call('/api/staff/copper-room/lookup',{...lookup,cookie:f.outsider})).status,403);assert.equal((await f.call('/api/staff/copper-room/lookup',{...lookup,cookie:f.staff})).data.id,m.id);
  const received=await f.call(`/api/staff/members/${m.id}/bottles`,{method:'POST',cookie:f.staff,key:'receive',body:{name:'Synthetic bottle',capacityMl:750}});assert.equal(received.status,201);const bottle=received.data;
  const pour={method:'POST',cookie:f.staff,key:'pour',body:{deltaMl:-45,reason:'Synthetic service'}};assert.equal((await f.call(`/api/staff/bottles/${bottle.id}`,pour)).data.remainingMl,705);assert.equal((await f.call(`/api/staff/bottles/${bottle.id}`,pour)).data.duplicate,true);
  const correction={method:'POST',key:'correction',body:{deltaMl:15,reason:'Manager measured stock'}};assert.equal((await f.call(`/api/staff/bottles/${bottle.id}`,{...correction,cookie:f.staff})).status,403);assert.equal((await f.call(`/api/staff/bottles/${bottle.id}`,{...correction,cookie:f.manager})).data.remainingMl,720);
  assert.equal((await f.call(`/api/staff/bottles/${bottle.id}`,{...pour,key:'overdraw',body:{deltaMl:-721,reason:'Synthetic overdraw'}})).status,409);
  pair=await passes(f,k,m.id);assert.match(pair.apple.storeCard.backFields.find(x=>x.key==='stock').value,/720 \/ 750 mL/);assert.match(pair.google.textModulesData.find(x=>x.id==='stock').body,/720 \/ 750 mL/);
  assert.equal((await f.store.get('SELECT count(*) n FROM bottle_log WHERE bottle_id=?',bottle.id)).n,3);assert.ok((await f.store.get("SELECT count(*) n FROM outbox WHERE kind='wallet' AND status='pending'")).n>=4);
  const refunded=await event(f,'charge.refunded',{payment_intent:`pi_${oid}`,amount:order.amount_cents,amount_refunded:order.amount_cents,currency:'usd'},'refund-member');assert.equal(refunded.status,200);
  pair=await passes(f,k,m.id);assert.equal(pair.apple.voided,true);assert.equal(pair.google.state,'EXPIRED');assert.equal((await f.call(`/api/staff/bottles/${bottle.id}`,{...pour,key:'after-refund'})).status,409);
  const dashboard=await f.call('/api/staff/copper-room',{cookie:f.manager});assert.equal(dashboard.status,200);assert.equal((await f.store.get('SELECT remaining_ml FROM bottles WHERE id=?',bottle.id)).remaining_ml,720);
});

test('customer cancellation survives refund outage and only the correct venue manager can retry delivery',async t=>{
  const f=await actors(t),venue=(await f.call('/api/venues/copper-room')).data;
  const body={kind:'ticket',venueId:'v_copper',resourceId:venue.resources[0].id,eventId:venue.events[0].id,partySize:1};
  const created=await f.call('/api/orders',{method:'POST',cookie:f.customer,key:'booking',body}),oid=created.data.orderId;assert.equal(created.status,201);await pay(f,oid);
  assert.equal((await f.call(`/api/orders/${oid}/cancel`,{method:'POST',cookie:f.outsider,body:{}})).status,404);
  assert.equal((await f.call(`/api/orders/${oid}/cancel`,{method:'POST',cookie:f.customer,body:{}})).data.refundPending,true);
  let available=false;const keys=[];f.payments.request=async(url,options)=>{assert.ok(url.endsWith('/refunds'));keys.push(options.headers['idempotency-key']);if(!available)throw new Error('Synthetic provider outage');return{json:async()=>({status:'succeeded'})};};
  await f.jobs.tick();assert.equal((await f.call(`/api/orders/${oid}`,{cookie:f.customer})).data.state,'refund_pending');const job=(await f.call('/api/staff/copper-room/jobs',{cookie:f.manager})).data[0];assert.equal(job.attempts,1);assert.equal(job.last_error,'Delivery failed (500).');
  for(const cookie of [f.customer,f.staff,f.outsider])assert.equal((await f.call(`/api/staff/jobs/${job.id}/retry`,{method:'POST',cookie,body:{}})).status,403);
  available=true;assert.equal((await f.call(`/api/staff/jobs/${job.id}/retry`,{method:'POST',cookie:f.manager,body:{}})).status,200);await f.jobs.tick();assert.equal((await f.call(`/api/orders/${oid}`,{cookie:f.customer})).data.state,'refunded');assert.equal((await f.call('/api/staff/copper-room/jobs',{cookie:f.manager})).data.length,0);assert.deepEqual(keys,[`refund:${oid}`,`refund:${oid}`]);
  assert.equal((await f.store.get('SELECT state FROM reservations WHERE order_id=?',oid)).state,'cancelled');
});

test('server-only PEM secrets issue verifiable passes without a private-key mount and clean signing failures',async t=>{
  const f=await actors(t),k=signingFixture(t,f),e=f.config.env;
  for(const name of ['APPLE_CERT','APPLE_KEY','APPLE_WWDR','GOOGLE_PRIVATE_KEY']){e[`${name}_PEM`]=readFileSync(e[`${name}_PATH`],'utf8');delete e[`${name}_PATH`];}
  rmSync(join(k.dir,'key.pem'));
  const previousTmp=process.env.TMPDIR;process.env.TMPDIR=k.dir;
  t.after(()=>{if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;});
  const purchase=await f.call('/api/orders',{method:'POST',cookie:f.customer,key:'pem-member',body:{kind:'membership',venueId:'v_copper',planId:'v_copper_shared'}});assert.equal(purchase.status,201);await pay(f,purchase.data.orderId);
  const m=(await f.call('/api/account',{cookie:f.customer})).data.memberships[0];
  const pair=await passes(f,k,m.id);assert.equal(pair.apple.serialNumber,m.id);assert.equal(pair.google.id,`test-issuer.${m.id}`);
  const visible=await f.call('/api/config');assert.deepEqual(visible.data.wallets,{apple:true,google:true});assert.doesNotMatch(JSON.stringify(visible.data),/BEGIN|PRIVATE|PEM/);
  assert.deepEqual(readdirSync(k.dir).filter(name=>name.startsWith('regulars-pass-')),[]);
  e.APPLE_KEY_PEM='invalid-test-key';await assert.rejects(f.wallets.apple(m.id));
  assert.deepEqual(readdirSync(k.dir).filter(name=>name.startsWith('regulars-pass-')),[],'failed signing must remove temporary credentials');
  delete e.APPLE_KEY_PEM;assert.equal(f.wallets.readiness().apple,false);delete e.GOOGLE_PRIVATE_KEY_PEM;assert.equal(f.wallets.readiness().google,false);
});
