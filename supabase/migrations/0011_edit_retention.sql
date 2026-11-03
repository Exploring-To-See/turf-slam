-- Edit a retained player's level and retention price (the price no longer has to be the category's fixed value).
-- The team must still be able to afford it and keep enough in the purse to fill its squad.
-- Run after 0010. Safe to run more than once.

create or replace function public.ts_edit_retention(p_player uuid, p_category text, p_price bigint) returns void language plpgsql as $$
declare v_p public.ts_players; v_t public.ts_teams; v_after bigint;
begin
  select * into v_p from public.ts_players where id = p_player for update;
  if not found then raise exception 'Player not found'; end if;
  if v_p.status <> 'retained' then raise exception '% is not retained', v_p.name; end if;
  if p_category is null or not exists (select 1 from public.ts_categories where code = p_category) then raise exception 'Pick a level'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Enter a retention price above zero'; end if;
  select * into v_t from public.ts_teams where id = v_p.team_id for update;
  v_after := public.ts_spent(v_t.id) - coalesce(v_p.price, 0) + p_price;
  if v_after > v_t.purse_total then raise exception '% cannot afford % (purse left after the other players: %)', v_t.name, p_price, v_t.purse_total - (public.ts_spent(v_t.id) - coalesce(v_p.price, 0)); end if;
  if v_t.purse_total - v_after < greatest(v_t.max_squad - public.ts_squad(v_t.id), 0) * public.ts_min_base() then
    raise exception '% would not have enough left to fill its squad at that price', v_t.name;
  end if;
  update public.ts_players set category = p_category, price = p_price, updated_at = now() where id = p_player;
  perform public.ts_log('retain', p_player, v_t.id, p_price);
end $$;

revoke all on function public.ts_edit_retention(uuid, text, bigint) from public, anon, authenticated;
