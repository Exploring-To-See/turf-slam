-- The Turf Slam player auction (rules: "Official Auction Rules, 2026 edition").
--   10 teams, 10 players each = 3 retained + 7 bought, Rs 1 crore purse per team.
--   Retention values come off the purse first: A+ 12,00,000 / A 9,00,000.
--   Auction categories A and B: base 1,00,000 / 50,000, bid step 10,000 / 5,000.
--   Max bid is limited by the remaining purse (enough is always held back to fill the squad).
--
-- Everything is prefixed ts_ so it never touches other tables in the project.
-- All access goes through the Vercel API with the service-role key; RLS is on and nothing is granted
-- to anon/authenticated, so the browser cannot read or write these tables directly.

-- ---------- rules ----------
create table if not exists public.ts_categories (
  code            text primary key check (code in ('A+', 'A', 'B')),
  label           text not null,
  base_price      bigint check (base_price is null or base_price > 0),   -- null = not sold at auction
  increment       bigint check (increment is null or increment > 0),
  retention_value bigint check (retention_value is null or retention_value > 0), -- null = cannot be retained
  sort_order      int not null default 0,
  check ((base_price is null) = (increment is null))
);
insert into public.ts_categories (code, label, base_price, increment, retention_value, sort_order) values
  ('A+', 'Category A+', null,   null,  1200000, 1),
  ('A',  'Category A',  100000, 10000, 900000,  2),
  ('B',  'Category B',  50000,  5000,  null,    3)
on conflict (code) do nothing;

create table if not exists public.ts_settings (
  id             int primary key check (id = 1),
  title          text not null default 'The Turf Slam Player Auction 2026',
  retain_per_team int not null default 3 check (retain_per_team >= 0),
  show_photos    boolean not null default true,
  updated_at     timestamptz not null default now()
);
insert into public.ts_settings (id) values (1) on conflict (id) do nothing;

-- ---------- teams ----------
create table if not exists public.ts_teams (
  id           int generated always as identity primary key,
  name         text not null check (char_length(name) between 1 and 40),
  short_name   text not null check (char_length(short_name) between 1 and 5),
  color        text not null default '#c8f03a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  captain_name text check (captain_name is null or char_length(captain_name) <= 60),
  purse_total  bigint not null default 10000000 check (purse_total >= 0),   -- Rs 1 crore
  max_squad    int not null default 10 check (max_squad > 0),
  created_at   timestamptz not null default now()
);
insert into public.ts_teams (name, short_name, color)
select 'Team ' || n, 'T' || n, (array['#c8f03a','#ff8f5a','#5ac8ff','#ffd25a','#c58bff','#ff6b8b','#5affc2','#ff5a5a','#8bb0ff','#f0a8ff'])[n]
from generate_series(1, 10) n
where not exists (select 1 from public.ts_teams);

-- ---------- players ----------
create sequence if not exists public.ts_player_serial;

create table if not exists public.ts_players (
  id              uuid primary key default gen_random_uuid(),
  serial          int not null unique default nextval('public.ts_player_serial'),
  registration_id uuid unique references public.registrations(id) on delete set null,
  name            text not null check (char_length(name) between 1 and 80),
  role            public.player_role,
  age             smallint check (age is null or age between 5 and 99),
  tournaments_played text check (tournaments_played is null or char_length(tournaments_played) <= 300),
  category        text not null references public.ts_categories(code),
  status          text not null default 'pool' check (status in ('pool', 'live', 'sold', 'unsold', 'retained')),
  team_id         int references public.ts_teams(id) on delete restrict,
  price           bigint check (price is null or price >= 0),   -- sale price, or the retention value
  sold_at         timestamptz,
  notes           text check (notes is null or char_length(notes) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status in ('sold', 'retained') and team_id is not null and price is not null)
      or (status not in ('sold', 'retained') and team_id is null and price is null))
);
create index if not exists ts_players_status_idx on public.ts_players (status);
create index if not exists ts_players_team_idx on public.ts_players (team_id);

