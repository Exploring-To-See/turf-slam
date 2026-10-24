-- Admin console: login tables, 'due' payment state, and room for admin-created entries (no images required).
-- NOTE: `alter type ... add value` must run on its own (outside a transaction block in older Postgres).
alter type public.payment_status add value if not exists 'due';
