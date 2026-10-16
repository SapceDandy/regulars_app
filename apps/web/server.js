import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { configuration,clientAddress } from './config.js';
import { openStore } from '../../packages/db/store.js';
import { seed } from '../../packages/db/seed.js';
import { Regulars } from '../../packages/core/regulars.js';
import { Auth } from '../../packages/integrations/auth.js';
import { Payments } from '../../packages/integrations/payments.js';
import { Wallets } from '../../packages/integrations/wallets.js';
import { Jobs } from '../../packages/integrations/jobs.js';
import { Problem, requireThat, escapeHtml, id, text } from '../../packages/core/rules.js';

const publicRoot=new URL('./public/',import.meta.url);
const assets=new Map([
  ['/app.js',['app.js','text/javascript; charset=utf-8']],['/styles.css',['styles.css','text/css; charset=utf-8']],
  ['/assets/mark.svg',['assets/mark.svg','image/svg+xml']],['/assets/icon.png',['assets/icon.png','image/png']],['/assets/icon@2x.png',['assets/icon@2x.png','image/png']]
]);
async function readBody(req) {
  let size=0;const chunks=[];
  for await(const chunk of req) {size+=chunk.length;requireThat(size<=128*1024,413,'Request body is too large.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function jsonBody(raw) {try {const parsed=JSON.parse(raw.toString('utf8')||'{}');requireThat(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),400,'Expected a JSON object.');return parsed;}catch(e){if(e instanceof Problem)throw e;throw new Problem(400,'Invalid JSON body.');}}

export function createApplication({config=configuration(),store=openStore(config.databasePath),now=()=>Date.now(),seedData=true,request}={}) {
  requireThat(config.mode!=='live'||store.get('SELECT count(*) n FROM venues WHERE demo=1').n===0,500,'Use a fresh live database; demo venues cannot accept live payments.');
  if(seedData)seed(store,{mode:config.mode,configPath:config.env.VENUE_CONFIG_PATH,now:now()});
  const app=new Regulars(store,{now});const auth=new Auth(store,config,{now,...(request?{request}:{})});const payments=new Payments(store,app,config,{...(request?{request}:{})});const wallets=new Wallets(store,app,config,{...(request?{request}:{})});const jobs=new Jobs(store,app,{wallets,payments});
  const server=createServer(async(req,res)=>{
    const requestId=id();
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if(config.secure)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
    const frame=`'self'${config.embedOrigins.length?' '+config.embedOrigins.join(' '):''}`;
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors ${frame}`);
    if(!config.embedOrigins.length)res.setHeader('X-Frame-Options','SAMEORIGIN');
    const send=(status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8',...headers});res.end(data===undefined?'':JSON.stringify(data));};
    try {
      const url=new URL(req.url,config.origin);const path=url.pathname;const method=req.method;const ip=clientAddress(req,config);
      const isApple=path.startsWith('/api/wallet/apple/');const isStripe=path==='/api/webhooks/stripe';
      if(!['GET','HEAD'].includes(method)&&!isApple&&!isStripe) {
        requireThat(req.headers.origin===config.origin,403,'This action must come from the Regulars site.');
        requireThat(String(req.headers['content-type']??'').startsWith('application/json'),415,'Use application/json.');
      }
      if(method==='OPTIONS')return send(405,{error:'Cross-origin API calls are not supported.'});
      const user=auth.session(req.headers.cookie);const signedIn=()=>{requireThat(user,401,'Sign in with your phone to continue.');return user.id;};
      if(method==='GET'&&path==='/healthz')return send(200,{ok:true});
      if(method==='GET'&&path==='/api/config')return send(200,{mode:config.mode,wallets:wallets.readiness()});
      if(method==='GET'&&path==='/api/venues')return send(200,app.catalog());
      let match;
      if(method==='GET'&&(match=path.match(/^\/api\/venues\/([a-z0-9_-]+)$/)))return send(200,app.venuePage(match[1]));
      if(method==='POST'&&path==='/api/auth/start')return send(200,await auth.start(jsonBody(await readBody(req)),ip));
      if(method==='POST'&&path==='/api/auth/verify') {const result=await auth.verify(jsonBody(await readBody(req)),ip);return send(200,{signedIn:true},{'set-cookie':auth.cookie(result.token)});}
      if(method==='POST'&&path==='/api/auth/logout') {auth.revoke(req.headers.cookie);return send(200,{signedOut:true},{'set-cookie':auth.cookie('',true)});}
      if(method==='GET'&&path==='/api/account')return send(200,app.account(signedIn()));
      if(method==='PATCH'&&path==='/api/account') {
        const uid=signedIn();const input=jsonBody(await readBody(req));
        store.run('UPDATE users SET name=?,marketing_opt_in=? WHERE id=?',text(input.name,'name',80),input.marketingOptIn===true?1:0,uid);return send(200,{updated:true});
      }
      if(method==='POST'&&path==='/api/memberships/guest') {const uid=signedIn();const b=jsonBody(await readBody(req));return send(201,app.enrollGuest(uid,b.venueId,b.planId));}
      if(method==='POST'&&path==='/api/orders') {const uid=signedIn();auth.limit(`checkout:${uid}`,20,60_000);const b=jsonBody(await readBody(req));const o=app.createOrder(uid,b,req.headers['idempotency-key']);return send(201,await payments.checkout(o));}
      if(method==='GET'&&(match=path.match(/^\/api\/orders\/([\w-]+)$/)))return send(200,app.order(signedIn(),match[1]));
      if(method==='POST'&&(match=path.match(/^\/api\/orders\/([\w-]+)\/resume$/))) {const uid=signedIn();app.cleanup();return send(200,await payments.checkout(app.order(uid,match[1])));}
      if(method==='POST'&&(match=path.match(/^\/api\/orders\/([\w-]+)\/cancel$/)))return send(200,app.cancelOrder(signedIn(),match[1]));
      if(method==='POST'&&(match=path.match(/^\/api\/orders\/([\w-]+)\/demo-pay$/))) {
        requireThat(config.mode==='demo',404,'Not found.');const o=app.order(signedIn(),match[1]);return send(200,app.settle({eventId:`demo:${o.id}`,orderId:o.id,amount:o.amount_cents,currency:o.currency,paymentIntent:`demo_pi_${o.id}`}));
      }
      if(method==='POST'&&path==='/api/queue') {const uid=signedIn();const b=jsonBody(await readBody(req));return send(201,app.joinQueue(uid,b.venueId,b.partySize));}
      if(method==='POST'&&(match=path.match(/^\/api\/queue\/([\w-]+)\/leave$/)))return send(200,app.leaveQueue(signedIn(),match[1]));
      if(method==='POST'&&path==='/api/webhooks/stripe') {requireThat(config.mode==='live',404,'Not found.');return send(200,payments.webhook(await readBody(req),req.headers['stripe-signature']));}
      if(method==='GET'&&(match=path.match(/^\/api\/wallet\/(apple|google)\/([\w-]+)$/))) {
        app.cleanup();wallets.assertOwner(signedIn(),match[2]);
        if(match[1]==='google')return send(200,{url:wallets.google(match[2])});
        const data=wallets.apple(match[2]);res.writeHead(200,{'content-type':'application/vnd.apple.pkpass','content-disposition':'attachment; filename="regulars.pkpass"'});return res.end(data);
      }
      if(isApple) {
        auth.limit(`apple:${ip}`,300,60_000);
        if((match=path.match(/^\/api\/wallet\/apple\/v1\/devices\/([^/]+)\/registrations\/([^/]+)\/([\w-]+)$/))) {
          const [,device,type,mid]=match;requireThat(type===config.env.APPLE_PASS_TYPE_ID,404,'Pass type not found.');wallets.authorizeApple(mid,req.headers.authorization);
          if(method==='POST') {const b=jsonBody(await readBody(req));return send(wallets.register(device,mid,b.pushToken));}
          if(method==='DELETE'){store.run('DELETE FROM apple_registrations WHERE device_id=? AND membership_id=?',device,mid);return send(200);}
        }
        if(method==='GET'&&(match=path.match(/^\/api\/wallet\/apple\/v1\/devices\/([^/]+)\/registrations\/([^/]+)$/))) {
          requireThat(match[2]===config.env.APPLE_PASS_TYPE_ID,404,'Pass type not found.');
          const since=Number(url.searchParams.get('passesUpdatedSince')??0);requireThat(Number.isSafeInteger(since)&&since>=0,400,'Invalid update tag.');
          const rows=store.all('SELECT m.id,m.revision FROM apple_registrations a JOIN memberships m ON m.id=a.membership_id WHERE a.device_id=? AND m.revision>?',match[1],since);
          if(!rows.length)return send(204);return send(200,{serialNumbers:rows.map(r=>r.id),lastUpdated:String(store.get('SELECT value FROM wallet_revision WHERE id=1').value)});
        }
        if(method==='GET'&&(match=path.match(/^\/api\/wallet\/apple\/v1\/passes\/([^/]+)\/([\w-]+)$/))) {
          requireThat(match[1]===config.env.APPLE_PASS_TYPE_ID,404,'Pass type not found.');wallets.authorizeApple(match[2],req.headers.authorization);app.cleanup();const member=store.get('SELECT revision,pass_updated_at FROM memberships WHERE id=?',match[2]);const etag=`"${member.revision}"`;
          if(req.headers['if-none-match']===etag||(req.headers['if-modified-since']&&Date.parse(req.headers['if-modified-since'])>=member.pass_updated_at)){res.writeHead(304,{etag});return res.end();}
          const data=wallets.apple(match[2]);res.writeHead(200,{'content-type':'application/vnd.apple.pkpass','last-modified':new Date(member.pass_updated_at).toUTCString(),etag});return res.end(data);
        }
        if(method==='POST'&&path==='/api/wallet/apple/v1/log') {await readBody(req);return send(200);}
      }
      if(method==='GET'&&(match=path.match(/^\/api\/staff\/([a-z0-9-]+)$/)))return send(200,app.staffDashboard(signedIn(),match[1]));
      if(method==='POST'&&(match=path.match(/^\/api\/staff\/([a-z0-9-]+)\/lookup$/))) {const uid=signedIn();const b=jsonBody(await readBody(req));return send(200,app.memberForStaff(uid,match[1],text(b.token,'pass code',100)));}
      if(method==='POST'&&(match=path.match(/^\/api\/staff\/reservations\/([\w-]+)$/)))return send(200,app.checkIn(signedIn(),match[1],jsonBody(await readBody(req)).action));
      if(method==='POST'&&(match=path.match(/^\/api\/staff\/queue\/([\w-]+)$/)))return send(200,app.queueAction(signedIn(),match[1],jsonBody(await readBody(req)).action));
      if(method==='POST'&&(match=path.match(/^\/api\/staff\/members\/([\w-]+)\/bottles$/)))return send(201,app.addBottle(signedIn(),match[1],jsonBody(await readBody(req)),req.headers['idempotency-key']));
      if(method==='POST'&&(match=path.match(/^\/api\/staff\/bottles\/([\w-]+)$/)))return send(200,app.adjustBottle(signedIn(),match[1],jsonBody(await readBody(req)),req.headers['idempotency-key']));
      if(method==='POST'&&(match=path.match(/^\/api\/staff\/campaigns\/([\w-]+)\/approve$/))) {
        const uid=signedIn();const c=store.get('SELECT * FROM campaigns WHERE id=?',match[1]);requireThat(c,404,'Campaign not found.');app.staff(uid,c.venue_id,true);store.transaction(()=>{store.run("UPDATE campaigns SET state='approved' WHERE id=?",c.id);app.audit(c.venue_id,uid,'campaign.approved',c.id);});return send(200,{approved:true});
      }
      if(method==='POST'&&(match=path.match(/^\/api\/venues\/([a-z0-9-]+)\/ask$/))) {auth.limit(`question:${ip}`,30,60_000);return send(200,app.answer(match[1],jsonBody(await readBody(req)).question));}
      if(method==='POST'&&path==='/api/partners') {
        auth.limit(`lead:${ip}`,4,60*60_000);const b=jsonBody(await readBody(req));const email=text(b.email,'email',200);requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Enter a valid email address.');store.run('INSERT INTO leads VALUES(?,?,?,?,?)',id(),text(b.venueName,'venue name',100),text(b.name,'name',80),email,now());return send(201,{received:true});
      }
      if(method==='GET'&&(match=path.match(/^\/api\/staff\/([a-z0-9-]+)\/jobs$/))) {
        const v=app.venue(match[1]);app.staff(signedIn(),v.id,true);return send(200,store.all("SELECT id,kind,subject_id,attempts,status,last_error FROM outbox WHERE status!='done' AND (subject_id IN(SELECT id FROM memberships WHERE venue_id=?) OR subject_id IN(SELECT id FROM orders WHERE venue_id=?))",v.id,v.id));
      }
      if(method==='POST'&&(match=path.match(/^\/api\/staff\/jobs\/([\w-]+)\/retry$/))) {
        const uid=signedIn();const j=store.get('SELECT * FROM outbox WHERE id=?',match[1]);requireThat(j,404,'Job not found.');const subject=store.get('SELECT venue_id FROM memberships WHERE id=?',j.subject_id)??store.get('SELECT venue_id FROM orders WHERE id=?',j.subject_id);requireThat(subject,404,'Job subject not found.');app.staff(uid,subject.venue_id,true);store.run("UPDATE outbox SET status='pending',attempts=0,next_at=? WHERE id=?",now(),j.id);return send(200,{queued:true});
      }
      if(path.startsWith('/api/'))return send(404,{error:'Not found.'});
      if(method!=='GET'&&method!=='HEAD')return send(405,{error:'Method not supported.'});
      if(assets.has(path)) {
        const [file,type]=assets.get(path);res.writeHead(200,{'content-type':type,'cache-control':'public,max-age=3600'});return res.end(method==='HEAD'?'':readFileSync(new URL(file,publicRoot)));
      }
      if(path==='/robots.txt'){res.writeHead(200,{'content-type':'text/plain'});return res.end(config.mode==='demo'?'User-agent: *\nDisallow: /\n':`User-agent: *\nDisallow: /account\nDisallow: /staff\nDisallow: /checkout\nDisallow: /api\nSitemap: ${config.origin}/sitemap.xml\n`);}
      if(path==='/sitemap.xml') {
        const urls=['/','/venues','/partners',...app.catalog().map(v=>`/v/${v.slug}`)];res.writeHead(200,{'content-type':'application/xml'});return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${escapeHtml(config.origin+u)}</loc></url>`).join('')}</urlset>`);
      }
      const known=path==='/'||['/venues','/partners','/account','/login','/terms','/privacy'].includes(path)||/^\/checkout\/[\w-]+$/.test(path)||/^\/staff\/[a-z0-9-]+$/.test(path)||/^\/v\/[a-z0-9-]+$/.test(path);
      requireThat(known,404,'Page not found.');
      let title='Regulars — Make it your place.';let description='Find your game-day home. Memberships, lockers, season passes and table reservations at local venues.';
      if(path.startsWith('/v/')) {const v=app.venue(path.split('/')[2]);title=`${v.name} · ${v.city} | Regulars`;description=v.description;}
      const privatePage=/^\/(account|staff|login|checkout)/.test(path);const noindex=config.mode==='demo'||privatePage;
      const meta=`<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><link rel="canonical" href="${escapeHtml(config.origin+path)}">${noindex?'<meta name="robots" content="noindex,nofollow">':''}`;
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(method==='HEAD'?'':readFileSync(new URL('index.html',publicRoot),'utf8').replace('<!--META-->',meta));
    } catch(error) {
      const status=error.status??500;
      if(status>=500) console.error(JSON.stringify({requestId,status,error:'Request failed'}));
      if(!res.headersSent)send(status,{error:status<500||error instanceof Problem?error.message:'Something went wrong. Please try again.',requestId});else res.end();
    }
  });
  server.requestTimeout=15_000;server.headersTimeout=10_000;
  return {server,store,app,auth,payments,wallets,jobs,config};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const runtime=createApplication();const {config,server,jobs}=runtime;
  server.listen(config.port,config.host,()=>console.log(`Regulars ${config.mode}: ${config.origin}`));
  const timer=setInterval(()=>jobs.tick().catch(()=>console.error('Background job failed; inspect the venue job queue.')),15_000);timer.unref();
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{clearInterval(timer);server.close(()=>{runtime.store.close();process.exit(0);});});
}
