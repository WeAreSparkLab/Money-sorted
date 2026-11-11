-- REVIEW ONLY. Apply only after Sara explicitly approves this migration.
-- Adds stable recurring-series IDs without changing existing names, amounts or dates.
alter table moneysorted.outgoings
  add column if not exists recurring_id uuid;

create unique index if not exists outgoings_one_row_per_series_month
  on moneysorted.outgoings (user_id, month, recurring_id)
  where recurring_id is not null;

alter table moneysorted.settings
  add column if not exists last_carry_month date;

