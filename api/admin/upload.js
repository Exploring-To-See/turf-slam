const crypto = require("crypto");
const { db, BUCKET } = require("../_lib/supabase");
const { adminRoute } = require("../_lib/admin");
const { UUID_RE, TYPES, checkFile } = require("../_lib/validate");
const { send } = require("../_lib/http");

// POST {id, kind, type, size} -> replaces the stored image and returns a one-time signed upload URL.
module.exports = adminRoute(["POST"], async (req, res, body) => {
  const { id, kind } = body;
  if (!UUID_RE.test(String(id ?? "")) || !["photo", "payment"].includes(kind)) return send(res, 400, { ok: false, message: "Bad request." });
  const bad = checkFile({ type: body.type, size: body.size }, "an image");
  if (bad) return send(res, 400, { ok: false, message: bad });
  const sb = db();
  const { data: row } = await sb.from("registrations").select("id, photo_path, payment_path").eq("id", id).maybeSingle();
  if (!row) return send(res, 404, { ok: false, message: "Entry not found." });
  const old = row[kind + "_path"];
  if (old) await sb.storage.from(BUCKET).remove([old]);
  const path = `${id}/${kind}-${crypto.randomBytes(4).toString("hex")}.${TYPES[body.type]}`;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  const { error: upErr } = await sb.from("registrations")
    .update({ [kind + "_path"]: path, [kind + "_type"]: body.type, updated_at: new Date().toISOString() }).eq("id", id);
  if (upErr) throw upErr;
  send(res, 200, { ok: true, signedUrl: data.signedUrl });
});
