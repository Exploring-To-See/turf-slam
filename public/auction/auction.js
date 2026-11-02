(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const INR = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const trim = (x) => String(+x.toFixed(2));
  const short = (n) => (n >= 1e7 ? `₹${trim(n / 1e7)} Cr` : n >= 1e5 ? `₹${trim(n / 1e5)} L` : INR(n));
  const initials = (name) => (String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let snap = null, version = -1, tab = "teams", filter = "all", query = "";
  let lastEvent = null, stamp = null, lastStageHtml = "", lastPrice = null, lastLot = null, failures = 0;

  // ---------- opening ----------
  const intro = $("#intro");
  function endIntro() { if (!intro.isConnected) return; intro.remove(); document.body.classList.remove("lock"); }
  (function runIntro() {
    let seen = false;
    try { seen = sessionStorage.getItem("ts-auction-intro") === "1"; sessionStorage.setItem("ts-auction-intro", "1"); } catch (_) {}
    if (seen) return endIntro();
    $("#intro-skip").addEventListener("click", endIntro);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") endIntro(); });
    setTimeout(endIntro, reduce ? 900 : 4150);
  })();

  // ---------- data ----------
  async function poll() {
    try {
      const r = await fetch(`/api/auction/state?since=${version}`, { headers: { accept: "application/json" } });
      const d = await r.json();
      if (!d.ok) throw new Error("feed");
      failures = 0;
      if (d.changed) { snap = d; version = d.v; render(); }
      setLive();
    } catch (_) { failures++; if (failures > 1) setLive(true); }
    setTimeout(poll, document.hidden ? 6000 : 2000);
  }
  function setLive(off) {
    const el = $("#live"), t = $("#live-t");
    if (off || !snap) { el.className = "live off"; t.textContent = off ? "Reconnecting" : "Connecting"; return; }
    const s = snap.state.status;
    el.className = "live" + (s === "paused" ? " paused" : "");
    t.textContent = s === "live" ? "Bidding live" : s === "paused" ? "Paused" : "Live feed";
  }

  const team = (id) => snap.teams.find((t) => t.id === id);
  const player = (id) => snap.players.find((p) => p.id === id);
  const cat = (code) => snap.categories.find((c) => c.code === code);

  // ---------- render ----------
  function render() {
    document.title = `${snap.title} · Turf Slam`;
    $("#ev-title").textContent = snap.title;
    noteStamp();
    renderStage();
    renderTeams();
    renderPlayers();
    renderFeed();
    renderRules();
    $("#n-teams").textContent = snap.teams.length;
    $("#n-players").textContent = snap.players.length;
    $("#n-results").textContent = snap.events.filter((e) => ["sold", "unsold"].includes(e.kind)).length;
  }

  // A sale or unsold call that arrives while the page is open gets the stamp for a few seconds.
  function noteStamp() {
    const newest = snap.events.length ? snap.events[0].id : 0;
    if (lastEvent === null) { lastEvent = newest; return; }
    const fresh = snap.events.filter((e) => e.id > lastEvent && (e.kind === "sold" || e.kind === "unsold"));
    lastEvent = newest;
    if (fresh.length) {
      const e = fresh[0];
      stamp = { kind: e.kind, name: e.player_name, team: e.team_name, amount: e.amount, until: Date.now() + 9000 };
      setTimeout(() => { if (stamp && Date.now() >= stamp.until) { stamp = null; renderStage(); } }, 9100);
    }
  }

  function avatar(p, eager) {
    return p.has_photo ? `<img src="/api/auction/state?photo=${esc(p.id)}" alt="" ${eager ? "" : 'loading="lazy" '}decoding="async" onerror="this.remove()">` : "";
  }
  const stampHtml = () => (stamp && Date.now() < stamp.until
    ? `<div class="stamp ${stamp.kind === "unsold" ? "unsold" : ""}" role="status"><span class="big">${stamp.kind === "sold" ? "Sold" : "Unsold"}</span><span class="who">${esc(stamp.name)}${stamp.kind === "sold" ? ` to ${esc(stamp.team)}` : ""}</span>${stamp.kind === "sold" ? `<span class="amt">${INR(stamp.amount)}</span>` : ""}</div>` : "");

  function renderStage() {
    const st = snap.state, p = st.player_id ? player(st.player_id) : null;
    let html;
    if (p && (st.status === "live" || st.status === "paused")) {
      const c = cat(p.category), lead = st.leading_team_id ? team(st.leading_team_id) : null;
      const base = c.base_price, step = c.increment;
      const next = lead ? st.price + step : base;
      const bids = st.bids.map((b) => { const t = team(b.team_id); return `<li><i class="swatch" style="--c:${esc(t ? t.color : "#c8f03a")}"></i><span>${esc(t ? t.name : "Team")}</span><b class="num">${INR(b.amount)}</b></li>`; }).join("");
      html = `
        <article class="lot">
          <div class="lot-photo"><span class="serial">#${String(p.serial).padStart(2, "0")}</span><div class="initials" aria-hidden="true">${esc(initials(p.name))}</div>${avatar(p, true)}</div>
          <div class="lot-info">
            <p class="kicker">On the block</p>
            <h2 class="lot-name">${esc(p.name)}</h2>
            <div class="tags"><span class="tag cat">${esc(c.label)}</span>${p.role ? `<span class="tag">${esc(p.role)}</span>` : ""}${p.age ? `<span class="tag">Age ${esc(p.age)}</span>` : ""}</div>
            ${p.tournaments_played ? `<p class="played"><b>Tournaments played</b>${esc(p.tournaments_played)}</p>` : ""}
            <dl class="facts"><div><dt>Base price</dt><dd>${INR(base)}</dd></div><div><dt>Bid step</dt><dd>${INR(step)}</dd></div></dl>
          </div>
        </article>
        <aside class="board" aria-label="Current bid">
          <p class="kicker">${lead ? "Current bid" : "Opening price"}</p>
          <div class="price-wrap"><div class="price num" id="price">${INR(st.price)}</div></div>
          ${st.status === "paused" ? `<p class="paused-flag">Auction paused</p>` : ""}
          <div class="leader">${lead ? `<i class="swatch" style="--c:${esc(lead.color)}"></i><b>${esc(lead.name)}</b><small>leading</small>` : `<b>No bids yet</b><small>waiting for the first bid</small>`}</div>
          <p class="next">${lead ? "Next bid" : "First bid"} <b>${INR(next)}</b></p>
          ${bids ? `<ol class="ladder" aria-label="Bid history">${bids}</ol>` : ""}
        </aside>`;
    } else {
      const last = snap.events.find((e) => e.kind === "sold" || e.kind === "unsold");
      const recent = last && Date.now() - new Date(last.created_at).getTime() < 10 * 60 * 1000;
      const sold = snap.players.filter((x) => x.status === "sold").length;
      const nothing = !snap.events.length && !sold;
      const left = snap.players.filter((x) => x.status === "pool" && cat(x.category).base_price).length;
      html = stampHtml() ? `<div class="idle">${stampHtml()}</div>` : `<div class="idle">
        <p class="kicker">${nothing ? "Auction not started" : "Between players"}</p>
        <h2>${nothing ? "The auction starts soon" : "Next player coming up"}</h2>
        <p>${nothing ? "Teams, purses and the player list are below. This page updates live once bidding opens." : `${left} player${left === 1 ? "" : "s"} still to come.`}</p>
        ${recent ? `<p class="last">${last.kind === "sold" ? `Last sale: <b>${esc(last.player_name)}</b> to <b>${esc(last.team_name)}</b> for <b>${INR(last.amount)}</b>` : `<b>${esc(last.player_name)}</b> went unsold`}</p>` : ""}
      </div>`;
    }
    if (p && (st.status === "live" || st.status === "paused")) html += stampHtml();
    if (html === lastStageHtml) return;
    lastStageHtml = html;
    $("#stage").innerHTML = html;
    const pe = $("#price");
    if (pe && lastLot === (p && p.id) && lastPrice !== null && lastPrice !== st.price && !reduce) { pe.classList.add("bump"); }
    lastPrice = p ? st.price : null; lastLot = p ? p.id : null;
  }

  function renderTeams() {
    const lead = snap.state.leading_team_id;
    $("#teams-note").textContent = "Retained players are marked R. Max bid keeps enough back to fill the squad.";
    $("#teams").innerHTML = snap.teams.map((t) => {
      const mine = snap.players.filter((p) => p.team_id === t.id).sort((a, b) => (a.status === "retained" ? 0 : 1) - (b.status === "retained" ? 0 : 1) || String(a.sold_at).localeCompare(String(b.sold_at)));
      const pips = Array.from({ length: t.max_squad }, (_, i) => `<i class="${i < t.retained_count ? "r" : i < t.squad ? "b" : ""}"></i>`).join("");
      const rows = mine.map((p) => `<li><span>${esc(p.name)}${p.status === "retained" ? "<em>R</em>" : ""}</span><b class="num">${short(p.price)}</b></li>`).join("");
      return `<article class="team${lead === t.id ? " lead" : ""}" style="--c:${esc(t.color)}">
        <div class="team-h"><h3>${esc(t.name)}</h3><small>of ${short(t.purse_total)}</small></div>
        <dl class="team-money">
          <div><dt>Purse left</dt><dd class="num">${short(t.purse_left)}</dd></div>
          <div class="sm"><dt>Max bid</dt><dd class="num">${t.slots_left > 0 ? short(t.max_bid) : "Full"}</dd></div>
          <div class="pips" aria-label="${t.squad} of ${t.max_squad} players">${pips}<span class="num">${t.squad}/${t.max_squad}</span></div>
        </dl>
        <ul class="squad">${rows || `<li class="empty">No players yet</li>`}</ul>
      </article>`;
    }).join("");
  }

  const AVAIL = (p) => (p.status === "pool" || p.status === "live") && cat(p.category).base_price;
  function renderPlayers() {
    const q = query.trim().toLowerCase();
    const rows = snap.players.filter((p) => {
      if (filter === "available" && !AVAIL(p)) return false;
      if (["sold", "unsold", "retained"].includes(filter) && p.status !== filter) return false;
      if (["A", "B"].includes(filter) && p.category !== filter) return false;
      return !q || `${p.name} ${p.role || ""}`.toLowerCase().includes(q);
    }).sort((a, b) => (b.status === "live") - (a.status === "live") || a.serial - b.serial);
    const left = snap.players.filter(AVAIL).length;
    $("#players-note").textContent = `${snap.players.length} players · ${left} still available`;
    $("#plist").innerHTML = rows.length ? rows.map((p) => {
      const t = p.team_id ? team(p.team_id) : null, c = cat(p.category);
      const stat = p.status === "sold" || p.status === "retained"
        ? `<b class="num">${INR(p.price)}</b><small><span class="st ${p.status}">${p.status === "sold" ? "Sold" : "Retained"}</span>${t ? esc(t.name) : ""}</small>`
        : `<b class="num">${c.base_price ? INR(c.base_price) : "Retention only"}</b><small><span class="st ${p.status}">${p.status === "live" ? "On the block" : p.status === "unsold" ? "Unsold" : "Available"}</span></small>`;
      return `<li class="prow${p.status === "live" ? " live" : ""}"><div class="av"><span aria-hidden="true">${esc(initials(p.name))}</span>${avatar(p)}</div>
        <div class="pmain"><b>${esc(p.name)}</b><small><span class="cat-dot">${esc(p.category)}</span>${esc(p.role || "Player")}${p.age ? ` · ${esc(p.age)} yrs` : ""}</small></div>
        <div class="pstat">${stat}</div></li>`;
    }).join("") : `<li class="empty-note" style="grid-column:1/-1">${snap.players.length ? "No players match." : "The player list will appear here once it's published."}</li>`;
  }

  function renderFeed() {
    const kinds = { sold: "Sold", unsold: "Unsold", retain: "Retained", unretain: "Released", revert: "Reversed" };
    const rows = snap.events.filter((e) => kinds[e.kind]);
    $("#feed").innerHTML = rows.length ? rows.map((e) => {
      const who = `<b>${esc(e.player_name || "Player")}</b>`;
      const text = e.kind === "sold" ? `${who} sold to <b>${esc(e.team_name)}</b> for <b class="num">${INR(e.amount)}</b>`
        : e.kind === "unsold" ? `${who} went unsold`
        : e.kind === "retain" ? `<b>${esc(e.team_name)}</b> retained ${who} for <b class="num">${INR(e.amount)}</b>`
        : e.kind === "unretain" ? `${who} released by <b>${esc(e.team_name)}</b>`
        : `Sale of ${who} reversed`;
      return `<li><span class="k ${e.kind}">${kinds[e.kind]}</span><span class="t">${text}</span><time datetime="${esc(e.created_at)}">${esc(time(e.created_at))}</time></li>`;
    }).join("") : `<li class="empty-note">Nothing yet. Sales appear here as they happen.</li>`;
  }

  function renderRules() {
    const t0 = snap.teams[0], per = snap.settings.retain_per_team;
    const items = [];
    if (t0) {
      items.push(["Teams", snap.teams.length, ""]);
      items.push(["Squad", `${t0.max_squad} players`, `${per} retained + ${Math.max(t0.max_squad - per, 0)} to buy`]);
      items.push(["Purse per team", short(t0.purse_total), INR(t0.purse_total)]);
    }
    for (const c of snap.categories) {
      if (c.retention_value) items.push([`Retention ${c.code}`, short(c.retention_value), "deducted from the purse"]);
    }
    for (const c of snap.categories) {
      if (c.base_price) items.push([`Category ${c.code}`, `${INR(c.base_price)} base`, `${INR(c.increment)} per bid`]);
    }
    items.push(["Maximum bid", "Remaining purse", "enough stays back to fill the squad"]);
    $("#rules").innerHTML = items.map(([k, v, s]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}${s ? `<small>${esc(s)}</small>` : ""}</dd></div>`).join("");
  }

  // ---------- tabs / filters ----------
  const tabs = [...document.querySelectorAll("#tabs [data-tab]")];
  function selectTab(name, focus) {
    tab = name;
    tabs.forEach((b) => { const on = b.dataset.tab === name; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    for (const n of ["teams", "players", "results"]) $("#p-" + n).hidden = n !== name;
  }
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => selectTab(b.dataset.tab));
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true); }
    });
  });
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    filter = b.dataset.f; document.querySelectorAll("#chips .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    if (snap) renderPlayers();
  });
  $("#q").addEventListener("input", (e) => { query = e.target.value; if (snap) renderPlayers(); });

  poll();
})();
