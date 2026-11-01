// Opt-in provider rehearsal. Never part of CI and never deployed.
// node --use-env-proxy tests/manual/stripe-sandbox.mjs <key-file> <expected-account> <stripe-cli>
// JSON lines on stdin: create, status, replay, partial, cancel, expire, review, stop.
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {serverFixture} from '../helpers/http.js';

const [keyPath,accountId,cli]=process.argv.slice(2);
assert.ok(keyPath && /^acct_[A-Za-z0-9]+$/.test(accountId??'') && cli,'Supply a protected test-key file, expected sandbox account, and Stripe CLI.');
assert.equal(statSync(keyPath).mode & 0o077,0,'The key file must be readable only by its owner (chmod 600).');
const key=readFileSync(keyPath,'utf8').trim();
if(!/^sk_test_[A-Za-z0-9]+$/.test(key))throw new Error('Only sandbox secret keys are permitted.');
assert.ok(!process.env.DATABASE_URL && !process.env.REGULARS_TEST_DB,'Use the fresh in-memory SQLite fixture only.');
const output=value=>console.log(JSON.stringify(value));
const api=async(path,body)=>{
  const response=await fetch(`https://api.stripe.com/v1/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${key}`,...(body?{'content-type':'application/x-www-form-urlencoded','idempotency-key':`regulars-rehearsal:${randomUUID()}`}:{})},...(body?{body:new URLSearchParams(body)}:{}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok)throw new Error(`Stripe ${response.status}: ${data.error?.code??data.error?.type??'request_failed'}`);
  return data;
};
assert.equal((await api('account')).id,accountId,'Refusing to test against the wrong Stripe account.');
const cleanups=[],f=await serverFixture({after:fn=>cleanups.push(fn)});
const customer=await f.login(),manager=await f.login('+12025550100');
// The existing HTTP fixture supplies synthetic identities before switching to
// the real payment adapter. This does not change any deployable mode or guards.
f.config.mode='live';f.config.env.STRIPE_SECRET_KEY=key;
const realProvider=f.payments.request;
f.payments.request=(url,options)=>{assert.equal(new URL(url).origin,'https://api.stripe.com');return realProvider(url,options);};
const cases=new Map(),deliveries=[];
const originalWebhook=f.payments.webhook.bind(f.payments);
f.payments.webhook=async(raw,signature)=>{
  const result=await originalWebhook(raw,signature),event=JSON.parse(raw);
  assert.equal(event.livemode,false,'Provider event must be test mode.');
  deliveries.push({raw:Buffer.from(raw),signature,event});
  output({webhook:{id:event.id,type:event.type,result}});
  return result;
};
let listener,input,stopped=false;
const stop=async()=>{if(stopped)return;stopped=true;input?.close();process.stdin.pause();listener?.kill('SIGTERM');for(const fn of cleanups.reverse())await fn();};
process.once('SIGINT',()=>stop().then(()=>process.exit(0)));
process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
try {
  listener=spawn(cli,['listen','--events','checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,charge.refunded,charge.dispute.created,charge.dispute.updated,charge.dispute.closed','--events-from','@self','--forward-to',`${f.config.origin}/api/webhooks/stripe`,'--skip-update'],{env:{...process.env,STRIPE_API_KEY:key},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Stripe listener did not become ready.')),45000);let buffer='';
    const observe=chunk=>{
      buffer=(buffer+chunk.toString()).slice(-8192);
      const secret=buffer.match(/whsec_[A-Za-z0-9]+/);
      if(secret){f.config.env.STRIPE_WEBHOOK_SECRET=secret[0];buffer='';clearTimeout(timer);resolve();}
      // CLI output can contain signing credentials. Never print it verbatim.
    };
    listener.stdout.on('data',observe);listener.stderr.on('data',observe);
    listener.once('error',()=>{clearTimeout(timer);reject(new Error('Stripe listener failed to start.'));});
    listener.once('exit',code=>{clearTimeout(timer);reject(new Error(`Stripe listener exited (${code}).`));});
  });
  const json=async(path,options={})=>{const r=await f.call(path,{cookie:customer,...options});assert.ok(r.status<400,`${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;};
  output({ready:true,accountId,origin:f.config.origin,scope:'fresh local database; actual Stripe sandbox and CLI-signed webhooks; no SMS/Wallet sends'});
  input=createInterface({input:process.stdin});
  for await(const line of input){
    if(!line.trim())continue;
    try {
      const c=JSON.parse(line),entry=cases.get(c.name);
      if(c.action==='stop')break;
      if(c.action==='create'){
        assert.ok(!cases.has(c.name),'Use a unique case name.');
        const venue=await json('/api/venues/copper-room');
        const body=c.kind==='membership'?{kind:'membership',venueId:venue.venue.id,planId:'v_copper_shared'}:{kind:'ticket',venueId:venue.venue.id,eventId:venue.events[0].id,resourceId:venue.resources[c.resource??0].id,partySize:1};
        const created=await json('/api/orders',{method:'POST',key:randomUUID(),body});
        const order=await json(`/api/orders/${created.orderId}`);
        assert.equal(order.state,'held');assert.match(created.url,/^https:\/\/checkout.stripe.com\//);
        const repeated=await json(`/api/orders/${order.id}/resume`,{method:'POST',body:{}});assert.equal(repeated.url,created.url);
        cases.set(c.name,{id:order.id,url:created.url});
        output({case:c.name,orderId:order.id,state:order.state,cents:order.amount_cents,url:created.url,resumeReusedSession:true});
      }else if(c.action==='status'){
        const orders=[];for(const [name,e] of cases)orders.push({name,...await f.store.get("SELECT o.id,o.state,o.amount_cents,CASE WHEN o.state='refunded' THEN o.amount_cents ELSE coalesce(r.refunded_cents,0) END refunded_cents,o.stripe_session,o.payment_intent FROM orders o LEFT JOIN refund_reviews r ON r.order_id=o.id WHERE o.id=?",e.id)});
        output({orders,memberships:(await json('/api/account')).memberships.map(m=>({id:m.id,status:m.status})),processedEvents:(await f.store.get('SELECT count(*) n FROM payment_events')).n,webhookDeliveries:deliveries.length,refundReviews:await f.store.all('SELECT order_id,status,refunded_cents FROM refund_reviews')});
      }else if(c.action==='replay'){
        assert.ok(entry,'Unknown case.');
        const delivery=deliveries.find(d=>d.event.type==='checkout.session.completed'&&d.event.data.object.metadata?.order_id===entry.id);assert.ok(delivery,'Await an actual paid webhook first.');
        const count=(await f.store.get('SELECT count(*) n FROM payment_events')).n;
        const result=await f.call('/api/webhooks/stripe',{method:'POST',origin:false,raw:delivery.raw,headers:{'stripe-signature':delivery.signature}});assert.equal(result.status,200);assert.equal(result.data.duplicate,true);
        assert.equal((await f.store.get('SELECT count(*) n FROM payment_events')).n,count);
        const altered=JSON.parse(delivery.raw);altered.data.object.amount_total++;
        const bad=await f.call('/api/webhooks/stripe',{method:'POST',origin:false,raw:JSON.stringify(altered),headers:{'stripe-signature':delivery.signature}});assert.equal(bad.status,400);
        output({case:c.name,duplicateIgnored:true,tamperedDeliveryRejected:true});
      }else if(c.action==='partial'){
        assert.ok(entry,'Unknown case.');const order=await json(`/api/orders/${entry.id}`);assert.equal(order.state,'paid');
        const refund=await api('refunds',{payment_intent:order.payment_intent,amount:String(c.cents)});output({case:c.name,partialRefund:{id:refund.id,status:refund.status,amount:refund.amount}});
      }else if(c.action==='cancel'){
        assert.ok(entry,'Unknown case.');const result=await json(`/api/orders/${entry.id}/cancel`,{method:'POST',body:{}});await f.jobs.tick();
        output({case:c.name,cancellation:result,state:(await json(`/api/orders/${entry.id}`)).state});
      }else if(c.action==='expire'){
        assert.ok(entry,'Unknown case.');const order=await json(`/api/orders/${entry.id}`);const expired=await api(`checkout/sessions/${order.stripe_session}/expire`,{});assert.equal(expired.livemode,false);output({case:c.name,sessionStatus:expired.status});
      }else if(c.action==='review'){
        assert.ok(entry,'Unknown case.');const review=await f.store.get('SELECT refunded_cents FROM refund_reviews WHERE order_id=?',entry.id);assert.ok(review,'Await the actual refund webhook.');
        const denied=await f.call(`/api/staff/refund-reviews/${entry.id}`,{method:'POST',cookie:customer,body:{refundedCents:review.refunded_cents,note:'Sandbox review'}});assert.equal(denied.status,403);
        const reviewed=await json(`/api/staff/refund-reviews/${entry.id}`,{method:'POST',cookie:manager,body:{refundedCents:review.refunded_cents,note:'Verified actual Stripe sandbox partial refund.'}});output({case:c.name,customerReviewDenied:true,managerReview:reviewed});
      }else throw new Error('Unknown rehearsal action.');
    }catch(error){output({caseError:error.message.replace(/(?:sk_test_|whsec_)[A-Za-z0-9]+/g,'[redacted]')});}
  }
} finally {await stop();}
