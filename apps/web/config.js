import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { requireThat } from '../../packages/core/rules.js';

export function configuration(env = process.env) {
  const mode=env.APP_MODE??'demo';requireThat(['demo','live'].includes(mode),500,'APP_MODE must be demo or live.');
  const production=env.NODE_ENV==='production';
  requireThat(!production||mode==='live',500,'Production cannot run with demo authentication or payments.');
  const port=Number(env.PORT??3000); const origin=new URL(env.PUBLIC_ORIGIN??`http://localhost:${port}`).origin;
  const host=env.HOST??'127.0.0.1';
  requireThat(mode!=='demo'||(['127.0.0.1','localhost','::1'].includes(host)&&['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)),500,'Demo mode is restricted to localhost.');
  if(mode==='live') {
    for(const key of ['SESSION_SECRET','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_VERIFY_SERVICE_SID','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','VENUE_CONFIG_PATH']) requireThat(!!env[key],500,`Configure ${key} before live startup.`);
    requireThat(env.SESSION_SECRET.length>=32&&origin.startsWith('https://'),500,'Live mode needs HTTPS and a 32+ character session secret.');
  }
  const embedOrigins=(env.EMBED_ORIGINS??'').split(',').filter(Boolean).map(v=>new URL(v.trim()).origin);
  requireThat(embedOrigins.every(v=>v.startsWith('https://')),500,'Embed origins must be HTTPS.');
  const trustedProxyIps=(env.TRUSTED_PROXY_IPS??'').split(',').filter(Boolean).map(v=>v.trim());requireThat(trustedProxyIps.every(v=>isIP(v)>0),500,'Configure exact trusted proxy IP addresses.');
  return {mode,production,host,port,origin,secure:origin.startsWith('https://'),databasePath:resolve(env.DATABASE_PATH??'./data/regulars.sqlite'),secret:env.SESSION_SECRET||randomBytes(32).toString('hex'),embedOrigins,trustedProxyIps,env};
}
export function clientAddress(req,config) {
  const remote=req.socket.remoteAddress??'unknown';
  if(!config.trustedProxyIps?.includes(remote))return remote;
  // Trust only the closest explicitly configured proxy. It must append/overwrite the actual client IP.
  const candidate=String(req.headers['x-forwarded-for']??'').split(',').at(-1).trim();return isIP(candidate)>0?candidate:remote;
}
