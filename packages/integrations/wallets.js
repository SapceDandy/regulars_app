import { createHash, createSign } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:http2';
import { equal, requireThat, Problem } from '../core/rules.js';
import { zip } from './zip.js';
import { providerFetch } from './http.js';

function jwt(payload,key) {
  const content=[{alg:'RS256',typ:'JWT'},payload].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return `${content}.${createSign('RSA-SHA256').update(content).sign(key).toString('base64url')}`;
}
export function passFields(member,next=null) {
  const stock=member.bottles.filter(b=>b.remaining_ml>0).map(b=>`${b.name}: ${b.remaining_ml} / ${b.capacity_ml} mL`).join('\n')||'No bottles recorded';
  return {stock,locker:member.locker?`${member.locker.label}${member.locker.mode==='shared'?` · position ${member.locker.position}`:''}`:'No locker',status:member.active?'Active':'Inactive',next:next?`${next.title} · ${next.resource_label}`:'View upcoming games in your account'};
}
export function appleDocument(member,secret,config,next) {
  const f=passFields(member,next);const e=config.env;
  return {formatVersion:1,passTypeIdentifier:e.APPLE_PASS_TYPE_ID,serialNumber:member.id,teamIdentifier:e.APPLE_TEAM_ID,organizationName:'Regulars',description:`Regulars membership · ${member.venue_name}`,logoText:'REGULARS',backgroundColor:'rgb(38, 55, 45)',foregroundColor:'rgb(250, 246, 232)',labelColor:'rgb(202, 209, 171)',webServiceURL:`${config.origin}/api/wallet/apple`,authenticationToken:secret,voided:!member.active,expirationDate:new Date(member.ends_at).toISOString(),
    barcodes:[{format:'PKBarcodeFormatQR',message:member.pass_token,messageEncoding:'iso-8859-1',altText:member.pass_token.slice(-8)}],
    storeCard:{primaryFields:[{key:'venue',label:'YOUR PLACE',value:member.venue_name}],secondaryFields:[{key:'membership',label:'MEMBERSHIP',value:member.plan_name},{key:'locker',label:'LOCKER',value:f.locker}],auxiliaryFields:[{key:'status',label:'STATUS',value:f.status},{key:'balance',label:'ON YOUR SHELF',value:`${member.bottles.filter(b=>b.remaining_ml>0).length} bottles`}],backFields:[{key:'stock',label:'BOTTLES · LAST RECORDED BALANCE',value:f.stock},{key:'next',label:'NEXT RESERVATION',value:f.next},{key:'benefits',label:'MEMBERSHIP INCLUDES',value:member.benefits.join('\n')},{key:'account',label:'YOUR ACCOUNT',value:`${config.origin}/account`},{key:'note',label:'PLEASE KNOW',value:'Balances reflect venue records, not a live sensor. Service and identity checks remain with venue staff. Seating is separate unless shown in a confirmed booking.'}]}};
}
export function googleDocument(member,config,next) {
  const e=config.env;const f=passFields(member,next);return {id:`${e.GOOGLE_ISSUER_ID}.${member.id}`,classId:e.GOOGLE_CLASS_ID,state:member.active?'ACTIVE':'EXPIRED',hexBackgroundColor:'#26372D',
    cardTitle:{defaultValue:{language:'en-US',value:'REGULARS'}},header:{defaultValue:{language:'en-US',value:member.venue_name}},subheader:{defaultValue:{language:'en-US',value:member.plan_name}},
    barcode:{type:'QR_CODE',value:member.pass_token,alternateText:member.pass_token.slice(-8)},
    textModulesData:[{id:'status',header:'Membership',body:`${f.status} · ${f.locker}`},{id:'stock',header:'Bottles · last recorded balance',body:f.stock},{id:'next',header:'Next reservation',body:f.next},{id:'benefits',header:'Your membership',body:member.benefits.join('\n')},{id:'note',header:'Service',body:'Balances reflect venue records. Staff verify identity and service eligibility. Seating is separate.'}],
    linksModuleData:{uris:[{id:'account',uri:`${config.origin}/account`,description:'View your account'}]},validTimeInterval:{start:{date:new Date(member.starts_at).toISOString()},end:{date:new Date(member.ends_at).toISOString()}}};
}
export class Wallets {
  constructor(store,regulars,config,{request=providerFetch}={}) {this.s=store;this.app=regulars;this.config=config;this.request=request;this.access=null;}
  readiness() {
    const e=this.config.env;return {apple:this.config.mode==='live'&&['APPLE_PASS_TYPE_ID','APPLE_TEAM_ID','APPLE_CERT_PATH','APPLE_KEY_PATH','APPLE_WWDR_PATH'].every(k=>!!e[k]),google:this.config.mode==='live'&&['GOOGLE_ISSUER_ID','GOOGLE_CLASS_ID','GOOGLE_SERVICE_ACCOUNT_EMAIL','GOOGLE_PRIVATE_KEY_PATH'].every(k=>!!e[k])};
  }
  next(member) {return this.s.get("SELECT e.title,r.starts_at,s.label resource_label FROM reservations r JOIN orders o ON o.id=r.order_id JOIN events e ON e.id=r.event_id JOIN resources s ON s.id=r.resource_id WHERE o.user_id=? AND o.venue_id=? AND r.state IN('confirmed','attended') AND r.ends_at>? ORDER BY r.starts_at LIMIT 1",member.user_id,member.venue_id,this.app.now());}
  assertOwner(userId,mid) {const m=this.s.get('SELECT * FROM memberships WHERE id=? AND user_id=?',mid,userId);requireThat(m,404,'Pass not found.');return m;}
  authorizeApple(mid,header) {
    const m=this.s.get('SELECT * FROM memberships WHERE id=?',mid);requireThat(m&&equal(header,`ApplePass ${m.pass_auth}`),401,'Invalid pass authorization.');return m;
  }
  apple(mid) {
    requireThat(this.readiness().apple,503,'Apple Wallet needs the pass certificate and HTTPS setup.');
    const m=this.app.membershipSnapshot(mid);const secret=this.s.get('SELECT pass_auth FROM memberships WHERE id=?',mid).pass_auth;
    const files={'pass.json':Buffer.from(JSON.stringify(appleDocument(m,secret,this.config,this.next(m)))),'icon.png':readFileSync(new URL('../../apps/web/public/assets/icon.png',import.meta.url)),'icon@2x.png':readFileSync(new URL('../../apps/web/public/assets/icon@2x.png',import.meta.url)),'icon@3x.png':readFileSync(new URL('../../apps/web/public/assets/icon@3x.png',import.meta.url))};
    const manifest=Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(files).map(([name,data])=>[name,createHash('sha1').update(data).digest('hex')]))));
    const temp=mkdtempSync(join(tmpdir(),'regulars-pass-'));const e=this.config.env;
    try {
      writeFileSync(join(temp,'manifest.json'),manifest,{mode:0o600});
      // argv only; no shell interpolation. Certificates remain external to the repository.
      execFileSync('openssl',['smime','-binary','-sign','-signer',e.APPLE_CERT_PATH,'-inkey',e.APPLE_KEY_PATH,'-certfile',e.APPLE_WWDR_PATH,'-in',join(temp,'manifest.json'),'-out',join(temp,'signature'),'-outform','DER'],{stdio:'pipe',timeout:10_000});
      files['manifest.json']=manifest;files.signature=readFileSync(join(temp,'signature'));return zip(files);
    } finally {rmSync(temp,{recursive:true,force:true});}
  }
  google(mid) {
    requireThat(this.readiness().google,503,'Google Wallet needs an issuer, class and service account.');
    const e=this.config.env;const m=this.app.membershipSnapshot(mid);
    const token=jwt({iss:e.GOOGLE_SERVICE_ACCOUNT_EMAIL,aud:'google',typ:'savetowallet',iat:Math.floor(this.app.now()/1000),origins:[this.config.origin],payload:{genericObjects:[googleDocument(m,this.config,this.next(m))]}},readFileSync(e.GOOGLE_PRIVATE_KEY_PATH));
    return `https://pay.google.com/gp/v/save/${token}`;
  }
  register(device,mid,pushToken) {requireThat(device.length<=256&&typeof pushToken==='string'&&/^[A-Fa-f0-9]{32,512}$/.test(pushToken),400,'Invalid device registration.');const old=this.s.get('SELECT device_id FROM apple_registrations WHERE device_id=? AND membership_id=?',device,mid);this.s.run('INSERT INTO apple_registrations VALUES(?,?,?) ON CONFLICT(device_id,membership_id) DO UPDATE SET push_token=excluded.push_token',device,mid,pushToken);return old?200:201;}
  async googleAccess() {
    if(this.access&&this.access.expires>Date.now())return this.access.token;
    const e=this.config.env;const now=Math.floor(Date.now()/1000);
    const assertion=jwt({iss:e.GOOGLE_SERVICE_ACCOUNT_EMAIL,scope:'https://www.googleapis.com/auth/wallet_object.issuer',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600},readFileSync(e.GOOGLE_PRIVATE_KEY_PATH));
    const response=await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});const data=await response.json();this.access={token:data.access_token,expires:Date.now()+Math.max(0,data.expires_in-60)*1000};return this.access.token;
  }
  async updateGoogle(mid) {
    const m=this.app.membershipSnapshot(mid);const body=googleDocument(m,this.config,this.next(m));const access=await this.googleAccess();
    const url=`https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(body.id)}`;
    let res=await fetch(url,{method:'PATCH',headers:{authorization:`Bearer ${access}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12_000)});
    if(res.status===404) res=await fetch('https://walletobjects.googleapis.com/walletobjects/v1/genericObject',{method:'POST',headers:{authorization:`Bearer ${access}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12_000)});
    requireThat(res.ok,502,`Google Wallet update failed (${res.status}).`);
  }
  pushApple(token) {
    const e=this.config.env;
    return new Promise((resolve,reject)=>{
      const session=connect('https://api.push.apple.com',{cert:readFileSync(e.APPLE_CERT_PATH),key:readFileSync(e.APPLE_KEY_PATH)});
      let done=false;const finish=(error)=>{if(done)return;done=true;session.close();error?reject(error):resolve();};
      session.setTimeout(12_000,()=>finish(new Problem(502,'Apple update timed out.')));session.on('error',finish);
      const req=session.request({':method':'POST',':path':`/3/device/${token}`,'apns-topic':e.APPLE_PASS_TYPE_ID,'apns-push-type':'background','apns-priority':'5'});
      req.on('response',headers=>{const status=Number(headers[':status']);if(status===410) {this.s.run('DELETE FROM apple_registrations WHERE push_token=?',token);finish();}else if(status!==200)finish(new Problem(502,`Apple update failed (${status}).`));});
      req.on('data',()=>{});req.on('end',()=>finish());req.on('error',finish);req.end('{}');
    });
  }
  async update(mid) {
    const ready=this.readiness();if(this.config.mode==='demo')return;
    requireThat(ready.apple&&ready.google,503,'Complete both Wallet configurations before syncing.');
    const results=await Promise.allSettled([this.updateGoogle(mid),...this.s.all('SELECT DISTINCT push_token FROM apple_registrations WHERE membership_id=?',mid).map(r=>this.pushApple(r.push_token))]);
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  }
}
