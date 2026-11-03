-- Payment status no longer decides who can be auctioned: the admin can put any player under the hammer.
-- Run after 0006_queue_start.sql. Safe to run more than once.

create or replace function public.ts_open_lot(p_player uuid) returns void language plpgsql as $$
declare v_p public.ts_players; v_base bigint;
begin
  if (select started_at from public.ts_settings where id = 1) is null then raise exception 'Start the auction first'; end if;
  select * into v_p from public.ts_players where id = p_player for update;
  if not found then raise exception 'Player not found'; end if;
  if v_p.status in ('sold', 'retained') then raise exception '% is already with a team. Revert that first.', v_p.name; end if;
  select base_price into v_base from public.ts_categories where code = v_p.category;
  if v_base is null then raise exception 'Category % players are not sold at auction', v_p.category; end if;

  update public.ts_players set status = 'pool', updated_at = now() where status = 'live' and id <> p_player;
  update public.ts_players set status = 'live', queue_pos = null, updated_at = now() where id = p_player;
  delete from public.ts_bids where player_id = p_player;
  update public.ts_state set status = 'live', current_player_id = p_player, current_price = v_base, leading_team_id = null where id = 1;
  perform public.ts_log('lot_open', p_player, null, v_base);
end $$;
