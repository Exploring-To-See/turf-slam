const { db, BUCKET } = require("../_lib/supabase");
const { UUID_RE } = require("../_lib/validate");
const { safeEqual, send, route } = require("../_lib/http");

// Cleans up a pending registration whose uploads failed. Never touches a received one.
module.exports = route(async (body, res) => {
  const { id, upload_token } = body;
  if (!UUID_RE.test(String(id ?? "")) || typeof upload_token !== "string") {
    return send(res, 400, { ok: false, message: "Bad request." });
  }
  const sb = db();
  const { data: row, error } = await sb
    .from("registrations").select("id, status, upload_token, photo_path, payment_path").eq("id", id).maybeSingle();
  if (error) throw error;
  if (row && row.status === "pending" && safeEqual(row.upload_token, upload_token)) {
    await sb.storage.from(BUCKET).remove([row.photo_path, row.payment_path]);
    await sb.from("registrations").delete().eq("id", id).eq("status", "pending");
  }
  send(res, 200, { ok: true });
});
