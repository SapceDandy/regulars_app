import { createHmac } from 'node:crypto';
import { equal, requireThat } from '../core/rules.js';
import { providerFetch } from './http.js';

export function verifyStripeSignature(raw,header,secret,now=Date.now()) {
  const parts=String(header??'').split(',').map(x=>x.split('='));const timestamp=parts.find(x=>x[0]==='t')?.[1];
  requireThat(timestamp&&/^\d+$/.test(timestamp)&&Math.abs(now/1000-Number(timestamp))<=300,400,'Invalid payment signature.');
  const expected=createHmac('sha256',secret).update(`${timestamp}.`).update(raw).digest('hex');
  requireThat(parts.some(([k,v])=>k==='v1'&&equal(v,expected)),400,'Invalid payment signature.');
  try{return JSON.parse(raw.toString('utf8'));}catch{requireThat(false,400,'Invalid webhook JSON.');}
}
export class Payments {
  constructor(store,regulars,config,{request=providerFetch}={}) {this.s=store;this.app=regulars;this.config=config;this.request=request;}
  async stripe(path,body,key) {
    const res=await this.request(`https://api.stripe.com/v1/${path}`,{method:'POST',headers:{authorization:`Bearer ${this.config.env.STRIPE_SECRET_KEY}`,'content-type':'application/x-www-form-urlencoded','idempotency-key':key},body:new URLSearchParams(body)});return res.json();
  }
  async checkout(order) {
    requireThat(order.state==='held'&&order.expires_at>this.app.now(),409,'This checkout is no longer open.');
    if(this.config.mode==='demo') return {orderId:order.id,url:`${this.config.origin}/checkout/${order.id}`,demo:true};
    if(order.checkout_url) return {orderId:order.id,url:order.checkout_url};
    const session=await this.stripe('checkout/sessions',{
      mode:'payment',
      'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(order.amount_cents),
      'line_items[0][price_data][product_data][name]':`Regulars · ${order.details.planName??order.details.resourceLabel??'Priority access'}`,
      'line_items[0][quantity]':'1','metadata[order_id]':order.id,'payment_intent_data[metadata][order_id]':order.id,client_reference_id:order.id,
      success_url:`${this.config.origin}/account?order=${order.id}`,cancel_url:`${this.config.origin}/checkout/${order.id}?cancelled=1`,
      expires_at:String(Math.floor(order.expires_at/1000))
    },`checkout:${order.id}`);
    (await this.s.run('UPDATE orders SET stripe_session=?,checkout_url=? WHERE id=?',session.id,session.url,order.id));
    return {orderId:order.id,url:session.url};
  }
  async webhook(raw,signature) {
    const event=verifyStripeSignature(raw,signature,this.config.env.STRIPE_WEBHOOK_SECRET,this.app.now());
    if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded') {
      const o=event.data.object;
      if(o.payment_status==='paid') return (await this.app.settle({eventId:event.id,orderId:o.metadata.order_id,amount:o.amount_total,currency:o.currency,paymentIntent:o.payment_intent,sessionId:o.id}));
    }
    if(event.type==='checkout.session.async_payment_failed'||event.type==='checkout.session.expired') {
      const session=event.data.object;
      return this.s.transaction(async()=>{
        if(await this.s.get('SELECT id FROM payment_events WHERE id=?',event.id))return {duplicate:true};
        const order=await this.s.get('SELECT * FROM orders WHERE id=?',session.metadata.order_id);requireThat(order,404,'Order not found.');
        requireThat(!order.stripe_session||order.stripe_session===session.id,409,'Payment does not match the held order.');
        if(order.state==='held') {await this.app.release(order.id,'cancelled');await this.app.audit(order.venue_id,null,'payment.failed',order.id,{eventType:event.type});}
        await this.s.run('INSERT INTO payment_events VALUES(?,?)',event.id,this.app.now());return {received:true};
      });
    }
    if(event.type==='charge.refunded') {
      const c=event.data.object;
      // Partial external refunds require manager reconciliation; never revoke all benefits silently.
      if(c.amount_refunded!==c.amount) return {reconcile:true};
      return this.s.transaction(async ()=>{
        if(await this.s.get('SELECT id FROM payment_events WHERE id=?',event.id))return {duplicate:true};
        // Charge metadata comes from Checkout's PaymentIntent, including when a refund arrives first.
        const order=await this.s.get('SELECT * FROM orders WHERE payment_intent=?',c.payment_intent)??await this.s.get('SELECT * FROM orders WHERE id=?',c.metadata?.order_id??null);
        if(!order)return {received:true};
        requireThat(c.amount===order.amount_cents&&c.currency===order.currency&&typeof c.payment_intent==='string'&&c.payment_intent.length>0&&(!order.payment_intent||order.payment_intent===c.payment_intent)&&(!c.metadata?.order_id||c.metadata.order_id===order.id),409,'Refund does not match the order.');
        await this.s.run('INSERT INTO payment_events VALUES(?,?)',event.id,this.app.now());
        if(order.state==='refunded')return {duplicate:true};
        await this.app.release(order.id,'refunded');
        await this.s.run('UPDATE orders SET payment_intent=? WHERE id=?',c.payment_intent,order.id);
        (await this.s.run("UPDATE reservations SET state='cancelled' WHERE order_id=? AND state!='attended'",order.id));
        (await this.s.run("UPDATE queue_entries SET lane='standard',state='waiting',order_id=NULL WHERE order_id=? AND state IN('waiting','held')",order.id));
        const m=(await this.s.get('SELECT id FROM memberships WHERE order_id=?',order.id));
        if(m) {(await this.s.run("UPDATE memberships SET status='cancelled' WHERE id=?",m.id));(await this.s.run("UPDATE locker_allocations SET state='released' WHERE membership_id=?",m.id));}
        // Ticket refunds also change the next reservation displayed on a pass.
        for(const member of await this.s.all('SELECT id FROM memberships WHERE user_id=? AND venue_id=?',order.user_id,order.venue_id))await this.app.touch(member.id);
        (await this.app.audit(order.venue_id,null,'payment.refunded',order.id));
        return {received:true};
      });
    }
    return {received:true};
  }
  async refund(orderId) {
    const o=(await this.s.get('SELECT * FROM orders WHERE id=?',orderId));
    if(!o||o.state!=='refund_pending')return;
    if(this.config.mode!=='demo') {
      requireThat(o.payment_intent,409,'Missing payment reference. Manager reconciliation required.');
      const refund=await this.stripe('refunds',{payment_intent:o.payment_intent},`refund:${o.id}`);
      requireThat(refund.status==='succeeded',409,'Refund is not settled yet. Await the payment webhook or reconcile with the provider.');
    }
    (await this.s.run("UPDATE orders SET state='refunded' WHERE id=? AND state='refund_pending'",orderId));
  }
}
