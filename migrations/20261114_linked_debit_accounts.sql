-- Applied to the sparklab-apps project on 2026-11-14 with owner approval.
-- New tables only; existing Money, Sorted financial rows were not modified.
-- Plaid access tokens are encrypted by the server before insertion.
-- No browser role can read or write bank_connections.
create schema if not exists moneysorted;
grant usage on schema moneysorted to authenticated, service_role;

create table if not exists moneysorted.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'plaid'),
  provider_item_id text not null,
  token_ciphertext text not null,
  token_nonce text not null,
  sync_cursor text,
  status text not null default 'connected' check (status in ('connected','reauthorize','error')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id),
  unique (user_id, provider, provider_item_id),
  unique (id, user_id)
);

create table if not exists moneysorted.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_account_id text not null,
  account_type text not null check (account_type in ('checking','savings')),
  name text not null,
  mask text,
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  current_balance numeric(14,2),
  available_balance numeric(14,2),
  balance_synced_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (connection_id,user_id) references moneysorted.bank_connections(id,user_id) on delete cascade,
  unique (connection_id,provider_account_id),
  unique (id,user_id)
);

create table if not exists moneysorted.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_transaction_id text not null,
  transaction_date date not null,
  amount numeric(14,2) not null,
  name text not null,
  merchant_name text,
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (account_id,user_id) references moneysorted.bank_accounts(id,user_id) on delete cascade,
  unique (account_id,provider_transaction_id)
);

create index if not exists bank_accounts_user_id_idx on moneysorted.bank_accounts(user_id);
create index if not exists bank_transactions_account_date_idx on moneysorted.bank_transactions(account_id,transaction_date desc);

alter table moneysorted.bank_connections enable row level security;
alter table moneysorted.bank_accounts enable row level security;
alter table moneysorted.bank_transactions enable row level security;

revoke all on moneysorted.bank_connections, moneysorted.bank_accounts, moneysorted.bank_transactions from public, anon, authenticated;
grant all on moneysorted.bank_connections, moneysorted.bank_accounts, moneysorted.bank_transactions to service_role;
grant select on moneysorted.bank_accounts, moneysorted.bank_transactions to authenticated;

create policy bank_accounts_select_own on moneysorted.bank_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy bank_transactions_select_own on moneysorted.bank_transactions
  for select to authenticated using (user_id = (select auth.uid()));

-- Stripe owns billing state. The browser can inspect its own status, never set it.
create table if not exists moneysorted.billing_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'none'
    check (status in ('none','incomplete','incomplete_expired','trialing','active',
      'past_due','unpaid','canceled','paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table moneysorted.billing_subscriptions enable row level security;
revoke all on moneysorted.billing_subscriptions from public, anon, authenticated;
grant all on moneysorted.billing_subscriptions to service_role;
grant select on moneysorted.billing_subscriptions to authenticated;
create policy billing_subscriptions_select_own on moneysorted.billing_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

-- Server-side data deletion must revoke Plaid Items and cancel Stripe first,
-- then delete these rows with the service role. Do not silently extend the
-- existing client-side delete_my_financial_data() RPC to privileged tables.
