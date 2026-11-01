import { id, requireThat, text, integer, quotePrice, priorityPrice, digest } from './rules.js';

const DAY = 86_400_000;
export const HOLD_MS = 31 * 60_000;
const seatStates = "('held','confirmed','attended')";

export class Regulars {
  constructor(store, {now = () => Date.now()} = {}) { this.s=store; this.now=now; }
  async venue(key) {
    const v=(await this.s.get('SELECT * FROM venues WHERE id=? OR slug=?',key,key));
    requireThat(v,404,'Venue not found.'); return v;
  }
  async user(userId) { const u=(await this.s.get('SELECT * FROM users WHERE id=?',userId)); requireThat(u,401,'Sign in to continue.'); return u; }
  async staff(userId, venueId, manager=false) {
    const role=(await this.s.get('SELECT role FROM staff WHERE user_id=? AND venue_id=?',userId,venueId));
    requireThat(role && (!manager || role.role==='manager'),403,manager?'Manager access required.':'Venue staff access required.'); return role;
  }
  async audit(venue, actor, action, subject, detail={}) { (await this.s.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?)',id(),venue,actor,action,subject,JSON.stringify(detail),this.now())); }
  async enqueue(kind, subject, payload={}) { (await this.s.run('INSERT INTO outbox(id,kind,subject_id,payload,next_at,created_at) VALUES(?,?,?,?,?,?)',id(),kind,subject,JSON.stringify(payload),this.now(),this.now())); }
  async touch(memberId) {
    const m=(await this.s.get('SELECT * FROM memberships WHERE id=?',memberId));if(!m)return;
    const next=(await this.s.get("SELECT min(r.ends_at) at FROM reservations r JOIN orders o ON o.id=r.order_id WHERE o.user_id=? AND o.venue_id=? AND r.state IN('confirmed','attended') AND r.ends_at>?",m.user_id,m.venue_id,this.now()))?.at;
    const dates=[next,m.ends_at].filter(n=>n>this.now());
    (await this.s.run('UPDATE wallet_revision SET value=value+1 WHERE id=1'));
    (await this.s.run('UPDATE memberships SET revision=(SELECT value FROM wallet_revision WHERE id=1),next_refresh_at=?,pass_updated_at=? WHERE id=?',dates.length?Math.min(...dates):0,this.now(),memberId));
    (await this.enqueue('wallet',memberId));
  }
  async cleanup() {
    return (await this.s.transaction(async ()=> {
      const now=this.now();
      for(const o of (await this.s.all("SELECT id FROM orders WHERE state='held' AND expires_at<=?",now))) (await this.release(o.id,'expired'));
      for(const m of (await this.s.all("SELECT id FROM memberships WHERE status='active' AND ends_at<=?",now))) {
        (await this.s.run("UPDATE memberships SET status='expired' WHERE id=?",m.id));
        (await this.s.run("UPDATE locker_allocations SET state='released' WHERE membership_id=? AND state='active'",m.id)); (await this.touch(m.id));
      }
      for(const m of (await this.s.all('SELECT id FROM memberships WHERE next_refresh_at>0 AND next_refresh_at<=?',now)))(await this.touch(m.id));
      // Staff decide late release, so a delayed job never silently takes an occupied table.
      (await this.s.run('DELETE FROM sessions WHERE expires_at<=?',now));
      (await this.s.run('DELETE FROM rate_limits WHERE reset_at<?',now-DAY));
      (await this.s.run('DELETE FROM challenges WHERE expires_at<?',now-DAY));
    }));
  }
  async release(orderId,state) {
    (await this.s.run('UPDATE orders SET state=? WHERE id=?',state,orderId));
    (await this.s.run("UPDATE reservations SET state='released' WHERE order_id=? AND state='held'",orderId));
    (await this.s.run("UPDATE locker_allocations SET state='released' WHERE order_id=? AND state='held'",orderId));
    (await this.s.run("UPDATE queue_entries SET lane='standard',state='waiting',order_id=NULL WHERE order_id=? AND state='held'",orderId));
  }
  async catalog() { return (await this.s.all('SELECT id,slug,name,city,description,demo FROM venues ORDER BY name')); }
  async venuePage(key) {
    (await this.cleanup()); const v=(await this.venue(key));
    const plans=(await this.s.all('SELECT * FROM plans WHERE venue_id=? ORDER BY price_cents',v.id)).map(p=>({...p,benefits:JSON.parse(p.benefits)}));
    const events=(await this.s.all('SELECT * FROM events WHERE venue_id=? AND published=1 AND starts_at>? ORDER BY starts_at',v.id,this.now())).map(e=>({...e,price_cents:quotePrice(e,this.now())}));
    const resources=(await this.s.all('SELECT * FROM resources WHERE venue_id=? ORDER BY kind,label',v.id));
    for(const e of events) { e.available=[]; for(const r of resources) if(!(await this.s.get(`SELECT id FROM reservations WHERE resource_id=? AND state IN ${seatStates} AND starts_at<? AND ends_at>?`,r.id,e.ends_at,e.starts_at))) e.available.push(r.id); }
    const priorityCount=(await this.s.get("SELECT count(*) n FROM queue_entries WHERE venue_id=? AND lane='priority' AND state IN('held','waiting','called')",v.id)).n;
    return {venue:v,plans,events,resources,queue:{priorityCount,priceCents:priorityCount<4?priorityPrice(v.priority_base_cents,priorityCount):null,enabled:!!v.priority_enabled}};
  }
  async enrollGuest(userId,venueKey,planId) {
    (await this.user(userId)); const v=(await this.venue(venueKey));
    const p=(await this.s.get('SELECT * FROM plans WHERE id=? AND venue_id=? AND price_cents=0 AND mode IS NULL',planId,v.id));
    requireThat(p,400,'Choose an available guest pass.');
    return (await this.s.transaction(async ()=>{
      const old=(await this.s.get('SELECT * FROM memberships WHERE user_id=? AND venue_id=?',userId,v.id));
      if(old && old.status==='active' && old.ends_at>this.now()) return {membershipId:old.id};
      const mid=old?.id??id(); const until=this.now()+p.duration_days*DAY;
      if(old) (await this.s.run("UPDATE memberships SET plan_id=?,status='active',starts_at=?,ends_at=?,order_id=NULL WHERE id=?",p.id,this.now(),until,mid));
      else (await this.s.run("INSERT INTO memberships(id,user_id,venue_id,plan_id,status,starts_at,ends_at,pass_token,pass_auth) VALUES(?,?,?,?,'active',?,?,?,?)",mid,userId,v.id,p.id,this.now(),until,id(),id()+id()));
      (await this.touch(mid));(await this.audit(v.id,userId,'guest.enrolled',mid)); return {membershipId:mid};
    }));
  }
  async createOrder(userId,input,key) {
    (await this.user(userId)); text(key,'checkout retry key',100); (await this.cleanup());
    return (await this.s.transaction(async ()=>{
      const prior=(await this.s.get('SELECT * FROM orders WHERE user_id=? AND idempotency_key=?',userId,key));
      if(prior) { requireThat(JSON.parse(prior.details).requestFingerprint===digest(JSON.stringify(input)),409,'Use a new checkout key for a different purchase.'); return this.orderView(prior); }
      const v=(await this.venue(input.venueId)); const now=this.now(); const oid=id();
      let amount=0; let details={terms:v.terms,requestFingerprint:digest(JSON.stringify(input))}; let allocation=null; let reservations=[];
      requireThat(['membership','ticket','season','priority'].includes(input.kind),400,'Choose a valid purchase.');
      if(input.kind==='membership') {
        const p=(await this.s.get('SELECT * FROM plans WHERE id=? AND venue_id=? AND price_cents>0',input.planId,v.id));
        requireThat(p,400,'Choose an available paid membership.');
        const old=(await this.s.get('SELECT * FROM memberships WHERE user_id=? AND venue_id=?',userId,v.id));
        requireThat(!(await this.s.get("SELECT id FROM orders WHERE user_id=? AND venue_id=? AND kind='membership' AND state='held'",userId,v.id)),409,'You already have a membership checkout in progress.');
        const activePaid=old?.status==='active' && old.ends_at>now && (await this.s.get('SELECT price_cents FROM plans WHERE id=?',old.plan_id)).price_cents>0;
        requireThat(!activePaid || (old.plan_id===p.id && old.ends_at-now<=7*DAY),409,'Your membership is active. Renew the same plan during its last seven days.');
        const start=activePaid?old.ends_at:now; const end=start+p.duration_days*DAY;
        if(p.mode) {
          let found;
          const oldAllocation=activePaid?(await this.s.get("SELECT * FROM locker_allocations WHERE membership_id=? AND state='active' ORDER BY ends_at DESC LIMIT 1",old.id)):null;
          const lockers=(await this.s.all('SELECT * FROM lockers WHERE venue_id=? AND mode=? ORDER BY label',v.id,p.mode));
          for(const l of lockers) {
            for(let position=1;position<=l.positions;position++) {
              if(oldAllocation && (l.id!==oldAllocation.locker_id || position!==oldAllocation.position)) continue;
              const conflict=(await this.s.get("SELECT id FROM locker_allocations WHERE locker_id=? AND state IN('held','active') AND starts_at<? AND ends_at>? AND (position=? OR ?='private')",l.id,end,start,position,p.mode));
              if(!conflict) {found={lockerId:l.id,position};break;}
            }
            if(found) break;
          }
          requireThat(found,409,'This locker plan is full. Choose another plan or contact the venue.'); allocation={...found,start,end};
        }
        details={...details,planId:p.id,planName:p.name,start,end,benefits:JSON.parse(p.benefits)}; amount=p.price_cents;
      } else if(input.kind==='ticket'||input.kind==='season') {
        const r=(await this.s.get('SELECT * FROM resources WHERE id=? AND venue_id=?',input.resourceId,v.id));
        requireThat(r,400,'Choose a table or bar seat at this venue.');
        const size=integer(input.partySize,1,r.capacity,'party size'); let games=[];
        if(input.kind==='ticket') {const e=(await this.s.get('SELECT * FROM events WHERE id=? AND venue_id=? AND published=1',input.eventId,v.id));requireThat(e,404,'Game not found.');games=[e];}
        else {text(input.team,'team');text(input.season,'season');games=(await this.s.all('SELECT * FROM events WHERE venue_id=? AND team=? AND season=? AND published=1 AND starts_at>? ORDER BY starts_at',v.id,input.team,input.season,now));}
        requireThat(games.length>0,409,'No upcoming games in this pass.');
        for(const e of games) {
          const price=quotePrice(e,now);
          requireThat(!(await this.s.get(`SELECT id FROM reservations WHERE resource_id=? AND state IN ${seatStates} AND starts_at<? AND ends_at>?`,r.id,e.ends_at,e.starts_at)),409,`${r.label} is already reserved during ${e.title}.`);
          requireThat(!reservations.some(x=>x.starts_at<e.ends_at&&x.ends_at>e.starts_at),409,'The selected season contains overlapping games.');
          reservations.push({...e,partySize:size,resourceId:r.id});amount+=price;
        }
        if(input.kind==='season') amount=Math.round(amount*0.9);
        details={...details,resourceLabel:r.label,partySize:size,gameIds:games.map(g=>g.id),gameTitles:games.map(g=>g.title),team:games[0].team,season:games[0].season,graceMinutes:v.grace_minutes};
      } else {
        requireThat(v.priority_enabled,409,'Paid priority is not enabled at this venue.');
        const q=(await this.s.get("SELECT * FROM queue_entries WHERE id=? AND user_id=? AND venue_id=? AND state='waiting' AND lane='standard'",input.queueId,userId,v.id));
        requireThat(q,409,'Join the standard queue before requesting paid priority.');
        requireThat(!(await this.s.get("SELECT id FROM orders WHERE user_id=? AND venue_id=? AND kind='priority' AND state='held'",userId,v.id)),409,'You already have a priority checkout in progress.');
        const ahead=(await this.s.get("SELECT count(*) n FROM queue_entries WHERE venue_id=? AND lane='priority' AND state IN('held','waiting','called')",v.id)).n;
        requireThat(ahead<4,409,'The priority lane is full.'); amount=priorityPrice(v.priority_base_cents,ahead);
        details={...details,queueId:q.id,ahead,notice:'Priority within the venue queue, subject to capacity. No fixed wait time or override of confirmed reservations.'};
      }
      requireThat(amount>0,400,'Use the guest-pass flow for free membership.');
      (await this.s.run('INSERT INTO orders(id,user_id,venue_id,kind,state,amount_cents,details,idempotency_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)',oid,userId,v.id,input.kind,'held',amount,JSON.stringify(details),key,now,now+HOLD_MS));
      if(allocation) (await this.s.run('INSERT INTO locker_allocations VALUES(?,?,NULL,?,?,?,?,?)',id(),oid,allocation.lockerId,allocation.position,'held',allocation.start,allocation.end));
      for(const e of reservations) (await this.s.run('INSERT INTO reservations(id,order_id,event_id,resource_id,party_size,state,starts_at,ends_at,checkin_deadline) VALUES(?,?,?,?,?,?,?,?,?)',id(),oid,e.id,e.resourceId,e.partySize,'held',e.starts_at,e.ends_at,e.starts_at+v.grace_minutes*60_000));
      if(input.kind==='priority') {
        const old=(await this.s.get('SELECT * FROM queue_entries WHERE id=?',details.queueId));
        (await this.s.run("UPDATE queue_entries SET lane='priority',state='held',order_id=? WHERE id=?",oid,old.id));
      }
      (await this.audit(v.id,userId,'checkout.held',oid,{amountCents:amount,kind:input.kind}));return this.orderView((await this.s.get('SELECT * FROM orders WHERE id=?',oid)));
    }));
  }
  orderView(o) { return {...o,details:JSON.parse(o.details),idempotency_key:undefined}; }
  async order(userId,oid) {const o=(await this.s.get('SELECT * FROM orders WHERE id=? AND user_id=?',oid,userId));requireThat(o,404,'Order not found.');return this.orderView(o);}
  async settle({eventId,orderId,amount,currency,paymentIntent,sessionId}) {
    return (await this.s.transaction(async ()=>{
      if((await this.s.get('SELECT id FROM payment_events WHERE id=?',eventId))) return {duplicate:true};
      const o=(await this.s.get('SELECT * FROM orders WHERE id=?',orderId));requireThat(o,404,'Order not found.');
      requireThat(o.amount_cents===amount && o.currency===currency && (!o.stripe_session||o.stripe_session===sessionId) && typeof paymentIntent==='string' && paymentIntent.length>0 && (!o.payment_intent||o.payment_intent===paymentIntent),409,'Payment does not match the held order.');
      if(['paid','refund_pending','refunded'].includes(o.state)) {(await this.s.run('INSERT INTO payment_events VALUES(?,?)',eventId,this.now()));return {duplicate:true};}
      if(o.state!=='held'||o.expires_at<=this.now()) {
        (await this.release(o.id,'refund_pending'));(await this.s.run('UPDATE orders SET payment_intent=? WHERE id=?',paymentIntent,o.id));(await this.enqueue('refund',o.id));(await this.s.run('INSERT INTO payment_events VALUES(?,?)',eventId,this.now()));return {refundPending:true};
      }
      (await this.s.run("UPDATE orders SET state='paid',payment_intent=? WHERE id=?",paymentIntent,o.id));
      const details=JSON.parse(o.details);
      if(o.kind==='membership') {
        const old=(await this.s.get('SELECT * FROM memberships WHERE user_id=? AND venue_id=?',o.user_id,o.venue_id));const mid=old?.id??id();
        if(old) (await this.s.run("UPDATE memberships SET plan_id=?,status='active',starts_at=?,ends_at=?,order_id=? WHERE id=?",details.planId,old.plan_id===details.planId&&old.status==='active'&&old.ends_at>=details.start?old.starts_at:details.start,details.end,o.id,mid));
        else (await this.s.run("INSERT INTO memberships(id,user_id,venue_id,plan_id,status,starts_at,ends_at,order_id,pass_token,pass_auth) VALUES(?,?,?,?,'active',?,?,?,?,?)",mid,o.user_id,o.venue_id,details.planId,details.start,details.end,o.id,id(),id()+id()));
        (await this.s.run("UPDATE locker_allocations SET state='active',membership_id=? WHERE order_id=?",mid,o.id));
      }
      if(o.kind==='ticket'||o.kind==='season') (await this.s.run("UPDATE reservations SET state='confirmed' WHERE order_id=?",o.id));
      if(o.kind==='priority') (await this.s.run("UPDATE queue_entries SET state='waiting' WHERE order_id=?",o.id));
      for(const m of (await this.s.all('SELECT id FROM memberships WHERE user_id=? AND venue_id=?',o.user_id,o.venue_id))) (await this.touch(m.id));
      (await this.audit(o.venue_id,o.user_id,'payment.confirmed',o.id));(await this.s.run('INSERT INTO payment_events VALUES(?,?)',eventId,this.now()));return {paid:true};
    }));
  }
  async recordRefund({eventId,paymentIntent,orderId,amount,currency,refundedAmount}) {
    requireThat(typeof paymentIntent==='string'&&paymentIntent.length>0,409,'Refund does not match the order.');
    return this.s.transaction(async()=>{
      if(await this.s.get('SELECT id FROM payment_events WHERE id=?',eventId))return {duplicate:true};
      const o=await this.s.get('SELECT * FROM orders WHERE payment_intent=?',paymentIntent)??await this.s.get('SELECT * FROM orders WHERE id=?',orderId??null);
      if(!o)return {received:true};
      requireThat(amount===o.amount_cents&&currency===o.currency&&(!o.payment_intent||o.payment_intent===paymentIntent)&&(!orderId||orderId===o.id)&&Number.isSafeInteger(refundedAmount)&&refundedAmount>0&&refundedAmount<=amount,409,'Refund does not match the order.');
      await this.s.run('INSERT INTO payment_events VALUES(?,?)',eventId,this.now());
      if(o.state==='refunded')return {duplicate:true};
      const prior=await this.s.get('SELECT * FROM refund_reviews WHERE order_id=?',o.id);
      if(prior&&prior.refunded_cents>=refundedAmount)return {duplicate:true};
      await this.s.run('UPDATE orders SET payment_intent=? WHERE id=?',paymentIntent,o.id);
      if(refundedAmount<amount) {
        // Stripe reports a cumulative amount: a replay or older snapshot must not add it twice.
        await this.s.run("INSERT INTO refund_reviews(order_id,refunded_cents,status,created_at,updated_at) VALUES(?,?,'open',?,?) ON CONFLICT(order_id) DO UPDATE SET refunded_cents=excluded.refunded_cents,status='open',note='',reviewed_by=NULL,reviewed_at=NULL,updated_at=excluded.updated_at",o.id,refundedAmount,this.now(),this.now());
        await this.audit(o.venue_id,null,'payment.partial_refund',o.id,{refundedCents:refundedAmount});return {reconcile:true};
      }
      await this.release(o.id,'refunded');
      await this.s.run("UPDATE refund_reviews SET refunded_cents=?,status='closed',updated_at=? WHERE order_id=?",amount,this.now(),o.id);
      await this.s.run("UPDATE reservations SET state='cancelled' WHERE order_id=? AND state!='attended'",o.id);
      await this.s.run("UPDATE queue_entries SET lane='standard',state='waiting',order_id=NULL WHERE order_id=? AND state IN('waiting','held')",o.id);
      const member=await this.s.get('SELECT id FROM memberships WHERE order_id=?',o.id);
      if(member) {await this.s.run("UPDATE memberships SET status='cancelled' WHERE id=?",member.id);await this.s.run("UPDATE locker_allocations SET state='released' WHERE membership_id=?",member.id);}
      for(const m of await this.s.all('SELECT id FROM memberships WHERE user_id=? AND venue_id=?',o.user_id,o.venue_id))await this.touch(m.id);
      await this.audit(o.venue_id,null,'payment.refunded',o.id);return {received:true};
    });
  }
  async completeRefund(orderId) {
    return this.s.transaction(async()=>{
      const o=await this.s.get('SELECT * FROM orders WHERE id=?',orderId);if(!o||o.state!=='refund_pending')return;
      await this.s.run("UPDATE orders SET state='refunded' WHERE id=?",orderId);
      await this.s.run("UPDATE refund_reviews SET refunded_cents=?,status='closed',updated_at=? WHERE order_id=?",o.amount_cents,this.now(),orderId);
    });
  }
  async reviewRefund(actorId,orderId,input) {
    return this.s.transaction(async()=>{
      const r=await this.s.get('SELECT r.*,o.venue_id FROM refund_reviews r JOIN orders o ON o.id=r.order_id WHERE r.order_id=?',orderId);requireThat(r,404,'Refund review not found.');await this.staff(actorId,r.venue_id,true);
      const note=text(input.note,'review note',1000);requireThat(input.refundedCents===r.refunded_cents,409,'The refunded amount changed. Refresh the review before saving.');
      if(r.status==='reviewed'&&r.note===note)return {duplicate:true};
      requireThat(r.status==='open',409,'This refund review has already been completed.');
      await this.s.run("UPDATE refund_reviews SET status='reviewed',note=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE order_id=?",note,actorId,this.now(),this.now(),orderId);
      await this.audit(r.venue_id,actorId,'payment.refund_reviewed',orderId,{refundedCents:r.refunded_cents,note});return {reviewed:true};
    });
  }
  async cancelOrder(userId,oid) {
    (await this.cleanup());return (await this.s.transaction(async ()=>{
      const o=(await this.order(userId,oid));
      if(o.state==='held') {
        if(o.kind==='priority') (await this.s.run("UPDATE queue_entries SET lane='standard',state='waiting',order_id=NULL WHERE order_id=?",oid));
        (await this.release(oid,'cancelled'));(await this.audit(o.venue_id,userId,'checkout.cancelled',oid));return {cancelled:true};
      }
      requireThat(o.state==='paid'&&['ticket','season','priority'].includes(o.kind),409,'Contact the venue to change this purchase.');
      if(o.kind==='priority') requireThat((await this.s.get("SELECT id FROM queue_entries WHERE order_id=? AND state='waiting'",oid)),409,'Priority service has already started. Contact the venue.');
      else requireThat(!(await this.s.get("SELECT id FROM reservations WHERE order_id=? AND (starts_at<=? OR state='attended')",oid,this.now())),409,'A game has started or this pass has been used. Contact the venue.');
      (await this.s.run("UPDATE orders SET state='refund_pending' WHERE id=?",oid));(await this.s.run("UPDATE reservations SET state='cancelled' WHERE order_id=?",oid));
      (await this.s.run("UPDATE queue_entries SET lane='standard',state='waiting',order_id=NULL WHERE order_id=?",oid));(await this.enqueue('refund',oid));(await this.audit(o.venue_id,userId,'refund.requested',oid));
      for(const m of (await this.s.all('SELECT id FROM memberships WHERE user_id=? AND venue_id=?',userId,o.venue_id)))(await this.touch(m.id));
      return {refundPending:true};
    }));
  }
  async joinQueue(userId,venueKey,partySize) {
    (await this.user(userId));const v=(await this.venue(venueKey));integer(partySize,1,12,'party size');
    return (await this.s.transaction(async ()=>{
      const old=(await this.s.get("SELECT id FROM queue_entries WHERE user_id=? AND venue_id=? AND state IN('held','waiting','called')",userId,v.id));if(old) return {queueId:old.id};
      const qid=id();(await this.s.run("INSERT INTO queue_entries(id,user_id,venue_id,lane,state,party_size,created_at) VALUES(?,?,?,'standard','waiting',?,?)",qid,userId,v.id,partySize,this.now()));(await this.audit(v.id,userId,'queue.joined',qid));return {queueId:qid};
    }));
  }
  async leaveQueue(userId,qid) {
    const q=(await this.s.get('SELECT * FROM queue_entries WHERE id=? AND user_id=?',qid,userId));requireThat(q,404,'Queue entry not found.');
    requireThat(!q.order_id,409,'Cancel your priority order to leave and request a refund.');
    (await this.s.run("UPDATE queue_entries SET state='left' WHERE id=?",qid));return {left:true};
  }
  async membershipSnapshot(mid) {
    const m=(await this.s.get('SELECT m.*,p.name plan_name,p.price_cents,p.benefits,u.name member_name,v.name venue_name,v.slug venue_slug,v.timezone FROM memberships m JOIN plans p ON p.id=m.plan_id JOIN users u ON u.id=m.user_id JOIN venues v ON v.id=m.venue_id WHERE m.id=?',mid));
    requireThat(m,404,'Membership not found.');
    const {pass_auth,...safe}=m;
    return {...safe,benefits:JSON.parse(m.benefits),active:m.status==='active'&&m.ends_at>this.now(),bottles:(await this.s.all('SELECT b.*,(SELECT max(at) FROM bottle_log WHERE bottle_id=b.id) last_recorded_at FROM bottles b WHERE membership_id=? ORDER BY name',mid)),locker:(await this.s.get("SELECT l.label,a.position,l.mode FROM locker_allocations a JOIN lockers l ON l.id=a.locker_id WHERE a.membership_id=? AND a.state='active' AND a.starts_at<=? AND a.ends_at>? ORDER BY a.ends_at DESC LIMIT 1",mid,this.now(),this.now()))??null};
  }
  async account(userId) {
    (await this.cleanup());const u=(await this.user(userId));
    const members=(await Promise.all((await this.s.all('SELECT id FROM memberships WHERE user_id=?',userId)).map(async m=>(await this.membershipSnapshot(m.id)))));
    return {user:{id:u.id,name:u.name,phone:u.phone,marketingOptIn:!!u.marketing_opt_in},memberships:members,
      orders:(await this.s.all("SELECT o.*,CASE WHEN o.state='refunded' THEN o.amount_cents ELSE coalesce(r.refunded_cents,0) END refunded_cents FROM orders o LEFT JOIN refund_reviews r ON r.order_id=o.id WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 100",userId)).map(o=>this.orderView(o)),
      reservations:(await this.s.all('SELECT r.*,e.title,e.team,e.starts_at,e.ends_at,v.name venue_name,v.timezone,s.label resource_label FROM reservations r JOIN orders o ON o.id=r.order_id JOIN events e ON e.id=r.event_id JOIN venues v ON v.id=o.venue_id JOIN resources s ON s.id=r.resource_id WHERE o.user_id=? ORDER BY e.starts_at',userId)),
      queue:(await this.s.all("SELECT q.*,v.name venue_name FROM queue_entries q JOIN venues v ON v.id=q.venue_id WHERE q.user_id=? AND q.state IN('held','waiting','called')",userId)),
      staffVenues:(await this.s.all('SELECT v.id,v.slug,v.name,s.role FROM staff s JOIN venues v ON v.id=s.venue_id WHERE s.user_id=?',userId))};
  }
  async memberForStaff(actorId,venueKey,token) {
    const v=(await this.venue(venueKey));(await this.staff(actorId,v.id));
    const m=(await this.s.get('SELECT id FROM memberships WHERE pass_token=? AND venue_id=?',token,v.id));
    requireThat(m,404,'Member not found at this venue.');return (await this.membershipSnapshot(m.id));
  }
  async staffDashboard(actorId,venueKey) {
    (await this.cleanup());const v=(await this.venue(venueKey));const role=(await this.staff(actorId,v.id));
    const reservations=(await this.s.all("SELECT r.*,u.name,u.phone,e.title,v.timezone,s.label resource_label,o.user_id FROM reservations r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=o.user_id JOIN events e ON e.id=r.event_id JOIN resources s ON s.id=r.resource_id JOIN venues v ON v.id=o.venue_id WHERE o.venue_id=? AND r.state IN('confirmed','attended','no_show') AND r.ends_at>? ORDER BY r.starts_at",v.id,this.now()));
    const members=(await Promise.all((await this.s.all('SELECT id FROM memberships WHERE venue_id=? ORDER BY ends_at DESC',v.id)).map(async m=>(await this.membershipSnapshot(m.id)))));
    const queue=(await this.s.all("SELECT q.*,u.name,u.phone FROM queue_entries q JOIN users u ON u.id=q.user_id LEFT JOIN orders o ON o.id=q.order_id WHERE q.venue_id=? AND q.state IN('waiting','called','held') ORDER BY CASE q.lane WHEN 'priority' THEN 0 ELSE 1 END,CASE q.lane WHEN 'priority' THEN coalesce(o.created_at,q.created_at) ELSE q.created_at END",v.id));
    const report=role.role==='manager'?{paidCents:(await this.s.get("SELECT CAST(coalesce(sum(o.amount_cents-coalesce(r.refunded_cents,0)),0) AS BIGINT) n FROM orders o LEFT JOIN refund_reviews r ON r.order_id=o.id WHERE o.venue_id=? AND o.state='paid'",v.id)).n,activeMembers:members.filter(m=>m.active).length,confirmed:reservations.filter(r=>r.state==='confirmed').length,attended:reservations.filter(r=>r.state==='attended').length,bottleActions:(await this.s.get('SELECT count(*) n FROM bottle_log bl JOIN bottles b ON b.id=bl.bottle_id JOIN memberships m ON m.id=b.membership_id WHERE m.venue_id=?',v.id)).n,pendingJobs:(await this.s.get("SELECT count(*) n FROM outbox WHERE status!='done' AND (subject_id IN(SELECT id FROM memberships WHERE venue_id=?) OR subject_id IN(SELECT id FROM orders WHERE venue_id=?))",v.id,v.id)).n}:null;
    return {venue:v,role:role.role,members,reservations,queue,report,refundReviews:role.role==='manager'?await this.s.all("SELECT r.*,o.amount_cents,o.kind,o.state order_state,u.name customer_name FROM refund_reviews r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=o.user_id WHERE o.venue_id=? ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,r.updated_at DESC LIMIT 100",v.id):[],campaigns:role.role==='manager'?(await this.s.all('SELECT * FROM campaigns WHERE venue_id=? ORDER BY created_at DESC',v.id)):[]};
  }
  async checkIn(actorId,rid,action) {
    return (await this.s.transaction(async ()=>{
      const r=(await this.s.get('SELECT r.*,o.venue_id,o.user_id FROM reservations r JOIN orders o ON o.id=r.order_id WHERE r.id=?',rid));requireThat(r,404,'Reservation not found.');(await this.staff(actorId,r.venue_id));
      requireThat(['attended','no_show'].includes(action),400,'Invalid check-in action.');requireThat(r.state==='confirmed',409,'This reservation has already been processed.');
      requireThat(action!=='no_show'||this.now()>r.checkin_deadline,409,'The check-in grace period has not ended.');requireThat(action!=='attended'||this.now()>=r.starts_at-60*60_000,409,'Check-in opens one hour before the game.');
      (await this.s.run('UPDATE reservations SET state=?,checked_in_at=? WHERE id=?',action,action==='attended'?this.now():null,rid));(await this.audit(r.venue_id,actorId,`reservation.${action}`,rid));
      if(action==='no_show')for(const m of await this.s.all('SELECT id FROM memberships WHERE user_id=? AND venue_id=?',r.user_id,r.venue_id))await this.touch(m.id);
      return {state:action};
    }));
  }
  async queueAction(actorId,qid,action) {
    return (await this.s.transaction(async ()=>{
      const q=(await this.s.get('SELECT * FROM queue_entries WHERE id=?',qid));requireThat(q,404,'Queue entry not found.');(await this.staff(actorId,q.venue_id));
      requireThat((q.state==='waiting'&&action==='called')||(q.state==='called'&&action==='seated'),409,'Queue state has changed.');
      (await this.s.run('UPDATE queue_entries SET state=?,called_at=? WHERE id=?',action,action==='called'?this.now():q.called_at,qid));(await this.audit(q.venue_id,actorId,`queue.${action}`,qid));return {state:action};
    }));
  }
  async addBottle(actorId,mid,input,key) {
    const m=(await this.s.get('SELECT * FROM memberships WHERE id=?',mid));requireThat(m,404,'Membership not found.');(await this.staff(actorId,m.venue_id));
    const name=text(input.name,'bottle name',80);const capacity=integer(input.capacityMl,50,6000,'bottle size');text(key,'retry key',100);
    return (await this.s.transaction(async ()=>{
      const prior=(await this.s.get('SELECT b.* FROM bottle_log bl JOIN bottles b ON b.id=bl.bottle_id WHERE bl.idempotency_key=?',`${m.venue_id}:${key}`));if(prior) {requireThat(prior.membership_id===mid,409,'Retry key belongs to another member.');return prior;}
      requireThat(m.status==='active'&&m.ends_at>this.now(),409,'Membership is not active.');
      requireThat((await this.s.get("SELECT id FROM locker_allocations WHERE membership_id=? AND state='active' AND starts_at<=? AND ends_at>?",mid,this.now(),this.now())),409,'An active locker is required for bottle storage.');
      const bid=id();(await this.s.run('INSERT INTO bottles VALUES(?,?,?,?,?)',bid,mid,name,capacity,capacity));
      (await this.s.run('INSERT INTO bottle_log VALUES(?,?,?,?,?,?,?)',id(),bid,actorId,capacity,'Bottle received by venue staff',this.now(),`${m.venue_id}:${key}`));(await this.touch(mid));(await this.audit(m.venue_id,actorId,'bottle.received',bid));return (await this.s.get('SELECT * FROM bottles WHERE id=?',bid));
    }));
  }
  async adjustBottle(actorId,bid,input,key) {
    const b=(await this.s.get('SELECT b.*,m.venue_id,m.status,m.ends_at FROM bottles b JOIN memberships m ON m.id=b.membership_id WHERE b.id=?',bid));requireThat(b,404,'Bottle not found.');(await this.staff(actorId,b.venue_id));
    const amount=integer(input.deltaMl,-6000,6000,'stock adjustment');requireThat(amount!==0,400,'Stock adjustment must be nonzero.');text(key,'retry key',100);
    const reason=text(input.reason,'service or correction reason',200);
    return (await this.s.transaction(async ()=>{
      const prior=(await this.s.get('SELECT * FROM bottle_log WHERE idempotency_key=?',`${b.venue_id}:${key}`));if(prior) {requireThat(prior.bottle_id===bid&&prior.delta_ml===amount,409,'Retry key belongs to another action.');return {duplicate:true};}
      const current=(await this.s.get('SELECT remaining_ml FROM bottles WHERE id=?',bid)).remaining_ml;
      if(amount<0) {
        requireThat(b.status==='active'&&b.ends_at>this.now(),409,'Membership is not active. Contact a manager.');
        requireThat(await this.s.get("SELECT id FROM locker_allocations WHERE membership_id=? AND state='active' AND starts_at<=? AND ends_at>?",b.membership_id,this.now(),this.now()),409,'An active locker is required for bottle service.');
      }
      requireThat(current+amount>=0&&current+amount<=b.capacity_ml,409,'This change would exceed the recorded bottle balance.');
      if(amount>0) (await this.staff(actorId,b.venue_id,true));
      (await this.s.run('UPDATE bottles SET remaining_ml=remaining_ml+? WHERE id=?',amount,bid));
      (await this.s.run('INSERT INTO bottle_log VALUES(?,?,?,?,?,?,?)',id(),bid,actorId,amount,reason,this.now(),`${b.venue_id}:${key}`));(await this.touch(b.membership_id));(await this.audit(b.venue_id,actorId,'bottle.adjusted',bid,{deltaMl:amount,reason}));return {remainingMl:current+amount};
    }));
  }
  async answer(venueKey,question) {
    const v=(await this.venue(venueKey));const q=text(question,'question',300).toLowerCase();
    if(/grace|late|check.?in/.test(q)) return {answer:`Check in by kickoff + ${v.grace_minutes} minutes. Staff handle late arrivals and release decisions.`,source:'Venue check-in policy'};
    if(/bottle|drink|locker/.test(q)) return {answer:'Your pass shows the last stock recorded by venue staff. Locker membership does not include a seat. Ask staff to correct a stock discrepancy.',source:'Membership and bottle workflow'};
    if(/refund|cancel/.test(q)) return {answer:v.terms,source:'Approved venue terms'};
    if(/seat|table|book|game/.test(q)) return {answer:'Choose a published game and available table or bar seat. Payment confirmation secures only the displayed time window. Season passes include exactly the games listed at checkout.',source:'Booking policy'};
    return {answer:`For availability, service exceptions or anything outside these policies, speak with ${v.name} staff.`,source:'Staff escalation'};
  }
}
