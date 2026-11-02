-- Auction day additions:
--   * a queue: players can be lined up; "Bring player" takes the next one in the queue, or a random one if the queue is empty
--   * a start switch: nobody can be brought on until the auction is started from the admin console
--   * only players whose registration payment is marked received can be put up for auction
--   * category changes for retained players recompute the retention value
-- Run after 0005_auction.sql. Safe to run more than once.

alter table public.ts_players  add column if not exists queue_pos  int;
alter table public.ts_settings add column if not exists started_at timestamptz;
create index if not exists ts_players_queue_idx on public.ts_players (queue_pos) where queue_pos is not null;

alter table public.ts_events drop constraint if exists ts_events_kind_check;
alter table public.ts_events add constraint ts_events_kind_check check (kind in
  ('lot_open', 'bid', 'undo_bid', 'sold', 'unsold', 'revert', 'retain', 'unretain', 'pause', 'resume', 'reset', 'start'));

-- the card view now carries the queue position and the registration's payment state
drop view if exists public.ts_player_cards;
create view public.ts_player_cards as
select p.*, (r.photo_path is not null) as has_photo, r.photo_path, r.reference as registration_reference,
       r.payment_status::text as payment_status
from public.ts_players p
left join public.registrations r on r.id = p.registration_id;
revoke all on public.ts_player_cards from anon, authenticated;

-- true when the player came from a registration whose payment is marked received
create or replace function public.ts_paid(p_player uuid) returns boolean language sql stable as $$
  select coalesce((select r.payment_status::text = 'verified'
                     from public.ts_players p join public.registrations r on r.id = p.registration_id
                    where p.id = p_player), false)
$$;

create or replace function public.ts_open_lot(p_player uuid) returns void language plpgsql as $$
declare v_p public.ts_players; v_base bigint;
begin
  if (select started_at from public.ts_settings where id = 1) is null then raise exception 'Start the auction first'; end if;
  select * into v_p from public.ts_players where id = p_player for update;
  if not found then raise exception 'Player not found'; end if;
  if v_p.status in ('sold', 'retained') then raise exception '% is already with a team. Revert that first.', v_p.name; end if;
  select base_price into v_base from public.ts_categories where code = v_p.category;
  if v_base is null then raise exception 'Category % players are not sold at auction', v_p.category; end if;
  if not public.ts_paid(p_player) then raise exception '% does not have payment marked received, so cannot be auctioned', v_p.name; end if;

  update public.ts_players set status = 'pool', updated_at = now() where status = 'live' and id <> p_player;
  update public.ts_players set status = 'live', queue_pos = null, updated_at = now() where id = p_player;
  delete from public.ts_bids where player_id = p_player;
  update public.ts_state set status = 'live', current_player_id = p_player, current_price = v_base, leading_team_id = null where id = 1;
  perform public.ts_log('lot_open', p_player, null, v_base);
end $$;

create or replace function public.ts_start() returns void language plpgsql as $$
begin
  if (select started_at from public.ts_settings where id = 1) is not null then raise exception 'The auction has already started'; end if;
  update public.ts_settings set started_at = now(), updated_at = now() where id = 1;
  insert into public.ts_events (kind) values ('start');
end $$;

-- Change a player's category. A retained player keeps their team and is charged the new category's retention value.
create or replace function public.ts_set_category(p_player uuid, p_category text) returns void language plpgsql as $$
declare v_p public.ts_players; v_val bigint; v_purse bigint;
begin
  select * into v_p from public.ts_players where id = p_player for update;
  if not found then raise exception 'Player not found'; end if;
  if not exists (select 1 from public.ts_categories where code = p_category) then raise exception 'Unknown category'; end if;
  if v_p.category = p_category then return; end if;
  if v_p.status in ('live', 'sold') then raise exception 'Category of % cannot change while they are %', v_p.name, v_p.status; end if;
  if v_p.status = 'retained' then
    select retention_value into v_val from public.ts_categories where code = p_category;
    if v_val is null then raise exception 'Category % players cannot be retained', p_category; end if;
    select purse_total into v_purse from public.ts_teams where id = v_p.team_id;
    if public.ts_spent(v_p.team_id) - v_p.price + v_val > v_purse then raise exception 'The team cannot afford % as a retention', v_val; end if;
    update public.ts_players set category = p_category, price = v_val, updated_at = now() where id = p_player;
  else
    update public.ts_players set category = p_category, queue_pos = case when p_category in ('A', 'B') then queue_pos end, updated_at = now() where id = p_player;
  end if;
end $$;

-- Import registrations with a category each (used by "Apply the category list").
create or replace function public.ts_import_one(p_reg uuid, p_category text) returns void language plpgsql as $$
begin
  insert into public.ts_players (registration_id, name, role, age, tournaments_played, category)
  select r.id, r.name, r.role, r.age, r.tournaments_played, p_category
    from public.registrations r where r.id = p_reg and r.status = 'received'
  on conflict (registration_id) do nothing;
end $$;

create or replace function public.ts_reset(p_include_retained boolean default false) returns void language plpgsql as $$
begin
  delete from public.ts_bids;
  update public.ts_players set status = 'pool', team_id = null, price = null, sold_at = null, updated_at = now()
   where status in ('live', 'sold', 'unsold') or (p_include_retained and status = 'retained');
  update public.ts_players set queue_pos = null where queue_pos is not null;
  update public.ts_state set status = 'idle', current_player_id = null, current_price = 0, leading_team_id = null where id = 1;
  update public.ts_settings set started_at = null, updated_at = now() where id = 1;
  delete from public.ts_events;
  insert into public.ts_events (kind) values ('reset');
end $$;

do $$
declare f text;
begin
  foreach f in array array['ts_paid(uuid)', 'ts_open_lot(uuid)', 'ts_start()', 'ts_set_category(uuid,text)', 'ts_import_one(uuid,text)', 'ts_reset(boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
