-- The auction pool is fed by registrations only:
--   * a player is in the pool exactly while their registration is received AND payment is marked received
--   * when the payment status moves away from received (or the registration is removed) they leave the pool by themselves
--     (a player already sold or retained keeps their team, so purses stay right)
--   * the level (A+, A, B) is set by the admin on the registration or on the player; no level = unassigned
-- Run after 0007. Safe to run more than once.

alter table public.registrations add column if not exists auction_category text references public.ts_categories(code) on update cascade;
alter table public.ts_players alter column category drop not null;

-- carry the levels players already have onto their registrations
update public.registrations r set auction_category = p.category
  from public.ts_players p where p.registration_id = r.id and r.auction_category is null and p.category is not null;

-- take a registration's player out of the pool (never touches sold / retained players)
create or replace function public.ts_drop_player(p_reg uuid) returns void language plpgsql as $$
begin
  if exists (select 1 from public.ts_players where registration_id = p_reg and status = 'live') then
    update public.ts_state set status = 'idle', current_player_id = null, current_price = 0, leading_team_id = null where id = 1;
  end if;
  delete from public.ts_players where registration_id = p_reg and status in ('pool', 'unsold', 'live');
end $$;

create or replace function public.ts_sync_reg() returns trigger language plpgsql as $$
begin
  if new.status = 'received' and new.payment_status::text = 'verified' then
    insert into public.ts_players (registration_id, name, role, age, tournaments_played, category)
    values (new.id, new.name, new.role, new.age, new.tournaments_played, new.auction_category)
    on conflict (registration_id) do update set
      name = excluded.name, role = excluded.role, age = excluded.age, tournaments_played = excluded.tournaments_played,
      category = case when public.ts_players.status in ('pool', 'unsold') then excluded.category else public.ts_players.category end,
      queue_pos = case when public.ts_players.status in ('pool', 'unsold') and excluded.category in ('A', 'B') then public.ts_players.queue_pos end,
      updated_at = now();
  else
    perform public.ts_drop_player(new.id);
  end if;
  return new;
end $$;

create or replace function public.ts_sync_reg_delete() returns trigger language plpgsql as $$
begin
  perform public.ts_drop_player(old.id);
  return old;
end $$;

drop trigger if exists ts_sync_reg_trg on public.registrations;
create trigger ts_sync_reg_trg after insert or update of status, payment_status, name, role, age, tournaments_played, auction_category
  on public.registrations for each row execute function public.ts_sync_reg();
drop trigger if exists ts_sync_reg_del_trg on public.registrations;
create trigger ts_sync_reg_del_trg before delete on public.registrations for each row execute function public.ts_sync_reg_delete();

-- a level changed on the player is written back to the registration, so both screens agree
create or replace function public.ts_sync_level() returns trigger language plpgsql as $$
begin
  update public.registrations set auction_category = new.category
   where id = new.registration_id and auction_category is distinct from new.category;
  return null;
end $$;
drop trigger if exists ts_sync_level_trg on public.ts_players;
create trigger ts_sync_level_trg after update of category on public.ts_players
  for each row when (old.category is distinct from new.category and new.registration_id is not null)
  execute function public.ts_sync_level();

-- importing now only records the level; the player appears (or not) according to payment
create or replace function public.ts_import_one(p_reg uuid, p_category text) returns void language plpgsql as $$
begin
  if p_category is not null and not exists (select 1 from public.ts_categories where code = p_category) then raise exception 'Unknown category'; end if;
  update public.registrations set auction_category = p_category, updated_at = now()
   where id = p_reg and status = 'received' and auction_category is distinct from p_category;
  -- level unchanged: still make sure a paid registration has its player
  insert into public.ts_players (registration_id, name, role, age, tournaments_played, category)
  select r.id, r.name, r.role, r.age, r.tournaments_played, r.auction_category
    from public.registrations r
   where r.id = p_reg and r.status = 'received' and r.payment_status::text = 'verified'
  on conflict (registration_id) do nothing;
end $$;

create or replace function public.ts_import_registrations(p_ids uuid[], p_category text) returns int language plpgsql as $$
declare n int := 0; r uuid;
begin
  foreach r in array p_ids loop
    perform public.ts_import_one(r, p_category);
    n := n + 1;
  end loop;
  return n;
end $$;

-- people already in the pool whose payment is not received leave it now (retained and sold players stay with their teams)
delete from public.ts_players p using public.registrations r
 where r.id = p.registration_id and p.status in ('pool', 'unsold') and not (r.status = 'received' and r.payment_status::text = 'verified');

-- make sure every paid registration has its player
insert into public.ts_players (registration_id, name, role, age, tournaments_played, category)
select r.id, r.name, r.role, r.age, r.tournaments_played, r.auction_category
  from public.registrations r
 where r.status = 'received' and r.payment_status::text = 'verified'
on conflict (registration_id) do nothing;

do $$
declare f text;
begin
  foreach f in array array['ts_drop_player(uuid)', 'ts_sync_reg()', 'ts_sync_reg_delete()', 'ts_sync_level()', 'ts_import_one(uuid,text)', 'ts_import_registrations(uuid[],text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
