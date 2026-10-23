// Server-side mirror of the validators in public/index.html. Keep in sync.
const ROLES = ["Only batter", "Only bowler", "All rounder", "Wicket keeper"];
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 8 * 1024 * 1024;
const NAME_RE = /^\p{L}[\p{L}\p{M}'’.\- ]*$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function normCric(v) {
  let s = String(v ?? "").trim();
  if (!s) return { value: null };
  if (s.length > 300) return { error: "That link is too long. Paste the link from CricHeroes." };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return { error: "Enter a full link, like https://cricheroes.com/player-profile/…" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Enter a web link that starts with https://" };
  if (!u.hostname.toLowerCase().includes("cricheroes")) return { error: "This doesn’t look like a CricHeroes link. Copy it from your CricHeroes profile." };
  u.protocol = "https:";
  const out = u.toString();
  if (out.length > 300) return { error: "That link is too long. Paste the link from CricHeroes." };
  return { value: out };
}

function normPhone(v) {
  let s = String(v ?? "").trim();
  const bad = "Enter a 10-digit mobile number, or include your country code with +.";
  if (!s) return { error: "Enter your phone number." };
  if (s.length > 32) return { error: bad };
  s = s.replace(/[\s\-.()]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  let m;
  if (/^[6-9]\d{9}$/.test(s)) return { value: "+91" + s };
  if ((m = s.match(/^0([6-9]\d{9})$/))) return { value: "+91" + m[1] };
  if ((m = s.match(/^91([6-9]\d{9})$/))) return { value: "+91" + m[1] };
  if (/^\+[1-9]\d{7,14}$/.test(s)) return { value: s };
  return { error: bad };
}

function checkFile(f, label) {
  if (!f || typeof f !== "object") return `Upload ${label}.`;
  if (!TYPES[f.type]) return "Use a JPG, PNG or WebP image.";
  if (!Number.isInteger(f.size) || f.size <= 0) return "That file looks empty.";
  if (f.size > MAX_BYTES) return "That file is over 8 MB.";
  return "";
}

// Returns { errors } or { data } (normalised, ready to insert).
function validateStart(b) {
  const errors = {};
  if (!b || typeof b !== "object") return { errors: { _: "Bad request." } };
  if (!UUID_RE.test(String(b.client_token ?? ""))) errors._ = "Bad request.";

  const name = tidy(b.name);
  if (name.length < 2) errors.name = "Enter your full name, at least 2 letters.";
  else if (name.length > 80 || !NAME_RE.test(name)) errors.name = "Use letters, spaces, apostrophes, hyphens or full stops only.";

  const ageStr = String(b.age ?? "").trim();
  const age = /^\d{1,2}$/.test(ageStr) ? Number(ageStr) : NaN;
  if (!(age >= 5 && age <= 99)) errors.age = "Enter an age between 5 and 99.";

  const phone = normPhone(b.phone);
  if (phone.error) errors.phone = phone.error;

  if (!ROLES.includes(b.role)) errors.role = "Select your playing role.";

  const played = tidy(b.tournaments_played);
  if (played.length < 2) errors.tournaments_played = "Enter at least one tournament name.";
  else if (played.length > 300) errors.tournaments_played = "Keep this under 300 characters.";

  const cric = normCric(b.crichero_url);
  if (cric.error) errors.crichero_url = cric.error;

  if (b.consent !== true) errors.consent = "Tick the box to confirm your details and agree to share them.";

  const pe = checkFile(b.photo, "a clear photo of yourself");
  if (pe) errors.photo = pe;
  const ye = checkFile(b.payment, "your payment screenshot");
  if (ye) errors.payment = ye;

  if (Object.keys(errors).length) return { errors };
  return {
    data: {
      client_token: b.client_token.toLowerCase(),
      name, age, phone: phone.value, role: b.role,
      tournaments_played: played, crichero_url: cric.value, consent: true,
      photo_type: b.photo.type, payment_type: b.payment.type,
    },
  };
}

module.exports = { validateStart, TYPES, UUID_RE };
