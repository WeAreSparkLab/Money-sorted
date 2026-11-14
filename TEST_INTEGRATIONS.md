# Linked-bank subscription test setup

This branch contains **test-only** Stripe Checkout and Plaid Sandbox endpoints. The test page is `/linked-bank-test.html`. It is not linked from the public tracker. The endpoints reject production Vercel deployments, live Stripe keys and non-Sandbox Plaid settings.

## Before any connected preview

1. The four new tables were added to the existing `sparklab-apps` project on 14 November 2026 after owner approval using `migrations/20261114_linked_debit_accounts.sql`. Existing financial rows were not modified. The new tables have RLS; browser roles have no write access, and `bank_connections` (which stores encrypted Plaid tokens) has no browser read access. Use a disposable test login within this shared project. Confirm two-user isolation before any connected preview.
2. The existing **SparkQuotes Stripe account**, in **test mode**, now has product `prod_VcsSGa5Sf9VtFI` and monthly recurring price `price_1UbchfIKcVHKjjafJpdLli5Z` at a **£1 test placeholder**. This is not the public price or a decision to bill Money, Sorted through SparkQuotes in production. The signed-in test page reconciles subscription status directly from Stripe after Checkout, so a protected preview can be tested without webhook delivery. Configure a test webhook later on a securely reachable endpoint for `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Test-mode customer portal cancellation is already enabled, effective at the end of the billing period.
3. In Plaid Dashboard, use **Sandbox** credentials. Configure the test redirect URI for the exact preview origin if the UK OAuth flow requires it. Use Plaid's test institution and fake credentials; do not connect a real account or copy live financial records.
   Plaid Sandbox Dashboard access was verified on 14 November 2026. No Plaid key was copied into source control or chat.
4. Set the following variables only for the intended Vercel **Preview** environment, in Vercel's secret store:

   | Variable | Value |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | Stripe secret beginning `sk_test_` |
   | `STRIPE_TEST_PRICE_ID` | `price_1UbchfIKcVHKjjafJpdLli5Z` (test placeholder) |
   | `STRIPE_TEST_WEBHOOK_SECRET` | Test endpoint signing secret, only when a securely reachable webhook is configured |
   | `PLAID_ENV` | `sandbox` |
   | `PLAID_CLIENT_ID` | Plaid client ID |
   | `PLAID_SECRET` | Plaid Sandbox secret |
   | `PLAID_TEST_REDIRECT_URI` | Exact registered preview callback URI, if required |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for the reviewed project |
   | `TEST_SUPABASE_URL` | Exact URL of the shared `sparklab-apps` Supabase project |
   | `TEST_SUPABASE_PUBLISHABLE_KEY` | Publishable key of that project |
   | `BANK_TOKEN_ENCRYPTION_KEY` | Fresh 32-byte random key encoded as base64 |
   | `TEST_APP_ORIGIN` | Exact HTTPS preview origin, with no trailing slash |

   Never paste any of these values into `index.html`, the test page, source control or a chat. The existing Supabase publishable key is public by design. The encryption key must be backed up securely: losing it makes stored Plaid tokens unreadable.
   Scope secrets to the `linked-debit-accounts` Preview branch only. The server also refuses to run these integrations on another Vercel preview branch or on production. The current Vercel preview is protected by Vercel Authentication; verify that protection remains enabled before adding the shared project's service-role key.
   The four non-secret settings `STRIPE_TEST_PRICE_ID`, `PLAID_ENV`, `TEST_SUPABASE_URL` and `TEST_APP_ORIGIN` are already configured on this branch only. `TEST_SUPABASE_PUBLISHABLE_KEY` and a fresh `BANK_TOKEN_ENCRYPTION_KEY` are also stored as sensitive branch-only variables. The Stripe, Plaid and Supabase server secrets are still missing, so the connected flow is disabled.
5. Use the previously confirmed disposable Supabase account in the shared project to sign into the test page. Complete Stripe Checkout with a [test card](https://docs.stripe.com/testing), confirm the signed-in status request updates entitlement, then connect a Plaid Sandbox current account. Test refresh, transaction changes, cancellation, failed payment, disconnect and a second user's isolation. Test signed webhook delivery separately once it has a securely reachable endpoint. Never use the owner's real financial records as test data.

## Known gaps before public release

- This branch has no live billing, live Plaid connection, provider webhooks, scheduled refresh, production data-deletion integration, customer terms, approved retail price or UK provider contract.
- The test page does not yet resume a UK bank OAuth redirect. Validate that flow separately before testing Lloyds or any real institution.
- The test endpoints require explicit preview-only secrets. Giving a preview server the shared project's service-role key is a stronger secret-management risk than using a separate test project. Review its deployment protection, secret scope and logs before configuring it. Never put that key in the browser or a public build log.
- The `/api/test-bank?action=sync` endpoint reads Plaid's cached account balance from `/accounts/get`. It does not promise an instant balance and does not call the potentially charged real-time Balance endpoint.
- A production implementation needs a quote-backed connection/refresh cap, provider webhook validation, token revocation during account deletion and subscription expiry, account export, retry monitoring and end-to-end tests.

## Plaid UK quote request

> We are building Money, Sorted, a UK personal finance web app. Users would connect one UK current account, starting with Lloyds, to view their balance and transactions. We need account-data access only; we will not initiate payments. Please quote UK production access for Transactions and cached account balances, plus optional Balance calls. Please specify any monthly or annual minimum, per-active-Item/connection charge, per-call Balance and refresh charges, included usage, whether failed or expired Items remain billable, Lloyds current-account coverage, consent renewal requirements, data retention terms and the steps for moving from Sandbox to production. We expect to start with a small number of users and need to know the minimum cost before setting a customer subscription price.

Do not accept a paid Plaid contract until its exact terms and projected break-even subscriber count have been reviewed.