-- ---------- live state, bids, log ----------
create table if not exists public.ts_state (
  id                int primary key check (id = 1),
  status            text not null default 'idle' check (status in ('idle', 'live', 'paused')),
  current_player_id uuid references public.ts_players(id) on delete set null,
  current_price     bigint not null default 0,
  leading_team_id   int references public.ts_teams(id) on delete set null,
  version           bigint not null default 0,       -- bumped on every change; clients poll this
  updated_at        timestamptz not null default now()
);
insert into public.ts_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.ts_bids (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references public.ts_players(id) on delete cascade,
  team_id    int not null references public.ts_teams(id) on delete cascade,
  amount     bigint not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists ts_bids_player_idx on public.ts_bids (player_id, id desc);

create table if not exists public.ts_events (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('lot_open', 'bid', 'undo_bid', 'sold', 'unsold', 'revert', 'retain', 'unretain', 'pause', 'resume', 'reset')),
  player_id   uuid references public.ts_players(id) on delete set null,
  team_id     int references public.ts_teams(id) on delete set null,
  amount      bigint,
  player_name text,
  team_name   text,
  created_at  timestamptz not null default now()
);
create index if not exists ts_events_id_idx on public.ts_events (id desc);

-- Any change anywhere bumps ts_state.version once per statement, so a viewer can poll one tiny row.
create or replace function public.ts_bump() returns trigger language plpgsql as $$
begin
  update public.ts_state set version = version + 1, updated_at = now() where id = 1;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ts_players', 'ts_teams', 'ts_bids', 'ts_events', 'ts_categories', 'ts_settings'] loop
    execute format('drop trigger if exists ts_bump_trg on public.%I', t);
    execute format('create trigger ts_bump_trg after insert or update or delete on public.%I for each statement execute function public.ts_bump()', t);
  end loop;
end $$;

-- ---------- helpers ----------
create or replace function public.ts_spent(p_team int) returns bigint language sql stable as $$
  select coalesce(sum(price), 0)::bigint from public.ts_players where team_id = p_team and status in ('sold', 'retained')
$$;
create or replace function public.ts_squad(p_team int) returns int language sql stable as $$
  select count(*)::int from public.ts_players where team_id = p_team and status in ('sold', 'retained')
$$;
create or replace function public.ts_min_base() returns bigint language sql stable as $$
  select coalesce(min(base_price), 0) from public.ts_categories where base_price is not null
$$;
-- Purse left, minus the cheapest possible price for every other empty squad place.
create or replace function public.ts_max_bid(p_team int) returns bigint language sql stable as $$
  select coalesce((
    select greatest(0, t.purse_total - public.ts_spent(t.id)
             - greatest(t.max_squad - public.ts_squad(t.id) - 1, 0) * public.ts_min_base())
      from public.ts_teams t
     where t.id = p_team and public.ts_squad(t.id) < t.max_squad
  ), 0)
$$;

create or replace view public.ts_team_summary as
select t.id, t.name, t.short_name, t.color, t.captain_name, t.purse_total, t.max_squad,
       public.ts_spent(t.id) as spent,
       t.purse_total - public.ts_spent(t.id) as purse_left,
       public.ts_squad(t.id) as squad,
       t.max_squad - public.ts_squad(t.id) as slots_left,
       (select count(*)::int from public.ts_players p where p.team_id = t.id and p.status = 'retained') as retained_count,
       (select count(*)::int from public.ts_players p where p.team_id = t.id and p.status = 'sold') as bought_count,
       public.ts_max_bid(t.id) as max_bid
from public.ts_teams t
order by t.id;

create or replace view public.ts_player_cards as
select p.*, (r.photo_path is not null) as has_photo, r.photo_path, r.reference as registration_reference
from public.ts_players p
left join public.registrations r on r.id = p.registration_id;

