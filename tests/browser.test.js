import test from 'node:test';
import assert from 'node:assert/strict';
import {browser} from './helpers/browser.js';
import {fixture} from './helpers/fixture.js';

let data;
test.before(async()=>{
  const f=await fixture();
  try{
    const m=await f.member();await f.app.addBottle(f.manager,m.id,{name:'Test <bottle>',capacityMl:750},'browser-bottle');
    await f.paid(await f.ticket());await f.app.joinQueue(f.uid,'v_copper',2);
    data={venues:await f.app.catalog(),venue:await f.app.venuePage('copper-room'),account:await f.app.account(f.uid),staff:await f.app.staffDashboard(f.manager,'copper-room')};
  }finally{await f.s.close();}
});
function handler(overrides={}){
  return request=>{
    if(overrides[`${request.method} ${request.url}`])return overrides[`${request.method} ${request.url}`](request);
    if(request.url==='/api/venues')return{data:data.venues};
    if(request.url.startsWith('/api/venues/'))return{data:data.venue};
    if(request.url==='/api/account')return{data:data.account};
    if(request.url.endsWith('/jobs'))return{data:[]};
    if(request.url==='/api/staff/copper-room')return{data:data.staff};
    return{data:{}};
  };
}
const html=b=>b.elements['#app'].innerHTML;
const last=b=>b.requests.at(-1);

test('public routes render and directory search filters names, cities and no matches',async()=>{
  for(const [path,phrase] of [['/','Your people.'],['/partners','Start the conversation'],['/privacy','Your privacy.'],['/terms','Clear expectations.'],['/missing','This place isn’t here.']]){
    const b=await browser({path,handle:handler()});assert.match(html(b),new RegExp(phrase));assert.equal(b.elements['#demo-banner'].hidden,false);
  }
  const b=await browser({path:'/venues',handle:handler()});const search=value=>b.elements['#venue-search'].listeners.input({target:{value}});
  search('COPPER');assert.match(b.elements['#venue-count'].textContent,/1 sample venue$/);assert.match(b.elements['#venue-results'].innerHTML,/Copper/);
  search('nonexistent');assert.match(b.elements['#venue-results'].innerHTML,/No places found/);
  search('');assert.match(b.elements['#venue-count'].textContent,/2 sample venues/);
  const live=await browser({path:'/venues',config:{mode:'live'},handle:handler()});live.elements['#venue-search'].listeners.input({target:{value:'COPPER'}});assert.equal(live.elements['#venue-count'].textContent,'1 venue');
});

test('sign-in preserves consent, validates redirect origin and exposes provider failure',async()=>{
  for(const next of ['/account?tab=passes#one','https://outside.invalid/','http://[bad']){
    const b=await browser({path:'/login',search:`?next=${encodeURIComponent(next)}`,config:{mode:'demo',pilot:true},handle:handler({'GET /api/account':()=>({status:401}),'POST /api/auth/start':()=>({data:{demoCode:'123456'}})})});
    assert.match(html(b),/Test guest/);const code=b.form('code-form',{code:'123456'});
    const phone=b.form('phone-form',{phone:'+12025550101',name:'Test <Guest>'});phone.smsConsent={checked:true};phone.marketingOptIn={checked:false};
    await b.submit(phone);assert.equal(code.dataset.phone,'+12025550101');assert.equal(last(b).body.smsConsent,true);assert.match(b.elements['.auth-card'].innerHTML,/123456/);
    await b.submit(code);assert.equal(last(b).body.marketingOptIn,false);assert.equal(b.location.href,next.startsWith('/account')?next:'/account');
  }
  const existing=await browser({path:'/login',handle:handler()});assert.equal(existing.location.href,'/account');
  const unavailable=await browser({path:'/login',handle:handler({'GET /api/account':()=>({status:503,data:{error:'Provider unavailable'}})})});assert.match(html(unavailable),/Provider unavailable/);
  const live=await browser({path:'/login',config:{mode:'live'},handle:handler({'GET /api/account':()=>({status:401}),'POST /api/auth/start':()=>({data:{}})})});live.form('code-form');const f=live.form('phone-form',{phone:'+12025550102'});f.smsConsent={checked:true};f.marketingOptIn={checked:true};await live.submit(f);assert.doesNotMatch(live.elements['.auth-card'].innerHTML,/Demo code/);
  const failed=live.form('profile-form',{name:'Test'});failed.marketingOptIn={checked:false};await live.submit({});assert.equal(failed.button.disabled,false);
});

