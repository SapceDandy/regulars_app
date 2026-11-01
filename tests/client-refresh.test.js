import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

async function client(){
  const elements={'#app':{innerHTML:''},'#modal':{open:false,addEventListener(){}},'#modal-content':{},'#toast':{},'#profile-status':{textContent:''}};
  const listeners={};let dirty=null,resolveAccount,ready;const requested=new Promise(resolve=>{ready=resolve;});
  const document={hidden:false,activeElement:{tagName:'BODY'},querySelector:selector=>selector==='form[data-dirty]'?dirty:elements[selector],addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn);}};
  const context=vm.createContext({document,location:{pathname:'/missing'},URL,Intl,setInterval(){},clearTimeout(){},setTimeout(){},fetch:async path=>({ok:true,json:async()=>path==='/api/config'?{mode:'live'}:new Promise(resolve=>{resolveAccount=resolve;ready();})})});
  const source=readFileSync(new URL('../apps/web/public/app.js',import.meta.url),'utf8');
  const api=await vm.runInContext(`(async()=>{${source}\nreturn {accountPage,refreshBlocked};})()`,context);
  return {api,elements,document,requested,edit(){const form={id:'profile-form',dataset:{}};dirty=form;listeners.input[0]({target:{closest:()=>form}});return form;},resolve(){resolveAccount({user:{name:'Saved Guest',phone:'test'},memberships:[],reservations:[],orders:[],queue:[],staffVenues:[]});}};
}

test('background account response cannot replace a draft started while the request was in flight',async()=>{
  const f=await client();f.elements['#app'].innerHTML='existing account';
  const pending=f.api.accountPage(true);await f.requested;
  const form=f.edit();assert.equal(form.dataset.dirty,'true');
  assert.match(f.elements['#profile-status'].textContent,/Unsaved changes/);
  f.resolve();await pending;assert.equal(f.elements['#app'].innerHTML,'existing account');
});

test('background account refresh renders current data when there is no active edit',async()=>{
  const f=await client();const pending=f.api.accountPage(true);await f.requested;f.resolve();await pending;
  assert.match(f.elements['#app'].innerHTML,/Good to have you, Saved/);
  f.document.activeElement.tagName='BUTTON';assert.ok(f.api.refreshBlocked());
});
