const { db, BUCKET } = require("../_lib/supabase");
const { snapshot, currentVersion } = require("../_lib/auction");
const { UUID_RE } = require("../_lib/validate");

// Public, read-only. GET /api/auction/state?since=<version>  -> {changed:false} when nothing moved.
// GET /api/auction/state?photo=<player id>                   -> redirect to a short-lived signed photo URL.
module.exports = async (req, res) => {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false }); }
  try {
    const { photo, since } = req.query || {};

    if (photo !== undefined) {
      if (!UUID_RE.test(String(photo))) return res.status(400).end();
      const sb = db();
      const { data: s } = await sb.from("ts_settings").select("show_photos").eq("id", 1).single();
      const { data: p } = await sb.from("ts_player_cards").select("photo_path").eq("id", photo).maybeSingle();
      if (!s?.show_photos || !p?.photo_path) return res.status(404).end();
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(p.photo_path, 300);
      if (error) throw error;
      res.setHeader("Cache-Control", "public, max-age=120");
      return res.redirect(302, data.signedUrl);
    }

    res.setHeader("Cache-Control", "public, s-maxage=1, stale-while-revalidate=4");
    const v = await currentVersion();
    if (since !== undefined && Number(since) === v) return res.status(200).json({ ok: true, changed: false, v });
    res.status(200).json({ ok: true, changed: true, ...(await snapshot()) });
  } catch (e) {
    console.error(e);
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ ok: false, message: "The auction feed is unavailable. Retrying…" });
  }
};