test('booking modal recalculates season total, caps group size and preserves checkout retry key',async()=>{
  let attempts=0;
  const b=await browser({path:'/v/copper-room',handle:handler({'POST /api/orders':()=>++attempts===1?{status:503,data:{error:'Try later'}}:{data:{url:'/checkout/test'}}})});
  assert.match(html(b),/Get a guest pass/);const game=data.venue.events[0],resource=data.venue.resources[0];
  const form=b.form('booking-form',{resourceId:resource.id,partySize:'1'},{game:game.id});form.resourceId={selectedOptions:[{dataset:{capacity:'2'}}]};form.partySize={value:'8'};form.season={checked:true};
  await b.click('book',game.id);assert.equal(b.elements['#modal'].open,true);form.listeners.change();assert.equal(form.partySize.value,'2');assert.equal(b.elements['#season-games'].hidden,false);assert.match(b.elements['#season-games'].innerHTML,/vs/);
  await b.submit(form);const key=last(b).headers['idempotency-key'];assert.equal(last(b).body.kind,'season');assert.equal(b.elements['#dialog-error'].textContent,'Try later');assert.equal(form.button.disabled,false);
  await b.submit(form);assert.equal(last(b).headers['idempotency-key'],key);assert.equal(b.location.href,'/checkout/test');
  form.season.checked=false;form.partySize.value='1';form.listeners.change();await b.submit(form);assert.equal(last(b).body.kind,'ticket');assert.equal(last(b).body.eventId,game.id);assert.equal(b.elements['#season-games'].hidden,true);
  await b.click('book','missing');assert.match(b.elements['#dialog-error'].textContent,/no longer available/);b.clickOutside();assert.equal(b.elements['#modal'].open,false);
});

test('guest and paid membership forms, standard queue and policy question send scoped requests',async()=>{
  const b=await browser({path:'/v/copper-room',handle:handler({'POST /api/orders':()=>({data:{url:'/checkout/member'}}),'POST /api/venues/copper-room/ask':()=>({data:{answer:'Check in on time.',source:'Venue policy'}})})});
  for(const p of data.venue.plans){await b.click('membership',p.id);assert.match(b.elements['#modal-content'].innerHTML,/I agree/);await b.submit(b.form('membership-form',{}, {plan:p.id}));assert.equal(last(b).body.venueId,'v_copper');assert.equal(b.location.href,p.price_cents?'/checkout/member':'/account');await b.close();}
  await b.click('join-queue');assert.match(b.elements['#modal-content'].innerHTML,/standard queue/);await b.submit(b.form('join-queue-form',{partySize:'3'}));assert.equal(last(b).body.partySize,3);
  await b.submit(b.form('question-form',{question:'When do I arrive?'}));assert.equal(b.elements['#answer'].textContent,'Check in on time. (Venue policy)');
});

test('protected guest actions redirect and unexpected errors stay visible',async()=>{
  for(const action of ['book','membership','join-queue']){
    const b=await browser({path:'/v/copper-room',handle:handler({'GET /api/account':()=>({status:401})})});await b.click(action,'missing');assert.match(b.location.href,/\/login\?next=/);assert.equal(b.elements['#modal'].open,false);
  }
  for(const path of ['/account','/staff/copper-room','/checkout/order']){
    const b=await browser({path,handle:()=>({status:401})});assert.match(b.location.href,/\/login\?next=/);
  }
  for(const path of ['/account','/staff/copper-room']){
    const b=await browser({path,handle:()=>({status:503,data:{error:'Temporarily unavailable'}})});assert.match(html(b),/Temporarily unavailable/);
  }
  const b=await browser({path:'/v/copper-room',handle:handler({'GET /api/account':()=>({status:503})})});await b.click('join-queue');assert.equal(b.elements['#toast'].textContent,'Please try again.');
});

