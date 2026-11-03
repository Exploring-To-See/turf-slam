/* The official A / B category list and the name matching used to look a registered player up in it.
   The list never adds players: the auction pool is only people who filled the registration form. Shared by the admin console (browser) and the API (Node), so both sides agree on who is who.
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

  /* Players come only from the registration form; the list is just where categories come from.
     For every registration with payment received this works out what it needs:
       notImported   not in the auction yet (Apply adds them, with their list category if they have one)
       fillFromList  in the auction with no category, but on the list (Apply fills it in)
       mismatch      category differs from the list (Apply sets the list category)
       needCategory  not on the list and no category yet: an admin sets it by hand
       byHand        not on the list, category set by an admin (fine)
       dupes         the same name registered more than once with payment received
     plus pool players who did not come from a paid form (left out of the auction) and retained players
     who are not A or A+ (Apply makes them A+).
     regs: [{id, name, payment_status}], players: [{id, name, category, status, registration_id, payment_status}] */
  function check(regs, players = []) {
    const paid = regs.filter((r) => r.payment_status === "verified");
    const playerByReg = new Map(players.filter((p) => p.registration_id).map((p) => [p.registration_id, p]));
    const listNames = LIST.map((x) => x.name);
    const rows = paid.map((r) => { const l = listed(r.name); return { reg: r, name: r.name, list: l, player: playerByReg.get(r.id) || null, near: l ? [] : near(r.name, listNames) }; });
    const byName = new Map();
    for (const x of rows) { const k = key(x.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(x.reg); }
    const dupes = [...byName.values()].filter((g) => g.length > 1).map((g) => ({ name: g[0].name, regs: g }));
    const notImported = rows.filter((x) => !x.player);
    const fillFromList = rows.filter((x) => x.player && !x.player.category && x.list);
    const mismatch = rows.filter((x) => x.player && x.player.category && x.list && x.player.category !== x.list.category);
    const needCategory = rows.filter((x) => !x.list && !(x.player && x.player.category));
    const byHand = rows.filter((x) => !x.list && x.player && x.player.category);
    const notFromForm = players.filter((p) => (p.status === "pool" || p.status === "unsold") && p.payment_status !== "verified");
    const retainedToFix = players.filter((p) => p.status === "retained" && p.category !== "A" && p.category !== "A+");
    return { paid: paid.length, rows, dupes, notImported, fillFromList, mismatch, needCategory, byHand, notFromForm, retainedToFix };
  }

  const api = { ROSTER, TOTAL, LIST, key, listed, near, check };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TSRoster = api;
})(typeof window !== "undefined" ? window : globalThis);
