const { db } = require("./supabase");

const PLAYER_COLS = "id, serial, name, role, age, tournaments_played, category, status, team_id, price, sold_at, has_photo";
const PLAYER_COLS_ADMIN = PLAYER_COLS + ", notes, registration_id, registration_reference, queue_pos, payment_status";

async function one(q) {
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

async function currentVersion() {
  const row = await one(db().from("ts_state").select("version").eq("id", 1).single());
  return Number(row.version);
}

// Everything a screen needs in one object. `admin` adds notes and the list of registrations.
async function snapshot({ admin = false } = {}) {
  const sb = db();
  const [state, teams, players, categories, settings, events] = await Promise.all([
    one(sb.from("ts_state").select("*").eq("id", 1).single()),
    one(sb.from("ts_team_summary").select("*")),
    one(sb.from("ts_player_cards").select(admin ? PLAYER_COLS_ADMIN : PLAYER_COLS).order("serial")),
    one(sb.from("ts_categories").select("*").order("sort_order")),
    one(sb.from("ts_settings").select("*").eq("id", 1).single()),
    one(sb.from("ts_events").select("id, kind, player_id, team_id, amount, player_name, team_name, created_at").order("id", { ascending: false }).limit(60)),
  ]);
  const bids = state.current_player_id
    ? await one(sb.from("ts_bids").select("id, team_id, amount, created_at").eq("player_id", state.current_player_id).order("id", { ascending: false }).limit(12))
    : [];
  if (!settings.show_photos && !admin) players.forEach((p) => (p.has_photo = false));

  const snap = {
    v: Number(state.version),
    now: new Date().toISOString(),
    title: settings.title,
    settings: { retain_per_team: settings.retain_per_team, show_photos: settings.show_photos, started_at: settings.started_at || null },
    categories,
    state: { status: state.status, player_id: state.current_player_id, price: Number(state.current_price), leading_team_id: state.leading_team_id, bids },
    teams: teams.map((t) => ({ ...t, purse_total: Number(t.purse_total), spent: Number(t.spent), purse_left: Number(t.purse_left), max_bid: Number(t.max_bid) })),
    players: players.map((p) => ({ ...p, price: p.price == null ? null : Number(p.price) })),
    events,
  };

  if (admin) {
    const regs = await one(sb.from("registrations")
      .select("id, reference, name, role, age, tournaments_played, payment_status, completed_at, photo_path")
      .eq("status", "received").order("completed_at", { ascending: false }).limit(2000));
    const imported = new Set(players.map((p) => p.registration_id).filter(Boolean));
    snap.registrations = regs.map((r) => ({ ...r, has_photo: !!r.photo_path, photo_path: undefined, imported: imported.has(r.id) }));
  }
  return snap;
}

module.exports = { snapshot, currentVersion, one };
