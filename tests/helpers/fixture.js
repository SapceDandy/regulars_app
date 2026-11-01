import { testStore } from './store.js';
import { seed } from '../../packages/db/seed.js';
import { Regulars } from '../../packages/core/regulars.js';
import { id } from '../../packages/core/rules.js';

export async function fixture(path=':memory:') {
  let clock=1_900_000_000_000;const now=()=>clock;const s=await testStore(path);(await seed(s,{now:clock}));const app=new Regulars(s,{now});
  const user=async (p=`+1202555${String(Math.floor(Math.random()*9000)+1000)}`)=>{const uid=id();(await s.run('INSERT INTO users(id,phone,name,created_at) VALUES(?,?,?,?)',uid,p,'Test Member',clock));return uid;};
  const uid=(await user('+12025550101'));const other=(await user('+12025550102'));const manager=(await s.get('SELECT id FROM users WHERE phone=?','+12025550100')).id;
  const games=(await s.all("SELECT * FROM events WHERE venue_id='v_copper' ORDER BY starts_at"));
  const resource=(await s.get("SELECT * FROM resources WHERE venue_id='v_copper' AND kind='table' ORDER BY label LIMIT 1"));
  const ticket=async (u=uid,extra={})=>(await app.createOrder(u,{venueId:'v_copper',kind:'ticket',eventId:games[0].id,resourceId:resource.id,partySize:2,...extra},id()));
  const paid=async o=>(await app.settle({eventId:`evt_${id()}`,orderId:o.id,amount:o.amount_cents,currency:o.currency,paymentIntent:`pi_${o.id}`}));
  const member=async (u=uid,plan='shared')=>{const o=(await app.createOrder(u,{venueId:'v_copper',kind:'membership',planId:`v_copper_${plan}`},id()));(await paid(o));return (await app.account(u)).memberships[0];};
  return {s,app,uid,other,manager,games,resource,user,ticket,paid,member,now,setTime:v=>{clock=v;},advance:ms=>{clock+=ms;}};
}