test('account renders saved records, protects drafts and keeps old state on refresh failure',async()=>{
  let reject=false;const b=await browser({path:'/account',handle:handler({'GET /api/account':()=>reject?{status:503}:{data:data.account}})});
  assert.match(html(b),/Test &lt;bottle&gt;/);assert.match(html(b),/disabled> Add to Apple Wallet|disabled>Add to Apple Wallet/);assert.match(html(b),/Your place in line/);
  const form=b.form('profile-form',{name:'Updated'});form.marketingOptIn={checked:true};b.edit(form);assert.equal(form.dataset.dirty,'true');await b.refresh();assert.match(b.elements['#profile-status'].textContent,/Unsaved/);
  await b.submit(form);assert.equal(last(b).body.name,'Updated');assert.equal(form.dataset.dirty,undefined);assert.equal(b.elements['#profile-status'].textContent,'Preferences saved.');
  reject=true;const before=html(b);await b.refresh();assert.equal(html(b),before);reject=false;await b.refresh();
  for(const state of ['hidden','modal','focus']){if(state==='hidden')b.document.hidden=true;if(state==='modal')b.elements['#modal'].open=true;if(state==='focus')b.document.activeElement={tagName:'INPUT'};const count=b.requests.length;await b.refresh();assert.equal(b.requests.length,count);b.document.hidden=false;b.elements['#modal'].open=false;}
  b.timeouts.forEach(fn=>fn());assert.equal(b.elements['#toast'].hidden,true);
});

test('checkout states show pending actions only for open orders',async()=>{
  for(const mode of ['demo','live'])for(const state of ['held','paid','cancelled','expired','refund_pending']){
    const o={...data.account.orders[0],state,expires_at:1900001000000};
    const b=await browser({path:'/checkout/order',config:{mode,wallets:{}},handle:handler({'GET /api/orders/order':()=>({data:o})})});
    assert.match(html(b),/Total/);if(state==='held')assert.match(html(b),mode==='demo'?/Complete test purchase/:/Continue to secure checkout/);else assert.doesNotMatch(html(b),/data-action="(?:demo-pay|resume-pay)"/);
  }
});

test('account actions cover Wallet links, calendar escaping, payments, queue and clipboard',async()=>{
  const b=await browser({path:'/account',handle:handler({'GET /api/wallet/google/member':()=>({data:{url:'https://pay.google.com/test'}}),'POST /api/orders/order/resume':()=>({data:{url:'/checkout/provider'}}),'POST /api/orders/order/cancel':()=>({data:{refundPending:true}}),'POST /api/orders':()=>({data:{url:'/checkout/priority'}})})});
  await b.click('copy-code','test-code');assert.deepEqual(b.clipboard,['test-code']);
  await b.click('apple','member');assert.equal(b.location.href,'/api/wallet/apple/member');await b.click('google','member');assert.equal(b.location.href,'https://pay.google.com/test');
  await b.click('calendar',data.account.reservations[0].id);assert.equal(b.downloads[0].download,'regulars-game.ics');assert.match(await b.blobs[0].text(),/BEGIN:VEVENT\r\nUID:/);b.timeouts.forEach(fn=>fn());
  await b.click('demo-pay','order');assert.equal(b.location.href,'/account');await b.click('resume-pay','order');assert.equal(b.location.href,'/checkout/provider');
  await b.click('cancel-order','order');assert.equal(b.elements['#modal'].open,true);await b.click('confirm-cancel','order');assert.match(b.elements['#toast'].textContent,/refund is queued/);assert.equal(b.elements['#modal'].open,false);
  const q=data.account.queue[0];await b.click('priority',q.id);assert.match(b.elements['#modal-content'].innerHTML,/priority within the walk-in queue/);await b.submit(b.form('priority-form',{}, {queue:q.id}));assert.equal(last(b).body.queueId,q.id);assert.equal(b.location.href,'/checkout/priority');
  await b.click('leave-queue',q.id);assert.match(b.elements['#toast'].textContent,/left the queue/);
  await b.click('logout');assert.equal(b.location.href,'/');await b.click('pilot-session','manager');assert.equal(last(b).body.role,'manager');assert.equal(b.location.href,'/account');
});

