// Opt-in, read-only verification of the existing Vercel sandbox secret.
const expected = process.env.REGULARS_STRIPE_ACCOUNT_CHECK;
if (!expected) {
  console.log('STRIPE ACCOUNT CHECK: skipped (not enabled).');
} else {
  let stage = 'configuration';
  try {
    if (expected !== 'acct_1UWjDwRpgftslY1f' ||
        process.env.VERCEL_ENV !== 'preview' ||
        process.env.VERCEL_GIT_COMMIT_REF !== 'codex/provider-pilot' ||
        !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      throw new Error('Refusing account check outside the Regulars sandbox preview.');
    }
    stage = 'read-only account request';
    const response = await fetch('https://api.stripe.com/v1/account', {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error('Account request failed.');
    stage = 'Regulars account identity';
    const account = await response.json();
    if (account.object !== 'account' || account.id !== expected) {
      throw new Error('Account identity did not match.');
    }
    console.log('STRIPE ACCOUNT PASS: configured test secret belongs to the separate Regulars sandbox.');
    console.log('STRIPE ACCOUNT SCOPE: one read-only request; no payment, customer or webhook created.');
  } catch {
    // Never print provider bodies, account details, credentials or raw errors.
    console.error(`STRIPE ACCOUNT FAIL: ${stage}.`);
    process.exitCode = 1;
  }
}
