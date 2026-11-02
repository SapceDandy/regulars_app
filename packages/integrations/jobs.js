import { id } from '../core/rules.js';

export class Jobs {
  constructor(store,regulars,{wallets,payments}) {this.s=store;this.app=regulars;this.wallets=wallets;this.payments=payments;this.busy=false;}
  async tick() {
    if(this.busy)return;this.busy=true;
    try {
      await this.app.cleanup();
      for(let i=0;i<10;i++) {
        const token=id();
        const job=await this.s.transaction(async()=>{
          const now=this.app.now();
          // Serialize deliveries for one subject, not just one job ID: two queued
          // Wallet snapshots must not race and let an older balance finish last.
          const next=await this.s.get("SELECT o.* FROM outbox o WHERE o.status='pending' AND o.next_at<=? AND NOT EXISTS (SELECT 1 FROM outbox active JOIN job_leases lease ON lease.job_id=active.id WHERE active.kind=o.kind AND active.subject_id=o.subject_id AND lease.expires_at>?) ORDER BY o.created_at LIMIT 1",now,now);
          if(!next)return null;
          await this.s.run('INSERT INTO job_leases(job_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(job_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at',next.id,token,now+300_000);
          return next;
        });
        if(!job)break;
        let error;
        try {
          if(job.kind==='wallet')await this.wallets.update(job.subject_id);
          else if(job.kind==='refund')await this.payments.refund(job.subject_id);
          else throw new Error('Unknown job kind');
        } catch(cause) {error=cause;}
        await this.s.transaction(async()=>{
          const lease=await this.s.get('SELECT token FROM job_leases WHERE job_id=?',job.id);
          if(lease?.token!==token)return;
          if(!error)await this.s.run("UPDATE outbox SET status='done',last_error=NULL WHERE id=?",job.id);
          else {
            const attempts=job.attempts+1;
            await this.s.run('UPDATE outbox SET attempts=?,next_at=?,status=?,last_error=? WHERE id=?',attempts,this.app.now()+Math.min(3_600_000,30_000*2**attempts),attempts>=8?'failed':'pending',`Delivery failed (${error.status??500}).`,job.id);
          }
          await this.s.run('DELETE FROM job_leases WHERE job_id=? AND token=?',job.id,token);
        });
      }
    } finally {this.busy=false;}
  }
}
