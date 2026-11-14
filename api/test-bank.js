'use strict';

const {
  body, db, decryptToken, encryptToken, errorResponse, method, plaid,
  requireTestConfig, send, stripe, userFromRequest,
} = require('../server/test-integrations');

async function ownConnection(userId) {
  const rows = await db('bank_connections', {
    query: new URLSearchParams({user_id: 'eq.' + userId, select: '*', limit: '1'}).toString(),
  });
  return rows?.[0] || null;
}

async function subscriptionActive(userId) {
  const rows = await db('billing_subscriptions', {
    query: new URLSearchParams({user_id: 'eq.' + userId, select: 'stripe_subscription_id'}).toString(),
  });
  const row = rows?.[0];
  if (!row?.stripe_subscription_id) return false;
  const liveState = await stripe('/subscriptions/' +
    encodeURIComponent(row.stripe_subscription_id), {}, 'GET');
  return ['active', 'trialing'].includes(liveState.status);
}

async function ownAccounts(userId) {
  return await db('bank_accounts', {
    query: new URLSearchParams({user_id: 'eq.' + userId, select: 'id,connection_id,provider_account_id,name,mask,currency,current_balance,available_balance,balance_synced_at'}).toString(),
  }) || [];
}

function eligible(account) {
  return account.type === 'depository' && account.subtype === 'checking';
}

async function storeAccounts(userId, connectionId, accounts) {
  const now = new Date().toISOString();
  const selected = accounts.filter(eligible);
  if (selected.length) {
    await db('bank_accounts', {
      method: 'POST',
      query: 'on_conflict=connection_id,provider_account_id',
      data: selected.map(account => ({
        user_id: userId, connection_id: connectionId,
        provider_account_id: account.account_id, account_type: 'checking',
        name: String(account.name || 'Current account').slice(0, 120),
        mask: account.mask || null,
        currency: account.balances?.iso_currency_code || 'GBP',
        current_balance: account.balances?.current ?? null,
        available_balance: account.balances?.available ?? null,
        balance_synced_at: now,
      })),
      preference: 'resolution=merge-duplicates,return=minimal',
    });
  }
  return selected.length;
}

async function syncTransactions(connection, userId, accessToken) {
  let cursor = connection.sync_cursor || undefined;
  const initialCursor = cursor;
  let updates;
  for (let attempt = 0; attempt < 2; attempt++) {
    cursor = initialCursor;
    updates = {added: [], modified: [], removed: []};
    try {
      for (let page = 0; page < 30; page++) {
        const result = await plaid('/transactions/sync', {
          access_token: accessToken, ...(cursor ? {cursor} : {}), count: 500,
        });
        updates.added.push(...result.added);
        updates.modified.push(...result.modified);
        updates.removed.push(...result.removed);
        cursor = result.next_cursor;
        if (!result.has_more) break;
        if (page === 29) throw new Error('Transaction sync is too large for one request');
      }
      break;
    } catch (error) {
      if (error.code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || attempt) throw error;
    }
  }
  const accounts = await ownAccounts(userId);
  const byPlaidId = new Map(accounts.filter(account => account.connection_id === connection.id)
    .map(account => [account.provider_account_id, account.id]));
  for (const removed of updates.removed) {
    const accountId = byPlaidId.get(removed.account_id);
    if (accountId) await db('bank_transactions', {
      method: 'DELETE',
      query: new URLSearchParams({
        account_id: 'eq.' + accountId,
        provider_transaction_id: 'eq.' + removed.transaction_id,
      }).toString(),
    });
  }
  const rowsById = new Map();
  for (const transaction of [...updates.added, ...updates.modified]) {
    const accountId = byPlaidId.get(transaction.account_id);
    if (!accountId) continue;
    rowsById.set(accountId + ':' + transaction.transaction_id, {
      user_id: userId, account_id: accountId,
      provider_transaction_id: transaction.transaction_id,
      transaction_date: transaction.date,
      amount: transaction.amount,
      name: String(transaction.name || 'Transaction').slice(0, 240),
      merchant_name: transaction.merchant_name || null,
      pending: !!transaction.pending,
    });
  }
  const rows = [...rowsById.values()];
  if (rows.length) await db('bank_transactions', {
    method: 'POST',
    query: 'on_conflict=account_id,provider_transaction_id',
    data: rows,
    preference: 'resolution=merge-duplicates,return=minimal',
  });
  await db('bank_connections', {
    method: 'PATCH',
    query: new URLSearchParams({id: 'eq.' + connection.id, user_id: 'eq.' + userId}).toString(),
    data: {sync_cursor: cursor || null, last_synced_at: new Date().toISOString(), status: 'connected'},
  });
}

