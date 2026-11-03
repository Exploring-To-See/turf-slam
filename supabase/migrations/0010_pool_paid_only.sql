-- Keep the pool strictly to paid registrations.
-- A player who goes back to the pool or the unsold list without a registration, or with a registration whose payment is not
-- received (for example a retained player released or reset out of retention), is removed instead.
-- Run after 0009. Safe to run more than once.

create or replace function public.ts_drop_unregistered() returns trigger language plpgsql as $$
begin
  delete from public.ts_players p
   where p.id = new.id and p.status in ('pool', 'unsold')
     and not exists (select 1 from public.registrations r
                      where r.id = p.registration_id and r.status = 'received' and r.payment_status::text = 'verified');
  return null;
end $$;

drop trigger if exists ts_drop_unregistered_trg on public.ts_players;
create trigger ts_drop_unregistered_trg after update of status on public.ts_players
  for each row when (new.status in ('pool', 'unsold'))
  execute function public.ts_drop_unregistered();

revoke all on function public.ts_drop_unregistered() from public, anon, authenticated;

-- clear any that already exist
delete from public.ts_players p
 where p.status in ('pool', 'unsold')
   and not exists (select 1 from public.registrations r
                    where r.id = p.registration_id and r.status = 'received' and r.payment_status::text = 'verified');
