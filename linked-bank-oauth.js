'use strict';

(function(root){
  const KEY = 'moneysorted_plaid_oauth_test';
  const MAX_AGE_MS = 30 * 60 * 1000;

  function save(storage, token, userId, now = Date.now()){
    if(!token || !userId) throw new Error('Missing test Link session');
    storage.setItem(KEY, JSON.stringify({token, userId, createdAt: now}));
  }

  function load(storage, userId, now = Date.now()){
    const raw = storage.getItem(KEY);
    if(!raw) return null;
    let state;
    try{ state = JSON.parse(raw); }
    catch{ storage.removeItem(KEY); return null; }
    if(!state || typeof state.token !== 'string' || typeof state.userId !== 'string' ||
       !Number.isFinite(state.createdAt) || now < state.createdAt ||
       now - state.createdAt > MAX_AGE_MS){
      storage.removeItem(KEY);
      return null;
    }
    return state.userId === userId ? state.token : null;
  }

  function clear(storage){ storage.removeItem(KEY); }

  const api = {save, load, clear};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MoneySortedOAuth = api;
})(typeof window !== 'undefined' ? window : globalThis);