module.exports = async function handler(req, res) {
  if (!method(req, res)) return;
  try {
    requireTestConfig();
    const user = await userFromRequest(req);
    const action = req.query?.action;
    if (!['status', 'link-token', 'exchange', 'sync', 'disconnect'].includes(action)) {
      return send(res, 400, {error: 'Unknown action'});
    }
    const connection = await ownConnection(user.id);
    if (action === 'status') {
      const accounts = await ownAccounts(user.id);
      const transactions = await db('bank_transactions', {
        query: new URLSearchParams({
          user_id: 'eq.' + user.id, select: 'account_id,transaction_date,amount,name,merchant_name,pending',
          order: 'transaction_date.desc', limit: '50',
        }).toString(),
      });
      return send(res, 200, {
        linked: !!connection, lastSyncedAt: connection?.last_synced_at || null,
        accounts, transactions: transactions || [],
      });
    }
    if (action === 'disconnect') {
      if (!connection) return send(res, 200, {disconnected: true});
      await plaid('/item/remove', {access_token: decryptToken(connection)});
      await db('bank_connections', {
        method: 'DELETE',
        query: new URLSearchParams({id: 'eq.' + connection.id, user_id: 'eq.' + user.id}).toString(),
      });
      return send(res, 200, {disconnected: true});
    }
    if (!await subscriptionActive(user.id)) {
      return send(res, 403, {error: 'A Stripe test subscription is required for Sandbox linking.'});
    }
    if (action === 'link-token') {
      if (connection) return send(res, 409, {error: 'One test bank connection is already linked.'});
      const link = await plaid('/link/token/create', {
        user: {client_user_id: user.id},
        client_name: 'Money, Sorted (test)',
        products: ['transactions'],
        country_codes: ['GB'],
        language: 'en',
        ...(process.env.PLAID_TEST_REDIRECT_URI
          ? {redirect_uri: process.env.PLAID_TEST_REDIRECT_URI} : {}),
      });
      return send(res, 200, {linkToken: link.link_token});
    }
    if (action === 'exchange') {
      if (connection) return send(res, 409, {error: 'One test bank connection is already linked.'});
      const publicToken = body(req).publicToken;
      if (typeof publicToken !== 'string' || !publicToken.startsWith('public-sandbox-')) {
        return send(res, 400, {error: 'Invalid Sandbox Link token'});
      }
      const exchange = await plaid('/item/public_token/exchange', {public_token: publicToken});
      try {
        const accountData = await plaid('/accounts/get', {access_token: exchange.access_token});
        if (!accountData.accounts?.some(eligible)) {
          await plaid('/item/remove', {access_token: exchange.access_token});
          return send(res, 400, {error: 'This test connection has no current account.'});
        }
        const inserted = await db('bank_connections', {
          method: 'POST',
          data: {
            user_id: user.id, provider: 'plaid', provider_item_id: exchange.item_id,
            ...encryptToken(exchange.access_token),
          },
          preference: 'return=representation',
        });
        const newConnection = inserted[0];
        await storeAccounts(user.id, newConnection.id, accountData.accounts);
        await syncTransactions(newConnection, user.id, exchange.access_token);
        return send(res, 200, {linked: true});
      } catch (error) {
        await db('bank_connections', {
          method: 'DELETE',
          query: new URLSearchParams({
            user_id: 'eq.' + user.id, provider_item_id: 'eq.' + exchange.item_id,
          }).toString(),
        }).catch(() => {});
        await plaid('/item/remove', {access_token: exchange.access_token}).catch(() => {});
        throw error;
      }
    }
    if (!connection) return send(res, 404, {error: 'No test bank is linked'});
    if (connection.last_synced_at && Date.now() - new Date(connection.last_synced_at).getTime() < 15 * 60_000) {
      return send(res, 429, {error: 'Refresh is available every 15 minutes.'});
    }
    const accessToken = decryptToken(connection);
    const accountData = await plaid('/accounts/get', {access_token: accessToken});
    await storeAccounts(user.id, connection.id, accountData.accounts || []);
    await syncTransactions(connection, user.id, accessToken);
    return send(res, 200, {synced: true});
  } catch (error) {
    return errorResponse(res, error);
  }
};
