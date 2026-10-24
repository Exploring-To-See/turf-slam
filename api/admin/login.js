const { login, setSessionCookie } = require("../_lib/admin");
const { send } = require("../_lib/http");

module.exports = async (req, res) => {
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { ok: false, message: "Method not allowed." }); }
  try {
    if (req.headers["x-requested-with"] !== "turf-admin") return send(res, 403, { ok: false, message: "Bad request." });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (typeof b.username !== "string" || typeof b.password !== "string" || b.username.length > 100 || b.password.length > 200) {
      return send(res, 400, { ok: false, message: "Enter your username and password." });
    }
    const r = await login(b.username, b.password);
    if (r.locked) return send(res, 429, { ok: false, message: "Too many wrong attempts. Try again in 15 minutes." });
    if (!r.ok) return send(res, 401, { ok: false, message: "Wrong username or password." });
    setSessionCookie(res, r.token, r.maxAge);
    send(res, 200, { ok: true, name: r.name });
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, message: "Something went wrong. Please try again." });
  }
};