test('staff tabs, service forms, approvals and failed-job retry issue scoped writes',async()=>{
  const jobs=[{id:'retry',kind:'wallet',status:'failed',attempts:8,last_error:'Delivery failed'}];
  const b=await browser({path:'/staff/copper-room',handle:handler({'GET /api/staff/copper-room/jobs':()=>({data:jobs})})});assert.match(html(b),/manager access/);
  for(const tab of ['lockers','queue','promotions','sync','arrivals']){await b.click('staff-tab',tab);assert.equal(b.tabs.find(t=>t.dataset.id===tab).attributes['aria-pressed'],'true');assert.ok(b.elements['#staff-panel'].innerHTML.length);}
  const member=data.account.memberships[0];await b.click('add-bottle',member.id);await b.submit(b.form('bottle-form',{name:'Received',capacityMl:'750'},{member:member.id}));assert.ok(b.requests.some(r=>r.url===`/api/staff/members/${member.id}/bottles`&&r.body.capacityMl===750));
  await b.click('adjust-bottle','bottle');await b.submit(b.form('adjust-bottle-form',{deltaMl:'-90',reason:'Double service'},{bottle:'bottle'}));assert.ok(b.requests.some(r=>r.body?.deltaMl===-90));
  for(const [action,id,endpoint,value] of [['pour','bottle','/api/staff/bottles/bottle',undefined],['check-in','reservation','/api/staff/reservations/reservation','attended'],['no-show','reservation','/api/staff/reservations/reservation','no_show'],['call-queue','queue','/api/staff/queue/queue','called'],['seat-queue','queue','/api/staff/queue/queue','seated'],['approve-campaign','campaign','/api/staff/campaigns/campaign/approve',undefined]]){
    await b.click(action,id);assert.ok(b.requests.some(r=>r.url===endpoint&&r.body.action===value));
  }
  await b.click('copy-campaign',data.staff.campaigns[0].id);assert.match(b.clipboard.at(-1),/utm_campaign=/);await b.click('copy-venue');assert.equal(b.clipboard.at(-1),'https://regulars.example/v/copper-room');
  await b.click('staff-tab','sync');await b.click('retry-job','retry');assert.match(b.elements['#toast'].textContent,/queued for retry/);
  await b.refresh();assert.match(html(b),/Venue workspace/);
});

test('partner submission, lookup result and ignored clicks handle user errors without duplicate writes',async()=>{
  const b=await browser({path:'/partners',handle:handler()});const form=b.form('partner-form',{venueName:'Synthetic',name:'Test',email:'test@example.invalid'});await b.submit(form);assert.match(form.innerHTML,/inquiry has been received/);
  const count=b.requests.length;await b.click('logout',null,{disabled:true});await b.rawClick({closest:()=>null});assert.equal(b.requests.length,count);b.edit(null);b.change(form);
  const staff=await browser({path:'/staff/copper-room',handle:handler({'POST /api/staff/copper-room/lookup':()=>({data:{id:'member',active:false,plan_name:'Guest'}})})});await staff.click('staff-tab','lockers');await staff.submit(staff.form('lookup-form',{token:'pass'}));assert.match(staff.elements['#lookup-result'].innerHTML,/Inactive/);assert.match(staff.elements['#lookup-result'].innerHTML,/No locker/);
});

