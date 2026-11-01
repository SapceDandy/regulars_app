import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {openStore} from '../packages/db/store.js';
import {openPostgresStore} from '../packages/db/postgres.js';
import {Regulars} from '../packages/core/regulars.js';
import {operatorAction} from '../packages/core/operations.js';
import {requireThat} from '../packages/core/rules.js';

export async function runOperator(env,args,openHosted=openPostgresStore) {
  const [action,inputPath]=args;
  requireThat(env.DATABASE_URL||env.DATABASE_PATH&&existsSync(env.DATABASE_PATH),400,'Set DATABASE_URL or an existing DATABASE_PATH explicitly.');
  const input=inputPath?JSON.parse(readFileSync(inputPath,'utf8')):{};
  const store=env.DATABASE_URL?openHosted(env.DATABASE_URL,{schema:env.REGULARS_DB_SCHEMA??'public'}):openStore(env.DATABASE_PATH);
  try{return await operatorAction(new Regulars(store),action,input);}finally{await store.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{console.log(JSON.stringify(await runOperator(process.env,process.argv.slice(2)),null,2));}
  catch{console.error('Operator command failed. Check the private input, database configuration and operator runbook. No changes were committed if validation failed.');process.exitCode=1;}
}
