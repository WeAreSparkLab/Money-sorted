'use strict';

const {
  db, decryptToken, errorResponse, isOwnTestSubscription, method, plaid,
  requireTestConfig, send, stripe, userFromRequest,
} = require('../server/test-integrations');

module.exports = async function handler(req, res) {
  if (!method(req, res)) return;
  try {
    requireTestConfig();
    const user = await userFromRequest(req);
    const userQuery = new URLSearchParams({user_id: 'eq.' + user.id}).toString();
    const [billingRows, connectionRows] = await Promise.all([
      db('billing_subscriptions', {query: userQuery + '&select=stripe_subscription_id'}),
      db('bank_connections', {query: userQuery + '&select=*'}),
    ]);
    const subscriptionId = billingRows?.[0]?.stripe_subscription_id;
    if (subscriptionId) {
      const subscription = await stripe('/subscriptions/' + encodeURIComponent(subscriptionId), {}, 'GET');
      if (!isOwnTestSubscription(subscription, user.id)) {
        throw new Error('Subscription ownership or test price could not be verified');
      }
      if (!['canceled', 'incomplete_expired'].includes(subscription.status)) {
        await stripe('/subscriptions/' + encodeURIComponent(subscriptionId), {}, 'DELETE');
      }
    }
    for (const connection of connectionRows || []) {
      await plaid('/item/remove', {access_token: decryptToken(connection)});
      await db('bank_connections', {
        method: 'DELETE',
        query: new URLSearchParams({id: 'eq.' + connection.id, user_id: 'eq.' + user.id}).toString(),
      });
    }
    await db('billing_subscriptions', {method: 'DELETE', query: userQuery});
    return send(res, 200, {cleaned: true});
  } catch (error) {
    return errorResponse(res, error);
  }
};
