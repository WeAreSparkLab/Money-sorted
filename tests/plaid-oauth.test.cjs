'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const oauth = require('../linked-bank-oauth');

function storage(){
  const rows = new Map();
  return {
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: key => rows.delete(key),
  };
}

test('OAuth return uses only the original user’s short-lived Link token', () => {
  const store = storage();
  oauth.save(store, 'link-sandbox-example', 'user-1', 1000);
  assert.equal(oauth.load(store, 'user-2', 2000), null);
  assert.equal(oauth.load(store, 'user-1', 2000), 'link-sandbox-example');
  assert.equal(oauth.load(store, 'user-1', 1000 + 31 * 60 * 1000), null);
  assert.equal(oauth.load(store, 'user-1', 2000), null);
});

test('OAuth return discards malformed state and clears after completion', () => {
  const store = storage();
  store.setItem('moneysorted_plaid_oauth_test', '{bad json');
  assert.equal(oauth.load(store, 'user-1'), null);
  oauth.save(store, 'link-sandbox-another', 'user-1', 1000);
  oauth.clear(store);
  assert.equal(oauth.load(store, 'user-1', 2000), null);
});
