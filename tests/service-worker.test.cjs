'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function worker(cacheControl = '') {
  const handlers = {};
  const writes = [];
  const deleted = [];
  const response = {
    ok: true,
    headers: {get: () => cacheControl},
    clone() { return this; },
  };
  const cache = {
    open: async name => ({put: async request => writes.push([name, request.url])}),
    match: async () => null,
    keys: async () => ['money-sorted-v3', 'other'],
    delete: async name => {deleted.push(name); return true;},
  };
  const self = {
    location: {origin: 'https://money-sorted.example'},
    addEventListener: (type, callback) => {handlers[type] = callback;},
    skipWaiting() {}, clients: {claim: async () => {}},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), {
    self, caches: cache, fetch: async () => response, URL,
  });
  return {handlers, writes, deleted};
}

async function request(state, url, method = 'GET', cache = 'default') {
  const pending = [];
  const event = {
    request: {url, method, cache},
    respondWith(promise) {this.response = promise;},
    waitUntil(promise) {pending.push(promise);},
  };
  state.handlers.fetch(event);
  if (event.response) await event.response;
  await Promise.all(pending);
  return !!event.response;
}

test('service worker caches only static GETs without sensitive query strings', async () => {
  const state = worker();
  assert.equal(await request(state, 'https://money-sorted.example/', 'POST'), false);
  assert.equal(await request(state, 'https://money-sorted.example/api/test-config'), false);
  assert.equal(await request(state, 'https://money-sorted.example/?code=confirmation'), false);
  assert.equal(await request(state, 'https://money-sorted.example/', 'GET', 'no-store'), false);
  assert.equal(await request(state, 'https://another.example/index.html'), false);
  assert.equal(await request(state, 'https://money-sorted.example/index.html'), true);
  assert.deepEqual(state.writes, [['money-sorted-v4', 'https://money-sorted.example/index.html']]);
});

test('service worker clears prior caches and respects no-store responses', async () => {
  const state = worker('private, no-store');
  const pending = [];
  state.handlers.activate({waitUntil: promise => pending.push(promise)});
  await Promise.all(pending);
  assert.deepEqual(state.deleted, ['money-sorted-v3', 'other']);
  assert.equal(await request(state, 'https://money-sorted.example/privacy.html'), true);
  assert.deepEqual(state.writes, []);
});
