import { timingSafeEqual } from 'node:crypto';
import { configuration } from './config.js';
import { createApplication } from './server.js';
import { openPostgresStore } from '../../packages/db/postgres.js';

export function authorizedCron(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A pool belongs to one invocation and is always closed before returning.
export function vercelHandler({env = process.env, openStore = openPostgresStore, createApp = createApplication} = {}) {
  let migrated = false;
  return async (req, res) => {
    const cron = new URL(req.url, 'https://regulars.invalid').pathname === '/api/cron';
    res.setHeader('Cache-Control', 'no-store');
    if (cron && (req.method !== 'GET' || !authorizedCron(req.headers.authorization, env.CRON_SECRET))) {
      res.writeHead(401, {'content-type': 'application/json'});
      return res.end(JSON.stringify({error: 'Unauthorized'}));
    }
    let store;
    try {
      if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
      if (env.VERCEL_ENV === 'preview' && !env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Preview requires Stripe test credentials');
      const origin = env.PUBLIC_ORIGIN || (env.VERCEL_ENV === 'preview' && env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined);
      const config = configuration({...env, PUBLIC_ORIGIN: origin, NODE_ENV: 'production', APP_MODE: 'live'});
      store = openStore(env.DATABASE_URL);
      if (!migrated) {await store.migrate();migrated = true;}
      const runtime = await createApp({config, store});
      if (cron) {
        await runtime.jobs.tick();
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({ok: true}));
      } else await runtime.handler(req, res);
    } catch {
      console.error('Regulars startup or scheduled job failed; check deployment configuration and database.');
      if (!res.headersSent) res.writeHead(503, {'content-type': 'application/json'});
      res.end(JSON.stringify({error: 'Regulars is not ready. Please try again later.'}));
    } finally {
      if (store) await store.close();
    }
  };
}
