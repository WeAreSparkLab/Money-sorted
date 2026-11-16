'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {Readable} = require('node:stream');
const {
  decryptToken, encryptToken, isOwnTestSubscription, requireTestConfig, verifyStripeSignature,
} = require('../server/test-integrations');

const configKeys = [
  'STRIPE_SECRET_KEY', 'PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY', 'BANK_TOKEN_ENCRYPTION_KEY', 'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_REF',
  'TEST_SUPABASE_URL', 'TEST_SUPABASE_PUBLISHABLE_KEY',
  'STRIPE_TEST_PRICE_ID',
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
    process.env.VERCEL_GIT_COMMIT_REF = 'linked-debit-accounts';
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
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_GIT_COMMIT_REF = 'main';
  assert.throws(requireTestConfig, /linked-debit preview/);
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

test('only the signed-in user’s test product grants bank access', () => withConfig(() => {
  process.env.STRIPE_TEST_PRICE_ID = 'price_money_sorted';
  const subscription = {
    livemode: false, status: 'active', metadata: {supabase_user_id: 'user-1'},
    items: {data: [{price: {id: 'price_money_sorted'}}]},
  };
  assert.equal(isOwnTestSubscription(subscription, 'user-1'), true);
  assert.equal(isOwnTestSubscription(subscription, 'user-2'), false);
  assert.equal(isOwnTestSubscription({...subscription, livemode: true}, 'user-1'), false);
  assert.equal(isOwnTestSubscription({...subscription,
    items: {data: [{price: {id: 'price_other_app'}}]}}, 'user-1'), false);
}));

function fakeResponse() {
  return {
    code: null, payload: null,
    setHeader() {},
    status(code) {this.code = code; return this;},
    end(payload) {this.payload = JSON.parse(payload); return this;},
  };
}

test('test configuration distinguishes unavailable branches from broken preview setup', async () => {
  const keys = ['VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF',
    'TEST_SUPABASE_URL', 'TEST_SUPABASE_PUBLISHABLE_KEY'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const handler = require('../api/test-config');
    process.env.VERCEL_ENV = 'production';
    let res = fakeResponse();
    await handler({method: 'GET'}, res);
    assert.equal(res.code, 404);
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_GIT_COMMIT_REF = 'another-branch';
    res = fakeResponse();
    await handler({method: 'GET'}, res);
    assert.equal(res.code, 404);
    process.env.VERCEL_GIT_COMMIT_REF = 'linked-debit-accounts';
    delete process.env.TEST_SUPABASE_URL;
    res = fakeResponse();
    await handler({method: 'GET'}, res);
    assert.equal(res.code, 503);
    process.env.TEST_SUPABASE_URL = 'https://exampleabc.supabase.co';
    process.env.TEST_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';
    res = fakeResponse();
    await handler({method: 'GET'}, res);
    assert.equal(res.code, 200);
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

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
    process.env.VERCEL_GIT_COMMIT_REF = 'linked-debit-accounts';
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
    process.env.VERCEL_GIT_COMMIT_REF = 'linked-debit-accounts';
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

test('billing status reconciles a paid test subscription without webhook delivery', async () => {
  const before = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  const writes = [];
  try {
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_test_example', PLAID_ENV: 'sandbox',
      PLAID_CLIENT_ID: 'example', PLAID_SECRET: 'example',
      SUPABASE_SERVICE_ROLE_KEY: 'example',
      BANK_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
      VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'linked-debit-accounts',
      TEST_SUPABASE_URL: 'https://exampleabc.supabase.co',
      TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      STRIPE_TEST_PRICE_ID: 'price_test',
    });
    global.fetch = async (url, options = {}) => {
      if (url.endsWith('/auth/v1/user')) return {ok: true, json: async () => ({id: 'user-1'})};
      if (url.includes('/billing_subscriptions') && options.method === 'POST') {
        writes.push(JSON.parse(options.body));
        return {ok: true, text: async () => ''};
      }
      if (url.includes('/billing_subscriptions')) return {
        ok: true, text: async () => JSON.stringify([{user_id: 'user-1', stripe_customer_id: 'cus_test'}]),
      };
      if (url.includes('/subscriptions?')) return {ok: true, json: async () => ({data: [
        {id: 'sub_other', livemode: false, status: 'active', metadata: {supabase_user_id: 'other'},
          items: {data: [{price: {id: 'price_test'}}]}},
        {id: 'sub_test', livemode: false, status: 'active', metadata: {supabase_user_id: 'user-1'},
          items: {data: [{price: {id: 'price_test'}, current_period_end: 1800000000}]}},
      ]})};
      throw new Error('Unexpected request');
    };
    const res = fakeResponse();
    await require('../api/test-billing')({method: 'POST', query: {action: 'status'},
      headers: {authorization: 'Bearer sample'}}, res);
    assert.equal(res.code, 200);
    assert.equal(res.payload.status, 'active');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].stripe_subscription_id, 'sub_test');
  } finally {
    global.fetch = originalFetch;
    for (const key of configKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('expired subscription revokes Sandbox Item and hides cached bank data', async () => {
  const before = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  const calls = [];
  try {
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_test_example', PLAID_ENV: 'sandbox',
      PLAID_CLIENT_ID: 'example', PLAID_SECRET: 'example',
      SUPABASE_SERVICE_ROLE_KEY: 'example',
      BANK_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
      VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'linked-debit-accounts',
      TEST_SUPABASE_URL: 'https://exampleabc.supabase.co',
      TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      STRIPE_TEST_PRICE_ID: 'price_test',
    });
    const sealed = encryptToken('access-sandbox-expired');
    global.fetch = async (url, options = {}) => {
      calls.push([url, options.method || 'GET']);
      if (url.endsWith('/auth/v1/user')) return {ok: true, json: async () => ({id: 'user-1'})};
      if (url.includes('/bank_connections') && options.method === 'DELETE')
        return {ok: true, text: async () => ''};
      if (url.includes('/bank_connections')) return {ok: true, text: async () => JSON.stringify([
        {id: 'connection-1', user_id: 'user-1', ...sealed},
      ])};
      if (url.includes('/billing_subscriptions')) return {ok: true, text: async () => JSON.stringify([
        {stripe_subscription_id: 'sub_expired'},
      ])};
      if (url.includes('/subscriptions/sub_expired')) return {ok: true,
        json: async () => ({livemode: false, status: 'canceled',
          metadata: {supabase_user_id: 'user-1'},
          items: {data: [{price: {id: 'price_test'}}]}})};
      if (url.includes('/item/remove')) return {ok: true, json: async () => ({removed: true})};
      throw new Error('Unexpected request');
    };
    const res = fakeResponse();
    await require('../api/test-bank')({method: 'POST', query: {action: 'status'},
      headers: {authorization: 'Bearer sample'}}, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.payload, {linked: false, lastSyncedAt: null, accounts: [], transactions: []});
    assert.equal(calls.some(([url]) => url.includes('/item/remove')), true);
    assert.equal(calls.some(([url, method]) => url.includes('/bank_connections') && method === 'DELETE'), true);
    assert.equal(calls.some(([url]) => url.includes('/bank_transactions')), false);
  } finally {
    global.fetch = originalFetch;
    for (const key of configKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('test data cleanup cancels billing, revokes Plaid and deletes only the signed-in user’s rows', async () => {
  const before = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  const calls = [];
  try {
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_test_example', PLAID_ENV: 'sandbox',
      PLAID_CLIENT_ID: 'example', PLAID_SECRET: 'example',
      SUPABASE_SERVICE_ROLE_KEY: 'example',
      BANK_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
      VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'linked-debit-accounts',
      TEST_SUPABASE_URL: 'https://exampleabc.supabase.co',
      TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      STRIPE_TEST_PRICE_ID: 'price_test',
    });
    const sealed = encryptToken('access-sandbox-cleanup');
    global.fetch = async (url, options = {}) => {
      calls.push([url, options.method || 'GET']);
      if (url.endsWith('/auth/v1/user')) return {ok: true, json: async () => ({id: 'user-1'})};
      if (url.includes('/billing_subscriptions') && options.method !== 'DELETE')
        return {ok: true, text: async () => JSON.stringify([{stripe_subscription_id: 'sub_test'}])};
      if (url.includes('/bank_connections') && options.method !== 'DELETE')
        return {ok: true, text: async () => JSON.stringify([{id: 'connection-1', ...sealed}])};
      if (url.endsWith('/subscriptions/sub_test') && options.method === 'GET')
        return {ok: true, json: async () => ({livemode: false, status: 'active',
          metadata: {supabase_user_id: 'user-1'},
          items: {data: [{price: {id: 'price_test'}}]}})};
      if (url.endsWith('/subscriptions/sub_test') && options.method === 'DELETE')
        return {ok: true, json: async () => ({status: 'canceled'})};
      if (url.endsWith('/item/remove')) return {ok: true, json: async () => ({})};
      if (url.includes('/bank_connections') || url.includes('/billing_subscriptions'))
        return {ok: true, text: async () => ''};
      throw new Error('Unexpected request');
    };
    const res = fakeResponse();
    await require('../api/test-delete-data')({method: 'POST', headers: {authorization: 'Bearer sample'}}, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.payload, {cleaned: true});
    const sequence = calls.filter(([url, method]) => url.includes('/subscriptions/sub_test') && method === 'DELETE' ||
      url.includes('/item/remove') || method === 'DELETE' &&
      (url.includes('/bank_connections') || url.includes('/billing_subscriptions')));
    assert.deepEqual(sequence.map(([url]) => url.includes('/subscriptions/') ? 'cancel' :
      url.includes('/item/remove') ? 'revoke' :
      url.includes('/bank_connections') ? 'delete-bank' : 'delete-billing'),
    ['cancel', 'revoke', 'delete-bank', 'delete-billing']);
    assert.equal(calls.filter(([url]) => url.includes('/bank_connections') ||
      url.includes('/billing_subscriptions')).every(([url]) => url.includes('user_id=eq.user-1')), true);
  } finally {
    global.fetch = originalFetch;
    for (const key of configKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('test data cleanup stops when Stripe ownership cannot be verified', async () => {
  const before = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  const calls = [];
  try {
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_test_example', PLAID_ENV: 'sandbox',
      PLAID_CLIENT_ID: 'example', PLAID_SECRET: 'example',
      SUPABASE_SERVICE_ROLE_KEY: 'example',
      BANK_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
      VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'linked-debit-accounts',
      TEST_SUPABASE_URL: 'https://exampleabc.supabase.co',
      TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      STRIPE_TEST_PRICE_ID: 'price_test',
    });
    global.fetch = async (url, options = {}) => {
      calls.push([url, options.method || 'GET']);
      if (url.endsWith('/auth/v1/user')) return {ok: true, json: async () => ({id: 'user-1'})};
      if (url.includes('/billing_subscriptions')) return {ok: true,
        text: async () => JSON.stringify([{stripe_subscription_id: 'sub_other'}])};
      if (url.includes('/bank_connections')) return {ok: true, text: async () => '[]'};
      if (url.endsWith('/subscriptions/sub_other')) return {ok: true,
        json: async () => ({livemode: false, status: 'active',
          metadata: {supabase_user_id: 'user-2'},
          items: {data: [{price: {id: 'price_test'}}]}})};
      throw new Error('Unexpected request');
    };
    const res = fakeResponse();
    await require('../api/test-delete-data')({method: 'POST', headers: {authorization: 'Bearer sample'}}, res);
    assert.equal(res.code, 500);
    assert.equal(calls.some(([, method]) => method === 'DELETE'), false);
  } finally {
    global.fetch = originalFetch;
    for (const key of configKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('a delayed cancellation webhook does not recreate deleted billing data', async () => {
  const keys = [...configKeys, 'STRIPE_TEST_WEBHOOK_SECRET'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  const calls = [];
  try {
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_test_example', PLAID_ENV: 'sandbox',
      PLAID_CLIENT_ID: 'example', PLAID_SECRET: 'example',
      SUPABASE_SERVICE_ROLE_KEY: 'example',
      BANK_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
      VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'linked-debit-accounts',
      TEST_SUPABASE_URL: 'https://exampleabc.supabase.co',
      TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      STRIPE_TEST_PRICE_ID: 'price_test', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_example',
    });
    const userId = '11111111-1111-4111-8111-111111111111';
    global.fetch = async (url, options = {}) => {
      calls.push([url, options.method || 'GET']);
      if (url.endsWith('/subscriptions/sub_canceled')) return {ok: true,
        json: async () => ({livemode: false, status: 'canceled', customer: 'cus_test',
          metadata: {supabase_user_id: userId},
          items: {data: [{price: {id: 'price_test'}}]}})};
      throw new Error('Unexpected storage request');
    };
    const raw = Buffer.from(JSON.stringify({livemode: false,
      type: 'customer.subscription.deleted', data: {object: {id: 'sub_canceled'}}}));
    const time = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac('sha256', 'whsec_example')
      .update(String(time) + '.').update(raw).digest('hex');
    const req = Readable.from([raw]);
    req.method = 'POST';
    req.headers = {'stripe-signature': 't=' + time + ',v1=' + signature};
    const res = fakeResponse();
    await require('../api/test-stripe-webhook')(req, res);
    assert.equal(res.code, 200);
    assert.equal(calls.some(([url]) => url.includes('/billing_subscriptions')), false);
  } finally {
    global.fetch = originalFetch;
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
