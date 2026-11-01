import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

async function lookupClient(){
  const button={disabled:false,isConnected:true};
  class Form {constructor(){this.id='lookup-form';this.dataset={};this.values={token:'first'};this.isConnected=true;}querySelector(){return button;}}
  const form=new Form();
  const elements={'#app':{innerHTML:''},'#modal':{open:false,addEventListener(){}},'#modal-content':{},'#toast':{classList:{toggle(){}}},'#lookup-result':{innerHTML:'Previously matched member'}};
  const listeners={},requests=[];
  const document={querySelector:selector=>elements[selector],addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn);}};
  const context=vm.createContext({document,HTMLFormElement:Form,FormData:class{constructor(f){return Object.entries(f.values);}},location:{pathname:'/missing'},URL,Intl,setInterval(){},clearTimeout(){},setTimeout(){},fetch:async(path,options)=>path==='/api/config'?{ok:true,json:async()=>({mode:'live'})}:new Promise(resolve=>requests.push({path,body:JSON.parse(options.body),reply:(data,ok=true)=>resolve({ok,status:ok?200:404,json:async()=>data})}))});
  const source=readFileSync(new URL('../apps/web/public/app.js',import.meta.url),'utf8');
  await vm.runInContext(`(async()=>{${source}\nstaffData={venue:{slug:'copper-room'}};})()`,context);
  return {form,button,requests,result:elements['#lookup-result'],toast:elements['#toast'],submit:()=>listeners.submit[0]({target:form,preventDefault(){}}),edit(token){form.values.token=token;listeners.input[0]({target:{closest:()=>form}});}};
}

test('failed member lookup clears the old match and keeps an escaped error beside the form',async()=>{
  const f=await lookupClient();const pending=f.submit();
  assert.doesNotMatch(f.result.innerHTML,/Previously matched/);
  assert.match(f.result.innerHTML,/Looking up/);assert.equal(f.button.disabled,true);
  assert.equal(f.requests[0].path,'/api/staff/copper-room/lookup');assert.equal(f.requests[0].body.token,'first');
  f.requests[0].reply({error:'No member <script>alert(1)</script>'},false);await pending;
  assert.match(f.result.innerHTML,/role="alert"/);assert.match(f.result.innerHTML,/No member &lt;script&gt;/);assert.doesNotMatch(f.result.innerHTML,/<script>|Previously matched/);
  assert.equal(f.toast.textContent,undefined);assert.equal(f.button.disabled,false);
});

test('editing a code clears the match and ignores an in-flight response for the previous code',async()=>{
  const f=await lookupClient();f.edit('first');assert.equal(f.result.innerHTML,'');
  const pending=f.submit();f.edit('different');assert.equal(f.result.innerHTML,'');
  f.requests[0].reply({id:'first',active:true,member_name:'Wrong member',plan_name:'Guest'});await pending;
  assert.equal(f.result.innerHTML,'');
});

test('a late lookup failure cannot replace the newer successful member match',async()=>{
  const f=await lookupClient();const old=f.submit();f.edit('second');const latest=f.submit();
  f.requests[1].reply({id:'second',active:false,member_name:'Second <guest>',plan_name:'Locker',locker:{label:'L02'}});await latest;
  assert.match(f.result.innerHTML,/Second &lt;guest&gt;/);assert.match(f.result.innerHTML,/Inactive/);assert.match(f.result.innerHTML,/#member-second/);
  const matched=f.result.innerHTML;f.requests[0].reply({error:'Old code failed'},false);await old;
  assert.equal(f.result.innerHTML,matched);assert.equal(f.toast.textContent,undefined);
});
