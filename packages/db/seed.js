import { readFileSync } from 'node:fs';
import { id, phone, requireThat, text, integer } from '../core/rules.js';

export function demoConfig(now = Date.now()) {
  return { venues: [
    { id: 'v_copper', slug: 'copper-room', name: 'The Copper Room', city: 'Round Rock, TX',
      description: 'A neighborhood home for game day, familiar faces, and a seat with your name on it.',
      address: 'Illustrative location · not an operating partner', timezone: 'America/Chicago',
      terms: 'Demo terms: check in by kickoff + 15 minutes. Your booking covers the listed game window only. Cancel before kickoff for a refund. Drinks, gratuity and entry charges are separate. Memberships last 30 days and do not auto-renew.',
      graceMinutes: 15, priorityEnabled: true, priorityBaseCents: 2500, demo: true,
      staff: [{ phone: '+12025550100', name: 'Demo Manager', role: 'manager' }],
      games: Array.from({length:4}, (_,i) => ({id:`copper_game_${i+1}`,title:`Dallas vs. Visiting Team ${i+1}`,team:'Dallas',season:'Demo season',startsAt:now+(i*7+3)*86_400_000,endsAt:now+(i*7+3)*86_400_000+4*3_600_000,basePriceCents:4500})) },
    { id: 'v_social', slug: 'northside-social', name: 'Northside Social', city: 'Austin, TX',
      description: 'Big screens, good company, and an easy place to make a new tradition.',
      address: 'Illustrative location · not an operating partner', timezone:'America/Chicago',
      terms:'Demo terms: reservations cover the listed game window. Check in within 15 minutes of kickoff. Cancel before kickoff for a refund. Drinks are separate. Memberships last 30 days and do not auto-renew.',
      graceMinutes:15,priorityEnabled:false,priorityBaseCents:2500,demo:true,staff:[],
      games:Array.from({length:3},(_,i)=>({id:`social_game_${i+1}`,title:`Austin College vs. Visiting Team ${i+1}`,team:'Austin College',season:'Demo season',startsAt:now+(i*7+2)*86_400_000,endsAt:now+(i*7+2)*86_400_000+4*3_600_000,basePriceCents:3500})) }
  ] };
}

export function seed(store, {mode = 'demo', configPath = '', now = Date.now()} = {}) {
  const config = mode === 'demo' ? demoConfig(now) : JSON.parse(readFileSync(configPath,'utf8'));
  requireThat(Array.isArray(config.venues) && config.venues.length > 0,500,'Venue configuration is empty.');
  // This deliberately does not overwrite an operating venue on restart.
  store.transaction(() => {
    for (const v of config.venues) {
      requireThat(mode === 'demo' || (v.approved === true && v.demo !== true),500,'Live venues must be explicitly approved and use real reviewed inventory.');
      for (const key of ['id','slug','name','city','description','address','timezone','terms']) text(v[key],key,3000);
      requireThat(/^[a-z0-9-]+$/.test(v.slug),500,'Venue slug must be URL safe.');
      new Intl.DateTimeFormat('en',{timeZone:v.timezone});
      integer(v.graceMinutes,0,60,'grace period');
      if(store.get('SELECT id FROM venues WHERE id=?',v.id)) continue;
      store.run('INSERT INTO venues VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',v.id,v.slug,v.name,v.city,v.description,v.address,v.timezone,v.terms,v.graceMinutes,v.priorityEnabled?1:0,v.priorityBaseCents??2500,v.demo?1:0);
      const lockers = v.lockers ?? (mode === 'demo' ? Array.from({length:12},(_,i)=>({label:`L${String(i+1).padStart(2,'0')}`,mode:i<8?'shared':'private',positions:i<8?2:1})) : []);
      for(const l of lockers) {
        text(l.label,'locker label'); integer(l.positions,1,8,'locker positions');
        requireThat(['shared','private'].includes(l.mode) && (l.mode==='shared'||l.positions===1),500,'Invalid locker configuration.');
        store.run('INSERT INTO lockers VALUES(?,?,?,?,?)',id(),v.id,l.label,l.mode,l.positions);
      }
      const plans = v.plans ?? (mode === 'demo' ? [
        {key:'guest',name:'Guest pass',mode:null,priceCents:0,durationDays:365,benefits:['Your venue pass','Book games and tables','No locker included']},
        {key:'shared',name:'Shared locker',mode:'shared',priceCents:6900,durationDays:30,benefits:['A named shared locker position','Bottle inventory on your pass','Member recognition; seating purchased separately']},
        {key:'private',name:'Private locker',mode:'private',priceCents:9900,durationDays:30,benefits:['A whole locker for your group','Bottle inventory on your pass','Member recognition; seating purchased separately']}
      ] : []);
      requireThat(plans.length>0,500,'Configure membership plans.');
      for(const p of plans) { integer(p.priceCents,0,1_000_000,'plan price'); integer(p.durationDays,1,730,'plan duration'); store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?)',`${v.id}_${p.key}`,v.id,text(p.name,'plan name'),p.mode??null,p.priceCents,p.durationDays,JSON.stringify(p.benefits??[])); }
      const resources = v.resources ?? (mode === 'demo' ? [
        ...Array.from({length:6},(_,i)=>({label:`Table ${i+1}`,kind:'table',capacity:4})),
        ...Array.from({length:6},(_,i)=>({label:`Bar seat ${i+1}`,kind:'stool',capacity:1}))
      ] : []);
      for(const r of resources) store.run('INSERT INTO resources VALUES(?,?,?,?,?)',id(),v.id,r.label,r.kind,integer(r.capacity,1,50,'seat capacity'));
      for(const g of v.games??[]) store.run('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,1)',g.id,v.id,g.title,g.team,g.season,integer(g.startsAt,now,now+730*86_400_000,'game start'),integer(g.endsAt,g.startsAt+1,now+731*86_400_000,'game end'),integer(g.basePriceCents,0,1_000_000,'game price'));
      for(const s of v.staff??[]) {
        const normalized=phone(s.phone); let u=store.get('SELECT id FROM users WHERE phone=?',normalized);
        if(!u) {u={id:id()};store.run('INSERT INTO users(id,phone,name,created_at) VALUES(?,?,?,?)',u.id,normalized,text(s.name,'staff name'),now);}
        store.run('INSERT INTO staff VALUES(?,?,?)',u.id,v.id,s.role==='manager'?'manager':'staff');
      }
      for(const [index,g] of (v.games??[]).slice(0,2).entries()) store.run('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)',id(),v.id,`Game day ${index+1}`,`Join us for ${g.title}. Reserve your place through our venue page.`, 'draft',g.id,now);
    }
  });
}
