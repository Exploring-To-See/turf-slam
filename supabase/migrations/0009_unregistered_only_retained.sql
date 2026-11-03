-- A player with no registration can only exist as a team's retained player.
-- When such a player is released or reset out of retention they are removed instead of falling into the pool.
-- Run after 0008. Safe to run more than once.

create or replace function public.ts_drop_unregistered() returns trigger language plpgsql as $$
begin
  delete from public.ts_players where id = new.id and registration_id is null and status in ('pool', 'unsold');
  return null;
end $$;

drop trigger if exists ts_drop_unregistered_trg on public.ts_players;
create trigger ts_drop_unregistered_trg after update of status on public.ts_players
  for each row when (new.registration_id is null and new.status in ('pool', 'unsold'))
  execute function public.ts_drop_unregistered();

revoke all on function public.ts_drop_unregistered() from public, anon, authenticated;

-- clear any that already exist (none expected)
delete from public.ts_players where registration_id is null and status in ('pool', 'unsold');
