/* Bally on the auction page: the lime ball character from the registration page, sitting where the ball belongs on the
   header logo. It drops in once the opening sequence is done, blinks, follows the pointer with its eyes, hops when tapped,
   gets wide-eyed on a new bid and star-eyed on a sale. Decorative, so hidden from assistive tech. */
(() => {
  "use strict";
  const brand = document.querySelector(".bar .brand"), logo = brand && brand.querySelector(".face");
  if (!logo) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const INK = "#173a0b", WHITE = "#fffdf4";
  const HOME = [0.733, 0.299], RAD = 0.1;   // same spot and size as on the registration page (fractions of the logo)
  const BOX = 3.4;                          // canvas size in radii: room for the hop, the stars and the shadow

  const root = document.createElement("div"); root.className = "bally"; root.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas"); root.append(canvas);
  const hit = document.createElement("span"); hit.className = "bally-hit"; hit.setAttribute("aria-hidden", "true");
  brand.append(root, hit);
  const ctx = canvas.getContext("2d");

  let r = 12, size = 0, dpr = 1;
  function layout() {
    const w = logo.offsetWidth, h = logo.offsetHeight; if (!w) return;
    r = Math.max(8, w * RAD); size = Math.ceil(r * BOX); dpr = Math.min(3, devicePixelRatio || 1);
    canvas.width = canvas.height = Math.ceil(size * dpr);
    const cx = w * HOME[0], cy = h * HOME[1];
    Object.assign(root.style, { width: size + "px", height: size + "px", left: cx - size / 2 + "px", top: cy - size / 2 + "px" });
    Object.assign(hit.style, { width: r * 2.4 + "px", height: r * 2.4 + "px", left: cx - r * 1.2 + "px", top: cy - r * 1.2 + "px" });
  }

  // ---------- state ----------
  const gaze = { x: 0, y: 0, tx: 0, ty: 0 };
  let mood = "idle", moodUntil = 0, blinkAt = performance.now() + 1500, blinkT = -1;
  let y = reduce ? 0 : -400, vy = 0, landed = reduce, started = reduce;   // y: offset above the seat, in px (negative = up)
  let squash = 0, spin = 0, vspin = 0;
  const feel = (m, ms) => { mood = m; moodUntil = performance.now() + ms; };
  const hop = (power = 1) => { if (reduce) return; if (landed) { vy = -r * 13 * power; landed = false; } };

  // ---------- reactions ----------
  hit.addEventListener("click", () => { feel("happy", 1100); hop(1); vspin = (Math.random() < 0.5 ? -1 : 1) * 0.25; });
  hit.addEventListener("pointerenter", () => { if (mood === "idle") feel("surprised", 600); });
  addEventListener("pointermove", (e) => {
    const b = root.getBoundingClientRect(), dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
    gaze.tx = dx / (Math.abs(dx) + 220); gaze.ty = dy / (Math.abs(dy) + 220);
  }, { passive: true });
  document.addEventListener("bally", (e) => {
    const k = e.detail;
    if (k === "bid") { feel("surprised", 900); hop(0.6); gaze.tx = 0; gaze.ty = 0.6; }
    else if (k === "sold") { feel("star", 2200); hop(1.25); vspin = 0.35; }
    else if (k === "unsold") feel("sad", 1800);
    else if (k === "enter") { feel("happy", 1200); hop(0.8); }
  });

  // ---------- drawing (same look as the registration page) ----------
  function star(x, yy, R) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? R * 0.45 : R; ctx.lineTo(x + Math.cos(a) * q, yy + Math.sin(a) * q); }
    ctx.closePath(); ctx.fillStyle = "#ffd23a"; ctx.fill(); ctx.stroke();
  }
  function eye(x, yy, rx, ry, style, px, py, blink) {
    if (style === "happy") { ctx.beginPath(); ctx.moveTo(x - rx, yy + ry * 0.2); ctx.quadraticCurveTo(x, yy - ry * 1.1, x + rx, yy + ry * 0.2); ctx.stroke(); return; }
    if (style === "star") { star(x, yy, rx * 1.2); return; }
    const h = ry * blink * (style === "big" ? 1.2 : 1);
    if (h < ry * 0.15) { ctx.beginPath(); ctx.moveTo(x - rx, yy); ctx.quadraticCurveTo(x, yy + ry * 0.25, x + rx, yy); ctx.stroke(); return; }
    ctx.beginPath(); ctx.ellipse(x, yy, rx, h, 0, 0, Math.PI * 2); ctx.fillStyle = WHITE; ctx.fill();
    ctx.save(); ctx.clip();
    const pr = rx * (style === "big" ? 0.42 : 0.55), cx = x + px * (rx - pr) * 0.85, cy = yy + py * (h - pr) * 0.7;
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.arc(cx - pr * 0.35, cy - pr * 0.38, pr * 0.34, 0, Math.PI * 2); ctx.fillStyle = WHITE; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.ellipse(x, yy, rx, h, 0, 0, Math.PI * 2); ctx.stroke();
  }
  function draw(now) {
    const S = size, s = dpr, m = now < moodUntil ? mood : "idle";
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!started) return;
    ctx.setTransform(s, 0, 0, s, (S / 2) * s, (S / 2) * s);
    // contact shadow on the logo, fading as Bally goes up
    const lift = Math.min(1, -y / (r * 2.5));
    ctx.beginPath(); ctx.ellipse(0, r * 0.96, r * 0.78 * (1 - lift * 0.5), r * 0.15 * (1 - lift * 0.5), 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(40, 25, 0, ${0.3 * (1 - lift * 0.7)})`; ctx.fill();
    const breathe = reduce ? 0 : Math.sin(now / 520) * 0.025;
    const sx = 1 + squash * 0.22 - breathe, sy = 1 - squash * 0.22 + breathe;
    ctx.translate(0, y + r); ctx.scale(sx, sy); ctx.translate(0, -r);
    ctx.rotate(spin);
    // body
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.1, 0, 0, r * 1.05);
    g.addColorStop(0, "#f2ff9a"); g.addColorStop(0.45, "#c3e432"); g.addColorStop(1, "#6f9a12");
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1.2, r * 0.07); ctx.strokeStyle = INK; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r * 0.965, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.55, r * 0.32, r * 0.17, -0.5, 0, Math.PI * 2); ctx.fillStyle = "rgba(255, 255, 240, 0.55)"; ctx.fill();
    // face
    const fx = gaze.x * r * 0.24, fy = gaze.y * r * 0.18 + r * 0.04, k = 1 - Math.abs(gaze.x) * 0.16;
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, r * 0.075);
    if (m === "happy" || m === "star") {
      ctx.fillStyle = "rgba(255, 105, 90, 0.4)";
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(fx + d * r * 0.52 * k, fy + r * 0.2, r * 0.15, r * 0.09, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    const style = m === "happy" ? "happy" : m === "star" ? "star" : m === "surprised" ? "big" : "open";
    const ex = r * 0.3 * k, ey = fy - r * 0.15, rx = r * 0.19, ry = r * 0.25;
    const px = Math.max(-1, Math.min(1, gaze.x * 2.4)), py = Math.max(-1, Math.min(1, gaze.y * 2.4));
    const blink = blinkT >= 0 ? Math.abs(1 - blinkT * 2) : 1;
    eye(fx - ex, ey, rx, ry, style, px, py, blink);
    eye(fx + ex, ey, rx, ry, style, px, py, blink);
    // brows
    const by = ey - r * 0.3 - (m === "surprised" ? r * 0.08 : 0), tiltB = m === "sad" ? -0.1 : -0.05;
    for (const d of [-1, 1]) {
      const inner = fx + d * (ex - rx * 0.7), outer = fx + d * (ex + rx * 0.9);
      ctx.beginPath(); ctx.moveTo(outer, by + (m === "sad" ? r * 0.04 : 0)); ctx.lineTo(inner, by + tiltB * r); ctx.stroke();
    }
    // mouth
    const my = fy + r * 0.33;
    if (m === "surprised") { ctx.beginPath(); ctx.ellipse(fx, my + r * 0.04, r * 0.09, r * 0.12, 0, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill(); }
    else if (m === "happy" || m === "star") {
      const ow = r * 0.27, top = my - r * 0.04, bot = my + r * 0.26;
      ctx.beginPath(); ctx.moveTo(fx - ow, top); ctx.quadraticCurveTo(fx, top + r * 0.08, fx + ow, top);
      ctx.quadraticCurveTo(fx + ow * 0.9, bot, fx, bot); ctx.quadraticCurveTo(fx - ow * 0.9, bot, fx - ow, top);
      ctx.closePath(); ctx.fillStyle = INK; ctx.fill(); ctx.stroke();
      ctx.save(); ctx.clip(); ctx.beginPath(); ctx.ellipse(fx, bot, ow * 0.6, (bot - top) * 0.45, 0, 0, Math.PI * 2); ctx.fillStyle = "#e0584a"; ctx.fill(); ctx.restore();
    } else {
      const w = r * 0.2, sm = m === "sad" ? -0.35 : 0.4;
      ctx.beginPath(); ctx.moveTo(fx - w, my - sm * r * 0.05); ctx.quadraticCurveTo(fx, my + sm * r * 0.3, fx + w, my - sm * r * 0.05); ctx.stroke();
    }
    ctx.restore();
    if (m === "star") {
      ctx.lineWidth = r * 0.05; ctx.strokeStyle = INK;
      for (let i = 0; i < 3; i++) { const a = now / 300 + i * 2.09; star(Math.cos(a) * r * 1.0, -r * 1.12 + Math.sin(a) * r * 0.16, r * 0.15); }
    }
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (started && !reduce) {
      if (!landed) {
        vy += r * 60 * dt; y += vy * dt;          // gravity, in px/s², scaled to Bally's size
        if (y >= 0) {
          y = 0;
          if (vy > r * 3) { squash = Math.min(1, vy / (r * 40)); vy = -vy * 0.42; }
          else { vy = 0; landed = true; }
        }
      }
      squash *= Math.pow(0.0008, dt);
      spin += vspin; vspin *= Math.pow(0.02, dt); spin *= Math.pow(0.05, dt);
    }
    gaze.x += (gaze.tx - gaze.x) * Math.min(1, dt * 8); gaze.y += (gaze.ty - gaze.y) * Math.min(1, dt * 8);
    if (blinkT >= 0) { blinkT += dt / 0.16; if (blinkT >= 1) { blinkT = -1; blinkAt = now + 2200 + Math.random() * 3200; } }
    else if (now > blinkAt && mood !== "star") blinkT = 0;
    draw(now);
    if (!document.hidden) requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { last = performance.now(); requestAnimationFrame(frame); } });

  // drop in once the opening sequence has cleared
  function start() { if (started) return; started = true; feel("happy", 1400); }
  const ready = () => !document.body.classList.contains("pre");
  if (ready()) setTimeout(start, 250);
  else new MutationObserver((_, o) => { if (ready()) { o.disconnect(); setTimeout(start, 450); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  const relayout = () => { layout(); };
  if (logo.complete) relayout(); else logo.addEventListener("load", relayout);
  addEventListener("resize", relayout);
  requestAnimationFrame(frame);
})();