test('empty, inactive and populated accounts expose only the appropriate customer actions',async()=>{
  const source=data.account,m=source.memberships[0],r=source.reservations[0],q=source.queue[0],o=source.orders[0];
  const cases=[
    {user:{name:'',phone:'test',marketingOptIn:false},memberships:[],reservations:[],orders:[],queue:[],staffVenues:[]},
    {...source,user:{...source.user,marketingOptIn:true},memberships:[{...m,active:false,locker:null,bottles:[],price_cents:0,member_name:''},{...m,locker:{label:'Private',mode:'private'},bottles:[...m.bottles,...m.bottles]}],reservations:[{...r,ends_at:Date.now()+86400000,state:'attended',party_size:1},{...r,ends_at:Date.now()+86400000,state:'confirmed',party_size:2},{...r,state:'cancelled'}],orders:[{...o,state:'held',details:{planName:'Held'}},{...o,state:'paid',kind:'ticket',details:{resourceLabel:'Table'}},{...o,state:'refunded',details:{}},{...o,state:'paid',kind:'membership',details:{}}],queue:[{...q,lane:'priority',state:'called',party_size:1},{...q,lane:'standard',state:'held'},{...q,lane:'standard',state:'waiting'}],staffVenues:[{slug:'copper-room',name:'Copper'}]}
  ];
  for(const account of cases){const b=await browser({path:'/account',config:{mode:'live',wallets:{apple:true,google:true}},handle:handler({'GET /api/account':()=>({data:account})})});assert.doesNotMatch(html(b),/A small detour/);if(!account.memberships.length)assert.match(html(b),/Start with a place/);else{assert.match(html(b),/INACTIVE PASS/);assert.match(html(b),/Checked in/);assert.match(html(b),/Open Copper/);}}
});

test('venue availability and checkout summaries cover sold out games and all purchase kinds',async()=>{
  const venue={...data.venue,venue:{...data.venue.venue,demo:false},queue:{enabled:false},events:data.venue.events.map(g=>({...g,available:[]}))};
  const b=await browser({path:'/v/copper-room',config:{mode:'live'},handle:handler({'GET /api/venues/copper-room':()=>({data:venue})})});assert.match(html(b),/Sold out/);assert.match(html(b),/Staff manage the order/);
  const form=b.form('booking-form');await b.click('book',venue.events[0].id);assert.match(b.elements['#modal-content'].innerHTML,/max="1"/);assert.match(b.elements['#modal-content'].innerHTML,/disabled>Continue/);
  const emptyVenue=await browser({path:'/v/copper-room',handle:handler({'GET /api/venues/copper-room':()=>({data:{...venue,events:[]}})})});assert.match(html(emptyVenue),/next game is on its way/);
  for(const details of [{planName:'Shared',benefits:['One locker'],partySize:1,notice:'Pending confirmation'},{resourceLabel:'Table',gameTitles:['Game one','Game two'],partySize:2},{}]){
    const checkout=await browser({path:'/checkout/order',handle:handler({'GET /api/orders/order':()=>({data:{...data.account.orders[0],state:'held',details,expires_at:1900001000000}})})});assert.match(html(checkout),/Make it a plan/);assert.doesNotMatch(html(checkout),/A small detour/);
  }
});

test('staff rendering covers normal staff, empty panels and each membership and queue state',async()=>{
  const source=data.staff,r=source.reservations[0],m=source.members[0],q=source.queue[0];
  const staff={...source,role:'staff',report:null,venue:{...source.venue,priority_enabled:false},reservations:[{...r,name:'',phone:'test',party_size:1,starts_at:Date.now()+7200000},{...r,state:'attended'},{...r,state:'confirmed',starts_at:Date.now()-7200000,checkin_deadline:Date.now()-3600000}],members:[{...m,member_name:'',locker:null,active:false,bottles:[{name:'Empty',id:'empty',remaining_ml:0,capacity_ml:750}]},{...m,locker:{mode:'private',label:'L09'},bottles:[]},{...m,active:false},{...m,locker:null}],queue:[{...q,name:'',phone:'test',party_size:1,state:'called',lane:'priority'},{...q,state:'held'}],campaigns:source.campaigns.map(c=>({...c,state:'approved'}))};
  const b=await browser({path:'/staff/copper-room',handle:handler({'GET /api/staff/copper-room':()=>({data:staff}),'GET /api/staff/copper-room/jobs':()=>({data:[{id:'job',kind:'wallet',status:'pending',attempts:0}]})})});assert.doesNotMatch(html(b),/data-id="promotions"/);
  for(const tab of ['lockers','queue','promotions','sync']){await b.click('staff-tab',tab);assert.doesNotMatch(b.elements['#staff-panel'].innerHTML,/undefined|NaN/);}
  for(const tab of ['arrivals','lockers','queue','sync']){const empty=await browser({path:'/staff/copper-room',handle:handler({'GET /api/staff/copper-room':()=>({data:{...source,members:[],reservations:[],queue:[]}})})});await empty.click('staff-tab',tab);assert.match(empty.elements['#staff-panel'].innerHTML,/class="empty"/);}
});

