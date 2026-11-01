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
    requireThat(event&&typeof event.id==='string'&&event.id.length>0&&typeof event.type==='string',400,'Invalid payment event.');
    const report=async kind=>{
      const o=event.data.object;
      return this.app.recordPaymentCase({eventId:event.id,kind,reference:typeof o.id==='string'?o.id:event.id,paymentIntent:typeof o.payment_intent==='string'?o.payment_intent:null,orderId:typeof o.metadata?.order_id==='string'?o.metadata?.order_id:null,amount:Number.isSafeInteger(o.amount??o.amount_total)&&(o.amount??o.amount_total)>=0?(o.amount??o.amount_total):null,currency:typeof o.currency==='string'?o.currency:'',providerStatus:event.type});
    };
    requireThat(event.data?.object&&typeof event.data.object==='object',400,'Invalid payment event object.');
    if(['charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated'].includes(event.type)) {
      const d=event.data.object;
      requireThat(typeof d.status==='string'&&typeof d.currency==='string',400,'Invalid dispute report.');
      return this.app.recordPaymentCase({eventId:event.id,kind:'dispute',reference:d.id,paymentIntent:typeof d.payment_intent==='string'?d.payment_intent:null,amount:d.amount,currency:d.currency,providerStatus:d.status,dueAt:d.evidence_details?.due_by?d.evidence_details.due_by*1000:null});
    }
    try {
    if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded') {
      const o=event.data.object;
      if(o.payment_status==='paid') return (await this.app.settle({eventId:event.id,orderId:o.metadata?.order_id,amount:o.amount_total,currency:o.currency,paymentIntent:o.payment_intent,sessionId:o.id}));
    }
    if(event.type==='checkout.session.async_payment_failed'||event.type==='checkout.session.expired') {
      const session=event.data.object;
      return await this.s.transaction(async()=>{
        if(await this.s.get('SELECT id FROM payment_events WHERE id=?',event.id))return {duplicate:true};
        const order=await this.s.get('SELECT * FROM orders WHERE id=?',session.metadata?.order_id??null);requireThat(order,404,'Order not found.');
        requireThat(!order.stripe_session||order.stripe_session===session.id,409,'Payment does not match the held order.');
        if(order.state==='held') {await this.app.release(order.id,'cancelled');await this.app.audit(order.venue_id,null,'payment.failed',order.id,{eventType:event.type});}
        await this.s.run('INSERT INTO payment_events VALUES(?,?)',event.id,this.app.now());return {received:true};
      });
    }
    if(event.type==='charge.refunded') {
      const c=event.data.object;
      const result=await this.app.recordRefund({eventId:event.id,paymentIntent:c.payment_intent,orderId:c.metadata?.order_id,amount:c.amount,currency:c.currency,refundedAmount:c.amount_refunded});
      if(!await this.s.get('SELECT id FROM orders WHERE payment_intent=?',c.payment_intent))return report('unmatched_refund');
      return result;
    }
    return {received:true};
    } catch(error) {
      if([404,409].includes(error.status))await report('payment_mismatch');
      throw error;
    }
  }
  async refund(orderId) {
    const o=(await this.s.get('SELECT * FROM orders WHERE id=?',orderId));
    if(!o||o.state!=='refund_pending')return;
    if(this.config.mode!=='demo') {
      requireThat(o.payment_intent,409,'Missing payment reference. Manager reconciliation required.');
      const refund=await this.stripe('refunds',{payment_intent:o.payment_intent},`refund:${o.id}`);
      requireThat(refund.status==='succeeded',409,'Refund is not settled yet. Await the payment webhook or reconcile with the provider.');
    }
    await this.app.completeRefund(orderId);
  }
}
