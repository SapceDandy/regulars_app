import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let count=0;
function walk(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    if(['node_modules','.git','data','backups'].includes(entry.name))continue;
    const path=join(dir,entry.name);
    if(entry.isDirectory())walk(path);
    else if(path.endsWith('.js')){const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);count++;}
    else if(path.endsWith('.json'))JSON.parse(readFileSync(path,'utf8'));
  }
}
walk('.');console.log(`Syntax and JSON checked (${count} JavaScript files).`);