test('priority capacity errors, cancellation without refund and failed lookups remain visible',async()=>{
  for(const queue of [{enabled:false},{enabled:true,priceCents:null}]){const b=await browser({path:'/account',handle:handler({[`GET /api/venues/${data.account.queue[0].venue_id}`]:()=>({data:{queue}})})});await b.click('priority',data.account.queue[0].id);assert.match(b.elements['#toast'].textContent,/not enabled|lane is full/);}
  const b=await browser({path:'/account',handle:handler()});await b.click('confirm-cancel','held');assert.equal(b.elements['#toast'].textContent,'Checkout cancelled.');
  const staff=await browser({path:'/staff/copper-room',handle:handler({'POST /api/staff/copper-room/lookup':()=>({status:404,data:{error:'Unknown <member>'}})})});await staff.click('staff-tab','lockers');const f=staff.form('lookup-form',{token:'bad'});staff.edit(f);await staff.submit(f);assert.match(staff.elements['#lookup-result'].innerHTML,/Unknown &lt;member&gt;/);assert.match(staff.elements['#lookup-result'].innerHTML,/role="alert"/);
  const success=await browser({path:'/staff/copper-room',handle:handler({'POST /api/staff/copper-room/lookup':()=>({data:{...data.staff.members[0]}})})});await success.click('staff-tab','lockers');await success.submit(success.form('lookup-form',{token:'known'}));assert.match(success.elements['#lookup-result'].innerHTML,/Active/);
});

test('refresh fences responses and ignores writes, drafts, concurrent refreshes and detached forms',async()=>{
  let resolve,hold=false;
  const deferred=()=>new Promise(r=>{resolve=r;});
  const b=await browser({path:'/account',handle:handler({'GET /api/account':async()=>hold?await deferred():{data:data.account},'PATCH /api/account':async()=>await deferred()})});
  hold=true;const refresh=b.refresh();await Promise.resolve();const count=b.requests.length;await b.refresh();assert.equal(b.requests.length,count);const form=b.form('profile-form',{name:'Draft'});form.marketingOptIn={checked:false};b.edit(form);const before=html(b);resolve({data:{...data.account,user:{...data.account.user,name:'Changed'}}});await refresh;assert.equal(html(b),before);
  hold=false;const saved=b.submit(form);await Promise.resolve();await b.refresh();b.edit(form);resolve({data:{}});await saved;assert.equal(form.dataset.dirty,'true');assert.match(b.elements['#profile-status'].textContent,/Unsaved/);
  const staff=await browser({path:'/staff/copper-room',handle:handler({'GET /api/staff/copper-room':async()=>hold?await deferred():{data:data.staff},'POST /api/staff/copper-room/lookup':async()=>await deferred()})});
  hold=true;const update=staff.refresh();await Promise.resolve();const lookup=staff.form('lookup-form',{token:'known'});staff.edit(lookup);const previous=html(staff);resolve({data:data.staff});await update;assert.equal(html(staff),previous);
  hold=false;const pending=staff.submit(lookup);await Promise.resolve();lookup.isConnected=false;lookup.button.isConnected=false;resolve({data:data.staff.members[0]});await pending;assert.doesNotMatch(staff.elements['#lookup-result'].innerHTML,/class="lookup-result"/);
  const failing=staff.submit(lookup);await Promise.resolve();resolve({status:404,data:{error:'Stale'}});await failing;assert.doesNotMatch(staff.elements['#lookup-result'].innerHTML,/Stale/);
  staff.document.activeElement=null;staff.document.hidden=true;await staff.refresh();
});

test('live public pages omit synthetic notices and use operating policies',async()=>{
  for(const path of ['/','/privacy','/terms']){const b=await browser({path,config:{mode:'live'},handle:handler()});assert.doesNotMatch(html(b),/sample venues and game schedules|Demo policy/);if(path!=='/')assert.match(html(b),/venue-specific membership and booking terms/);}
});
