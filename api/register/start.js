const crypto = require("crypto");
const { db, BUCKET } = require("../_lib/supabase");
const { validateStart, TYPES } = require("../_lib/validate");
const { makeReference, makeToken, send, route } = require("../_lib/http");

// Step 1: validate details, create a pending row, hand back one-time signed upload URLs.
module.exports = route(async (body, res) => {
  const v = validateStart(body);
  if (v.errors) return send(res, 400, { ok: false, errors: v.errors, message: v.errors._ });
  const d = v.data;
  const sb = db();

  // Idempotent on client_token: a retry never creates a second registration.
  const { data: existing, error: findErr } = await sb
    .from("registrations").select("id, status, reference, completed_at").eq("client_token", d.client_token).maybeSingle();
  if (findErr) throw findErr;
  if (existing?.status === "received") {
    return send(res, 200, { ok: true, already: true, reference: existing.reference, created_at: existing.completed_at });
  }
  if (existing) {
    await sb.storage.from(BUCKET).remove([`${existing.id}/photo`, `${existing.id}/payment`].flatMap((p) => Object.values(TYPES).map((e) => `${p}.${e}`)));
    await sb.from("registrations").delete().eq("id", existing.id).eq("status", "pending");
  }

  const id = crypto.randomUUID();
  const upload_token = makeToken();
  const photo_path = `${id}/photo.${TYPES[d.photo_type]}`;
  const payment_path = `${id}/payment.${TYPES[d.payment_type]}`;

  // reference is unique; retry on the (very unlikely) collision
  let inserted = false;
  for (let i = 0; i < 4 && !inserted; i++) {
    const { error } = await sb.from("registrations").insert({
      id, reference: makeReference(), upload_token, photo_path, payment_path, ...d,
    });
    if (!error) inserted = true;
    else if (!(error.code === "23505" && /reference/.test(error.message))) throw error;
  }
  if (!inserted) throw new Error("could not allocate a reference");

  const [photo, payment] = await Promise.all([
    sb.storage.from(BUCKET).createSignedUploadUrl(photo_path),
    sb.storage.from(BUCKET).createSignedUploadUrl(payment_path),
  ]);
  if (photo.error || payment.error) {
    await sb.from("registrations").delete().eq("id", id);
    throw photo.error || payment.error;
  }

  send(res, 200, {
    ok: true, id, upload_token,
    uploads: { photo: { signedUrl: photo.data.signedUrl }, payment: { signedUrl: payment.data.signedUrl } },
  });
});
