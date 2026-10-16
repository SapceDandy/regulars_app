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
      mode:'payment','payment_method_types[0]':'card',
      'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(order.amount_cents),
      'line_items[0][price_data][product_data][name]':`Regulars · ${order.details.planName??order.details.resourceLabel??'Priority access'}`,
      'line_items[0][quantity]':'1','metadata[order_id]':order.id,client_reference_id:order.id,
      success_url:`${this.config.origin}/account?order=${order.id}`,cancel_url:`${this.config.origin}/checkout/${order.id}?cancelled=1`,
      expires_at:String(Math.floor(order.expires_at/1000))
    },`checkout:${order.id}`);
    this.s.run('UPDATE orders SET stripe_session=?,checkout_url=? WHERE id=?',session.id,session.url,order.id);
    return {orderId:order.id,url:session.url};
  }
  webhook(raw,signature) {
    const event=verifyStripeSignature(raw,signature,this.config.env.STRIPE_WEBHOOK_SECRET,this.app.now());
    if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded') {
      const o=event.data.object;
      if(o.payment_status==='paid') return this.app.settle({eventId:event.id,orderId:o.metadata.order_id,amount:o.amount_total,currency:o.currency,paymentIntent:o.payment_intent,sessionId:o.id});
    }
    if(event.type==='charge.refunded') {
      const c=event.data.object;
      // Partial external refunds require manager reconciliation; never revoke all benefits silently.
      if(c.amount_refunded!==c.amount) return {reconcile:true};
      const order=this.s.get('SELECT * FROM orders WHERE payment_intent=?',c.payment_intent);
      if(order) this.s.transaction(()=>{
        this.s.run("UPDATE orders SET state='refunded' WHERE id=?",order.id);
        this.s.run("UPDATE reservations SET state='cancelled' WHERE order_id=? AND state!='attended'",order.id);
        this.s.run("UPDATE queue_entries SET lane='standard',state='waiting',order_id=NULL WHERE order_id=? AND state IN('waiting','held')",order.id);
        const m=this.s.get('SELECT id FROM memberships WHERE order_id=?',order.id);
        if(m) {this.s.run("UPDATE memberships SET status='cancelled' WHERE id=?",m.id);this.s.run("UPDATE locker_allocations SET state='released' WHERE membership_id=?",m.id);this.app.touch(m.id);}
        this.app.audit(order.venue_id,null,'payment.refunded',order.id);
      });
    }
    return {received:true};
  }
  async refund(orderId) {
    const o=this.s.get('SELECT * FROM orders WHERE id=?',orderId);
    if(!o||o.state!=='refund_pending')return;
    if(this.config.mode!=='demo') {
      requireThat(o.payment_intent,409,'Missing payment reference. Manager reconciliation required.');
      const refund=await this.stripe('refunds',{payment_intent:o.payment_intent},`refund:${o.id}`);
      requireThat(refund.status==='succeeded',409,'Refund is not settled yet. Await the payment webhook or reconcile with the provider.');
    }
    this.s.run("UPDATE orders SET state='refunded' WHERE id=? AND state='refund_pending'",orderId);
  }
}
