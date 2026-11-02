(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const INR = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const trim = (x) => String(+x.toFixed(2));
  const short = (n) => (n >= 1e7 ? `₹${trim(n / 1e7)} Cr` : n >= 1e5 ? `₹${trim(n / 1e5)} L` : INR(n));
  const initials = (name) => (String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
  const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const money = (v) => { const n = Number(String(v).replace(/[^\d]/g, "")); return Number.isFinite(n) ? n : NaN; };
  const PAY = { awaiting_review: "Awaiting review", verified: "Received", due: "Due" };
  const ROLES = ["Only batter", "Only bowler", "All rounder", "Wicket keeper"];
  const SIZES = ["S", "M", "L", "XL", "XXL", "XXXL"];
  const ROUTES = ["overview", "registrations", "live", "players", "teams", "rules"];
  const H = { "content-type": "application/json", "x-requested-with": "turf-admin" };

  let A = null;            // auction snapshot
  let R = null;            // registrations
  let route = "overview";
  let seenRegs = null, freshRegs = new Set();
  const ui = { regFilter: "all", regQ: "", pf: "all", pc: "all", pq: "", pickCat: "any", pickQ: "" };
  const drafts = {};       // unsaved field values, survive re-renders

  // ---------- plumbing ----------
  async function api(path, opts = {}) {
    const r = await fetch(path, { credentials: "same-origin", ...opts, headers: { ...H, ...(opts.headers || {}) } });
    let data = null; try { data = await r.json(); } catch (_) {}
    if (r.status === 401 && path !== "/api/admin/login") { showLogin(); throw new Error("signed-out"); }
    return { status: r.status, data: data || { ok: false, message: "Unexpected reply from the server." } };
  }
  const post = (p, body, method = "POST") => api(p, { method, body: JSON.stringify(body) });
  let toastT = 0;
  function toast(msg, bad) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), bad ? 4600 : 3000);
  }

  // Run an auction action; on success the server returns the fresh snapshot.
  async function act(action, body = {}, okMsg) {
    try {
      const { data } = await post("/api/admin/auction", { action, ...body });
      if (!data.ok) { toast(data.message || "That didn't work.", true); return false; }
      A = data; render(); if (okMsg) toast(okMsg); return true;
    } catch (e) { if (e.message !== "signed-out") toast("Couldn't reach the server.", true); return false; }
  }

  // ---------- views: login / app ----------
  function showLogin() { stopTimer(); $("#app").hidden = true; $("#login-view").hidden = false; A = R = null; setTimeout(() => $("#u").focus(), 0); }
  function showApp(name) { $("#login-view").hidden = true; $("#app").hidden = false; $("#who").textContent = name; }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("#login-btn"), err = $("#login-err"); err.hidden = true; b.disabled = true;
    try {
      const { data } = await post("/api/admin/login", { username: $("#u").value, password: $("#p").value });
      if (!data.ok) { err.textContent = data.message; err.hidden = false; return; }
      $("#p").value = ""; await boot();
    } catch (_) {} finally { b.disabled = false; }
  });
  $("#logout").addEventListener("click", async () => { try { await post("/api/admin/logout", {}); } catch (_) {} showLogin(); });

  // ---------- polling ----------
  let timer = 0, busy = false;
  const stopTimer = () => { clearTimeout(timer); timer = 0; };
  async function tick() {
    if (busy) return; busy = true;
    try {
      const wantRegs = ["overview", "registrations"].includes(route) || !!$("#dlg[open] .importlist");
      const [a, r] = await Promise.all([
        api("/api/admin/auction" + (A ? `?since=${A.v}` : "")),
        wantRegs ? api("/api/admin/registrations") : Promise.resolve(null),
      ]);
      let changed = false;
      if (a.data.ok && a.data.changed) { A = a.data; changed = true; showApp(a.data.admin || $("#who").textContent); }
      if (r && r.data.ok) {
        const sig = (rows) => rows.map((x) => x.id + x.payment_status + x.updated_at).join();
        if (!R || sig(R) !== sig(r.data.rows)) {
          const prev = seenRegs, rows = r.data.rows;
          if (prev) { const fresh = rows.filter((x) => !prev.has(x.id)); fresh.forEach((x) => freshRegs.add(x.id)); if (fresh.length) toast(fresh.length === 1 ? `New registration: ${fresh[0].name}` : `${fresh.length} new registrations`); }
          seenRegs = new Set(rows.map((x) => x.id)); R = rows; changed = true;
          setTimeout(() => { freshRegs.clear(); }, 9000);
        }
        showApp(r.data.admin);
      }
      $("#live").classList.remove("off"); $("#live-t").textContent = "Live · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      if (changed) render();
    } catch (e) { if (e.message !== "signed-out") { $("#live").classList.add("off"); $("#live-t").textContent = "Offline, retrying"; } }
    finally { busy = false; }
    if ($("#app").hidden === false) timer = setTimeout(tick, route === "live" ? 1500 : 3000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#app").hidden) { stopTimer(); tick(); } });

  async function boot() {
    stopTimer();
    const [a, r] = await Promise.all([api("/api/admin/auction"), api("/api/admin/registrations")]).catch(() => [null, null]);
    if (!a) return showLogin();
    if (a.data.ok) { A = a.data; showApp(a.data.admin); }
    if (r && r.data.ok) { R = r.data.rows; seenRegs = new Set(R.map((x) => x.id)); }
    if ($("#app").hidden) return showLogin();
    setRoute(); render(); timer = setTimeout(tick, 1500);
  }

  // ---------- routing ----------
  function setRoute() { const h = (location.hash.match(/^#\/(\w+)/) || [])[1]; route = ROUTES.includes(h) ? h : "overview"; }
  window.addEventListener("hashchange", () => { setRoute(); render(); $("#view").scrollTop = 0; scrollTo(0, 0); if (!$("#app").hidden) { stopTimer(); tick(); } });

  // ---------- render (keeps typed values and focus across live refreshes) ----------
  const val = (key, server) => (key in drafts ? drafts[key] : server ?? "");
  function render() {
    if (!A) return;
    const f = document.activeElement, fk = f && f.dataset && f.dataset.keep, sel = fk && f.selectionStart != null ? [f.selectionStart, f.selectionEnd] : null;
    const y = scrollY;
    $("#nav").querySelectorAll("a").forEach((a) => a.setAttribute("aria-current", a.dataset.r === route ? "page" : "false"));
    const view = { overview, registrations, live, players, teams, rules }[route];
    $("#view").innerHTML = view();
    if (fk) { const n = $(`[data-keep="${fk}"]`); if (n) { n.focus(); if (sel) try { n.setSelectionRange(...sel); } catch (_) {} } }
    scrollTo(0, y);
    pills();
  }
  function pills() {
    const regs = R ? R.length : null;
    $("#pill-regs").textContent = regs ?? ""; $("#pill-regs").hidden = regs == null;
    const st = A.state; const lp = $("#pill-live");
    lp.textContent = st.status === "live" ? "LIVE" : st.status === "paused" ? "II" : ""; lp.classList.toggle("hot", st.status === "live"); lp.hidden = st.status === "idle";
    $("#pill-players").textContent = A.players.length;
  }

  const team = (id) => A.teams.find((t) => t.id === id);
  const player = (id) => A.players.find((p) => p.id === id);
  const cat = (c) => A.categories.find((x) => x.code === c);
  const auctionable = (p) => !!cat(p.category).base_price;
  const avatar = (p) => `<div class="av"><span aria-hidden="true">${esc(initials(p.name))}</span>${p.has_photo ? `<img src="/api/auction/state?photo=${esc(p.id)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>`;
  const teamChip = (t) => (t ? `<span class="tm"><i class="swatch" style="--c:${esc(t.color)}"></i>${esc(t.name)}</span>` : "");
  const head = (title, sub, acts = "") => `<div class="page-h"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="acts">${acts}</div></div>`;

  // =====================================================================
  // OVERVIEW
  // =====================================================================
  function overview() {
    const regs = R || [], by = (s) => regs.filter((r) => r.payment_status === s).length;
    const pl = A.players, n = (s) => pl.filter((p) => p.status === s).length;
    const spent = A.teams.reduce((s, t) => s + t.spent, 0);
    const st = A.state, p = st.player_id ? player(st.player_id) : null;
    const sales = A.events.filter((e) => e.kind === "sold").slice(0, 5);
    return head("Overview", `Signed in as ${esc($("#who").textContent)}.`,
      `<a class="btn" href="#/live">${st.status === "idle" ? "Open live control" : "Go to the block"}</a>`) + `
      <div class="stack">
        <section aria-label="Registrations"><div class="card-h"><h2>Registrations</h2><a class="mini" href="#/registrations">Manage</a></div>
          <div class="stats">
            <div class="stat"><b>${regs.length}</b><span>Registered</span></div>
            <div class="stat ok"><b>${by("verified")}</b><span>Payment received</span></div>
            <div class="stat due"><b>${by("due")}</b><span>Payment due</span></div>
            <div class="stat wait"><b>${by("awaiting_review")}</b><span>Awaiting review</span></div>
          </div></section>
        <section aria-label="Auction"><div class="card-h"><h2>Auction</h2><a class="mini" href="/auction" target="_blank" rel="noopener">Open public view</a></div>
          <div class="stats">
            <div class="stat"><b><span class="badge b-${esc(st.status)}">${st.status === "live" ? "Live" : st.status === "paused" ? "Paused" : "Idle"}</span></b><span>${p ? esc(p.name) + " on the block" : "Nobody on the block"}</span></div>
            <div class="stat"><b>${pl.length}</b><span>Players in the auction</span></div>
            <div class="stat ok"><b>${n("sold")}</b><span>Sold</span></div>
            <div class="stat"><b>${n("retained")}</b><span>Retained</span></div>
            <div class="stat wait"><b>${n("pool")}</b><span>Still to come</span></div>
            <div class="stat due"><b>${n("unsold")}</b><span>Unsold</span></div>
            <div class="stat"><b>${short(spent)}</b><span>Spent across teams</span></div>
          </div></section>
        ${pl.length ? "" : `<div class="card"><h2>Get the auction ready</h2><p class="hint">1. Add players from the registered list on the Players page.  2. Set team names on Teams.  3. Retain players (3 per team).  4. Open Live control and bring on the first player.</p><div class="btns" style="margin-top:12px"><a class="btn" href="#/players">Add players</a><a class="btn ghost" href="#/teams">Set up teams</a></div></div>`}
        <div class="grid2">
          <section class="card"><div class="card-h"><h2>Latest registrations</h2></div>${regs.length ? `<ul class="log">${regs.slice(0, 6).map((r) => `<li><span class="k">${esc(PAY[r.payment_status] || "")}</span><span>${esc(r.name)} <small>${esc(r.role)}</small></span><time>${esc(clock(r.completed_at))}</time></li>`).join("")}</ul>` : `<p class="hint">No registrations yet.</p>`}</section>
          <section class="card"><div class="card-h"><h2>Latest sales</h2></div>${sales.length ? `<ul class="log">${sales.map((e) => `<li><span class="k sold">Sold</span><span>${esc(e.player_name)} to ${esc(e.team_name)} <b class="num">${INR(e.amount)}</b></span><time>${esc(clock(e.created_at))}</time></li>`).join("")}</ul>` : `<p class="hint">No sales yet.</p>`}</section>
        </div>
      </div>`;
  }

  // =====================================================================
  // REGISTRATIONS
  // =====================================================================
  function regsVisible() {
    const q = ui.regQ.trim().toLowerCase();
    return (R || []).filter((r) => (ui.regFilter === "all" || r.payment_status === ui.regFilter) &&
      (!q || [r.name, r.phone, r.reference, r.role, r.jersey_size, r.tournaments_played].join(" ").toLowerCase().includes(q)));
  }
  function registrations() {
    const inAuction = new Set(A.players.map((p) => p.registration_id).filter(Boolean));
    const v = regsVisible();
    const chip = (f, label) => `<button class="chip" type="button" data-act="regfilter" data-v="${f}" aria-pressed="${ui.regFilter === f}">${label}</button>`;
    return head("Registrations", "New entries appear here live. Confirm payments, edit details or remove entries.",
      `<button class="mini" data-act="csv" type="button">Export CSV</button><button class="btn" data-act="reg-add" type="button">Add entry</button>`) + `
      <div class="toolbar">
        <label class="sr" for="regq">Search entries</label>
        <input class="input" id="regq" data-keep="regq" type="search" placeholder="Search name, phone, reference, role" autocomplete="off" value="${esc(ui.regQ)}">
        <div class="chips" role="group" aria-label="Filter by payment">${chip("all", "All")}${chip("awaiting_review", "Awaiting")}${chip("verified", "Received")}${chip("due", "Due")}</div>
      </div>
      <div class="list">${!R ? `<div class="empty">Loading…</div>` : v.length ? v.map((r) => {
        const ps = r.payment_status;
        const cric = r.crichero_url ? `<a href="${esc(r.crichero_url)}" target="_blank" rel="noopener noreferrer">CricHeroes profile</a>` : "";
        return `<article class="row s-${esc(ps)}${freshRegs.has(r.id) ? " fresh" : ""}" data-id="${esc(r.id)}">
          <div><div class="who-name">${esc(r.name)}</div>
            <span class="ref"><code>${esc(r.reference)}</code>${r.source === "admin" ? '<span class="src">added by admin</span>' : ""} · ${esc(when(r.completed_at))}</span>
            <div class="files">
              <button class="mini" type="button" data-act="img" data-kind="photo" ${r.photo_path ? "" : "disabled"}>Photo</button>
              <button class="mini" type="button" data-act="img" data-kind="payment" ${r.payment_path ? "" : "disabled"}>Payment screenshot</button>
            </div></div>
          <div class="meta"><span><span class="k">Age</span> ${esc(r.age)} · <span class="k">Phone</span> <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></span>
            <span><span class="k">Role</span> ${esc(r.role)} · <span class="k">Jersey</span> ${esc(r.jersey_size || "—")}</span></div>
          <div class="meta"><span><span class="k">Tournaments</span> ${esc(r.tournaments_played)}</span>${cric}</div>
          <div class="pay"><span class="badge b-${esc(ps)}">${esc(PAY[ps] || ps)}</span>
            <div class="btns"><button class="pay-btn rec" type="button" data-act="pay" data-v="verified" aria-pressed="${ps === "verified"}">Payment received</button><button class="pay-btn due" type="button" data-act="pay" data-v="due" aria-pressed="${ps === "due"}">Mark due</button></div>
            <div class="btns"><button class="mini" type="button" data-act="reg-edit">Edit</button>${inAuction.has(r.id) ? `<span class="badge">In auction</span>` : `<button class="mini" type="button" data-act="reg-to-auction">Add to auction</button>`}<button class="mini danger" type="button" data-act="reg-del">Delete</button></div></div>
          ${r.organiser_notes ? `<div class="note">Note: ${esc(r.organiser_notes)}</div>` : ""}
        </article>`;
      }).join("") : `<div class="empty">${R.length ? "No entries match your search." : "No registrations yet."}</div>`}</div>`;
  }

  // =====================================================================
  // LIVE CONTROL
  // =====================================================================
  function live() {
    const st = A.state, p = st.player_id ? player(st.player_id) : null, c = p ? cat(p.category) : null;
    const lead = st.leading_team_id ? team(st.leading_team_id) : null;
    const open = !!p && st.status === "live";
    const next = p ? (lead ? st.price + c.increment : c.base_price) : 0;
    let blockHtml;
    if (p) {
      blockHtml = `
        <div class="card-h"><h2>On the block</h2><span class="badge b-${esc(st.status)}">${st.status === "paused" ? "Paused" : "Bidding live"}</span></div>
        <div class="block-top"><div class="block-photo"><span aria-hidden="true">${esc(initials(p.name))}</span>${p.has_photo ? `<img src="/api/auction/state?photo=${esc(p.id)}" alt="" onerror="this.remove()">` : ""}</div>
          <div><div class="block-name">${esc(p.name)}</div>
            <div class="tags"><span class="tag cat">${esc(c.label)}</span>${p.role ? `<span class="tag">${esc(p.role)}</span>` : ""}${p.age ? `<span class="tag">Age ${esc(p.age)}</span>` : ""}<span class="tag">Base ${INR(c.base_price)}</span><span class="tag">Step ${INR(c.increment)}</span></div></div></div>
        <div class="price-box"><span class="p num">${INR(st.price)}</span>
          <span class="l">${lead ? `<i class="swatch" style="--c:${esc(lead.color)}"></i>${esc(lead.name)} <small>leading</small>` : `<small>No bids yet. Opening price.</small>`}</span></div>
        <div class="block-acts">
          <button class="btn big" type="button" data-act="sell" ${lead && open ? "" : "disabled"}>${lead ? `Sold to ${esc(lead.name)} for ${INR(st.price)}` : "Sold (needs a bid)"}</button>
          <div class="pair">
            <button class="btn ghost" type="button" data-act="unsold">Unsold</button>
            <button class="btn ghost" type="button" data-act="undo" ${lead ? "" : "disabled"}>Undo last bid</button>
            <button class="btn ghost" type="button" data-act="pause" data-v="${st.status === "paused" ? "0" : "1"}">${st.status === "paused" ? "Resume" : "Pause"}</button>
          </div></div>`;
    } else {
      blockHtml = `<div class="card-h"><h2>On the block</h2><span class="badge b-idle">Idle</span></div>
        <div class="empty">No player on the block. Bring one on from the list, or draw a random player.</div>`;
    }

    const teamBtns = A.teams.map((t, i) => {
      let why = "", disabled = false;
      if (!open) { disabled = true; why = p ? "Paused" : "No player"; }
      else if (t.id === st.leading_team_id) { disabled = true; why = "Leading"; }
      else if (t.slots_left <= 0) { disabled = true; why = "Squad full"; }
      else if (next > t.max_bid) { disabled = true; why = `Max ${short(t.max_bid)}`; }
      return `<button class="tbtn${t.id === st.leading_team_id ? " lead" : ""}" type="button" data-act="bid" data-team="${t.id}" style="--c:${esc(t.color)}" ${disabled ? "disabled" : ""} title="${esc(t.name)}">
        ${i < 10 ? `<kbd>${(i + 1) % 10}</kbd>` : ""}<b>${esc(t.name)}</b><span class="bid num">${why || INR(next)}</span><small>Purse ${short(t.purse_left)}</small><small>Max ${t.slots_left > 0 ? short(t.max_bid) : "Full"}</small></button>`;
    }).join("");

    const q = ui.pickQ.trim().toLowerCase();
    const avail = A.players.filter((x) => (x.status === "pool" || x.status === "unsold") && auctionable(x) &&
      (ui.pickCat === "any" || x.category === ui.pickCat) && (!q || `${x.name} ${x.role || ""}`.toLowerCase().includes(q)));
    const nUnsold = avail.filter((x) => x.status === "unsold").length;
    const seg = (v, l) => `<button type="button" data-act="pickcat" data-v="${v}" aria-pressed="${ui.pickCat === v}">${l}</button>`;

    return head("Live control", `Everything the auctioneer needs on one screen. The public page at <b>/auction</b> follows along within a second or two.`,
      `<a class="mini" href="/auction" target="_blank" rel="noopener">Open public view</a>`) + `
      <div class="live-grid">
        <section class="card">${blockHtml}</section>
        <section class="card"><div class="card-h"><h2>Place a bid</h2></div>
          <div class="teamgrid">${teamBtns}</div>
          <div class="jump"><div><label class="label" for="jteam">Team</label><select class="select sm" id="jteam" data-keep="jteam">${A.teams.map((t) => `<option value="${t.id}" ${String(val("jteam", "")) === String(t.id) ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
            <div><label class="label" for="jamt">Jump bid (₹)</label><input class="input sm" id="jamt" data-keep="jamt" inputmode="numeric" placeholder="${p ? esc(String(next)) : "Amount"}" value="${esc(val("jamt", ""))}"></div>
            <button class="btn" type="button" data-act="jump" ${open ? "" : "disabled"}>Bid</button></div>
          <p class="hintbar">Tap a team to bid the next step. Keys <kbd>1</kbd> to <kbd>9</kbd> and <kbd>0</kbd> do the same for teams 1 to 10.</p></section>
        <section class="card"><div class="card-h"><h2>Bring on a player</h2>
            <div class="seg" role="group" aria-label="Category">${seg("any", "Any")}${seg("A", "A")}${seg("B", "B")}</div></div>
          <div class="btns"><button class="btn" type="button" data-act="random">Random ${ui.pickCat === "any" ? "player" : "category " + ui.pickCat}</button></div>
          <label class="sr" for="pickq">Search players</label>
          <input class="input sm" id="pickq" data-keep="pickq" type="search" placeholder="Or search the ${avail.length} available players" value="${esc(ui.pickQ)}" style="margin-top:10px" autocomplete="off">
          ${nUnsold ? `<p class="hint">${nUnsold} unsold player${nUnsold === 1 ? "" : "s"} can be brought back.</p>` : ""}
          <ul class="picklist">${avail.slice(0, 80).map((x) => `<li class="pick" data-id="${esc(x.id)}">${avatar(x)}<span><b>${esc(x.name)}</b><small>#${x.serial} · Cat ${esc(x.category)}${x.role ? " · " + esc(x.role) : ""}${x.status === "unsold" ? " · unsold" : ""}</small></span><button class="mini primary" type="button" data-act="open-lot">Bring on</button></li>`).join("") || `<li class="hint">${A.players.length ? "No players match." : "No players yet. Add them on the Players page."}</li>`}</ul></section>
        <section class="card"><div class="card-h"><h2>Activity</h2></div>
          <ul class="log">${A.events.slice(0, 14).map((e) => `<li><span class="k ${esc(e.kind)}">${esc(evLabel(e.kind))}</span><span>${esc(evText(e))}</span><time>${esc(clock(e.created_at))}</time></li>`).join("") || `<li><span></span><span>Nothing yet.</span><span></span></li>`}</ul></section>
      </div>`;
  }
  const evLabel = (k) => ({ lot_open: "Open", bid: "Bid", undo_bid: "Undo", sold: "Sold", unsold: "Unsold", revert: "Revert", retain: "Retain", unretain: "Release", pause: "Pause", resume: "Resume", reset: "Reset" }[k] || k);
  const evText = (e) => ({
    lot_open: `${e.player_name} brought on at ${INR(e.amount || 0)}`, bid: `${e.team_name} bid ${INR(e.amount)} for ${e.player_name}`, undo_bid: `${e.team_name}'s bid of ${INR(e.amount)} removed`,
    sold: `${e.player_name} to ${e.team_name} for ${INR(e.amount)}`, unsold: `${e.player_name} unsold`, revert: `Sale of ${e.player_name} reversed`,
    retain: `${e.team_name} retained ${e.player_name} (${INR(e.amount)})`, unretain: `${e.team_name} released ${e.player_name}`, pause: "Auction paused", resume: "Auction resumed", reset: "Auction reset",
  }[e.kind] || e.kind);

  // =====================================================================
  // PLAYERS
  // =====================================================================
  function players() {
    const q = ui.pq.trim().toLowerCase();
    const rows = A.players.filter((p) => (ui.pf === "all" || p.status === ui.pf) && (ui.pc === "all" || p.category === ui.pc) && (!q || `${p.name} ${p.role || ""}`.toLowerCase().includes(q)));
    const chip = (key, v, l) => `<button class="chip" type="button" data-act="pfilter" data-k="${key}" data-v="${v}" aria-pressed="${ui[key] === v}">${l}</button>`;
    const cnt = (s) => A.players.filter((p) => p.status === s).length;
    return head("Players", `${A.players.length} in the auction · ${cnt("pool")} to come · ${cnt("sold")} sold · ${cnt("retained")} retained · ${cnt("unsold")} unsold`,
      `<button class="mini" type="button" data-act="import">Add registered players</button><button class="btn" type="button" data-act="player-add">Add player</button>`) + `
      <div class="toolbar"><label class="sr" for="pq">Search players</label><input class="input" id="pq" data-keep="pq" type="search" placeholder="Search name or role" value="${esc(ui.pq)}" autocomplete="off">
        <div class="chips" role="group" aria-label="Status">${chip("pf", "all", "All")}${chip("pf", "pool", "To come")}${chip("pf", "sold", "Sold")}${chip("pf", "retained", "Retained")}${chip("pf", "unsold", "Unsold")}</div>
        <div class="chips" role="group" aria-label="Category">${chip("pc", "all", "Any cat")}${chip("pc", "A+", "A+")}${chip("pc", "A", "A")}${chip("pc", "B", "B")}</div></div>
      <div class="list">${rows.length ? rows.map((p) => {
        const t = p.team_id ? team(p.team_id) : null, locked = ["live", "sold", "retained"].includes(p.status);
        const ret = cat(p.category).retention_value && (p.status === "pool" || p.status === "unsold");
        return `<article class="prow${p.status === "live" ? " live" : ""}" data-id="${esc(p.id)}">
          <div class="pid">${avatar(p)}<div><b>${esc(p.name)}</b><small>#${p.serial}${p.role ? " · " + esc(p.role) : ""}${p.age ? " · " + esc(p.age) + " yrs" : ""}${p.registration_reference ? " · " + esc(p.registration_reference) : " · added manually"}</small></div></div>
          <div><label class="sr" for="cat-${esc(p.id)}">Category</label><select class="select sm" id="cat-${esc(p.id)}" data-change="player-cat" ${locked ? "disabled title=\"Revert or release the player to change category\"" : ""}>${A.categories.map((c) => `<option value="${esc(c.code)}" ${c.code === p.category ? "selected" : ""}>Cat ${esc(c.code)}</option>`).join("")}</select></div>
          <div class="pstat"><span class="badge b-${esc(p.status)}">${{ pool: "To come", live: "On the block", sold: "Sold", unsold: "Unsold", retained: "Retained" }[p.status]}</span>${t ? `${teamChip(t)} <span class="money">${INR(p.price)}</span>` : `<span class="hint" style="margin:0">${auctionable(p) ? "Base " + INR(cat(p.category).base_price) : "Retention only"}</span>`}</div>
          <div class="btns">
            ${(p.status === "pool" || p.status === "unsold") && auctionable(p) ? `<button class="mini primary" type="button" data-act="open-lot">Bring on</button>` : ""}
            ${ret ? `<button class="mini" type="button" data-act="retain">Retain…</button>` : ""}
            ${p.status === "retained" ? `<button class="mini" type="button" data-act="release">Release</button>` : ""}
            ${p.status === "sold" ? `<button class="mini" type="button" data-act="revert">Revert sale</button>` : ""}
            <button class="mini" type="button" data-act="player-edit">Edit</button>
            <button class="mini danger" type="button" data-act="player-del" ${p.status === "live" ? "disabled" : ""}>Delete</button></div>
        </article>`;
      }).join("") : `<div class="empty">${A.players.length ? "No players match these filters." : "No players yet. Use “Add registered players” to pull them in from the registration list."}</div>`}</div>`;
  }

  // =====================================================================
  // TEAMS
  // =====================================================================
  function teams() {
    const retainable = A.players.filter((p) => cat(p.category).retention_value && (p.status === "pool" || p.status === "unsold"));
    return head("Teams", `Purse, squad size and retained players for each team. Max bid always keeps enough back to fill the squad.`,
      `<button class="btn" type="button" data-act="team-add">Add team</button>`) + `
      <div class="teams">${A.teams.map((t) => {
        const mine = A.players.filter((p) => p.team_id === t.id).sort((a, b) => (a.status === "retained" ? 0 : 1) - (b.status === "retained" ? 0 : 1));
        const k = (f) => `t${t.id}-${f}`;
        return `<article class="tcard" data-team="${t.id}" style="--c:${esc(val(k("color"), t.color))}">
          <div class="tcard-h"><i class="swatch"></i><h3>${esc(t.name)}</h3><span class="badge">${t.squad}/${t.max_squad}</span></div>
          <div class="tcard-b">
            <dl class="tmoney"><div><dt>Purse left</dt><dd class="num">${short(t.purse_left)}</dd></div><div><dt>Spent</dt><dd class="num">${short(t.spent)}</dd></div><div><dt>Max bid</dt><dd class="num">${t.slots_left > 0 ? short(t.max_bid) : "Full"}</dd></div></dl>
            <div class="fgrid">
              <div class="wide"><label class="label" for="${k("name")}">Team name</label><input class="input sm" id="${k("name")}" data-keep="${k("name")}" data-f="name" maxlength="40" value="${esc(val(k("name"), t.name))}"></div>
              <div><label class="label" for="${k("short")}">Short name</label><input class="input sm" id="${k("short")}" data-keep="${k("short")}" data-f="short_name" maxlength="5" value="${esc(val(k("short"), t.short_name))}"></div>
              <div><label class="label" for="${k("color")}">Colour</label><input class="input" type="color" id="${k("color")}" data-keep="${k("color")}" data-f="color" value="${esc(val(k("color"), t.color))}"></div>
              <div class="wide"><label class="label" for="${k("cap")}">Captain <span class="opt">(optional)</span></label><input class="input sm" id="${k("cap")}" data-keep="${k("cap")}" data-f="captain_name" maxlength="60" value="${esc(val(k("cap"), t.captain_name || ""))}"></div>
              <div><label class="label" for="${k("purse")}">Purse (₹)</label><input class="input sm" id="${k("purse")}" data-keep="${k("purse")}" data-f="purse_total" inputmode="numeric" value="${esc(val(k("purse"), t.purse_total))}"></div>
              <div><label class="label" for="${k("squad")}">Squad size</label><input class="input sm" id="${k("squad")}" data-keep="${k("squad")}" data-f="max_squad" inputmode="numeric" value="${esc(val(k("squad"), t.max_squad))}"></div>
            </div>
            <div class="btns"><button class="mini primary" type="button" data-act="team-save">Save team</button><button class="mini danger" type="button" data-act="team-del" ${mine.length ? "disabled title=\"Remove this team's players first\"" : ""}>Delete team</button></div>
            <div><h4 class="label">Squad</h4>
              <ul class="squad">${mine.map((p) => `<li data-id="${esc(p.id)}"><span>${esc(p.name)} <span class="badge b-${esc(p.status)}">${p.status === "retained" ? "Retained" : "Bought"}</span></span><span class="money num">${INR(p.price)}</span><button class="mini" type="button" data-act="${p.status === "retained" ? "release" : "revert"}">${p.status === "retained" ? "Release" : "Revert"}</button></li>`).join("") || `<li><span class="hint" style="margin:0">No players yet.</span></li>`}</ul></div>
            <div><label class="label" for="${k("ret")}">Retain a player (${A.settings.retain_per_team} allowed)</label>
              <div class="btns" style="flex-wrap:nowrap"><select class="select sm" id="${k("ret")}" data-keep="${k("ret")}"><option value="">Choose a player</option>${retainable.map((p) => `<option value="${esc(p.id)}" ${val(k("ret"), "") === p.id ? "selected" : ""}>${esc(p.name)} (Cat ${esc(p.category)}, ${short(cat(p.category).retention_value)})</option>`).join("")}</select>
                <button class="mini primary" type="button" data-act="team-retain">Retain</button></div></div>
          </div></article>`;
      }).join("")}</div>`;
  }

  // =====================================================================
  // RULES + SETUP
  // =====================================================================
  function rules() {
    const s = A.settings, t0 = A.teams[0];
    return head("Rules and setup", "Values from the official rules book. Change them here if the rules change.") + `
      <div class="stack">
        <section class="card"><div class="card-h"><h2>Categories</h2></div>
          <table class="table"><thead><tr><th>Category</th><th>Base price (₹)</th><th>Bid step (₹)</th><th>Retention value (₹)</th></tr></thead><tbody>
          ${A.categories.map((c) => `<tr data-code="${esc(c.code)}"><td><b>${esc(c.label)}</b></td>
            <td><input class="input sm" data-keep="c-${esc(c.code)}-base" data-f="base_price" inputmode="numeric" placeholder="not auctioned" value="${esc(val(`c-${c.code}-base`, c.base_price ?? ""))}" aria-label="${esc(c.label)} base price"></td>
            <td><input class="input sm" data-keep="c-${esc(c.code)}-inc" data-f="increment" inputmode="numeric" placeholder="not auctioned" value="${esc(val(`c-${c.code}-inc`, c.increment ?? ""))}" aria-label="${esc(c.label)} bid step"></td>
            <td><input class="input sm" data-keep="c-${esc(c.code)}-ret" data-f="retention_value" inputmode="numeric" placeholder="cannot be retained" value="${esc(val(`c-${c.code}-ret`, c.retention_value ?? ""))}" aria-label="${esc(c.label)} retention value"></td></tr>`).join("")}
          </tbody></table>
          <p class="hint">Leave base price and bid step empty for a category that is only ever retained (A+).</p>
          <div class="btns" style="margin-top:10px"><button class="mini primary" type="button" data-act="cats-save">Save categories</button></div></section>
        <div class="grid2">
          <section class="card"><div class="card-h"><h2>Event</h2></div><div class="stack">
            <div><label class="label" for="s-title">Title shown on the public page</label><input class="input sm" id="s-title" data-keep="s-title" maxlength="120" value="${esc(val("s-title", s.title))}"></div>
            <div><label class="label" for="s-ret">Retained players per team</label><input class="input sm" id="s-ret" data-keep="s-ret" inputmode="numeric" value="${esc(val("s-ret", s.retain_per_team))}"></div>
            <label class="label"><input type="checkbox" data-change="photos" ${s.show_photos ? "checked" : ""} style="width:20px;height:20px;accent-color:#c8f03a;vertical-align:-4px"> Show player photos on the public page</label>
            <p class="hint">Photos come from the registration form, where players were told photos are seen only by organisers. Turn this off to show initials instead.</p>
            <div class="btns"><button class="mini primary" type="button" data-act="settings-save">Save</button></div></div></section>
          <section class="card"><div class="card-h"><h2>Purse for every team</h2></div><div class="stack">
            <div><label class="label" for="s-purse">Purse (₹)</label><input class="input sm" id="s-purse" data-keep="s-purse" inputmode="numeric" value="${esc(val("s-purse", t0 ? t0.purse_total : 10000000))}"></div>
            <p class="hint">Applies to all ${A.teams.length} teams. ${t0 ? "Currently " + INR(t0.purse_total) + "." : ""}</p>
            <div class="btns"><button class="mini primary" type="button" data-act="purse-all">Apply to all teams</button></div></div></section>
        </div>
        <section class="card danger-zone"><div class="card-h"><h2>Reset the auction</h2></div>
          <p class="hint" style="margin:0 0 10px">Sends every sold, unsold and live player back to the pool, clears all bids and the activity log, and refunds all purses. Team and player details stay.</p>
          <button class="mini solid-danger" type="button" data-act="reset">Reset auction…</button></section>
      </div>`;
  }

  // =====================================================================
  // DIALOGS
  // =====================================================================
  const dlg = $("#dlg"), dbody = $("#dlg-body");
  function openDlg(html) { dbody.innerHTML = html; if (!dlg.open) dlg.showModal(); const f = $("[autofocus], input, select", dbody); if (f) f.focus(); }
  const closeDlg = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDlg(); });
  dlg.addEventListener("close", () => { dbody.innerHTML = ""; });
  function ask({ title, text, ok = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      openDlg(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="dlg-acts"><button class="mini" type="button" data-d="no">Cancel</button><button class="mini ${danger ? "solid-danger" : "primary"}" type="button" data-d="yes">${esc(ok)}</button></div>`);
      const done = (v) => { dbody.removeEventListener("click", on); dlg.removeEventListener("close", onClose); resolve(v); closeDlg(); };
      const on = (e) => { const b = e.target.closest("[data-d]"); if (b) done(b.dataset.d === "yes"); };
      const onClose = () => { dbody.removeEventListener("click", on); resolve(false); };
      dbody.addEventListener("click", on); dlg.addEventListener("close", onClose, { once: true });
    });
  }

  // ---- registration add/edit ----
  const regFields = [["name", "Name", "text", "wide"], ["age", "Age", "text"], ["phone", "Phone", "text"], ["role", "Role", "role"], ["jersey_size", "Jersey size", "size"], ["tournaments_played", "Tournaments played", "text", "wide"], ["crichero_url", "CricHeroes link (optional)", "text", "wide"]];
  function regDialog(r) {
    const f = (k, label, type, cls = "") => {
      const v = r ? r[k] ?? "" : "";
      const input = type === "role" ? `<select class="select" id="r-${k}" data-k="${k}"><option value="">Select role</option>${ROLES.map((x) => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("")}</select>`
        : type === "size" ? `<select class="select" id="r-${k}" data-k="${k}"><option value="">Select size</option>${SIZES.map((x) => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("")}</select>`
        : `<input class="input" id="r-${k}" data-k="${k}" value="${esc(v)}" ${k === "phone" ? 'inputmode="tel"' : ""}>`;
      return `<div class="${cls}"><label class="label" for="r-${k}">${label}</label>${input}<p class="err" data-e="${k}"></p></div>`;
    };
    openDlg(`<form data-submit="reg-save" data-id="${r ? esc(r.id) : ""}" novalidate><h2>${r ? "Edit entry" : "Add entry"}</h2><div class="fgrid" style="margin-top:12px">
      ${regFields.map(([k, l, t, c]) => f(k, l, t, c)).join("")}
      <div><label class="label" for="r-pay">Payment</label><select class="select" id="r-pay" data-k="payment_status">${Object.entries(PAY).map(([k, l]) => `<option value="${k}" ${(r ? r.payment_status : "awaiting_review") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="wide"><label class="label" for="r-notes">Organiser notes <span class="opt">(optional)</span></label><textarea class="textarea" id="r-notes" data-k="organiser_notes" maxlength="1000">${esc(r ? r.organiser_notes || "" : "")}</textarea></div>
      <div class="wide"><span class="label">Photograph <span class="opt">(optional, max 8 MB)</span></span><div class="upl"><input type="file" id="r-photo" accept="image/jpeg,image/png,image/webp">${r && r.photo_path ? "<span>Current photo kept unless replaced.</span>" : ""}</div></div>
      <div class="wide"><span class="label">Payment screenshot <span class="opt">(optional)</span></span><div class="upl"><input type="file" id="r-payment" accept="image/jpeg,image/png,image/webp">${r && r.payment_path ? "<span>Current screenshot kept unless replaced.</span>" : ""}</div></div>
    </div><p class="form-err" id="r-err" role="alert" hidden style="margin-top:12px"></p>
    <div class="dlg-acts" style="margin-top:14px"><button class="mini" type="button" data-d="no">Cancel</button><button class="btn" type="submit">Save</button></div></form>`);
  }
  async function putFile(kind, id, file) {
    const { data } = await post("/api/admin/upload", { id, kind, type: file.type, size: file.size });
    if (!data.ok) throw new Error(data.message || "Upload failed.");
    const r = await fetch(data.signedUrl, { method: "PUT", headers: { "content-type": file.type, "x-upsert": "false", "cache-control": "max-age=3600" }, body: file });
    if (!r.ok) throw new Error("The image didn't upload.");
  }
  async function saveReg(form) {
    const id = form.dataset.id, err = $("#r-err"); err.hidden = true;
    const d = {}; $$("[data-k]", form).forEach((n) => (d[n.dataset.k] = n.value));
    const { payment_status, organiser_notes, ...details } = d;
    const btn = $("button[type=submit]", form); btn.disabled = true;
    try {
      const res = id ? await post("/api/admin/registrations", { id, details, payment_status, organiser_notes }, "PATCH") : await post("/api/admin/registrations", { ...details, payment_status, organiser_notes });
      $$("[data-e]", form).forEach((p) => (p.textContent = (res.data.errors || {})[p.dataset.e] || ""));
      $$("[data-k]", form).forEach((n) => n.setAttribute("aria-invalid", (res.data.errors || {})[n.dataset.k] ? "true" : "false"));
      if (!res.data.ok) { err.textContent = res.data.message || "Couldn't save."; err.hidden = false; return; }
      const rid = res.data.row.id;
      try { for (const kind of ["photo", "payment"]) { const fl = $("#r-" + kind).files[0]; if (fl) await putFile(kind, rid, fl); } }
      catch (ue) { err.textContent = "Entry saved, but: " + ue.message; err.hidden = false; await tick(); return; }
      closeDlg(); R = null; await tick(); toast(id ? "Entry updated" : "Entry added");
    } catch (ex) { if (ex.message !== "signed-out") { err.textContent = "Couldn't reach the server."; err.hidden = false; } } finally { btn.disabled = false; }
  }

  // ---- player add/edit ----
  function playerDialog(p) {
    openDlg(`<form data-submit="player-save" data-id="${p ? esc(p.id) : ""}" novalidate><h2>${p ? "Edit player" : "Add player"}</h2><div class="fgrid" style="margin-top:12px">
      <div class="wide"><label class="label" for="p-name">Name</label><input class="input" id="p-name" data-k="name" maxlength="80" value="${esc(p ? p.name : "")}"></div>
      <div><label class="label" for="p-role">Role</label><select class="select" id="p-role" data-k="role"><option value="">Not set</option>${ROLES.map((x) => `<option ${p && p.role === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div><label class="label" for="p-age">Age</label><input class="input" id="p-age" data-k="age" inputmode="numeric" maxlength="2" value="${esc(p && p.age ? p.age : "")}"></div>
      <div><label class="label" for="p-cat">Category</label><select class="select" id="p-cat" data-k="category" ${p && ["live", "sold", "retained"].includes(p.status) ? "disabled" : ""}>${A.categories.map((c) => `<option value="${esc(c.code)}" ${(p ? p.category : "B") === c.code ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>
      <div class="wide"><label class="label" for="p-played">Tournaments played <span class="opt">(optional)</span></label><input class="input" id="p-played" data-k="tournaments_played" maxlength="300" value="${esc(p ? p.tournaments_played || "" : "")}"></div>
      <div class="wide"><label class="label" for="p-notes">Notes <span class="opt">(admin only)</span></label><input class="input" id="p-notes" data-k="notes" maxlength="500" value="${esc(p ? p.notes || "" : "")}"></div></div>
      <p class="form-err" id="p-err" role="alert" hidden style="margin-top:12px"></p>
      <div class="dlg-acts" style="margin-top:14px"><button class="mini" type="button" data-d="no">Cancel</button><button class="btn" type="submit">Save</button></div></form>`);
  }
  function importDialog(pre) {
    const rows = (A.registrations || []);
    const free = rows.filter((r) => !r.imported);
    const preset = new Set(pre ? [pre] : []);
    openDlg(`<form data-submit="import"><h2>Add registered players</h2>
      <p class="hint" style="margin:6px 0 10px">Pick who goes into the auction pool. Name, role, age and tournaments are copied from the registration.</p>
      <div class="toolbar"><div class="seg" role="group" aria-label="Show"><button type="button" data-d2="all" aria-pressed="true">All (${free.length})</button><button type="button" data-d2="verified" aria-pressed="false">Payment received (${free.filter((r) => r.payment_status === "verified").length})</button></div>
        <button class="mini" type="button" data-d2="toggle">Select all shown</button></div>
      <div class="importlist" id="implist">${rows.map((r) => `<label class="imp${r.imported ? " done" : ""}" data-pay="${esc(r.payment_status)}"><input type="checkbox" value="${esc(r.id)}" ${r.imported ? "disabled" : ""} ${preset.has(r.id) ? "checked" : ""}><span><b>${esc(r.name)}</b><small>${esc(r.role)} · ${esc(r.tournaments_played || "")}</small></span><span class="badge b-${r.imported ? "sold" : esc(r.payment_status)}">${r.imported ? "In auction" : esc(PAY[r.payment_status])}</span></label>`).join("") || `<p class="hint">No registrations yet.</p>`}</div>
      <div class="fgrid" style="margin-top:12px"><div><label class="label" for="i-cat">Category for these players</label><select class="select" id="i-cat">${A.categories.map((c) => `<option value="${esc(c.code)}" ${c.code === "B" ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div></div>
      <p class="form-err" id="i-err" role="alert" hidden style="margin-top:12px"></p>
      <div class="dlg-acts" style="margin-top:14px"><button class="mini" type="button" data-d="no">Cancel</button><button class="btn" type="submit">Add to auction</button></div></form>`);
  }

  // ---- delegated dialog events ----
  dbody.addEventListener("click", (e) => {
    if (e.target.closest("[data-d='no']") && !e.target.closest("[data-d='yes']")) { if (!dbody.querySelector("[data-d='yes']")) closeDlg(); return; }
    const b = e.target.closest("[data-d2]"); if (!b) return;
    const list = $("#implist");
    if (b.dataset.d2 === "toggle") { const boxes = $$("label:not([hidden]) input:not(:disabled)", list); const all = boxes.every((x) => x.checked); boxes.forEach((x) => (x.checked = !all)); return; }
    $$("[data-d2='all'],[data-d2='verified']").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $$("label", list).forEach((l) => (l.hidden = b.dataset.d2 === "verified" && l.dataset.pay !== "verified"));
  });
  dbody.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target, kind = form.dataset.submit;
    if (kind === "reg-save") return saveReg(form);
    if (kind === "player-save") {
      const d = {}; $$("[data-k]", form).forEach((n) => (d[n.dataset.k] = n.value));
      const id = form.dataset.id;
      const ok = await act(id ? "update_player" : "add_player", id ? { id, ...d } : d, id ? "Player updated" : "Player added");
      if (ok) closeDlg(); else { const m = $("#toast").textContent; const er = $("#p-err"); er.textContent = m; er.hidden = false; }
    } else if (kind === "import") {
      const ids = $$("#implist input:checked", form).map((x) => x.value);
      const ok = await act("import", { registration_ids: ids, category: $("#i-cat").value }, `${ids.length} player${ids.length === 1 ? "" : "s"} added to the auction`);
      if (ok) closeDlg(); else { const er = $("#i-err"); er.textContent = $("#toast").textContent; er.hidden = false; }
    } else if (kind === "retain") {
      const ok = await act("retain", { player_id: form.dataset.id, team_id: $("#ret-team").value }, "Player retained");
      if (ok) closeDlg();
    } else if (kind === "reset") {
      const ok = await act("reset", { confirm: $("#reset-word").value.trim(), include_retained: $("#reset-ret").checked }, "Auction reset");
      if (ok) closeDlg();
    }
  });

  // =====================================================================
  // EVENTS (delegated)
  // =====================================================================
  const view = $("#view");
  view.addEventListener("input", (e) => {
    const n = e.target, k = n.dataset.keep; if (!k) return;
    if (k === "regq") { ui.regQ = n.value; render(); return; }
    if (k === "pq") { ui.pq = n.value; render(); return; }
    if (k === "pickq") { ui.pickQ = n.value; render(); return; }
    drafts[k] = n.value;
  });
  view.addEventListener("change", async (e) => {
    const n = e.target, k = n.dataset.keep; if (k && !["regq", "pq", "pickq"].includes(k)) drafts[k] = n.value;
    if (n.dataset.change === "player-cat") { const id = n.closest("[data-id]").dataset.id; await act("update_player", { id, category: n.value }, "Category updated"); render(); }
    if (n.dataset.change === "photos") { await act("update_settings", { show_photos: n.checked }, n.checked ? "Photos shown on the public page" : "Photos hidden on the public page"); }
  });

  const clearDrafts = (prefix) => Object.keys(drafts).forEach((k) => k.startsWith(prefix) && delete drafts[k]);
  const idOf = (b) => { const el = b.closest("[data-id]"); return el && el.dataset.id; };
  const handlers = {
    // registrations
    regfilter: (b) => { ui.regFilter = b.dataset.v; render(); },
    csv() {
      const cols = ["reference", "completed_at", "name", "age", "phone", "role", "jersey_size", "tournaments_played", "crichero_url", "payment_status", "organiser_notes"];
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
      const csv = [cols.join(","), ...regsVisible().map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = "turf-slam-registrations.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async pay(b) {
      const id = idOf(b), r = R.find((x) => x.id === id); if (!r) return;
      const v = b.dataset.v === r.payment_status ? "awaiting_review" : b.dataset.v, prev = r.payment_status;
      r.payment_status = v; render();
      const { data } = await post("/api/admin/registrations", { id, payment_status: v }, "PATCH");
      if (!data.ok) { r.payment_status = prev; render(); toast(data.message || "Couldn't update payment.", true); }
      else { Object.assign(r, data.row); render(); toast(v === "verified" ? "Payment marked received" : v === "due" ? "Payment marked due" : "Payment reset to awaiting review"); }
    },
    "reg-add": () => regDialog(null),
    "reg-edit": (b) => regDialog(R.find((x) => x.id === idOf(b))),
    async "reg-del"(b) {
      const r = R.find((x) => x.id === idOf(b));
      if (!await ask({ title: "Delete entry?", text: `This permanently removes ${r.name} (${r.reference}) and their uploaded images. It can't be undone.`, ok: "Delete permanently", danger: true })) return;
      const { data } = await post("/api/admin/registrations", { id: r.id }, "DELETE");
      if (!data.ok) return toast(data.message || "Couldn't delete.", true);
      R = R.filter((x) => x.id !== r.id); seenRegs && seenRegs.delete(r.id); render(); toast("Entry deleted");
    },
    "reg-to-auction": (b) => { if (!A.registrations) return; importDialog(idOf(b)); },
    img(b) {
      const r = R.find((x) => x.id === idOf(b)), kind = b.dataset.kind;
      $("#img-h").textContent = `${kind === "photo" ? "Photograph" : "Payment screenshot"} · ${r.name}`; $("#img-el").alt = $("#img-h").textContent;
      $("#img-el").src = `/api/admin/image?id=${encodeURIComponent(r.id)}&kind=${kind}&t=${Date.now()}`; $("#img-dlg").showModal();
    },
    // live
    "open-lot": (b) => act("open_lot", { player_id: idOf(b) }, "On the block"),
    random: () => act("random", { category: ui.pickCat === "any" ? undefined : ui.pickCat }, "On the block"),
    pickcat: (b) => { ui.pickCat = b.dataset.v; render(); },
    bid: (b) => act("bid", { team_id: b.dataset.team }),
    async jump() {
      const team_id = drafts.jteam || ($("#jteam") && $("#jteam").value), amount = money(drafts.jamt);
      if (!(amount > 0)) return toast("Enter the amount to bid.", true);
      if (await act("bid", { team_id, amount })) delete drafts.jamt;
    },
    sell: () => act("sell", {}, "Sold"),
    unsold: () => act("unsold", {}, "Marked unsold"),
    undo: () => act("undo_bid", {}, "Last bid removed"),
    pause: (b) => act("pause", { paused: b.dataset.v === "1" }, b.dataset.v === "1" ? "Auction paused" : "Auction resumed"),
    // players
    pfilter: (b) => { ui[b.dataset.k] = b.dataset.v; render(); },
    import: () => importDialog(null),
    "player-add": () => playerDialog(null),
    "player-edit": (b) => playerDialog(player(idOf(b))),
    async "player-del"(b) {
      const p = player(idOf(b));
      if (await ask({ title: "Delete player?", text: `${p.name} is removed from the auction${p.team_id ? " and the team's purse is refunded" : ""}. The registration itself stays.`, ok: "Delete", danger: true })) act("delete_player", { id: p.id }, "Player deleted");
    },
    retain(b) {
      const p = player(idOf(b));
      openDlg(`<form data-submit="retain" data-id="${esc(p.id)}"><h2>Retain ${esc(p.name)}</h2><p class="hint" style="margin:6px 0 12px">Retention value ${INR(cat(p.category).retention_value)} comes off the team's purse.</p>
        <label class="label" for="ret-team">Team</label><select class="select" id="ret-team">${A.teams.map((t) => `<option value="${t.id}">${esc(t.name)} (${t.retained_count}/${A.settings.retain_per_team} retained)</option>`).join("")}</select>
        <div class="dlg-acts" style="margin-top:14px"><button class="mini" type="button" data-d="no">Cancel</button><button class="btn" type="submit">Retain</button></div></form>`);
    },
    release: (b) => act("retain", { player_id: idOf(b), team_id: null }, "Player released"),
    async revert(b) {
      const p = player(idOf(b));
      if (await ask({ title: "Revert this sale?", text: `${p.name} goes back to the pool and ${INR(p.price)} is refunded to ${team(p.team_id).name}.`, ok: "Revert sale", danger: true })) act("revert", { player_id: p.id, to: "pool" }, "Sale reverted");
    },
    // teams
    "team-add": () => act("add_team", {}, "Team added"),
    async "team-save"(b) {
      const card = b.closest("[data-team]"), id = card.dataset.team, body = { id };
      $$("[data-f]", card).forEach((n) => (body[n.dataset.f] = n.value));
      if (await act("update_team", body, "Team saved")) clearDrafts(`t${id}-`);
    },
    async "team-del"(b) {
      const t = team(b.closest("[data-team]").dataset.team);
      if (await ask({ title: "Delete team?", text: `${t.name} is removed.`, ok: "Delete team", danger: true })) act("delete_team", { id: t.id }, "Team deleted");
    },
    async "team-retain"(b) {
      const card = b.closest("[data-team]"), id = card.dataset.team, pid = $(`#t${id}-ret`).value;
      if (!pid) return toast("Choose a player to retain.", true);
      if (await act("retain", { player_id: pid, team_id: id }, "Player retained")) clearDrafts(`t${id}-ret`);
    },
    // rules
    async "cats-save"() {
      const rows = $$("tr[data-code]").map((tr) => { const o = { code: tr.dataset.code }; $$("[data-f]", tr).forEach((n) => (o[n.dataset.f] = n.value.trim() === "" ? null : money(n.value))); return o; });
      if (await act("update_categories", { rows }, "Categories saved")) clearDrafts("c-");
    },
    async "settings-save"() { if (await act("update_settings", { title: drafts["s-title"] ?? A.title, retain_per_team: money(drafts["s-ret"] ?? A.settings.retain_per_team) }, "Settings saved")) { delete drafts["s-title"]; delete drafts["s-ret"]; } },
    async "purse-all"() { if (await act("set_purse_all", { purse_total: money(drafts["s-purse"] ?? A.teams[0].purse_total) }, "Purse applied to all teams")) delete drafts["s-purse"]; },
    reset() {
      openDlg(`<form data-submit="reset"><h2>Reset the auction?</h2><p>Every sold, unsold and live player returns to the pool, all bids and the log are cleared, and purses are refunded. This can't be undone.</p>
        <label class="label" for="reset-word" style="margin-top:12px">Type RESET to confirm</label><input class="input" id="reset-word" autocomplete="off">
        <label class="label" style="margin-top:12px"><input type="checkbox" id="reset-ret" style="width:20px;height:20px;accent-color:#c8f03a;vertical-align:-4px"> Also release retained players</label>
        <div class="dlg-acts" style="margin-top:14px"><button class="mini" type="button" data-d="no">Cancel</button><button class="mini solid-danger" type="submit">Reset auction</button></div></form>`);
    },
  };
  view.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b && handlers[b.dataset.act]) handlers[b.dataset.act](b, e); });

  $("#img-close").addEventListener("click", () => $("#img-dlg").close());
  $("#img-dlg").addEventListener("close", () => $("#img-el").removeAttribute("src"));
  $("#img-dlg").addEventListener("click", (e) => { if (e.target === $("#img-dlg")) $("#img-dlg").close(); });

  // keys 1-9, 0 bid for teams 1-10 on the live screen
  document.addEventListener("keydown", (e) => {
    if (route !== "live" || dlg.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName)) return;
    if (!/^[0-9]$/.test(e.key)) return;
    const t = A.teams[(Number(e.key) + 9) % 10], b = t && $(`.tbtn[data-team="${t.id}"]:not(:disabled)`);
    if (b) b.click();
  });

  setRoute();
  boot();
})();
