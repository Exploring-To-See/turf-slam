const { db, BUCKET } = require("../_lib/supabase");
const { UUID_RE } = require("../_lib/validate");
const { safeEqual, send, route } = require("../_lib/http");

// Step 3: confirm both images landed in storage, then mark the registration received.
module.exports = route(async (body, res) => {
  const { id, upload_token } = body;
  if (!UUID_RE.test(String(id ?? "")) || typeof upload_token !== "string") {
    return send(res, 400, { ok: false, message: "Bad request." });
  }
  const sb = db();
  const { data: row, error } = await sb
    .from("registrations").select("id, status, reference, upload_token, photo_path, payment_path, completed_at").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row || !safeEqual(row.upload_token, upload_token)) {
    return send(res, 404, { ok: false, message: "We couldn’t find that registration. Please submit the form again." });
  }
  if (row.status === "received") {
    return send(res, 200, { ok: true, reference: row.reference, created_at: row.completed_at });
  }

  const { data: objs, error: listErr } = await sb.storage.from(BUCKET).list(id);
  if (listErr) throw listErr;
  const names = new Set((objs || []).map((o) => `${id}/${o.name}`));
  if (!names.has(row.photo_path) || !names.has(row.payment_path)) {
    return send(res, 409, { ok: false, message: "Your images haven’t finished uploading." });
  }

  const completed_at = new Date().toISOString();
  const { error: upErr } = await sb.from("registrations")
    .update({ status: "received", completed_at }).eq("id", id).eq("status", "pending");
  if (upErr) throw upErr;
  send(res, 200, { ok: true, reference: row.reference, created_at: completed_at });
});
