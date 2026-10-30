import { PGlite } from '@electric-sql/pglite';
import { openStore } from '../../packages/db/store.js';
import { createPostgresStore } from '../../packages/db/postgres.js';

export async function testStore(path = ':memory:') {
  if (process.env.REGULARS_TEST_DB !== 'postgres' || path !== ':memory:') return openStore(path);
  const db = new PGlite();
  let queue = Promise.resolve();
  const acquire = async () => {
    const previous = queue;
    let release;
    queue = new Promise(resolve => {release = resolve;});
    await previous;
    return release;
  };
  const query = async (sql, args) => args?.length ? db.query(sql,args) :
    (sql.includes(';') ? {rows: await db.exec(sql)} : db.query(sql));
  const pool = {
    async query(sql,args) {const release=await acquire();try{return await query(sql,args);}finally{release();}},
    async connect() {const release=await acquire();return {query,release};},
    end: () => db.close()
  };
  const store = createPostgresStore(pool);
  await store.migrate();
  return store;
}
