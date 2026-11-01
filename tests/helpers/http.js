import assert from 'node:assert/strict';
import {createApplication} from '../../apps/web/server.js';
import {configuration} from '../../apps/web/config.js';
import {testStore} from './store.js';

export async function serverFixture(t,{now}={}) {
  const config=configuration({APP_MODE:'demo',PUBLIC_ORIGIN:'http://127.0.0.1:3000'});const store=await testStore();const r=(await createApplication({config,store,now}));await new Promise(resolve=>r.server.listen(0,'127.0.0.1',resolve));config.origin=`http://127.0.0.1:${r.server.address().port}`;
  t.after(async()=>{r.server.closeAllConnections();await new Promise(resolve=>r.server.close(resolve));(await store.close());});
  const call=async(path,{method='GET',body,cookie,origin=true,key,headers={},raw}={})=>{
    const response=await fetch(config.origin+path,{method,headers:{...(origin?{origin:config.origin}:{}),...(method!=='GET'?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(key?{'idempotency-key':key}:{}),...headers},...(raw!==undefined?{body:raw}:body!==undefined?{body:JSON.stringify(body)}:{})});const content=response.headers.get('content-type')??'';const text=await response.text();return {status:response.status,headers:response.headers,data:content.includes('json')&&text?JSON.parse(text):text};
  };
  const login=async(phone='+12025550101')=>{const start=await call('/api/auth/start',{method:'POST',body:{phone,smsConsent:true}});assert.equal(start.status,200);const verify=await call('/api/auth/verify',{method:'POST',body:{phone,code:start.data.demoCode,name:'Test Patron'}});assert.equal(verify.status,200);return verify.headers.get('set-cookie').split(';')[0];};
  return {...r,call,login};
}

