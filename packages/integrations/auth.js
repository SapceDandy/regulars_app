import { createHmac, randomInt } from 'node:crypto';
import { id, digest, equal, phone, requireThat, text } from '../core/rules.js';
import { providerFetch } from './http.js';

export class Auth {
  constructor(store, config, {now=()=>Date.now(),request=providerFetch}={}) {this.s=store;this.config=config;this.now=now;this.request=request;}
  limit(key,max,windowMs) {
    // Persistent counters apply across restarts and every server sharing this DB.
    this.s.transaction(()=>{
      const now=this.now();const hashed=digest(key);const row=this.s.get('SELECT * FROM rate_limits WHERE key=?',hashed);
      if(!row||row.reset_at<=now) this.s.run('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=1,reset_at=excluded.reset_at',hashed,now+windowMs);
      else {requireThat(row.hits<max,429,'Too many attempts. Please try again later.');this.s.run('UPDATE rate_limits SET hits=hits+1 WHERE key=?',hashed);}
    });
  }
  codeHash(p,code) {return createHmac('sha256',this.config.secret).update(`${p}:${code}`).digest('hex');}
  async twilio(path,body) {
    const e=this.config.env;const auth=Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString('base64');
    const res=await this.request(`https://verify.twilio.com/v2/Services/${encodeURIComponent(e.TWILIO_VERIFY_SERVICE_SID)}/${path}`,{method:'POST',headers:{authorization:`Basic ${auth}`,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});return res.json();
  }
  async start(input,ip) {
    const p=phone(input.phone);requireThat(input.smsConsent===true,400,'Agree to receive a sign-in code by text.');
    this.limit(`send:ip:${ip}`,15,60*60_000);this.limit(`send:phone:${p}`,4,60*60_000);
    const current=this.s.get('SELECT expires_at FROM challenges WHERE phone=?',p);
    requireThat(!current||current.expires_at-this.now()<9*60_000,429,'Wait one minute before requesting another code.');
    const code=String(randomInt(100000,1000000));
    this.s.run('INSERT INTO challenges VALUES(?,?,?,0) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0',p,this.config.mode==='demo'?this.codeHash(p,code):null,this.now()+10*60_000);
    if(this.config.mode==='live') {
      try {await this.twilio('Verifications',{To:p,Channel:'sms'});}
      catch(error) {this.s.run('DELETE FROM challenges WHERE phone=?',p);throw error;}
    }
    return {sent:true,...(this.config.mode==='demo'?{demoCode:code}:{} )};
  }
  async verify(input,ip) {
    const p=phone(input.phone);requireThat(/^\d{6}$/.test(input.code??''),400,'Enter the six-digit code.');
    this.limit(`check:ip:${ip}`,30,15*60_000);this.limit(`check:phone:${p}`,8,15*60_000);
    const c=this.s.get('SELECT * FROM challenges WHERE phone=?',p);
    requireThat(c&&c.expires_at>this.now()&&c.attempts<5,401,'Code expired or unavailable. Request another code.');
    this.s.run('UPDATE challenges SET attempts=attempts+1 WHERE phone=?',p);
    const ok=this.config.mode==='demo'?equal(c.code_hash,this.codeHash(p,input.code)):(await this.twilio('VerificationCheck',{To:p,Code:input.code})).status==='approved';
    requireThat(ok,401,'That code is not valid.');
    // Consume only the still-current challenge; two concurrent verifications cannot mint two sessions.
    return this.s.transaction(()=>{
      const consumed=this.s.run('DELETE FROM challenges WHERE phone=? AND expires_at=?',p,c.expires_at);requireThat(consumed.changes===1,401,'Code has already been used.');
      let u=this.s.get('SELECT * FROM users WHERE phone=?',p);
      if(!u) {u={id:id()};this.s.run('INSERT INTO users(id,phone,name,marketing_opt_in,created_at) VALUES(?,?,?,?,?)',u.id,p,input.name?text(input.name,'name',80):'',input.marketingOptIn===true?1:0,this.now());}
      const token=id()+id();this.s.run('INSERT INTO sessions VALUES(?,?,?)',digest(token),u.id,this.now()+7*86_400_000);return {token,userId:u.id};
    });
  }
  session(cookie='') {
    const value=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('regulars_session='))?.slice('regulars_session='.length);
    if(!value||value.length>100) return null;
    return this.s.get('SELECT u.id,u.name,u.phone FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',digest(value),this.now())??null;
  }
  revoke(cookie='') {const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('regulars_session='))?.split('=')[1];if(token)this.s.run('DELETE FROM sessions WHERE token_hash=?',digest(token));}
  cookie(token,clear=false) {return `regulars_session=${clear?'':token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:7*86400}${this.config.secure?'; Secure':''}`;}
}
