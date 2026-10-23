const { createClient } = require("@supabase/supabase-js");

const BUCKET = "registrations";
let client;

function db() {
  if (!client) {
    // Vercel's Supabase integration prefixes names with STORAGE_ ; plain names also work.
    const env = process.env;
    const url = env.SUPABASE_URL || env.NEXT_PUBLIC_STORAGE_SUPABASE_URL || env.STORAGE_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.STORAGE_SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase URL and service-role key env vars are not set.");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

module.exports = { db, BUCKET };
