import { configuration } from './config.js';
import { requireThat } from '../../packages/core/rules.js';

// Explicitly opted-in, protected Vercel previews only. Never a production mode.
export function pilotConfiguration(env) {
  requireThat(env.VERCEL==='1' && env.VERCEL_ENV==='preview' && env.PILOT_TESTING_ENABLED==='true',500,'Synthetic pilot is restricted to Vercel previews.');
  requireThat(env.SESSION_SECRET?.length>=32 && !!env.VERCEL_URL,500,'Pilot needs a session secret and deployment URL.');
  const config=configuration({APP_MODE:'demo',SESSION_SECRET:env.SESSION_SECRET});
  return {...config,pilot:true,secure:true,origin:`https://${env.VERCEL_URL}`,env:{VERCEL:'1'}};
}

export async function blockPilotProvider() {
  throw new Error('External providers are disabled in the synthetic pilot.');
}
