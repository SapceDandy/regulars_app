import {requireThat,text} from './rules.js';

// Privileged operator commands only. Never expose these through customer/staff HTTP routes.
// The caller must already hold direct database access in a trusted runtime.
export async function operatorAction(app,action,input={}) {
  const s=app.s;
  if(action==='report')return {
    unmatchedPayments:await s.all('SELECT c.id,c.kind,c.reference,c.provider_status,c.due_at,c.created_at FROM payment_cases c LEFT JOIN orders o ON o.id=c.order_id OR (c.order_id IS NULL AND o.payment_intent=c.payment_intent) WHERE o.id IS NULL AND c.reviewed_at IS NULL ORDER BY c.created_at'),
    failedJobs:await s.all("SELECT id,kind,subject_id,attempts FROM outbox WHERE status='failed' ORDER BY created_at"),
    staff:await s.all('SELECT venue_id,user_id,role FROM staff ORDER BY venue_id,user_id')
  };
  requireThat(['staff','review'].includes(action),400,'Use report, staff or review.');
  const reason=text(input.reason,'operator reason',1000);
  return s.transaction(async()=>{
    if(action==='review'){
      const c=await s.get('SELECT * FROM payment_cases WHERE id=?',text(input.caseId,'case ID',200));requireThat(c,404,'Payment report not found.');
      requireThat(c.reviewed_at===null,409,'Report already reviewed.');
      await s.run('UPDATE payment_cases SET note=?,reviewed_at=? WHERE id=?',reason,app.now(),c.id);
      await app.audit(null,null,'operator.payment_reviewed',c.id,{reason});return {reviewed:true};
    }
    const v=await app.venue(text(input.venueId,'venue ID',100)),userId=text(input.userId,'user ID',100);
    requireThat(await s.get('SELECT id FROM users WHERE id=?',userId),404,'User must first sign in to Regulars.');
    requireThat(['staff','manager','none'].includes(input.role),400,'Role must be staff, manager or none.');
    const prior=await s.get('SELECT role FROM staff WHERE venue_id=? AND user_id=?',v.id,userId);
    if(prior?.role==='manager'&&input.role!=='manager')requireThat((await s.get("SELECT count(*) n FROM staff WHERE venue_id=? AND role='manager'",v.id)).n>1,409,'Provision a replacement manager before removing the last one.');
    await s.run('DELETE FROM staff WHERE venue_id=? AND user_id=?',v.id,userId);
    if(input.role!=='none')await s.run('INSERT INTO staff VALUES(?,?,?)',userId,v.id,input.role);
    await s.run('DELETE FROM sessions WHERE user_id=?',userId);
    await app.audit(v.id,null,'operator.staff_changed',userId,{previous:prior?.role??'none',role:input.role,reason});return {updated:true};
  });
}
