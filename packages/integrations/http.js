import { Problem } from '../core/rules.js';

export async function providerFetch(url, options={}) {
  const res=await fetch(url,{...options,signal:options.signal??AbortSignal.timeout(12_000)});
  if(!res.ok) {
    // Never expose provider bodies: these can contain phone numbers or credentials.
    throw new Problem(502,`Provider request failed (${res.status}).`);
  }
  return res;
}
