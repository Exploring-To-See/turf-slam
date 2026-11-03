/* The official auction list (A and B category players) and the name matching used to check it against the
   registrations. Shared by the admin console (browser) and the API (Node), so both sides agree on who is who.
   Names are matched on letters only, lower case, with doubled letters squashed ("Aanurag" = "Anurag",
   "Anujj" = "Anuj"); anything else that differs is reported so it can be fixed by hand. */
(function (root) {
  "use strict";
  const ROSTER = {
    A: [
      "Aditya Bhagchandani", "Akshat Harlalka", "Aman Daga", "Aman Gupta", "Anurag Pandey", "Gaurav Agarwal",
      "Hardik Jalan", "Hari Harlalka", "Jitesh Singh", "Mayank Dhanania", "Mayank Jaiswal", "Mayank Sonthalia",
      "Mohit Hirawat", "Nikunj Daga", "Nitin Jain", "Pratik Jaiswal", "Raashik Saraf", "Rachit Keshwani",
      "Rajkrish Saraf", "Rishav Shaw", "Sanchit Adukia", "Somesh Singh", "Sunny Sharma", "Tanuj Mundhra",
    ],
    B: [
      "Aanurag Dalmia", "Aditya Gupta", "Aman Murarka", "Amit Beriwal", "Anant Arora", "Ankit Agarwal",
      "Anujj Saraogi", "Arjun Jindal", "Ashish Jain", "Ayush Agarwal", "Ayush Bhatter", "Ayush Fatehchandka",
      "Ayush Jayaswal", "Debasis Chakravarthy", "Devansh Mittal", "Farazuddin", "Harshit Didwania", "Hitesh Gupta",
      "Ishaan Rathi", "Ishan Joshi", "Jayant Nahata", "Kanishq Tibrewala", "Keshav Agarwal", "Keshav Rathi",
      "Khushal Baid", "Kunal Dujari", "Kunal Sarda", "Kushal Agarwal", "Lakshya Bajaj", "Misal Agarwal",
      "Mukesh Singhi", "Navin Shaw", "Prithvi Sharma", "Rajdeep Sen", "Riju Sharma", "Ronak Lunia",
      "Sashank Jaiswal", "Sudip Agarwal", "Sulav Ganeriwal", "Swayam Daga", "Vatsal Mundhra", "Vidharb Jalan",
      "Vikas Agarwal", "Yashpal Parekh", "Yousuf Jamal", "Yuvraj Daswani",
    ],
  };
  const TOTAL = ROSTER.A.length + ROSTER.B.length;

  const key = (name) => String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1");
  function dist(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 9;
    const d = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return d[b.length];
  }
  const LIST = [].concat(ROSTER.A.map((n) => ({ name: n, category: "A", key: key(n) })), ROSTER.B.map((n) => ({ name: n, category: "B", key: key(n) })));
  const byKey = new Map(LIST.map((x) => [x.key, x]));

  // The list entry for a name, or null.
  const listed = (name) => byKey.get(key(name)) || null;
  // Closest names from `pool` (strings) to `name`, for "did you mean" hints.
  function near(name, pool, max = 2) {
    const k = key(name);
    return pool.map((n) => ({ n, d: dist(k, key(n)) })).filter((x) => x.d > 0 && x.d <= max).sort((a, b) => a.d - b.d).slice(0, 2).map((x) => x.n);
  }

  /* Compare the list with the registrations (and the auction players, if given).
     regs: [{id, name, payment_status}], players: [{id, name, category, status, registration_id}] */
  function check(regs, players = []) {
    const paid = regs.filter((r) => r.payment_status === "verified");
    const regsByKey = new Map();
    for (const r of regs) { const k = key(r.name); if (!regsByKey.has(k)) regsByKey.set(k, []); regsByKey.get(k).push(r); }
    const playerByReg = new Map(players.filter((p) => p.registration_id).map((p) => [p.registration_id, p]));
    const regNames = regs.map((r) => r.name), listNames = LIST.map((x) => x.name);

    const missing = [], unpaid = [], dupes = [], matched = [];
    for (const x of LIST) {
      const hits = regsByKey.get(x.key) || [];
      const paidHits = hits.filter((r) => r.payment_status === "verified");
      if (!hits.length) missing.push({ ...x, near: near(x.name, regNames) });
      else if (!paidHits.length) unpaid.push({ ...x, reg: hits[0] });
      else { if (paidHits.length > 1) dupes.push({ ...x, regs: paidHits }); matched.push({ ...x, reg: paidHits[0], player: playerByReg.get(paidHits[0].id) || null }); }
    }
    const unlisted = paid.filter((r) => !byKey.has(key(r.name))).map((r) => ({ reg: r, near: near(r.name, listNames) }));
    const notImported = matched.filter((m) => !m.player);
    const wrongCat = matched.filter((m) => m.player && m.player.category !== m.category);
    const retainedToFix = players.filter((p) => p.status === "retained" && p.category !== "A" && p.category !== "A+");
    return { total: TOTAL, paid: paid.length, matched, missing, unpaid, dupes, unlisted, notImported, wrongCat, retainedToFix };
  }

  const api = { ROSTER, TOTAL, LIST, key, listed, near, check };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TSRoster = api;
})(typeof window !== "undefined" ? window : globalThis);
