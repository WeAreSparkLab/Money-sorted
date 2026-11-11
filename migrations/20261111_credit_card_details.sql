-- REVIEW ONLY. Apply only after Sara explicitly approves this migration.
-- Existing cards and entries remain in place. Old card entries become starting balances.
alter table moneysorted.credit_cards
  add column if not exists credit_limit numeric(12,2) check (credit_limit >= 0),
  add column if not exists minimum_payment numeric(12,2) check (minimum_payment >= 0),
  add column if not exists payment_due_date date;

alter table moneysorted.card_items
  add column if not exists entry_type text not null default 'opening_balance',
  add column if not exists entry_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'moneysorted.card_items'::regclass
      and conname = 'card_items_entry_type_check'
  ) then
    alter table moneysorted.card_items
      add constraint card_items_entry_type_check
      check (entry_type in ('opening_balance', 'purchase', 'payment'));
  end if;
end $$;

