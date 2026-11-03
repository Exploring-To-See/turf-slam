-- 1. Reset auction failed through the API: Supabase's API role runs with pg_safeupdate, which refuses a DELETE or UPDATE with
--    no WHERE clause, even inside a function. Every statement in ts_reset now has one.
-- 2. Move a sold player to another team (and change the price) without reverting and re-auctioning.
-- Run after 0011. Safe to run more than once.

create or replace function public.ts_reset(p_include_retained boolean default false) returns void language plpgsql as $$
begin
  delete from public.ts_bids where id is not null;
  update public.ts_players set status = 'pool', team_id = null, price = null, sold_at = null, updated_at = now()
   where status in ('live', 'sold', 'unsold') or (p_include_retained and status = 'retained');
  update public.ts_players set queue_pos = null where queue_pos is not null;
  update public.ts_state set status = 'idle', current_player_id = null, current_price = 0, leading_team_id = null where id = 1;
  update public.ts_settings set started_at = null, updated_at = now() where id = 1;
  delete from public.ts_events where id is not null;
  insert into public.ts_events (kind) values ('reset');
end $$;

create or replace function public.ts_reassign_sale(p_player uuid, p_team int, p_price bigint) returns void language plpgsql as $$
declare v_p public.ts_players; v_t public.ts_teams; v_same boolean; v_after bigint; v_squad int;
begin
  select * into v_p from public.ts_players where id = p_player for update;
  if not found then raise exception 'Player not found'; end if;
  if v_p.status <> 'sold' then raise exception '% has not been sold', v_p.name; end if;
  select * into v_t from public.ts_teams where id = p_team for update;
  if not found then raise exception 'Team not found'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Enter a price above zero'; end if;
  v_same := v_p.team_id = p_team;
  v_squad := public.ts_squad(p_team) + (case when v_same then 0 else 1 end);
  if v_squad > v_t.max_squad then raise exception '% already has a full squad', v_t.name; end if;
  v_after := public.ts_spent(p_team) - (case when v_same then v_p.price else 0 end) + p_price;
  if v_after > v_t.purse_total then raise exception '% cannot afford % (purse left: %)', v_t.name, p_price, v_t.purse_total - (v_after - p_price); end if;
  if v_t.purse_total - v_after < greatest(v_t.max_squad - v_squad, 0) * public.ts_min_base() then
    raise exception '% would not have enough left to fill its squad at that price', v_t.name;
  end if;
  update public.ts_players set team_id = p_team, price = p_price, sold_at = now(), updated_at = now() where id = p_player;
  perform public.ts_log('revert', p_player, v_p.team_id, v_p.price);
  perform public.ts_log('sold', p_player, p_team, p_price);
end $$;

revoke all on function public.ts_reset(boolean) from public, anon, authenticated;
revoke all on function public.ts_reassign_sale(uuid, int, bigint) from public, anon, authenticated;
