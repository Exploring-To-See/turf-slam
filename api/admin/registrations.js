const { db, BUCKET } = require("../_lib/supabase");
const { adminRoute } = require("../_lib/admin");
const { validateDetails, UUID_RE } = require("../_lib/validate");
const { makeReference, send } = require("../_lib/http");

const PAYMENT = ["awaiting_review", "verified", "due"];
const COLS = "id, reference, status, payment_status, name, age, phone, role, jersey_size, tournaments_played, crichero_url, photo_path, payment_path, organiser_notes, source, created_at, completed_at, reviewed_at, updated_at";

async function dropFiles(sb, row) {
  const paths = [row.photo_path, row.payment_path].filter(Boolean);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
}

// GET list | POST add | PATCH edit / payment / notes | DELETE remove
module.exports = adminRoute(["GET", "POST", "PATCH", "DELETE"], async (req, res, body, admin) => {
  const sb = db();

  if (req.method === "GET") {
    const { data, error } = await sb.from("registrations").select(COLS)
      .eq("status", "received").order("completed_at", { ascending: false }).limit(2000);
    if (error) throw error;
    return send(res, 200, { ok: true, admin: admin.name, now: new Date().toISOString(), rows: data });
  }

  if (req.method === "POST") {
    const v = validateDetails(body);
    if (v.errors) return send(res, 400, { ok: false, errors: v.errors, message: "Check the highlighted fields." });
    const payment_status = PAYMENT.includes(body.payment_status) ? body.payment_status : "awaiting_review";
    const notes = typeof body.organiser_notes === "string" ? body.organiser_notes.slice(0, 1000) || null : null;
    for (let i = 0; i < 4; i++) {
      const { data, error } = await sb.from("registrations").insert({
        ...v.data, reference: makeReference(), consent: true, status: "received", source: "admin",
        payment_status, organiser_notes: notes, completed_at: new Date().toISOString(),
      }).select(COLS).single();
      if (!error) return send(res, 200, { ok: true, row: data });
      if (!(error.code === "23505" && /reference/.test(error.message))) throw error;
    }
    throw new Error("could not allocate a reference");
  }

  const id = body.id;
  if (!UUID_RE.test(String(id ?? ""))) return send(res, 400, { ok: false, message: "Bad request." });

  if (req.method === "DELETE") {
    const { data: row } = await sb.from("registrations").select("id, photo_path, payment_path").eq("id", id).maybeSingle();
    if (!row) return send(res, 404, { ok: false, message: "Entry not found." });
    await dropFiles(sb, row);
    const { error } = await sb.from("registrations").delete().eq("id", id);
    if (error) throw error;
    return send(res, 200, { ok: true });
  }

  // PATCH: any of payment_status / organiser_notes / details
  const patch = { updated_at: new Date().toISOString() };
  if ("payment_status" in body) {
    if (!PAYMENT.includes(body.payment_status)) return send(res, 400, { ok: false, message: "Bad payment status." });
    patch.payment_status = body.payment_status;
    patch.reviewed_at = body.payment_status === "awaiting_review" ? null : new Date().toISOString();
  }
  if ("organiser_notes" in body) patch.organiser_notes = String(body.organiser_notes ?? "").slice(0, 1000) || null;
  if (body.details) {
    const v = validateDetails(body.details);
    if (v.errors) return send(res, 400, { ok: false, errors: v.errors, message: "Check the highlighted fields." });
    Object.assign(patch, v.data);
  }
  const { data, error } = await sb.from("registrations").update(patch).eq("id", id).select(COLS).maybeSingle();
  if (error) throw error;
  if (!data) return send(res, 404, { ok: false, message: "Entry not found." });
  send(res, 200, { ok: true, row: data });
});
