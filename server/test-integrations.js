'use strict';

const crypto = require('node:crypto');

const schema = 'moneysorted';

function publicTestConfig() {
  if (process.env.VERCEL_ENV === 'production') throw new Error('Test integrations are disabled in production');
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url || '') || !key?.startsWith('sb_publishable_')) {
    throw new Error('Test Supabase project is not configured');
  }
  return {url, key};
}

function requireTestConfig() {
  publicTestConfig();
  if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Stripe test mode is not configured');
  if (process.env.PLAID_ENV !== 'sandbox' || !process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    throw new Error('Plaid Sandbox is not configured');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.BANK_TOKEN_ENCRYPTION_KEY) {
    throw new Error('Server-side storage is not configured');
  }
  const key = Buffer.from(process.env.BANK_TOKEN_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('Invalid encryption configuration');
  return key;
}

function send(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(payload));
}

function method(req, res) {
  if (req.method === 'POST') return true;
  res.setHeader('Allow', 'POST');
  send(res, 405, {error: 'Method not allowed'});
  return false;
}

function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return {};
}

async function userFromRequest(req) {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  if (!match) throw Object.assign(new Error('Sign in required'), {status: 401});
  const {url, key} = publicTestConfig();
  const response = await fetch(url + '/auth/v1/user', {
    headers: {apikey: key, Authorization: `Bearer ${match[1]}`},
  });
  if (!response.ok) throw Object.assign(new Error('Session expired'), {status: 401});
  const user = await response.json();
  if (!user.id) throw Object.assign(new Error('Session expired'), {status: 401});
  return user;
}

async function db(table, {method = 'GET', query = '', data, preference} = {}) {
  const response = await fetch(`${publicTestConfig().url}/rest/v1/${table}${query ? '?' + query : ''}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Accept-Profile': schema,
      'Content-Profile': schema,
      'Content-Type': 'application/json',
      ...(preference ? {Prefer: preference} : {}),
    },
    ...(data === undefined ? {} : {body: JSON.stringify(data)}),
  });
  if (!response.ok) throw new Error(`Storage operation failed (${response.status})`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function stripe(path, params, method = 'POST') {
  const response = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(method === 'POST' ? {'Content-Type': 'application/x-www-form-urlencoded'} : {}),
    },
    ...(method === 'POST' ? {body: new URLSearchParams(params)} : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'Stripe request failed');
  return result;
}

async function plaid(path, params) {
  const response = await fetch('https://sandbox.plaid.com' + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...params}),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error_message || 'Plaid request failed');
    error.code = result.error_code;
    throw error;
  }
  return result;
}

function encryptToken(token) {
  const key = requireTestConfig();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    token_ciphertext: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
    token_nonce: nonce.toString('base64'),
  };
}

function decryptToken(row) {
  const key = requireTestConfig();
  const all = Buffer.from(row.token_ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.token_nonce, 'base64'));
  decipher.setAuthTag(all.subarray(all.length - 16));
  return decipher.update(all.subarray(0, all.length - 16), undefined, 'utf8') + decipher.final('utf8');
}

function verifyStripeSignature(raw, header, secret, now = Date.now()) {
  const parts = String(header || '').split(',').map(part => part.trim().split('='));
  const time = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(time) || Math.abs(now / 1000 - time) > 300 || !signatures.length) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${time}.`).update(raw).digest('hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return signatures.some(signature => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const actual = Buffer.from(signature, 'hex');
    return crypto.timingSafeEqual(actual, expectedBytes);
  });
}

function errorResponse(res, error) {
  if (error.status === 401) return send(res, 401, {error: error.message});
  // Provider responses and internal errors may include sensitive details.
  console.error('Test integration failed:', error.code || error.status || error.name || 'unknown');
  return send(res, 500, {error: 'This test feature is unavailable. Please try again later.'});
}

module.exports = {
  body, db, decryptToken, encryptToken, errorResponse, method, plaid,
  publicTestConfig, requireTestConfig, send, stripe, userFromRequest, verifyStripeSignature,
};