-- ---------- auction actions (atomic; called by the API only) ----------
create or replace function public.ts_log(p_kind text, p_player uuid, p_team int, p_amount bigint) returns void
language sql as $$
  insert into public.ts_events (kind, player_id, team_id, amount, player_name, team_name)
  values (p_kind, p_player, p_team, p_amount,
          (select name from public.ts_players where id = p_player),
          (select name from public.ts_teams where id = p_team))
$$;

create or replace function public.ts_open_lot(p_player uuid) returns void language plpgsql as $$
declare v_p public.ts_players; v_base bigint;
begin
  select * into v_p from public.ts_players where id = p_player for update;
  if not found then raise exception 'Player not found'; end if;
  if v_p.status in ('sold', 'retained') then raise exception '% is already with a team. Revert that first.', v_p.name; end if;
  select base_price into v_base from public.ts_categories where code = v_p.category;
  if v_base is null then raise exception 'Category % players are not sold at auction', v_p.category; end if;

  update public.ts_players set status = 'pool', updated_at = now() where status = 'live' and id <> p_player;
  update public.ts_players set status = 'live', updated_at = now() where id = p_player;
  delete from public.ts_bids where player_id = p_player;
  update public.ts_state set status = 'live', current_player_id = p_player, current_price = v_base, leading_team_id = null where id = 1;
  perform public.ts_log('lot_open', p_player, null, v_base);
end $$;

create or replace function public.ts_place_bid(p_team int, p_amount bigint default null) returns bigint language plpgsql as $$
declare v_s public.ts_state; v_p public.ts_players; v_t public.ts_teams;
        v_base bigint; v_inc bigint; v_min bigint; v_amt bigint; v_max bigint;
begin
  select * into v_s from public.ts_state where id = 1 for update;
  if v_s.status = 'paused' then raise exception 'The auction is paused'; end if;
  if v_s.status <> 'live' or v_s.current_player_id is null then raise exception 'No player is on the block'; end if;
  select * into v_t from public.ts_teams where id = p_team for update;
  if not found then raise exception 'Team not found'; end if;
  if v_s.leading_team_id = p_team then raise exception '% already holds the highest bid', v_t.name; end if;

  select * into v_p from public.ts_players where id = v_s.current_player_id;
  select base_price, increment into v_base, v_inc from public.ts_categories where code = v_p.category;
  v_min := case when v_s.leading_team_id is null then v_base else v_s.current_price + v_inc end;
  v_amt := coalesce(p_amount, v_min);
  if v_amt < v_min then raise exception 'The next bid must be at least %', v_min; end if;
  if (v_amt - v_base) % v_inc <> 0 then raise exception 'Bids go up in steps of % from the base price', v_inc; end if;
  if public.ts_squad(p_team) >= v_t.max_squad then raise exception '% already has a full squad', v_t.name; end if;
  v_max := public.ts_max_bid(p_team);
  if v_amt > v_max then raise exception '% can bid at most % (rest of the purse is held back for the empty squad places)', v_t.name, v_max; end if;

  insert into public.ts_bids (player_id, team_id, amount) values (v_p.id, p_team, v_amt);
  update public.ts_state set current_price = v_amt, leading_team_id = p_team where id = 1;
  perform public.ts_log('bid', v_p.id, p_team, v_amt);
  return v_amt;
end $$;

create or replace function public.ts_undo_bid() returns void language plpgsql as $$
declare v_s public.ts_state; v_last public.ts_bids; v_prev public.ts_bids; v_base bigint;
begin
  select * into v_s from public.ts_state where id = 1 for update;
  if v_s.current_player_id is null then raise exception 'No player is on the block'; end if;
  select * into v_last from public.ts_bids where player_id = v_s.current_player_id order by id desc limit 1;
  if not found then raise exception 'There is no bid to undo'; end if;
  delete from public.ts_bids where id = v_last.id;
  select * into v_prev from public.ts_bids where player_id = v_s.current_player_id order by id desc limit 1;
  select c.base_price into v_base from public.ts_players p join public.ts_categories c on c.code = p.category where p.id = v_s.current_player_id;
  update public.ts_state set current_price = coalesce(v_prev.amount, v_base), leading_team_id = v_prev.team_id where id = 1;
  perform public.ts_log('undo_bid', v_s.current_player_id, v_last.team_id, v_last.amount);
