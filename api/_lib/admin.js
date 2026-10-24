const crypto = require("crypto");
const { db } = require("./supabase");
const { send } = require("./http");

const COOKIE = "ts_admin";
const SESSION_HOURS = 8;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const normUser = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const N = 16384;
  const h = crypto.scryptSync(pw, salt, 64, { N }).toString("hex");
  return `scrypt$${N}$${salt}$${h}`;
}

function verifyPassword(pw, stored) {
  const [alg, N, salt, hash] = String(stored).split("$");
  if (alg !== "scrypt") return false;
  const got = crypto.scryptSync(String(pw), salt, 64, { N: Number(N) });
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Used to burn the same time when the username does not exist.
const DUMMY = hashPassword("not-a-real-password");

function getCookie(req, name) {
  const m = String(req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}

function setSessionCookie(res, token, maxAge) {
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
}

async function login(username, password) {
  const sb = db();
  const key = normUser(username);
  const { data: u } = await sb.from("admin_users").select("*").eq("username_key", key).maybeSingle();
  if (u?.locked_until && new Date(u.locked_until) > new Date()) {
    verifyPassword(password, DUMMY);
    return { locked: true };
  }
  const ok = verifyPassword(password, u ? u.password_hash : DUMMY) && !!u;
  if (!ok) {
    if (u) {
      const fails = u.failed_count + 1;
      await sb.from("admin_users").update(fails >= MAX_FAILS
        ? { failed_count: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() }
        : { failed_count: fails }).eq("id", u.id);
    }
    return { ok: false };
  }
  await sb.from("admin_users").update({ failed_count: 0, locked_until: null }).eq("id", u.id);
  await sb.from("admin_sessions").delete().lt("expires_at", new Date().toISOString());
  const token = crypto.randomBytes(32).toString("base64url");
  await sb.from("admin_sessions").insert({
    token_hash: sha256(token), admin_id: u.id,
    expires_at: new Date(Date.now() + SESSION_HOURS * 3600000).toISOString(),
  });
  return { ok: true, token, name: u.username, maxAge: SESSION_HOURS * 3600 };
}

async function getAdmin(req) {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const { data } = await db().from("admin_sessions")
    .select("expires_at, admin_users(username)").eq("token_hash", sha256(token)).maybeSingle();
  if (!data || new Date(data.expires_at) < new Date()) return null;
  return { name: data.admin_users.username, tokenHash: sha256(token) };
}

// Wraps an admin handler: session required; mutating calls also need the CSRF header.
function adminRoute(methods, handler) {
  return async (req, res) => {
    res.setHeader("X-Robots-Tag", "noindex");
    if (!methods.includes(req.method)) {
      res.setHeader("Allow", methods.join(", "));
      return send(res, 405, { ok: false, message: "Method not allowed." });
    }
    try {
      const admin = await getAdmin(req);
      if (!admin) return send(res, 401, { ok: false, message: "Please sign in." });
      if (req.method !== "GET" && req.headers["x-requested-with"] !== "turf-admin") {
        return send(res, 403, { ok: false, message: "Bad request." });
      }
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      await handler(req, res, body, admin);
    } catch (e) {
      console.error(e);
      send(res, 500, { ok: false, message: "Something went wrong. Please try again." });
    }
  };
}

module.exports = { COOKIE, hashPassword, normUser, login, getAdmin, getCookie, setSessionCookie, adminRoute, sha256 };
