'use strict';

const {db, errorResponse, method, requireTestConfig, send, stripe, userFromRequest} =
  require('../server/test-integrations');

async function refreshSubscription(user, record) {
  if (!record?.stripe_customer_id) return record;
  const subscriptions = await stripe('/subscriptions?' + new URLSearchParams({
    customer: record.stripe_customer_id, status: 'all', limit: '100',
  }), {}, 'GET');
  const subscription = subscriptions.data?.find(sub =>
    sub.metadata?.supabase_user_id === user.id &&
    sub.items?.data?.some(item => item.price?.id === process.env.STRIPE_TEST_PRICE_ID));
  const periodEnd = subscription?.items?.data?.[0]?.current_period_end ||
    subscription?.current_period_end;
  const updated = {
    user_id: user.id,
    stripe_customer_id: record.stripe_customer_id,
    stripe_subscription_id: subscription?.id || null,
    status: subscription?.status || 'none',
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: !!subscription?.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  await db('billing_subscriptions', {
    method: 'POST', query: 'on_conflict=user_id', data: updated,
    preference: 'resolution=merge-duplicates,return=minimal',
  });
  return updated;
}

module.exports = async function handler(req, res) {
  if (!method(req, res)) return;
  try {
    requireTestConfig();
    const user = await userFromRequest(req);
    const action = req.query?.action;
    const rows = await db('billing_subscriptions', {
      query: new URLSearchParams({user_id: 'eq.' + user.id, select: '*'}).toString(),
    });
    let record = rows?.[0];
    if (action === 'status') {
      record = await refreshSubscription(user, record);
      return send(res, 200, {
        status: record?.status || 'none',
        currentPeriodEnd: record?.current_period_end || null,
        cancelAtPeriodEnd: !!record?.cancel_at_period_end,
      });
    }
    if (!['checkout', 'portal'].includes(action)) return send(res, 400, {error: 'Unknown action'});
    if (!process.env.TEST_APP_ORIGIN || !/^https:\/\//.test(process.env.TEST_APP_ORIGIN)) {
      throw new Error('Test app origin is not configured');
    }
    let customerId = record?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe('/customers', {
        email: user.email || '',
        'metadata[supabase_user_id]': user.id,
      });
      customerId = customer.id;
      await db('billing_subscriptions', {
        method: 'POST',
        query: 'on_conflict=user_id',
        data: {user_id: user.id, stripe_customer_id: customerId},
        preference: 'resolution=merge-duplicates,return=minimal',
      });
    }
    if (action === 'portal') {
      const portal = await stripe('/billing_portal/sessions', {
        customer: customerId,
        return_url: process.env.TEST_APP_ORIGIN + '/linked-bank-test.html',
      });
      return send(res, 200, {url: portal.url});
    }
    if (!process.env.STRIPE_TEST_PRICE_ID) throw new Error('Stripe test price is not configured');
    const subscriptions = await stripe('/subscriptions?' + new URLSearchParams({
      customer: customerId, status: 'all', limit: '100',
    }), {}, 'GET');
    if (subscriptions.data?.some(sub => ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']
      .includes(sub.status))) return send(res, 409, {error: 'A test subscription already exists. Manage it instead.'});
    const checkout = await stripe('/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': process.env.STRIPE_TEST_PRICE_ID,
      'line_items[0][quantity]': '1',
      client_reference_id: user.id,
      'subscription_data[metadata][supabase_user_id]': user.id,
      success_url: process.env.TEST_APP_ORIGIN + '/linked-bank-test.html?checkout=success',
      cancel_url: process.env.TEST_APP_ORIGIN + '/linked-bank-test.html?checkout=cancelled',
    });
    return send(res, 200, {url: checkout.url});
  } catch (error) {
    return errorResponse(res, error);
  }
};