end $$;

create or replace function public.ts_sell(p_team int default null, p_price bigint default null) returns void language plpgsql as $$
declare v_s public.ts_state; v_p public.ts_players; v_t public.ts_teams; v_team int; v_price bigint; v_base bigint; v_max bigint;
begin
  select * into v_s from public.ts_state where id = 1 for update;
  if v_s.current_player_id is null then raise exception 'No player is on the block'; end if;
  v_team := coalesce(p_team, v_s.leading_team_id);
  if v_team is null then raise exception 'Nobody has bid yet, so there is no team to sell to'; end if;
  v_price := coalesce(p_price, v_s.current_price);
  select * into v_p from public.ts_players where id = v_s.current_player_id for update;
  select base_price into v_base from public.ts_categories where code = v_p.category;
  if v_price < v_base then raise exception 'The price cannot be below the base price of %', v_base; end if;
  select * into v_t from public.ts_teams where id = v_team for update;
  if not found then raise exception 'Team not found'; end if;
  if public.ts_squad(v_team) >= v_t.max_squad then raise exception '% already has a full squad', v_t.name; end if;
  v_max := public.ts_max_bid(v_team);
  if v_price > v_max then raise exception '% can pay at most % for this player', v_t.name, v_max; end if;

  update public.ts_players set status = 'sold', team_id = v_team, price = v_price, sold_at = now(), updated_at = now() where id = v_p.id;
  update public.ts_state set status = 'idle', current_player_id = null, current_price = 0, leading_team_id = null where id = 1;
  perform public.ts_log('sold', v_p.id, v_team, v_price);
end $$;

create or replace function public.ts_mark_unsold() returns void language plpgsql as $$
declare v_s public.ts_state;
begin
  select * into v_s from public.ts_state where id = 1 for update;
  if v_s.current_player_id is null then raise exception 'No player is on the block'; end if;
  update public.ts_players set status = 'unsold', updated_at = now() where id = v_s.current_player_id;
  update public.ts_state set status = 'idle', current_player_id = null, current_price = 0, leading_team_id = null where id = 1;
  perform public.ts_log('unsold', v_s.current_player_id, null, null);
end $$;

create or replace function public.ts_revert_sale(p_player uuid, p_to text default 'pool') returns void language plpgsql as $$
declare v_p public.ts_players;
begin
  if p_to not in ('pool', 'unsold') then raise exception 'A reverted sale goes back to the pool or to unsold'; end if;
  select * into v_p from public.ts_players where id = p_player and status = 'sold' for update;
  if not found then raise exception 'That player has not been sold'; end if;
  update public.ts_players set status = p_to, team_id = null, price = null, sold_at = null, updated_at = now() where id = p_player;
  perform public.ts_log('revert', p_player, v_p.team_id, v_p.price);
end $$;

