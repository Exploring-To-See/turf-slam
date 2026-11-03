-- Players come only from the registration form. A player whose name is on the official A / B list gets that category;
-- anyone else starts with no category until an admin sets one. So category may now be empty.
-- Run after 0006_queue_start.sql. Safe to run more than once.

alter table public.ts_players alter column category drop not null;

create or replace function public.ts_open_lot(p_player uuid) returns void language plpgsql as $$
declare v_p public.ts_players; v_base bigint;
begin
  if (select started_at from public.ts_settings where id = 1) is null then raise exception 'Start the auction first'; end if;
  select * into v_p from public.ts_players where id = p_player for update;
  if not found then raise exception 'Player not found'; end if;
  if v_p.status in ('sold', 'retained') then raise exception '% is already with a team. Revert that first.', v_p.name; end if;
  if v_p.category is null then raise exception '% has no category yet. Set it on the Players page.', v_p.name; end if;
  select base_price into v_base from public.ts_categories where code = v_p.category;
  if v_base is null then raise exception 'Category % players are not sold at auction', v_p.category; end if;
  if not public.ts_paid(p_player) then raise exception '% does not have payment marked received, so cannot be auctioned', v_p.name; end if;

  update public.ts_players set status = 'pool', updated_at = now() where status = 'live' and id <> p_player;
  update public.ts_players set status = 'live', queue_pos = null, updated_at = now() where id = p_player;
  delete from public.ts_bids where player_id = p_player;
  update public.ts_state set status = 'live', current_player_id = p_player, current_price = v_base, leading_team_id = null where id = 1;
  perform public.ts_log('lot_open', p_player, null, v_base);
end $$;

-- Set or clear a player's category. A retained player keeps their team and is charged the new category's retention value.
create or replace function public.ts_set_category(p_player uuid, p_category text) returns void language plpgsql as $$
declare v_p public.ts_players; v_val bigint; v_purse bigint;
begin
  select * into v_p from public.ts_players where id = p_player for update;
  if not found then raise exception 'Player not found'; end if;
  if p_category is not null and not exists (select 1 from public.ts_categories where code = p_category) then raise exception 'Unknown category'; end if;
  if v_p.category is not distinct from p_category then return; end if;
  if v_p.status in ('live', 'sold') then raise exception 'Category of % cannot change while they are %', v_p.name, v_p.status; end if;
  if v_p.status = 'retained' then
    if p_category is null then raise exception 'A retained player needs a category'; end if;
    select retention_value into v_val from public.ts_categories where code = p_category;
    if v_val is null then raise exception 'Category % players cannot be retained', p_category; end if;
    select purse_total into v_purse from public.ts_teams where id = v_p.team_id;
    if public.ts_spent(v_p.team_id) - v_p.price + v_val > v_purse then raise exception 'The team cannot afford % as a retention', v_val; end if;
    update public.ts_players set category = p_category, price = v_val, updated_at = now() where id = p_player;
  else
    update public.ts_players set category = p_category, queue_pos = case when p_category in ('A', 'B') then queue_pos end, updated_at = now() where id = p_player;
  end if;
end $$;

-- Import one registration, with a category or with none.
create or replace function public.ts_import_one(p_reg uuid, p_category text) returns void language plpgsql as $$
begin
  if p_category is not null and not exists (select 1 from public.ts_categories where code = p_category) then raise exception 'Unknown category'; end if;
  insert into public.ts_players (registration_id, name, role, age, tournaments_played, category)
  select r.id, r.name, r.role, r.age, r.tournaments_played, p_category
    from public.registrations r where r.id = p_reg and r.status = 'received'
  on conflict (registration_id) do nothing;
end $$;

do $$
declare f text;
begin
  foreach f in array array['ts_open_lot(uuid)', 'ts_set_category(uuid,text)', 'ts_import_one(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
