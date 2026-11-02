const { db } = require("../_lib/supabase");
const { adminRoute } = require("../_lib/admin");
const { snapshot, currentVersion, one } = require("../_lib/auction");
const { UUID_RE } = require("../_lib/validate");
const { send } = require("../_lib/http");

const ROLES = ["Only batter", "Only bowler", "All rounder", "Wicket keeper"];
const CATS = ["A+", "A", "B"];
const bad = (message) => Object.assign(new Error(message), { user: true });
const int = (v, label, { min = 0, max = 1e12, optional = false } = {}) => {
  if ((v === null || v === undefined || v === "") && optional) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}.`);
  return n;
};

function playerFields(b, { partial }) {
  const out = {};
  if (!partial || "name" in b) {
    const name = String(b.name ?? "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) throw bad("Enter a player name (up to 80 characters).");
    out.name = name;
  }
  if (!partial || "role" in b) {
    if (b.role && !ROLES.includes(b.role)) throw bad("Pick a valid role.");
    out.role = b.role || null;
  }
  if (!partial || "age" in b) out.age = int(b.age, "Age", { min: 5, max: 99, optional: true });
  if (!partial || "tournaments_played" in b) out.tournaments_played = String(b.tournaments_played ?? "").trim().slice(0, 300) || null;
  if (!partial || "category" in b) {
    if (!CATS.includes(b.category)) throw bad("Pick a category.");
    out.category = b.category;
  }
  if ("notes" in b) out.notes = String(b.notes ?? "").trim().slice(0, 500) || null;
  return out;
}

const actions = {
  // ----- the block -----
  async open_lot(sb, b) { await one(sb.rpc("ts_open_lot", { p_player: b.player_id })); },
  async random(sb, b) {
    for (const status of ["pool", "unsold"]) {
      let q = sb.from("ts_players").select("id, category").eq("status", status).in("category", ["A", "B"]);
      if (b.category && ["A", "B"].includes(b.category)) q = q.eq("category", b.category);
      const rows = await one(q);
      if (rows.length) { await one(sb.rpc("ts_open_lot", { p_player: rows[Math.floor(Math.random() * rows.length)].id })); return; }
    }
    throw bad("No players left to bring on" + (b.category ? ` in category ${b.category}` : "") + ".");
  },
  async bid(sb, b) { await one(sb.rpc("ts_place_bid", { p_team: int(b.team_id, "Team", { min: 1 }), p_amount: b.amount ? int(b.amount, "Amount", { min: 1 }) : null })); },
  async undo_bid(sb) { await one(sb.rpc("ts_undo_bid")); },
  async sell(sb, b) { await one(sb.rpc("ts_sell", { p_team: b.team_id ? int(b.team_id, "Team", { min: 1 }) : null, p_price: b.price ? int(b.price, "Price", { min: 1 }) : null })); },
  async unsold(sb) { await one(sb.rpc("ts_mark_unsold")); },
  async revert(sb, b) { await one(sb.rpc("ts_revert_sale", { p_player: b.player_id, p_to: b.to === "unsold" ? "unsold" : "pool" })); },
  async pause(sb, b) { await one(sb.rpc("ts_set_paused", { p_paused: !!b.paused })); },
  async retain(sb, b) { await one(sb.rpc("ts_set_retention", { p_player: b.player_id, p_team: b.team_id ? int(b.team_id, "Team", { min: 1 }) : null })); },
  async reset(sb, b) {
    if (b.confirm !== "RESET") throw bad("Type RESET to confirm.");
    await one(sb.rpc("ts_reset", { p_include_retained: !!b.include_retained }));
  },

  // ----- players -----
  async import(sb, b) {
    const ids = Array.isArray(b.registration_ids) ? b.registration_ids.filter((x) => UUID_RE.test(String(x))) : [];
    if (!ids.length) throw bad("Select at least one registered player.");
    if (!CATS.includes(b.category)) throw bad("Pick a category for the imported players.");
    await one(sb.rpc("ts_import_registrations", { p_ids: ids, p_category: b.category }));
  },
  async add_player(sb, b) { await one(sb.from("ts_players").insert(playerFields(b, { partial: false }))); },
  async update_player(sb, b) {
    if (!UUID_RE.test(String(b.id))) throw bad("Bad request.");
    const f = playerFields(b, { partial: true });
    const cur = await one(sb.from("ts_players").select("status, category").eq("id", b.id).single());
    if ("category" in f && f.category !== cur.category && ["live", "sold", "retained"].includes(cur.status)) {
      throw bad(`Category can't change while the player is ${cur.status}. Revert them to the pool first.`);
    }
    await one(sb.from("ts_players").update({ ...f, updated_at: new Date().toISOString() }).eq("id", b.id));
  },
  async delete_player(sb, b) {
    if (!UUID_RE.test(String(b.id))) throw bad("Bad request.");
    const cur = await one(sb.from("ts_players").select("status").eq("id", b.id).single());
    if (cur.status === "live") throw bad("This player is on the block. Mark them sold or unsold first.");
    await one(sb.from("ts_players").delete().eq("id", b.id));
  },

  // ----- teams -----
  async add_team(sb, b) {
    const { count } = await sb.from("ts_teams").select("id", { count: "exact", head: true });
    if (count >= 32) throw bad("That's the most teams supported.");
    await one(sb.from("ts_teams").insert({ name: `Team ${count + 1}`, short_name: `T${count + 1}`, color: "#c8f03a" }));
  },
  async update_team(sb, b) {
    const id = int(b.id, "Team", { min: 1 });
    const f = {};
    if ("name" in b) { const v = String(b.name).trim(); if (!v || v.length > 40) throw bad("Team name must be 1 to 40 characters."); f.name = v; }
    if ("short_name" in b) { const v = String(b.short_name).trim().toUpperCase(); if (!v || v.length > 5) throw bad("Short name must be 1 to 5 characters."); f.short_name = v; }
    if ("color" in b) { if (!/^#[0-9a-fA-F]{6}$/.test(b.color)) throw bad("Pick a valid colour."); f.color = b.color; }
    if ("captain_name" in b) f.captain_name = String(b.captain_name ?? "").trim().slice(0, 60) || null;
    if ("purse_total" in b || "max_squad" in b) {
      const [t] = await one(sb.from("ts_team_summary").select("spent, squad").eq("id", id));
      if ("purse_total" in b) { f.purse_total = int(b.purse_total, "Purse", { min: 0 }); if (f.purse_total < t.spent) throw bad("The purse can't be lower than what the team has already spent."); }
      if ("max_squad" in b) { f.max_squad = int(b.max_squad, "Squad size", { min: 1, max: 50 }); if (f.max_squad < t.squad) throw bad("The squad size can't be lower than the players the team already has."); }
    }
    await one(sb.from("ts_teams").update(f).eq("id", id));
  },
  async delete_team(sb, b) {
    const id = int(b.id, "Team", { min: 1 });
    const { count } = await sb.from("ts_players").select("id", { count: "exact", head: true }).eq("team_id", id);
    if (count) throw bad("This team has players. Revert or unretain them first.");
    await one(sb.from("ts_teams").delete().eq("id", id));
  },
  async set_purse_all(sb, b) {
    const purse = int(b.purse_total, "Purse", { min: 0 });
    const over = (await one(sb.from("ts_team_summary").select("name, spent"))).filter((t) => t.spent > purse);
    if (over.length) throw bad(`${over[0].name} has already spent more than that.`);
    await one(sb.from("ts_teams").update({ purse_total: purse }).gte("id", 0));
  },

  // ----- rules -----
  async update_categories(sb, b) {
    for (const r of b.rows || []) {
      if (!CATS.includes(r.code)) throw bad("Unknown category.");
      const base = int(r.base_price, "Base price", { min: 1, optional: true });
      const inc = int(r.increment, "Bid step", { min: 1, optional: true });
      if ((base === null) !== (inc === null)) throw bad(`Category ${r.code}: set both a base price and a bid step, or neither.`);
      const ret = int(r.retention_value, "Retention value", { min: 1, optional: true });
      await one(sb.from("ts_categories").update({ base_price: base, increment: inc, retention_value: ret }).eq("code", r.code));
    }
  },
  async update_settings(sb, b) {
    const f = {};
    if ("title" in b) { const v = String(b.title).trim(); if (!v || v.length > 120) throw bad("Title must be 1 to 120 characters."); f.title = v; }
    if ("retain_per_team" in b) f.retain_per_team = int(b.retain_per_team, "Retained players per team", { min: 0, max: 20 });
    if ("show_photos" in b) f.show_photos = !!b.show_photos;
    await one(sb.from("ts_settings").update({ ...f, updated_at: new Date().toISOString() }).eq("id", 1));
  },
};

// GET  /api/admin/auction[?since=v]  -> full admin snapshot (or {changed:false})
// POST /api/admin/auction {action, ...} -> runs it, returns the fresh snapshot
module.exports = adminRoute(["GET", "POST"], async (req, res, body, admin) => {
  if (req.method === "GET") {
    const since = req.query && req.query.since;
    if (since !== undefined && Number(since) === (await currentVersion())) return send(res, 200, { ok: true, changed: false, v: Number(since) });
    return send(res, 200, { ok: true, changed: true, admin: admin.name, ...(await snapshot({ admin: true })) });
  }
  const fn = actions[body.action];
  if (!fn) return send(res, 400, { ok: false, message: "Unknown action." });
  try {
    await fn(db(), body);
  } catch (e) {
    // plpgsql `raise exception` (P0001) and our own validation errors are meant for the admin to read
    if (e.user || e.code === "P0001") return send(res, 400, { ok: false, message: e.message });
    if (e.code === "23505") return send(res, 400, { ok: false, message: "That already exists." });
    throw e;
  }
  send(res, 200, { ok: true, changed: true, admin: admin.name, ...(await snapshot({ admin: true })) });
});