create or replace function public.ts_set_retention(p_player uuid, p_team int) returns void language plpgsql as $$
declare v_p public.ts_players; v_t public.ts_teams; v_val bigint; v_limit int;
begin
  select * into v_p from public.ts_players where id = p_player for update;
  if not found then raise exception 'Player not found'; end if;
  if p_team is null then
    if v_p.status <> 'retained' then raise exception '% is not retained', v_p.name; end if;
    update public.ts_players set status = 'pool', team_id = null, price = null, sold_at = null, updated_at = now() where id = p_player;
    perform public.ts_log('unretain', p_player, v_p.team_id, v_p.price);
    return;
  end if;
  if v_p.status in ('live', 'sold') then raise exception '% is % right now and cannot be retained', v_p.name, v_p.status; end if;
  select retention_value into v_val from public.ts_categories where code = v_p.category;
  if v_val is null then raise exception 'Category % players cannot be retained', v_p.category; end if;
  select * into v_t from public.ts_teams where id = p_team for update;
  if not found then raise exception 'Team not found'; end if;
  select retain_per_team into v_limit from public.ts_settings where id = 1;
  if (select count(*) from public.ts_players where team_id = p_team and status = 'retained' and id <> p_player) >= v_limit then
    raise exception '% already has % retained players', v_t.name, v_limit;
  end if;
  if public.ts_squad(p_team) - (case when v_p.team_id = p_team then 1 else 0 end) >= v_t.max_squad then raise exception '% already has a full squad', v_t.name; end if;
  if public.ts_spent(p_team) - (case when v_p.team_id = p_team then coalesce(v_p.price, 0) else 0 end) + v_val > v_t.purse_total then
    raise exception '% does not have % left in the purse', v_t.name, v_val;
  end if;
  update public.ts_players set status = 'retained', team_id = p_team, price = v_val, sold_at = null, updated_at = now() where id = p_player;
  perform public.ts_log('retain', p_player, p_team, v_val);
end $$;

create or replace function public.ts_set_paused(p_paused boolean) returns void language plpgsql as $$
declare v_s public.ts_state;
begin
  select * into v_s from public.ts_state where id = 1 for update;
  if p_paused and v_s.status = 'live' then
    update public.ts_state set status = 'paused' where id = 1; perform public.ts_log('pause', v_s.current_player_id, null, null);
  elsif not p_paused and v_s.status = 'paused' then
    update public.ts_state set status = 'live' where id = 1; perform public.ts_log('resume', v_s.current_player_id, null, null);
  end if;
end $$;

create or replace function public.ts_reset(p_include_retained boolean default false) returns void language plpgsql as $$
begin
  delete from public.ts_bids;
  update public.ts_players set status = 'pool', team_id = null, price = null, sold_at = null, updated_at = now()
   where status in ('live', 'sold', 'unsold') or (p_include_retained and status = 'retained');
  update public.ts_state set status = 'idle', current_player_id = null, current_price = 0, leading_team_id = null where id = 1;
  delete from public.ts_events;
  insert into public.ts_events (kind) values ('reset');
end $$;

-- Pull registered players into the auction pool (skips anyone already imported).
create or replace function public.ts_import_registrations(p_ids uuid[], p_category text) returns int language plpgsql as $$
declare n int;
begin
  if not exists (select 1 from public.ts_categories where code = p_category) then raise exception 'Unknown category'; end if;
  insert into public.ts_players (registration_id, name, role, age, tournaments_played, category)
  select r.id, r.name, r.role, r.age, r.tournaments_played, p_category
    from public.registrations r
   where r.id = any (p_ids) and r.status = 'received'
   order by r.completed_at
  on conflict (registration_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- lock everything down ----------
alter table public.ts_categories enable row level security;
alter table public.ts_settings   enable row level security;
alter table public.ts_teams      enable row level security;
alter table public.ts_players    enable row level security;
alter table public.ts_state      enable row level security;
alter table public.ts_bids       enable row level security;
alter table public.ts_events     enable row level security;
revoke all on public.ts_categories, public.ts_settings, public.ts_teams, public.ts_players, public.ts_state,
              public.ts_bids, public.ts_events, public.ts_team_summary, public.ts_player_cards from anon, authenticated;
revoke all on sequence public.ts_player_serial from anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'ts_bump()', 'ts_spent(int)', 'ts_squad(int)', 'ts_min_base()', 'ts_max_bid(int)', 'ts_log(text,uuid,int,bigint)',
    'ts_open_lot(uuid)', 'ts_place_bid(int,bigint)', 'ts_undo_bid()', 'ts_sell(int,bigint)', 'ts_mark_unsold()',
    'ts_revert_sale(uuid,text)', 'ts_set_retention(uuid,int)', 'ts_set_paused(boolean)', 'ts_reset(boolean)',
    'ts_import_registrations(uuid[],text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
