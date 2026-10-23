-- Turf Slam registration schema.
-- Run in Supabase SQL editor, or `supabase db push`.
-- All access goes through Vercel API routes using the service-role key.
-- RLS is on with no policies, so anon/authenticated roles can read or write nothing.

create extension if not exists pgcrypto;

-- ---------- enums ----------
do $$ begin
  create type public.player_role as enum ('Only batter', 'Only bowler', 'All rounder', 'Wicket keeper');
exception when duplicate_object then null; end $$;

do $$ begin
  -- pending  = row created, images maybe still uploading (not a real registration yet)
  -- received = both images confirmed in storage; shown to organisers
  create type public.registration_status as enum ('pending', 'received');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('awaiting_review', 'verified', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------- table ----------
create table if not exists public.registrations (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique,
  client_token       uuid not null unique,          -- makes retries idempotent
  upload_token       text not null,                 -- secret needed for complete/abort
  status             public.registration_status not null default 'pending',
  payment_status     public.payment_status not null default 'awaiting_review',

  name               text not null check (char_length(name) between 2 and 80),
  age                smallint not null check (age between 5 and 99),
  phone              text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  role               public.player_role not null,
  tournaments_played text not null check (char_length(tournaments_played) between 2 and 300),
  crichero_url       text check (crichero_url is null or char_length(crichero_url) <= 300),
  consent            boolean not null check (consent),

  photo_path         text not null,
  photo_type         text not null check (photo_type in ('image/jpeg', 'image/png', 'image/webp')),
  payment_path       text not null,
  payment_type       text not null check (payment_type in ('image/jpeg', 'image/png', 'image/webp')),

  organiser_notes    text,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create index if not exists registrations_status_created_idx on public.registrations (status, created_at desc);
create index if not exists registrations_phone_idx on public.registrations (phone);

alter table public.registrations enable row level security;
revoke all on public.registrations from anon, authenticated;

-- ---------- private storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('registrations', 'registrations', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
-- No storage.objects policies: only signed upload URLs (issued by the API) and the service role can write.

-- ---------- organiser view (use from the Supabase dashboard; not exposed to anon) ----------
create or replace view public.registrations_received
with (security_invoker = true) as
select reference, completed_at, name, age, phone, role, tournaments_played, crichero_url,
       payment_status, organiser_notes, photo_path, payment_path
from public.registrations
where status = 'received'
order by completed_at desc;

-- ---------- housekeeping ----------
-- Drops abandoned pending rows (and any images they uploaded) older than 24h.
-- Schedule with pg_cron:  select cron.schedule('turf-slam-purge', '17 * * * *', 'select public.purge_stale_pending()');
create or replace function public.purge_stale_pending()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare n integer;
begin
  delete from storage.objects
   where bucket_id = 'registrations'
     and (storage.foldername(name))[1] in (
       select id::text from public.registrations
        where status = 'pending' and created_at < now() - interval '24 hours');
  delete from public.registrations
   where status = 'pending' and created_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_stale_pending() from public, anon, authenticated;
