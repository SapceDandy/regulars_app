import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { Pool, neonConfig, types } from '@neondatabase/serverless';
import pg from 'pg';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const parseInteger = value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Database integer exceeds safe range');
  return n;
};
types.setTypeParser(20, parseInteger);
pg.types.setTypeParser(20, parseInteger);

// Keep the Supabase secret separate from DATABASE_URL injected by a Neon integration.
export function databaseConfiguration(env, {pilot=false}={}) {
  const provider=env.DATABASE_PROVIDER || 'neon';
  if(!['neon','supabase'].includes(provider))throw new Error('Unsupported database provider');
  const connectionString=provider==='supabase'?env.SUPABASE_DATABASE_URL:env.DATABASE_URL;
  if(provider==='supabase'&&!connectionString)throw new Error('Configure SUPABASE_DATABASE_URL');
  const schema=pilot?'regulars_pilot':env.REGULARS_DB_SCHEMA || (provider==='supabase'?'regulars':'public');
  if(provider==='supabase'&&schema==='public')throw new Error('Supabase requires a private Regulars schema');
  return {connectionString,provider,schema,ca:env.DATABASE_CA_CERT};
}

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
  if(!['public','regulars','regulars_pilot'].includes(schema))throw new Error('Unsupported database schema');
  const context = new AsyncLocalStorage();
  const query = async (sql, values = []) => {
    if(context.getStore())return context.getStore().query(postgresSql(sql),values);
    if(schema==='public')return pool.query(postgresSql(sql),values);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO ${schema}`);
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
        if(schema!=='public')await client.query(`SET LOCAL search_path TO ${schema}`);
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
        if(schema!=='public'&&!(await context.getStore().query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rows[0])await context.getStore().query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        await context.getStore().query(readFileSync(new URL('./schema.postgres.sql', import.meta.url), 'utf8'));
        if(schema==='regulars')await context.getStore().query(`DO $regulars$
          DECLARE relation record;
          BEGIN
            FOR relation IN SELECT tablename FROM pg_tables WHERE schemaname='regulars' LOOP
              EXECUTE format('ALTER TABLE regulars.%I ENABLE ROW LEVEL SECURITY', relation.tablename);
            END LOOP;
          END $regulars$`);
      });
    },
    close: () => pool.end()
  };
  return store;
}

export function openPostgresStore(connectionString, {schema='public',provider='neon',ca}={}) {
  if (!connectionString) throw new Error('Configure DATABASE_URL before opening PostgreSQL');
  if(!['public','regulars','regulars_pilot'].includes(schema))throw new Error('Unsupported database schema');
  if(!['neon','supabase'].includes(provider))throw new Error('Unsupported database provider');
  if(provider==='supabase'&&schema==='public')throw new Error('Supabase requires a private Regulars schema');
  let options={connectionString, max:4, connectionTimeoutMillis:10_000, idleTimeoutMillis:10_000};
  if(provider==='supabase') {
    const url=new URL(connectionString);
    if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Invalid PostgreSQL connection protocol');
    // URL SSL options override pg's ssl object. Never allow them to weaken verification
    // or cause pg to read certificate/key paths supplied in a connection URL.
    for(const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
    options={...options,connectionString:url.toString(),max:1,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})}};
  }
  const Driver=provider==='supabase'?pg.Pool:Pool;
  const pool = new Driver(options);
  pool.on('error', () => console.error('PostgreSQL connection failed'));
  return createPostgresStore(pool,{schema});
}
