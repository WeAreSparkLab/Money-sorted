-- REVIEW ONLY. Apply only after Sara explicitly approves this migration.
-- Stores confirmations of actual receipt separately from scheduled dates.
-- No existing financial rows are changed or deleted.
create table if not exists moneysorted.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  schedule_id uuid not null references moneysorted.benefit_schedules(id) on delete cascade,
  payment_date date not null,
  received_on date not null,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (schedule_id, payment_date)
);

alter table moneysorted.payment_receipts enable row level security;
create policy "own received payments only"
  on moneysorted.payment_receipts for all to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from moneysorted.benefit_schedules s
    where s.id = schedule_id and s.user_id = auth.uid()
  ))
  with check (user_id = auth.uid() and exists (
    select 1 from moneysorted.benefit_schedules s
    where s.id = schedule_id and s.user_id = auth.uid()
  ));

grant select, insert, delete on moneysorted.payment_receipts to authenticated;
revoke all on moneysorted.payment_receipts from anon;

