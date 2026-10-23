-- Adds the jersey size chosen on the form (S/M/L/XL/XXL/XXXL).
do $$ begin
  create type public.jersey_size as enum ('S', 'M', 'L', 'XL', 'XXL', 'XXXL');
exception when duplicate_object then null; end $$;

-- Nullable so rows saved before this migration stay valid; the API requires it for every new registration.
alter table public.registrations add column if not exists jersey_size public.jersey_size;

-- Recreate the organiser view with the new column.
drop view if exists public.registrations_received;
create view public.registrations_received
with (security_invoker = true) as
select reference, completed_at, name, age, phone, role, jersey_size, tournaments_played, crichero_url,
       payment_status, organiser_notes, photo_path, payment_path
from public.registrations
where status = 'received'
order by completed_at desc;
