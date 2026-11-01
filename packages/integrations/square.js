import {createHmac} from 'node:crypto';
import {equal,requireThat} from '../core/rules.js';

// One explicitly configured merchant/location. Payments never imply bottle service.
export class Square {
  constructor(app,config){this.app=app;this.config=config;}
  async webhook(raw,signature){
    const env=this.config.env;
    requireThat(!this.config.pilot&&this.config.mode==='live',404,'Not found.');
    requireThat(['SQUARE_WEBHOOK_SIGNATURE_KEY','SQUARE_WEBHOOK_URL','SQUARE_MERCHANT_ID','SQUARE_LOCATION_ID','SQUARE_VENUE_ID'].every(key=>env[key]),503,'Square is not configured.');
    const expected=createHmac('sha256',env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_URL).update(raw).digest('base64');
    requireThat(equal(String(signature??''),expected),400,'Invalid Square signature.');
    let event;try{event=JSON.parse(raw.toString('utf8'));}catch{requireThat(false,400,'Invalid Square JSON.');}
    requireThat(event&&typeof event.event_id==='string'&&event.event_id.length>0&&event.merchant_id===env.SQUARE_MERCHANT_ID,400,'Square merchant or event does not match.');
    if(!['payment.created','payment.updated'].includes(event.type))return {received:true};
    const p=event.data?.object?.payment;
    requireThat(p&&p.location_id===env.SQUARE_LOCATION_ID&&p.id===event.data.id,400,'Square payment or location does not match.');
    if(p.status!=='COMPLETED')return {received:true};
    requireThat(!p.refunded_money||p.refunded_money.currency==='USD',400,'Invalid Square refund currency.');
    const total=p.total_money??p.amount_money;
    return this.app.recordSquarePayment({id:p.id,venueId:env.SQUARE_VENUE_ID,amount:total?.amount,currency:total?.currency,createdAt:Date.parse(p.created_at),refundedAmount:p.refunded_money?.amount??0});
  }
}
