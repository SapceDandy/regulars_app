import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

// Queue access to a local connection while an asynchronous transaction is open.
export function openStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const context = new AsyncLocalStorage();
  let queue = Promise.resolve();
  const exclusive = fn => {
    if (context.getStore()) return Promise.resolve().then(fn);
    const result = queue.then(() => context.run(true, fn));
    queue = result.catch(() => {});
    return result;
  };
  return {
    db, dialect: 'sqlite',
    get: (sql, ...values) => exclusive(() => db.prepare(sql).get(...values)),
    all: (sql, ...values) => exclusive(() => db.prepare(sql).all(...values)),
    run: (sql, ...values) => exclusive(() => db.prepare(sql).run(...values)),
    transaction: fn => exclusive(async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const value = await fn(); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }),
    close: () => exclusive(() => db.close())
  };
}
