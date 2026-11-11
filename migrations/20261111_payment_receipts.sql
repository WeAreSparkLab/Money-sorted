-- REVIEW ONLY. Apply only after Sara explicitly approves this migration.
-- Stores confirmations of actual receipt separately from scheduled dates.
-- No existing financial rows are changed or deleted.
create table if not exists moneysorted.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  schedule_id uuid references moneysorted.benefit_schedules(id) on delete set null,
  payment_date date not null,
  received_on date not null,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (schedule_id, payment_date)
);

alter table moneysorted.payment_receipts enable row level security;
create policy "read own received payments"
  on moneysorted.payment_receipts for select to authenticated
  using (user_id = auth.uid());
create policy "remove own received payments"
  on moneysorted.payment_receipts for delete to authenticated
  using (user_id = auth.uid());
create policy "record payments for own schedules"
  on moneysorted.payment_receipts for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from moneysorted.benefit_schedules s
    where s.id = schedule_id and s.user_id = auth.uid()
  ));

grant select, insert, delete on moneysorted.payment_receipts to authenticated;
revoke all on moneysorted.payment_receipts from anon;

