const PDFDocument = require("pdfkit");
const { db } = require("../_lib/supabase");
const { adminRoute } = require("../_lib/admin");
const { one } = require("../_lib/auction");

const PAY = { verified: "Received", awaiting_review: "Awaiting", due: "Due" };
const ST = { pool: "To come", live: "On the block", sold: "Sold", unsold: "Unsold", retained: "Retained" };
const inr = (n) => (n == null ? "" : "Rs " + Number(n).toLocaleString("en-IN"));
const lvl = (v) => v || "Unassigned";

const GREEN = "#14532d", ZEBRA = "#f1f5ee", WARN = "#fff1c9", LINE = "#c9d3c4";

// Plain table with a repeating header row, zebra stripes and optional highlighted rows.
function table(doc, head, rows, widths, flag) {
  const x0 = doc.page.margins.left, rowH = 15, bottom = doc.page.height - doc.page.margins.bottom - 6;
  const header = (y) => {
    doc.rect(x0, y, widths.reduce((a, b) => a + b, 0), rowH).fill(GREEN);
    let x = x0; doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    head.forEach((h, i) => { doc.text(h, x + 3, y + 4, { width: widths[i] - 6, lineBreak: false }); x += widths[i]; });
  };
  let y = doc.y; header(y); y += rowH;
  rows.forEach((r, n) => {
    if (y + rowH > bottom) { doc.addPage(); y = doc.page.margins.top; header(y); y += rowH; }
    doc.rect(x0, y, widths.reduce((a, b) => a + b, 0), rowH).fill(flag && flag(r) ? WARN : n % 2 ? ZEBRA : "#ffffff");
    let x = x0; doc.fillColor("#111111").font("Helvetica").fontSize(8);
    r.forEach((c, i) => { doc.text(String(c ?? ""), x + 3, y + 4, { width: widths[i] - 6, lineBreak: false, ellipsis: true }); x += widths[i]; });
    doc.moveTo(x0, y + rowH).lineTo(x0 + widths.reduce((a, b) => a + b, 0), y + rowH).lineWidth(0.25).strokeColor(LINE).stroke();
    y += rowH;
  });
  doc.y = y + 4; doc.x = x0;
}

const h2 = (doc, text, sub) => {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.6).fillColor("#111111").font("Helvetica-Bold").fontSize(12).text(text);
  if (sub) doc.font("Helvetica").fontSize(8.5).fillColor("#555555").text(sub);
  doc.moveDown(0.3);
};

// GET /api/admin/report -> a live PDF of every registration and auction player: level and payment status.
module.exports = adminRoute(["GET"], async (req, res) => {
  const sb = db();
  const [regs, players, teams] = await Promise.all([
    one(sb.from("registrations").select("id, reference, name, role, payment_status, auction_category").eq("status", "received").order("name").limit(2000)),
    one(sb.from("ts_player_cards").select("id, name, category, status, team_id, price, registration_id, payment_status").order("name")),
    one(sb.from("ts_teams").select("id, name")),
  ]);
  const tname = new Map(teams.map((t) => [t.id, t.name]));
  const inPool = new Set(players.filter((p) => p.payment_status === "verified" && p.registration_id).map((p) => p.registration_id));
  const listed = players.filter((p) => p.payment_status === "verified");
  const others = players.filter((p) => p.payment_status !== "verified");
  const n = (rows, f) => rows.filter(f).length;

  const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 44, left: 42, right: 42 }, info: { Title: "Turf Slam status report" }, bufferPages: true });
  const chunks = []; doc.on("data", (c) => chunks.push(c));
  const done = new Promise((r) => doc.on("end", r));

  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  doc.font("Helvetica-Bold").fontSize(17).fillColor("#111111").text("The Turf Slam Player Auction 2026");
  doc.font("Helvetica").fontSize(9).fillColor("#555555").text(`Registrations and auction players, live from the database on ${stamp} IST`);
  doc.moveDown(0.6);

  const sum = [
    ["Registrations", regs.length],
    ["Payment received", n(regs, (r) => r.payment_status === "verified")],
    ["Payment awaiting review", n(regs, (r) => r.payment_status === "awaiting_review")],
    ["Payment due", n(regs, (r) => r.payment_status === "due")],
    ["Registered with no level", n(regs, (r) => !r.auction_category)],
    ["Players in the auction player list (payment received)", listed.length],
    ["   level A+ / A / B / unassigned", [n(listed, (p) => p.category === "A+"), n(listed, (p) => p.category === "A"), n(listed, (p) => p.category === "B"), n(listed, (p) => !p.category)].join(" / ")],
    ["   sold / retained / to come", [n(listed, (p) => p.status === "sold"), n(listed, (p) => p.status === "retained"), n(listed, (p) => p.status === "pool")].join(" / ")],
    ["Retained players not in the player list (kept on their teams)", others.length],
  ];
  table(doc, ["Summary", ""], sum, [330, 180]);

  h2(doc, `1. Auction player list (${listed.length})`, "Only players whose registration is marked Payment received. Yellow rows have no level yet.");
  table(doc, ["#", "Player", "Level", "Auction status", "Team", "Price"],
    listed.map((p, i) => [i + 1, p.name, lvl(p.category), ST[p.status] || p.status, tname.get(p.team_id) || "", inr(p.price)]), [26, 170, 60, 80, 100, 74], (r) => r[2] === "Unassigned");

  h2(doc, `2. All registrations (${regs.length})`, "Every received registration with its payment status and level. Yellow rows: payment not received, so not in the auction list.");
  table(doc, ["#", "Reference", "Name", "Role", "Payment", "Level", "In list"],
    regs.map((r, i) => [i + 1, r.reference, r.name, r.role || "", PAY[r.payment_status] || r.payment_status, lvl(r.auction_category), r.payment_status === "verified" && inPool.has(r.id) ? "Yes" : "No"]),
    [24, 76, 140, 84, 60, 60, 40], (r) => r[4] !== "Received");

  if (others.length) {
    h2(doc, `3. Retained players not in the player list (${others.length})`, "Retained by a team: they stay on that team and count against its purse, but are not registrations with payment received.");
    table(doc, ["#", "Player", "Level", "Team", "Retention", "Registration"],
      others.map((p, i) => [i + 1, p.name, lvl(p.category), tname.get(p.team_id) || "", inr(p.price), p.registration_id ? PAY[p.payment_status] || p.payment_status : "No registration"]), [26, 160, 56, 100, 80, 88]);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(7).fillColor("#888888");
    doc.text("The Turf Slam - admin report", 42, doc.page.height - 30, { lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, doc.page.width - 142, doc.page.height - 30, { width: 100, align: "right", lineBreak: false });
  }
  doc.end(); await done;

  const buf = Buffer.concat(chunks);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="turf-slam-status-${new Date().toISOString().slice(0, 10)}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).end(buf);
});
