import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

// Run the exact shipped ES module. Small DOM doubles exercise event behavior;
// real browser/device layout and accessibility remain separate pilot checks.
export async function browser({path='/',search='',config={mode:'demo',wallets:{apple:false,google:false}},handle=()=>({})}={}){
  class Element {
    constructor(){this.innerHTML='';this.textContent='';this.hidden=false;this.open=false;this.disabled=false;this.isConnected=true;this.dataset={};this.listeners={};this.attributes={};this.classList={toggle:(name,on)=>{this.attributes[name]=on;}};}
    addEventListener(type,fn){this.listeners[type]=fn;}
    setAttribute(name,value){this.attributes[name]=value;}
    focus(){document.activeElement=this;}
    showModal(){this.open=true;}
    close(){this.open=false;}
    click(){downloads.push(this);}
  }
  class Form extends Element {
    constructor(id,values={},dataset={}){super();this.id=id;this.values=values;this.dataset={...dataset};this.button=new Element();}
    querySelector(){return this.button;}
    closest(selector){return selector==='form'?this:null;}
  }
  const elements=Object.fromEntries(['#app','#modal','#modal-content','#toast','#profile-status','#lookup-result','#demo-banner','#staff-panel','#venue-search','#venue-count','#venue-results','.auth-card','#code','#answer','#dialog-error','#booking-price','#season-games'].map(id=>[id,new Element()]));
  const listeners={},intervals=[],timeouts=[],requests=[],clipboard=[],downloads=[],blobs=[];const forms=[];
  const tabs=['arrivals','lockers','queue','promotions','sync'].map(id=>{const b=new Element();b.dataset.id=id;return b;});
  const document={hidden:false,activeElement:{tagName:'BODY'},querySelector(selector){if(selector==='form[data-dirty]')return forms.find(f=>f.dataset.dirty)||null;return elements[selector]??null;},querySelectorAll:()=>tabs,addEventListener(type,fn){listeners[type]=fn;},createElement:()=>new Element()};
  const location={pathname:path,search,origin:'https://regulars.example',href:`https://regulars.example${path}${search}`,replace(value){this.href=value;}};
  class BrowserURL extends URL {static createObjectURL(blob){blobs.push(blob);return 'blob:fixture';}static revokeObjectURL(url){assertBlob(url);}}
  function assertBlob(url){if(url!=='blob:fixture')throw new Error('Unexpected blob URL');}
  const context=vm.createContext({document,location,HTMLFormElement:Form,FormData:class{constructor(form){return Object.entries(form.values);}},URL:BrowserURL,URLSearchParams,Intl,Blob,crypto:{randomUUID},navigator:{clipboard:{writeText:async value=>{clipboard.push(value);}}},setInterval(fn){intervals.push(fn);},setTimeout(fn){timeouts.push(fn);},clearTimeout(){},fetch:async(url,options)=>{const request={url,...options,body:options.body===undefined?undefined:JSON.parse(options.body)};requests.push(request);const result=url==='/api/config'?{data:config}:await handle(request);return{ok:(result.status??200)<400,status:result.status??200,json:async()=>result.data??{}};}});
  const url=new URL('../../apps/web/public/app.js',import.meta.url);
  const module=new vm.SourceTextModule(readFileSync(url,'utf8'),{context,identifier:url.href});
  await module.link(()=>{throw new Error('Unexpected client import');});
  await module.evaluate();
  function form(id,values={},dataset={}){const f=new Form(id,values,dataset);forms.push(f);elements[`#${id}`]=f;return f;}
  return {elements,document,location,requests,clipboard,downloads,blobs,tabs,forms,intervals,timeouts,form,
    submit:f=>listeners.submit({target:f,preventDefault(){}}),
    edit:f=>listeners.input({target:{closest:()=>f}}),
    change:f=>listeners.change({target:{closest:()=>f}}),
    async click(action,id,options={}){const b=Object.assign(new Element(),options);b.dataset={action,id};await listeners.click({target:{closest:selector=>selector==='[data-action]'?b:null}});return b;},
    clickOutside:()=>elements['#modal'].listeners.click({target:elements['#modal']}),
    close:()=>listeners.click({target:{closest:selector=>selector==='.modal-close'?{}:null}}),
    refresh:()=>intervals[0](),
    rawClick:target=>listeners.click({target})};
}
