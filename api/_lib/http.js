const crypto = require("crypto");

// Unambiguous characters only (no 0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeReference() {
  const bytes = crypto.randomBytes(6);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `TS-${s}`;
}

const makeToken = () => crypto.randomBytes(24).toString("base64url");

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

// Wraps a handler: POST only, JSON body, errors become a generic 500.
function route(handler) {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { ok: false, message: "Method not allowed." });
    }
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      await handler(body, res);
    } catch (e) {
      console.error(e);
      send(res, 500, { ok: false, message: "Something went wrong on our side. Please try again." });
    }
  };
}

module.exports = { makeReference, makeToken, safeEqual, send, route };
