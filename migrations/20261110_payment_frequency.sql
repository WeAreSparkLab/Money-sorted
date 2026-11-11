-- REVIEW ONLY. Do not apply until Sara explicitly approves this migration.
-- Existing payment schedules use a 28-day interval, so the default preserves them.
-- No existing rows are deleted or rewritten.
alter table moneysorted.benefit_schedules
  add column if not exists frequency text not null default 'four_weekly';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'moneysorted.benefit_schedules'::regclass
      and conname = 'benefit_schedules_frequency_check'
  ) then
    alter table moneysorted.benefit_schedules
      add constraint benefit_schedules_frequency_check
      check (frequency in ('once', 'weekly', 'fortnightly', 'four_weekly', 'monthly'));
  end if;
end $$;

