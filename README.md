# The Turf Slam — player registration

Static page (`public/`) + Vercel serverless functions (`api/`) + Supabase (Postgres + private Storage).

## Flow
1. `POST /api/register/start` validates details, inserts a `pending` row, returns signed upload URLs.
2. Browser PUTs photo + payment screenshot straight to the private `registrations` bucket.
3. `POST /api/register/complete` checks both files exist, marks the row `received`, returns the reference.
   `POST /api/register/abort` cleans up if uploads fail.

## Deploy
1. Create a Supabase project. SQL editor → run `supabase/migrations/0001_init.sql` (or `supabase db push`).
2. Optional: enable pg_cron and schedule `select public.purge_stale_pending()` (see the SQL comment).
3. Vercel → import this repo. Framework preset: Other. Add env vars from `.env.example`
   (Supabase → Project Settings → API → URL and `service_role` key).
4. Deploy. Organisers review rows in Supabase → Table editor → `registrations_received`
   and open images from Storage → `registrations` (private; use "Create signed URL").
   Set `payment_status` to `verified` / `rejected` after checking each payment.

## Local
`npm i -g vercel && npm i && vercel dev`

## Admin console (`/admin`)
Login-protected page: live list of registrations (refreshes every 5 s), mark payment received / due,
add, edit and delete entries, view photos and payment screenshots, search/filter, CSV export.

- Run `supabase/migrations/0003_admin.sql` first on its own (adds the `due` payment state), then `0004_admin_tables.sql`.
- Admin users live in the `admin_users` table (scrypt password hash, 5 wrong attempts = 15 min lock). Sessions are
  HttpOnly cookies stored hashed in `admin_sessions` (8 h). No extra env vars needed.
- To add or reset an admin, insert a row with `hashPassword()` from `api/_lib/admin.js`.
