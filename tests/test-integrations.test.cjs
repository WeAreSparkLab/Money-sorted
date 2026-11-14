'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {Readable} = require('node:stream');
const {
  decryptToken, encryptToken, requireTestConfig, verifyStripeSignature,
} = require('../server/test-integrations');

const configKeys = [
  'STRIPE_SECRET_KEY', 'PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY', 'BANK_TOKEN_ENCRYPTION_KEY', 'VERCEL_ENV',
  'TEST_SUPABASE_URL', 'TEST_SUPABASE_PUBLISHABLE_KEY',
];
function withConfig(run) {
  const before = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
  try {
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
    process.env.PLAID_ENV = 'sandbox';
    process.env.PLAID_CLIENT_ID = 'example';
    process.env.PLAID_SECRET = 'example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'example';
    process.env.BANK_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.VERCEL_ENV = 'preview';
    process.env.TEST_SUPABASE_URL = 'https://exampleabc.supabase.co';
    process.env.TEST_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';
    run();
  } finally {
    for (const key of configKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test('test integrations reject live Stripe and Plaid configuration', () => withConfig(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_live_example';
  assert.throws(requireTestConfig, /Stripe test mode/);
  process.env.STRIPE_SECRET_KEY = 'sk_test_example';
  process.env.PLAID_ENV = 'production';
  assert.throws(requireTestConfig, /Plaid Sandbox/);
  process.env.PLAID_ENV = 'sandbox';
  process.env.VERCEL_ENV = 'production';
  assert.throws(requireTestConfig, /disabled in production/);
}));

test('bank token encryption round trips and rejects tampering', () => withConfig(() => {
  const sealed = encryptToken('access-sandbox-example');
  assert.equal(decryptToken(sealed), 'access-sandbox-example');
  const bytes = Buffer.from(sealed.token_ciphertext, 'base64');
  bytes[0] ^= 1;
  assert.throws(() => decryptToken({...sealed, token_ciphertext: bytes.toString('base64')}));
}));

test('Stripe signature requires exact payload, valid timestamp and signing key', () => {
  const now = Date.now();
  const time = Math.floor(now / 1000);
  const raw = Buffer.from('{"type":"customer.subscription.updated"}');
  const secret = 'whsec_example';
  const sig = crypto.createHmac('sha256', secret).update(String(time) + '.')
    .update(raw).digest('hex');
  const header = 't=' + time + ',v1=' + sig;
  assert.equal(verifyStripeSignature(raw, header, secret, now), true);
  assert.equal(verifyStripeSignature(raw, header, 'wrong', now), false);
  assert.equal(verifyStripeSignature(Buffer.from('{}'), header, secret, now), false);
  assert.equal(verifyStripeSignature(raw, header, secret, now + 301_000), false);
});

function fakeResponse() {
  return {
    code: null, payload: null,
    setHeader() {},
    status(code) {this.code = code; return this;},
    end(payload) {this.payload = JSON.parse(payload); return this;},
  };
}

test('bank and billing endpoints reject requests without a signed-in user', async () => {
  const before = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
  try {
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
    process.env.PLAID_ENV = 'sandbox';
    process.env.PLAID_CLIENT_ID = 'example';
    process.env.PLAID_SECRET = 'example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'example';
    process.env.BANK_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.VERCEL_ENV = 'preview';
    process.env.TEST_SUPABASE_URL = 'https://exampleabc.supabase.co';
    process.env.TEST_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';
    for (const handler of [require('../api/test-billing'), require('../api/test-bank')]) {
      const res = fakeResponse();
      await handler({method: 'POST', query: {action: 'status'}, headers: {}}, res);
      assert.equal(res.code, 401);
      assert.match(res.payload.error, /Sign in/);
    }
  } finally {
    for (const key of configKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('Stripe webhook endpoint rejects an unsigned payload', async () => {
  const before = Object.fromEntries([...configKeys, 'STRIPE_TEST_WEBHOOK_SECRET']
    .map(key => [key, process.env[key]]));
  try {
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
    process.env.PLAID_ENV = 'sandbox';
    process.env.PLAID_CLIENT_ID = 'example';
    process.env.PLAID_SECRET = 'example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'example';
    process.env.BANK_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.VERCEL_ENV = 'preview';
    process.env.TEST_SUPABASE_URL = 'https://exampleabc.supabase.co';
    process.env.TEST_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';
    process.env.STRIPE_TEST_WEBHOOK_SECRET = 'whsec_example';
    const req = Readable.from([Buffer.from('{"type":"customer.subscription.created"}')]);
    req.method = 'POST';
    req.headers = {};
    const res = fakeResponse();
    await require('../api/test-stripe-webhook')(req, res);
    assert.equal(res.code, 400);
    assert.equal(res.payload.error, 'Invalid signature');
  } finally {
    for (const key of [...configKeys, 'STRIPE_TEST_WEBHOOK_SECRET']) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
