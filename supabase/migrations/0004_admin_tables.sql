-- Admin-created entries may have no images yet.
alter table public.registrations alter column photo_path drop not null;
alter table public.registrations alter column photo_type drop not null;
alter table public.registrations alter column payment_path drop not null;
alter table public.registrations alter column payment_type drop not null;
alter table public.registrations alter column client_token set default gen_random_uuid();
alter table public.registrations alter column upload_token set default encode(gen_random_bytes(18), 'hex');
alter table public.registrations add column if not exists source text not null default 'form' check (source in ('form', 'admin'));
alter table public.registrations add column if not exists updated_at timestamptz not null default now();

create table if not exists public.admin_users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  username_key  text not null unique,           -- lower-cased, single-spaced
  password_hash text not null,                  -- scrypt$N$salt$hash
  failed_count  integer not null default 0,
  locked_until  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  token_hash text primary key,                  -- sha256 of the cookie token
  admin_id   uuid not null references public.admin_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_sessions_expires_idx on public.admin_sessions (expires_at);

alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;
revoke all on public.admin_users, public.admin_sessions from anon, authenticated;

drop view if exists public.registrations_received;
create view public.registrations_received
with (security_invoker = true) as
select reference, completed_at, name, age, phone, role, jersey_size, tournaments_played, crichero_url,
       payment_status, organiser_notes, photo_path, payment_path
from public.registrations
where status = 'received'
order by completed_at desc;
