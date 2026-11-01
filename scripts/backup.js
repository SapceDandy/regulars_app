import { backup, DatabaseSync } from 'node:sqlite';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

if(process.env.DATABASE_URL)throw new Error('This command only backs up SQLite. Use the PostgreSQL provider backup and restore workflow for DATABASE_URL.');
// Read-only open fails for a missing source and never initializes an empty database.
const db=new DatabaseSync(resolve(process.env.DATABASE_PATH??'./data/regulars.sqlite'),{readOnly:true});
const dir=resolve('backups');
const path=resolve(dir,`regulars-${Date.now()}-${randomUUID()}.sqlite`);
const partial=`${path}.partial`;
process.umask(0o077);
try {
  mkdirSync(dir,{recursive:true,mode:0o700});
  await backup(db,partial);
  renameSync(partial,path);
  console.log(`Backup created: ${path}`);
} finally {
  db.close();
  rmSync(partial,{force:true});
}
