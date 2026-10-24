const { db, BUCKET } = require("../_lib/supabase");
const { adminRoute } = require("../_lib/admin");
const { UUID_RE } = require("../_lib/validate");
const { send } = require("../_lib/http");

// GET /api/admin/image?id=<uuid>&kind=photo|payment  ->  302 to a 60 s signed URL
module.exports = adminRoute(["GET"], async (req, res) => {
  const { id, kind } = req.query || {};
  if (!UUID_RE.test(String(id)) || !["photo", "payment"].includes(kind)) return send(res, 400, { ok: false, message: "Bad request." });
  const { data: row } = await db().from("registrations").select("photo_path, payment_path").eq("id", id).maybeSingle();
  const path = row && row[kind + "_path"];
  if (!path) return send(res, 404, { ok: false, message: "No image." });
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, 60);
  if (error) throw error;
  res.setHeader("Cache-Control", "private, max-age=30");
  res.redirect(302, data.signedUrl);
});
