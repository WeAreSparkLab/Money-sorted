'use strict';

const {db, errorResponse, method, requireTestConfig, send, stripe, verifyStripeSignature} =
  require('../server/test-integrations');

async function readRaw(req) {
  const parts = [];
  for await (const chunk of req) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

async function syncSubscription(id) {
  const subscription = await stripe('/subscriptions/' + encodeURIComponent(id), {}, 'GET');
  const userId = subscription.metadata?.supabase_user_id;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(userId || '')) throw new Error('Unmapped test subscription');
  const periodEnd = subscription.items?.data?.[0]?.current_period_end ||
    subscription.current_period_end;
  await db('billing_subscriptions', {
    method: 'POST',
    query: 'on_conflict=user_id',
    data: {
      user_id: userId,
      stripe_customer_id: subscription.customer,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: !!subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    preference: 'resolution=merge-duplicates,return=minimal',
  });
}

module.exports = async function handler(req, res) {
  if (!method(req, res)) return;
  try {
    requireTestConfig();
    if (!process.env.STRIPE_TEST_WEBHOOK_SECRET?.startsWith('whsec_')) {
      throw new Error('Stripe test webhook is not configured');
    }
    const raw = await readRaw(req);
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'],
      process.env.STRIPE_TEST_WEBHOOK_SECRET)) return send(res, 400, {error: 'Invalid signature'});
    const event = JSON.parse(raw.toString('utf8'));
    if (!event.livemode && event.type?.startsWith('customer.subscription.')) {
      await syncSubscription(event.data.object.id);
    } else if (event.livemode) {
      return send(res, 400, {error: 'Live events are not accepted here'});
    }
    return send(res, 200, {received: true});
  } catch (error) {
    return errorResponse(res, error);
  }
};
module.exports.config = {api: {bodyParser: false}};
