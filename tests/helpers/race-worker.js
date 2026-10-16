import { parentPort,workerData } from 'node:worker_threads';
import { openStore } from '../../packages/db/store.js';
import { Regulars } from '../../packages/core/regulars.js';
const s=openStore(workerData.path);const app=new Regulars(s,{now:()=>workerData.now});
const gate=new Int32Array(workerData.gate);Atomics.add(gate,0,1);Atomics.notify(gate,0);
Atomics.wait(gate,1,0);
try{const order=app.createOrder(workerData.user,workerData.input,workerData.user);parentPort.postMessage({status:201,order:order.id});}
catch(e){parentPort.postMessage({status:e.status??500,message:e.message});}
finally{s.close();}
