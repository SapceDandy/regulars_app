import { backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { configuration } from '../apps/web/config.js';
import { openStore } from '../packages/db/store.js';
const c=configuration();const s=openStore(c.databasePath);const dir=resolve('backups');mkdirSync(dir,{recursive:true,mode:0o700});const path=resolve(dir,`regulars-${Date.now()}.sqlite`);await backup(s.db,path);s.close();console.log(`Backup created: ${path}`);
