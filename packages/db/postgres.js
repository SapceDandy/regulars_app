import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { Pool, neonConfig, types } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
types.setTypeParser(20, value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Database integer exceeds safe range');
  return n;
});

// Convert positional placeholders without rewriting question marks in SQL literals.
export function postgresSql(sql) {
  let quoted = false, index = 0, result = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      result += c;
      if (quoted && sql[i + 1] === "'") { result += sql[++i]; continue; }
      quoted = !quoted;
    } else result += c === '?' && !quoted ? `$${++index}` : c;
  }
  return result;
}

export function createPostgresStore(pool, {schema='public'}={}) {
  if(!['public','regulars_pilot'].includes(schema))throw new Error('Unsupported database schema');
  const context = new AsyncLocalStorage();
  const query = async (sql, values = []) => {
    if(context.getStore())return context.getStore().query(postgresSql(sql),values);
    if(schema==='public')return pool.query(postgresSql(sql),values);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO regulars_pilot');
      const result=await client.query(postgresSql(sql),values);
      await client.query('COMMIT');return result;
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}finally {client.release();}
  };
  const store = {
    dialect: 'postgres',
    get: async (sql, ...values) => (await query(sql, values)).rows[0],
    all: async (sql, ...values) => (await query(sql, values)).rows,
    run: async (sql, ...values) => {const result = await query(sql, values); return {changes: result.rowCount ?? result.affectedRows ?? 0};},
    async transaction(fn) {
      if (context.getStore()) throw new Error('Nested database transactions are not supported');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if(schema==='regulars_pilot')await client.query('SET LOCAL search_path TO regulars_pilot');
        await client.query("SET LOCAL lock_timeout = '15s'");
        await client.query("SET LOCAL statement_timeout = '20s'");
        // Preserve SQLite's single-writer allocation semantics across all Vercel instances.
        // All transactional domain writes use this lock; provider calls remain outside it.
        await client.query('SELECT pg_advisory_xact_lock(1380271937)');
        const result = await context.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }finally {client.release();}
    },
    async migrate() {
      await store.transaction(async () => {
        if(schema==='regulars_pilot')await context.getStore().query('CREATE SCHEMA IF NOT EXISTS regulars_pilot');
        await context.getStore().query(readFileSync(new URL('./schema.postgres.sql', import.meta.url), 'utf8'));
      });
    },
    close: () => pool.end()
  };
  return store;
}

export function openPostgresStore(connectionString, {schema='public'}={}) {
  if (!connectionString) throw new Error('Configure DATABASE_URL before opening PostgreSQL');
  if(!['public','regulars_pilot'].includes(schema))throw new Error('Unsupported database schema');
  const pool = new Pool({connectionString, max: 4, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000});
  pool.on('error', () => console.error('PostgreSQL connection failed'));
  return createPostgresStore(pool,{schema});
}
