-- REVIEW ONLY. Apply only after Sara explicitly approves this migration.
-- Deletes only the signed-in user's Money, Sorted rows in one transaction.
-- The shared Supabase Auth identity is intentionally retained for other SparkLab apps.
create or replace function moneysorted.delete_my_financial_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
begin
  if account_id is null then
    raise exception 'Authentication required';
  end if;
  delete from moneysorted.payment_receipts where user_id = account_id;
  delete from moneysorted.card_items where user_id = account_id;
  delete from moneysorted.credit_cards where user_id = account_id;
  delete from moneysorted.benefit_schedules where user_id = account_id;
  delete from moneysorted.outgoings where user_id = account_id;
  delete from moneysorted.settings where user_id = account_id;
end;
$$;

revoke all on function moneysorted.delete_my_financial_data() from public, anon;
grant execute on function moneysorted.delete_my_financial_data() to authenticated;

