-- REVIEW ONLY. Apply only after Sara explicitly approves this migration.
-- Read-only checks found no existing rows that violate these constraints.
alter table moneysorted.outgoings
  add constraint outgoings_amount_nonnegative check (amount >= 0),
  add constraint outgoings_due_day_valid check (due_day is null or due_day between 1 and 31),
  add constraint outgoings_month_first_day check (month is null or extract(day from month) = 1);

alter table moneysorted.card_items
  add constraint card_items_amount_nonnegative check (amount >= 0);

alter table moneysorted.benefit_schedules
  add constraint benefit_schedules_amount_nonnegative check (amount >= 0);

alter table moneysorted.settings
  add constraint settings_income_nonnegative check (monthly_income >= 0);

