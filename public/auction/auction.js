(() => {
  "use strict";
  const S = window.TSStage;
  const $ = (s, r = document) => r.querySelector(s);
  const { esc, INR, short, initials } = S;
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let snap = null, version = -1, filter = "all", query = "", failures = 0, tab = "teams";
  const seen = { teams: false, players: false, feed: false };
  const counts = new Map();      // purse numbers, so they roll from the old value to the new one
  let prevSquads = null, prevFeedIds = null, tickerKey = "";
  const stage = S.presenter($("#stage"));
  { const ip = $("#i-pitch"); if (ip) ip.insertAdjacentHTML("afterbegin", S.marksHtml()); }
  const tabs = [...document.querySelectorAll("#tabs [data-tab]")];

  // ---------- opening ----------
  const intro = $("#intro");
  // the page is revealed while the stinger's dark panel covers the screen; the panels finish crossing, then the intro goes
  function reveal() {
    document.body.classList.remove("lock");
    const st = $("#stage"); if (st && st.querySelector(".ts-wrap")) S.restart(st, "is-enter", 2600);   // the player card plays its entrance as the opening lifts
    requestAnimationFrame(() => { document.body.classList.remove("pre"); document.body.classList.add("ready"); });
    placeSlider();
  }
  function endIntro() { if (intro.isConnected) intro.remove(); reveal(); }
  (function runIntro() {
    $("#intro-skip").addEventListener("click", endIntro);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && intro.isConnected) endIntro(); });
    if (S.reduce) setTimeout(endIntro, 900);
    else { setTimeout(reveal, 3780); setTimeout(endIntro, 4450); }
  })();

  // ---------- data ----------
  async function poll() {
    try {
      const r = await fetch(`/api/auction/state?since=${version}`, { headers: { accept: "application/json" } });
      const d = await r.json();
      if (!d.ok) throw new Error("feed");
      failures = 0;
      if (d.changed) { snap = d; version = d.v; render(); }
    } catch (_) { failures++; }
    setTimeout(poll, document.hidden ? 6000 : 2000);
  }

  const team = (id) => snap.teams.find((t) => t.id === id);
  const cat = (code) => snap.categories.find((c) => c.code === code) || { code: "", label: "Unassigned", base_price: null, increment: null };

  // ---------- render ----------
  function render() {
    document.title = `${snap.title} · Turf Slam`;
    stage.update(snap);
    $("#stats").innerHTML = S.statsHtml(snap);
    renderTicker();
    renderTeams();
    renderPlayers();
    renderFeed();
    renderRules();
    $("#n-teams").textContent = snap.teams.length;
    $("#n-players").textContent = snap.players.filter((p) => p.in_list).length;
    $("#n-results").textContent = snap.events.filter((e) => ["sold", "unsold"].includes(e.kind)).length;
    placeSlider();
  }

  function renderTicker() {
    const sales = snap.events.filter((e) => e.kind === "sold").slice(0, 10);
    const key = sales.map((e) => e.id).join();
    if (key === tickerKey) return; tickerKey = key;
    const box = $("#ticker"), track = $("#ticker-track");
    if (!sales.length) { box.classList.add("still"); track.innerHTML = "<span>Sales will scroll here as they happen</span>"; return; }
    const items = sales.map((e) => `<span><b>${esc(e.player_name)}</b> to ${esc(e.team_name)} <em>${INR(e.amount)}</em></span>`).join("");
    box.classList.toggle("still", S.reduce);
    track.style.setProperty("--dur", Math.max(26, sales.length * 7) + "s");
    track.innerHTML = items + items;
  }

  function avatar(p) {
    return `<div class="av"><span aria-hidden="true">${esc(initials(p.name))}</span>${p.has_photo ? `<img src="/api/auction/state?photo=${esc(p.id)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ""}</div>`;
  }

  function renderTeams() {
    const lead = snap.state.status === "live" ? snap.state.leading_team_id : null;
    $("#teams-note").textContent = "R = retained. Max bid keeps enough back to fill the squad.";
    const nowSquads = new Map(snap.players.filter((p) => p.team_id).map((p) => [p.id, p.team_id]));
    $("#teams").innerHTML = snap.teams.map((t, n) => {
      const mine = snap.players.filter((p) => p.team_id === t.id).sort((a, b) => (a.status === "retained" ? 0 : 1) - (b.status === "retained" ? 0 : 1) || String(a.sold_at).localeCompare(String(b.sold_at)));
      const pips = Array.from({ length: t.max_squad }, (_, i) => `<i class="${i < t.retained_count ? "r" : i < t.squad ? "b" : ""}"></i>`).join("");
      const rows = mine.map((p) => `<li${prevSquads && !prevSquads.has(p.id) ? ' class="just"' : ""}>${esc(p.name)}${p.status === "retained" ? "<em>R</em>" : ""}<b class="num">${short(p.price)}</b></li>`).join("");
      return `<article class="team${lead === t.id ? " lead" : ""}${seen.teams ? " static" : ""}" style="--c:${esc(t.color)};--n:${n}">
        <div class="team-name"><h3>${esc(t.name)}</h3><div class="pips" aria-label="${t.squad} of ${t.max_squad} players">${pips}<span class="num">${t.squad}/${t.max_squad}</span></div></div>
        <div class="team-num"><span>Purse left</span><b class="num" data-cnt="left-${t.id}" data-v="${t.purse_left}">${short(t.purse_left)}</b></div>
        <div class="team-num sm"><span>Max bid</span><b class="num" ${t.slots_left > 0 ? `data-cnt="max-${t.id}" data-v="${t.max_bid}"` : ""}>${t.slots_left > 0 ? short(t.max_bid) : "Full"}</b></div>
        <ul class="squad">${rows || `<li class="empty">No players yet</li>`}</ul>
      </article>`;
    }).join("");
    document.querySelectorAll("#teams [data-cnt]").forEach((el) => {
      const key = el.dataset.cnt, to = Number(el.dataset.v);
      if (counts.has(key)) el._v = counts.get(key);
      counts.set(key, to); S.countTo(el, to);
    });
    prevSquads = nowSquads; seen.teams = true;
  }

  const AVAIL = (p) => (p.status === "pool" || p.status === "live") && cat(p.category).base_price;
  function renderPlayers() {
    const q = query.trim().toLowerCase();
    const rows = snap.players.filter((p) => p.in_list).filter((p) => {
      if (filter === "available" && !AVAIL(p)) return false;
      if (["sold", "unsold", "retained"].includes(filter) && p.status !== filter) return false;
      if (["A", "B"].includes(filter) && p.category !== filter) return false;
      return !q || `${p.name} ${p.role || ""}`.toLowerCase().includes(q);
    }).sort((a, b) => (b.status === "live") - (a.status === "live") || a.serial - b.serial);
    const left = snap.players.filter(AVAIL).length;
    $("#players-note").textContent = `${snap.players.filter((p) => p.in_list).length} players · ${left} still available`;
    $("#plist").innerHTML = rows.length ? rows.map((p, n) => {
      const t = p.team_id ? team(p.team_id) : null, c = cat(p.category);
      const stat = p.status === "sold" || p.status === "retained"
        ? `<b class="num">${INR(p.price)}</b><small><span class="st ${p.status}">${p.status === "sold" ? "Sold" : "Retained"}</span>${t ? esc(t.name) : ""}</small>`
        : `<b class="num">${c.base_price ? INR(c.base_price) : "Retention only"}</b><small><span class="st ${p.status}">${p.status === "live" ? "Under hammer" : p.status === "unsold" ? "Unsold" : "Available"}</span></small>`;
      return `<li class="prow${p.status === "live" ? " live" : ""}${seen.players ? " static" : ""}" style="--n:${Math.min(n, 24)}">${avatar(p)}
        <div class="pmain"><b>${esc(p.name)}</b><small><span class="cat-dot">${esc(p.category || "–")}</span>${esc(p.role || "Player")}${p.age ? ` · ${esc(p.age)} yrs` : ""}</small></div>
        <div class="pstat">${stat}</div></li>`;
    }).join("") : `<li class="empty-note" style="grid-column:1/-1">${snap.players.some((p) => p.in_list) ? "No players match." : "The player list will appear here once it's published."}</li>`;
    seen.players = true;
  }

  function renderFeed() {
    const kinds = { sold: "Sold", unsold: "Unsold", retain: "Retained", unretain: "Released", revert: "Reversed" };
    const rows = snap.events.filter((e) => kinds[e.kind]);
    const ids = new Set(rows.map((e) => e.id));
    $("#feed").innerHTML = rows.length ? rows.map((e) => {
      const who = `<b>${esc(e.player_name || "Player")}</b>`;
      const text = e.kind === "sold" ? `${who} sold to <b>${esc(e.team_name)}</b> for <b class="num">${INR(e.amount)}</b>`
        : e.kind === "unsold" ? `${who} went unsold`
        : e.kind === "retain" ? `<b>${esc(e.team_name)}</b> retained ${who} for <b class="num">${INR(e.amount)}</b>`
        : e.kind === "unretain" ? `${who} released by <b>${esc(e.team_name)}</b>`
        : `Sale of ${who} reversed`;
      return `<li${prevFeedIds && !prevFeedIds.has(e.id) ? ' class="fresh"' : ""}><span class="k ${e.kind}">${kinds[e.kind]}</span><span class="t">${text}</span><time datetime="${esc(e.created_at)}">${esc(time(e.created_at))}</time></li>`;
    }).join("") : `<li class="empty-note">Nothing yet. Sales appear here as they happen.</li>`;
    prevFeedIds = ids;
  }

  function renderRules() {
    const t0 = snap.teams[0], per = snap.settings.retain_per_team;
    const items = [];
    if (t0) {
      items.push(["Teams", snap.teams.length, ""]);
      items.push(["Squad", `${t0.max_squad} players`, `${per} retained + ${Math.max(t0.max_squad - per, 0)} to buy`]);
      items.push(["Purse per team", short(t0.purse_total), INR(t0.purse_total)]);
    }
    for (const c of snap.categories) if (c.retention_value) items.push([`Retention ${c.code}`, short(c.retention_value), "deducted from the purse"]);
    for (const c of snap.categories) if (c.base_price) items.push([`Category ${c.code}`, `${INR(c.base_price)} base`, `${INR(c.increment)} per bid`]);
    items.push(["Maximum bid", "Remaining purse", "enough stays back to fill the squad"]);
    $("#rules").innerHTML = items.map(([k, v, s]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}${s ? `<small>${esc(s)}</small>` : ""}</dd></div>`).join("");
  }

  // ---------- tabs / filters ----------
  function placeSlider() {
    const on = tabs.find((b) => b.getAttribute("aria-selected") === "true"), s = $("#slider");
    if (!on || !s || !on.offsetWidth) return;
    s.style.width = on.offsetWidth + "px"; s.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  function selectTab(name, focus) {
    tab = name;
    tabs.forEach((b) => { const on = b.dataset.tab === name; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    for (const n of ["teams", "players", "results"]) { const p = $("#p-" + n); const show = n === name; if (show && p.hidden) S.restart(p, "in", 520); p.hidden = !show; }
    placeSlider();
  }
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => selectTab(b.dataset.tab));
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true); }
    });
  });
  addEventListener("resize", placeSlider);
  document.fonts && document.fonts.ready.then(placeSlider);
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    filter = b.dataset.f; document.querySelectorAll("#chips .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    seen.players = false; if (snap) renderPlayers();
  });
  $("#q").addEventListener("input", (e) => { query = e.target.value; if (snap) renderPlayers(); });

  poll();
})();
