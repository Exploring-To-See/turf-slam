/* Shared player-card stage: markup, change detection and the little animations that go with each change.
   Used by /auction and by the admin console (full screen card + the small live card). */
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const INR = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const trim = (x) => String(+x.toFixed(2));
  const short = (n) => (n >= 1e7 ? `₹${trim(n / 1e7)} Cr` : n >= 1e5 ? `₹${trim(n / 1e5)} L` : INR(n));
  const initials = (name) => (String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
  const node = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const restart = (el, cls, ms) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); if (ms) setTimeout(() => el.classList.remove(cls), ms); };

  // ---------- what changed between two snapshots ----------
  function detect(prev, next) {
    if (!prev || !next) return [];
    const out = [], base = prev.events.length ? prev.events[0].id : 0;
    const fresh = next.events.filter((e) => e.id > base).reverse();
    for (const e of fresh) if (e.kind === "sold" || e.kind === "unsold") out.push({ type: e.kind, player_id: e.player_id, team_id: e.team_id, team: e.team_name, name: e.player_name, amount: e.amount });
    const a = prev.state, b = next.state;
    if (b.player_id && b.player_id !== a.player_id) out.push({ type: a.player_id && !out.length ? "swap" : "enter", player_id: b.player_id });
    else if (b.player_id && b.player_id === a.player_id) {
      // the first bid lands on the base price, so the price alone does not change: the leader does
      const up = b.price > a.price || (b.leading_team_id && b.leading_team_id !== a.leading_team_id && b.price >= a.price);
      if (up) out.push({ type: "bid", delta: b.price - a.price, team_id: b.leading_team_id });
      else if (b.price < a.price || (!b.leading_team_id && a.leading_team_id)) out.push({ type: "undo", delta: b.price - a.price });
    }
    if (a.status !== b.status && (a.status === "paused" || b.status === "paused")) out.push({ type: b.status === "paused" ? "pause" : "resume" });
    return out;
  }

  // ---------- little effects ----------
  function confetti(host, { colors = ["#c8f03a", "#f7ecd0", "#ffffff"], count = 46, y = 44 } = {}) {
    if (reduce || !host) return;
    const W = host.clientWidth || 600;
    for (let i = 0; i < count; i++) {
      const s = document.createElement("i");
      s.className = "ts-confetti";
      const t = 1200 + Math.random() * 900;
      s.style.cssText = `--dx:${((Math.random() - 0.5) * W * 0.9).toFixed(0)}px;--up:${(-(70 + Math.random() * 190)).toFixed(0)}px;--dy:${(60 + Math.random() * 280).toFixed(0)}px;--r:${((Math.random() - 0.5) * 1500).toFixed(0)}deg;--t:${t.toFixed(0)}ms;--w:${(6 + Math.random() * 7).toFixed(0)}px;--bg:${colors[i % colors.length]};top:${y}%;animation-delay:${(Math.random() * 120).toFixed(0)}ms`;
      host.appendChild(s);
      setTimeout(() => s.remove(), t + 400);
    }
  }
  function floatDelta(host, text, neg) {
    if (!host || reduce) return;
    const d = document.createElement("span");
    d.className = "ts-delta" + (neg ? " neg" : ""); d.textContent = text;
    host.appendChild(d); setTimeout(() => d.remove(), 1300);
  }
  function ripple(host) {
    if (!host || reduce) return;
    const r = document.createElement("i"); r.className = "ts-ripple"; host.prepend(r); setTimeout(() => r.remove(), 950);
  }
  function countTo(el, to, fmt = short) {
    const from = el._v == null ? to : el._v; el._v = to;
    cancelAnimationFrame(el._raf);
    if (reduce || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 700;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (k < 1) el._raf = requestAnimationFrame(step); };
    el._raf = requestAnimationFrame(step);
  }

  // ---------- markup ----------
  const photo = (p, eager) => (p.has_photo ? `<img src="/api/auction/state?photo=${esc(p.id)}" alt="" ${eager ? "" : 'loading="lazy" '}decoding="async" onerror="this.remove()">` : "");
  function boardInner(snap) {
    const st = snap.state, p = snap.players.find((x) => x.id === st.player_id), c = snap.categories.find((x) => x.code === p.category);
    const team = (id) => snap.teams.find((t) => t.id === id);
    const lead = st.leading_team_id ? team(st.leading_team_id) : null;
    const next = lead ? st.price + c.increment : c.base_price;
    const bids = st.bids.map((b) => { const t = team(b.team_id); return `<li><i class="ts-swatch" style="--c:${esc(t ? t.color : "#c8f03a")}"></i><span>${esc(t ? t.name : "Team")}</span><b>${INR(b.amount)}</b></li>`; }).join("");
    return `<i class="ts-ball"></i>
      <p class="ts-kicker">${lead ? "Current bid" : "Opening price"}</p>
      <div class="ts-price-wrap"><div class="ts-price">${INR(st.price)}</div></div>
      ${st.status === "paused" ? `<p class="ts-paused-flag">Auction paused</p>` : ""}
      <div class="ts-leader" ${lead ? `style="--c:${esc(lead.color)}"` : ""}>${lead ? `<i class="ts-swatch" style="--c:${esc(lead.color)}"></i><b>${esc(lead.name)}</b><small>leading</small>` : `<b>No bids yet</b><small>waiting for the first bid</small>`}</div>
      <p class="ts-next">${lead ? "Next bid" : "First bid"} <b>${INR(next)}</b></p>
      ${bids ? `<ol class="ts-ladder" aria-label="Bid history">${bids}</ol>` : ""}`;
  }
  function stageHtml(snap) {
    const st = snap.state, p = st.player_id ? snap.players.find((x) => x.id === st.player_id) : null;
    if (p && (st.status === "live" || st.status === "paused")) {
      const c = snap.categories.find((x) => x.code === p.category);
      let i = 0; const ix = () => `style="--i:${i++}"`;
      return `<div class="ts-wrap" data-pid="${esc(p.id)}" data-status="${esc(st.status)}">
        <article class="ts-lot"><i class="ts-sweep"></i>
          <div class="ts-photo"><span class="ts-serial">#${String(p.serial).padStart(2, "0")}</span><div class="ts-initials" aria-hidden="true">${esc(initials(p.name))}</div>${photo(p, true)}</div>
          <div class="ts-info">
            <div class="ts-head">
              <p class="ts-kicker">Under Hammer</p>
              <h2 class="ts-name">${esc(p.name)}</h2>
              <div class="ts-tags"><span class="ts-tag cat" ${ix()}>${esc(c.label)}</span>${p.role ? `<span class="ts-tag" ${ix()}>${esc(p.role)}</span>` : ""}${p.age ? `<span class="ts-tag" ${ix()}>Age ${esc(p.age)}</span>` : ""}</div>
            </div>
            <dl class="ts-facts">${p.tournaments_played ? `<div class="played${String(p.tournaments_played).length > 26 ? " wide" : ""}" ${ix()}><dt>Tournaments played</dt><dd>${esc(p.tournaments_played)}</dd></div>` : ""}<div ${ix()}><dt>Base price</dt><dd>${INR(c.base_price)}</dd></div></dl>
          </div></article>
        <aside class="ts-board" aria-label="Current bid">${boardInner(snap)}</aside>
        <div class="ts-fx"></div></div>`;
    }
    const last = snap.events.find((e) => e.kind === "sold" || e.kind === "unsold");
    const recent = last && Date.now() - new Date(last.created_at).getTime() < 10 * 60 * 1000;
    const sold = snap.players.filter((x) => x.status === "sold").length;
    const nothing = !snap.events.length && !sold;
    const left = snap.players.filter((x) => x.status === "pool" && snap.categories.find((c) => c.code === x.category).base_price).length;
    return `<div class="ts-idle"><div class="ts-orbit" aria-hidden="true"><i></i><b></b></div>
      <p class="ts-kicker">${nothing ? "Auction not started" : "Between players"}</p>
      <h2>${nothing ? "The auction starts soon" : "Next player coming up"}</h2>
      <p>${nothing ? "Teams, purses and the player list are below. This page updates live once bidding opens." : `${left} player${left === 1 ? "" : "s"} still to come.`}</p>
      ${recent ? `<p class="last">${last.kind === "sold" ? `Last sale: <b>${esc(last.player_name)}</b> to <b>${esc(last.team_name)}</b> for <b>${INR(last.amount)}</b>` : `<b>${esc(last.player_name)}</b> went unsold`}</p>` : ""}</div>`;
  }
  const stampHtml = (t, cls = "") => `<div class="ts-stamp ${t.type === "unsold" ? "unsold" : ""} ${cls}" role="status"><span class="big">${t.type === "sold" ? "Sold" : "Unsold"}</span><span class="who">${esc(t.name)}${t.type === "sold" ? ` to ${esc(t.team)}` : ""}</span>${t.type === "sold" ? `<span class="amt">${INR(t.amount)}</span>` : ""}</div>`;
  const teamColors = (snap, id) => { const t = snap.teams.find((x) => x.id === id); return t ? [t.color, "#c8f03a", "#f7ecd0", "#ffffff"] : ["#c8f03a", "#f7ecd0", "#ffffff"]; };

  // ---------- the presenter: renders a snapshot into a root and plays the right animation for each change ----------
  function presenter(root) {
    root.classList.add("ts-stage");
    let prev = null, holding = false;

    const wrap = () => root.querySelector(":scope > .ts-wrap");
    const ghostOf = (kind) => { const w = wrap(); if (!w) return null; const g = document.createElement("div"); g.className = "ts-ghost " + kind; g.appendChild(w.cloneNode(true)); return g; };

    function enter(delay = 0) {
      root.style.setProperty("--d", delay + "ms");
      restart(root, "is-enter", 2600 + delay);
    }
    function patchBoard(next, tr) {
      const w = wrap(); if (!w) return false;
      const board = $(".ts-board", w); board.innerHTML = boardInner(next);
      w.dataset.status = next.state.status;
      const price = $(".ts-price", board), pw = $(".ts-price-wrap", board);
      for (const t of tr) {
        if (t.type === "bid") {
          restart(price, "bump", 700); ripple(pw); floatDelta(pw, t.delta > 0 ? "+" + INR(t.delta) : "First bid");
          const lead = $(".ts-leader", board); if (lead) restart(lead, "flash", 1100);
          const li = $(".ts-ladder li", board); if (li) li.classList.add("new");
        } else if (t.type === "undo") { restart(price, "shake", 500); floatDelta(pw, t.delta < 0 ? INR(t.delta) : "Bid removed", true); }
      }
      return true;
    }
    function full(next, tr) {
      const swap = tr.some((t) => t.type === "swap") && wrap();
      const ghost = swap ? ghostOf("swap") : null;
      root.innerHTML = stageHtml(next);
      if (ghost) { ghost.classList.add("out"); root.appendChild(ghost); setTimeout(() => ghost.remove(), 520); }
      if (tr.some((t) => t.type === "enter" || t.type === "swap")) enter(swap ? 220 : 0);
    }
    function hold(end, next) {
      holding = true;
      const g = ghostOf(end.type); if (!g) { holding = false; return false; }
      const h = root.offsetHeight; root.style.minHeight = h + "px";
      root.classList.remove("is-enter");
      root.innerHTML = stageHtml(next); root.classList.add("hold"); root.appendChild(g);
      const fx = $(".ts-fx", g) || g;
      g.insertAdjacentHTML("beforeend", stampHtml(end));
      if (end.type === "sold") confetti(fx, { colors: teamColors(next, end.team_id), count: 56 });
      setTimeout(() => {
        g.classList.add("out"); const s = $(".ts-stamp", g); if (s) s.classList.add("leave");
        setTimeout(() => {
          g.remove(); root.classList.remove("hold"); root.style.minHeight = ""; holding = false;
          const cur = prev; root.innerHTML = stageHtml(cur);
          if (cur.state.player_id) enter(0);
        }, 640);
      }, end.type === "sold" ? 3300 : 2700);
      return true;
    }
    function update(next) {
      const tr = detect(prev, next), first = !prev;
      prev = next;
      if (holding) return;                       // rendered from `prev` when the hold ends
      if (first) { root.innerHTML = stageHtml(next); return; }
      const end = tr.find((t) => t.type === "sold" || t.type === "unsold");
      if (end && !reduce && wrap() && hold(end, next)) return;
      const w = wrap(), samePlayer = w && next.state.player_id && w.dataset.pid === next.state.player_id && !tr.some((t) => t.type === "enter" || t.type === "swap");
      if (samePlayer && (next.state.status === "live" || next.state.status === "paused")) { patchBoard(next, tr); return; }
      full(next, tr);
    }
    const $ = (s, r = root) => r.querySelector(s);
    return { update, get snap() { return prev; } };
  }

  // ---------- the small live card in the admin console ----------
  const mini = { stamp: null };
  function playMini(card, tr, snap) {
    if (!card) return;
    for (const t of tr) {
      if (t.type === "enter" || t.type === "swap") { restart(card, "ts-mini-enter", 1400); }
      else if (t.type === "bid") {
        const price = card.querySelector("[data-ts=price]"), box = card.querySelector("[data-ts=pricebox]");
        if (price) restart(price, "bump", 700); ripple(box); floatDelta(box, t.delta > 0 ? "+" + INR(t.delta) : "First bid");
        const lead = card.querySelector("[data-ts=leader]"); if (lead) restart(lead, "flash", 1100);
      } else if (t.type === "undo") {
        const price = card.querySelector("[data-ts=price]"); if (price) restart(price, "shake", 500);
      } else if (t.type === "sold" || t.type === "unsold") {
        mini.stamp = { ...t, until: Date.now() + 3800, shown: false };
        restart(card, "ts-mini-hammer", 600);
        if (t.type === "sold") confetti(card.querySelector(".ts-fx") || card, { colors: teamColors(snap, t.team_id), count: 38 });
      }
    }
    applyStamp(card);
  }
  function applyStamp(card) {
    const s = mini.stamp; if (!card || !s) return;
    if (Date.now() >= s.until) { mini.stamp = null; return; }
    if (card.querySelector(".ts-stamp")) return;
    const el = node(stampHtml(s, "is-mini" + (s.shown ? " static" : ""))); s.shown = true;
    card.appendChild(el);
    const left = Math.max(0, s.until - Date.now());
    setTimeout(() => el.isConnected && el.classList.add("leave"), Math.max(0, left - 420));
    setTimeout(() => el.remove(), left + 40);
  }

  // ---------- team strip + full-screen shell ----------
  function stripHtml(snap) {
    const lead = snap.state.leading_team_id;
    return snap.teams.map((t) => `<div class="ts-chip${lead === t.id && snap.state.status === "live" ? " lead" : ""}" style="--c:${esc(t.color)}"><b>${esc(t.short_name || t.name)}</b><span>${short(t.purse_left)}</span><small>${t.squad}/${t.max_squad} · max ${t.slots_left > 0 ? short(t.max_bid) : "full"}</small></div>`).join("");
  }
  function openPresent({ title = "The Turf Slam", hint = "", onClose } = {}) {
    const el = node(`<div class="ts-present" role="dialog" aria-label="Full screen player card">
      <header class="ts-p-head"><img src="/assets/turf-slam-logo-1200-noball.webp" width="1200" height="452" alt="The Turf Slam">
        <div class="ts-p-title"><span class="ts-kicker">Player auction</span><b>${esc(title)}</b></div><span style="flex:1"></span>
        <button type="button" class="ts-p-btn" data-x>Exit full screen</button></header>
      <div class="ts-p-main"><div class="ts-stage" data-stage></div></div>
      <footer class="ts-p-strip" data-strip></footer>${hint ? `<span class="ts-p-hint">${esc(hint)}</span>` : ""}</div>`);
    document.body.appendChild(el);
    document.body.style.overflow = "hidden";
    const pres = presenter(el.querySelector("[data-stage]")), strip = el.querySelector("[data-strip]");
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      document.removeEventListener("fullscreenchange", onFs); document.removeEventListener("keydown", onKey, true);
      if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
      el.remove(); document.body.style.overflow = ""; onClose && onClose();
    };
    const onFs = () => { if (!document.fullscreenElement) close(); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    el.querySelector("[data-x]").addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    if (el.requestFullscreen) el.requestFullscreen().then(() => document.addEventListener("fullscreenchange", onFs)).catch(() => {});
    return { update(snap) { if (closed) return; pres.update(snap); strip.innerHTML = stripHtml(snap); }, close, el };
  }

  window.TSStage = { esc, INR, short, initials, detect, presenter, playMini, applyStamp, mini, openPresent, countTo, confetti, restart, reduce };
})();
