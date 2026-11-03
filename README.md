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

## Auction (`/auction` public view, controls in Admin → Auction)
Rules from the 2026 auction book: 10 teams, 10 players each (3 retained + 7 bought), Rs 1 crore purse,
retention A+ 12,00,000 / A 9,00,000, auction categories A (base 1,00,000, step 10,000) and B (base 50,000, step 5,000),
max bid limited by the remaining purse with enough held back to fill the squad.

- Run `supabase/migrations/0005_auction.sql` (tables are all prefixed `ts_`; bidding rules are enforced in Postgres functions).
- Admin → Players: add registered players, set categories, retain players. Admin → Live control: bring on a player,
  tap a team (or keys 1-9, 0) to bid, Sold / Unsold / Undo / Pause. Admin → Teams and Rules and setup: everything editable.
- Run `supabase/migrations/0006_queue_start.sql` too: the queue, the Start auction switch, the payment check and
  category changes for retained players. The admin console and auction pages need it.
- Run `supabase/migrations/0007_category_optional.sql` too: a player can be without a category until an admin sets one.
- Admin → Players → **Categories**: the pool is only people who filled the registration form with payment received.
  The A / B list (`public/shared/roster.js`) only supplies categories; it never adds players. Anyone not on the list is
  highlighted until an admin sets their category (any category can be changed from the player's row).
  **Sync with registrations** adds paid registrations not yet in the auction, fills or corrects categories from the list,
  and makes every retained player who is not A an A+.
- Admin → Live control: **Start auction** first checks that every paid registration is in the auction with a category.
  **Add to queue** lines players up; **Bring player** (or key N) takes the next one in the queue, or a random one if it is empty.
  Only players whose payment is marked received can go under the hammer (enforced in Postgres too).
- The public page polls one tiny row (`ts_state.version`) every 2 s, so many viewers cost almost nothing.

### Player-card motion (public `/auction`, its full-screen mode, and Admin → Live control)
`public/shared/ts-stage.{js,css}` is the one place the player card, price board and animations live.
It compares each new snapshot with the last one and plays the matching move: new player (card drops in, photo reveal, light sweep,
ball rolls to the price), player swapped (old card exits), bid (price jump, ring, +step chip, leader flash, ladder row),
undo (shake), sold (card held with SOLD stamp and confetti, then sent away), unsold (greyed card, UNSOLD stamp).
All of it is switched off for visitors with "reduce motion" set.
