const { db } = require("../_lib/supabase");
const { COOKIE, getCookie, setSessionCookie, sha256 } = require("../_lib/admin");
const { send } = require("../_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { ok: false }); }
  try {
    const t = getCookie(req, COOKIE);
    if (t) await db().from("admin_sessions").delete().eq("token_hash", sha256(t));
  } catch (e) { console.error(e); }
  setSessionCookie(res, "", 0);
  send(res, 200, { ok: true });
};
