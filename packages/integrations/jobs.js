export class Jobs {
  constructor(store,regulars,{wallets,payments}) {this.s=store;this.app=regulars;this.wallets=wallets;this.payments=payments;this.busy=false;}
  async tick() {
    if(this.busy)return;this.busy=true;
    try {
      this.app.cleanup();
      for(const job of this.s.all("SELECT * FROM outbox WHERE status='pending' AND next_at<=? ORDER BY created_at LIMIT 10",this.app.now())) {
        try {
          if(job.kind==='wallet')await this.wallets.update(job.subject_id);
          else if(job.kind==='refund')await this.payments.refund(job.subject_id);
          else throw new Error('Unknown job kind');
          this.s.run("UPDATE outbox SET status='done',last_error=NULL WHERE id=?",job.id);
        } catch(error) {
          const attempts=job.attempts+1;
          // Generic failure text is safe for staff visibility; provider bodies are never stored.
          this.s.run('UPDATE outbox SET attempts=?,next_at=?,status=?,last_error=? WHERE id=?',attempts,this.app.now()+Math.min(3_600_000,30_000*2**attempts),attempts>=8?'failed':'pending',`Delivery failed (${error.status??500}).`,job.id);
        }
      }
    } finally {this.busy=false;}
  }
}
