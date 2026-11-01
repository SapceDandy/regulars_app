import {readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';

function runtimeFiles(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.name==='node_modules'?[]:entry.isDirectory()?runtimeFiles(join(dir,entry.name)):entry.name.endsWith('.js')?[resolve(dir,entry.name)]:[]);}
// Native coverage only lists loaded files. Refuse a green report if a new runtime
// module has no test at all; tests and developer validation tools are out of scope.
export default async function* report(events){
  for await(const event of events){
    if(event.type!=='test:coverage')continue;
    const summary=event.data.summary;
    const expected=[...['api','apps','packages'].flatMap(runtimeFiles),resolve('scripts/seed.js'),resolve('scripts/backup.js'),resolve('scripts/operator.js')];
    const measured=new Set(summary.files.map(file=>resolve(file.path)));
    const missing=expected.filter(file=>!measured.has(file));
    if(missing.length)throw new Error(`Runtime files missing from coverage: ${missing.join(', ')}`);
    yield JSON.stringify({...summary,runtimeFileCount:expected.length,scope:'All application JavaScript and seed/backup/operator commands; excludes tests, dependencies and developer validation tools.'},null,2)+'\n';
  }
}
