#!/usr/bin/env node
/**
 * sync-sheet.js
 *
 * Fetches the competitor list from a public Google Sheet (CSV export)
 * and updates config.json's `global_competitors` map.
 *
 * NO API keys or service accounts needed — the sheet just needs to be
 * shared as "Anyone with the link can view".
 *
 * Expected sheet columns: Country (A), Competitor (B)
 * Colors & descriptions are preserved from existing config.json;
 * new competitors get an auto-assigned palette color.
 *
 * Usage:
 *   node scripts/sync-sheet.js
 *   SHEET_ID='...' SHEET_GID='0' node scripts/sync-sheet.js
 */

const fs = require("fs");
const path = require("path");

const SHEET_ID =
  process.env.SHEET_ID ||
  "1mmyXH3hhw7H_xPNFq2d5x67MwFUhSP_LULeSgczhVqU";

const SHEET_GID = process.env.SHEET_GID || "0"; // first tab

const CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

const CONFIG_PATH = path.resolve(__dirname, "..", "config.json");

const COLOR_PALETTE = [
  "#6366f1", "#ef4444", "#f97316", "#06b6d4", "#22c55e",
  "#8b5cf6", "#10b981", "#a855f7", "#ec4899", "#14b8a6",
];

// ── Simple CSV parser (handles quoted fields with commas/newlines) ──
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
      } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        row.push(field.trim());
        if (row.some((f) => f !== "")) rows.push(row);
        row = [];
        field = "";
        if (ch === "\r") i++;
      } else {
        field += ch;
      }
    }
  }
  row.push(field.trim());
  if (row.some((f) => f !== "")) rows.push(row);

  return rows;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log(`Fetching ${CSV_URL} ...`);
  const res = await fetch(CSV_URL, { redirect: "follow" });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${res.statusText}`);
    console.error(
      "Make sure the sheet is shared as 'Anyone with the link can view'."
    );
    process.exit(1);
  }
  const csv = await res.text();

  const rows = parseCSV(csv);
  if (rows.length < 2) {
    console.error("CSV has fewer than 2 rows (need header + data). Aborting.");
    process.exit(1);
  }

  const header = rows[0].map((h) => h.toLowerCase());
  const competitorAliases = ["competitor", "competitor name", "name", "company"];
  const countryAliases = ["country", "market", "region"];

  let competitorCol = header.findIndex((h) => competitorAliases.includes(h));
  let countryCol = header.findIndex((h) => countryAliases.includes(h));

  if (competitorCol === -1) competitorCol = 1;
  if (countryCol === -1) countryCol = 0;

  console.log(
    `Columns: country=${countryCol} ("${header[countryCol] || "?"}"), ` +
      `competitor=${competitorCol} ("${header[competitorCol] || "?"}")`
  );

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const existing = config.global_competitors || {};
  const previousCount = Object.keys(existing).length;

  const newCompetitors = {};
  let colorIndex = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const rawName = (rows[i][competitorCol] || "").trim();
    if (!rawName) { skipped++; continue; }

    const name = rawName.replace(/\n/g, " ").replace(/\s+/g, " ");
    if (newCompetitors[name]) continue;

    if (existing[name]) {
      newCompetitors[name] = {
        color: existing[name].color,
        description: existing[name].description || "",
      };
    } else {
      newCompetitors[name] = {
        color: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
        description: "",
      };
      colorIndex++;
      console.log(`  NEW: "${name}" → ${newCompetitors[name].color}`);
    }
  }

  if (skipped > 0) console.log(`Skipped ${skipped} empty rows.`);

  const count = Object.keys(newCompetitors).length;
  console.log(`Parsed ${count} unique competitors.`);

  if (count === 0) {
    console.error("No competitors found — aborting to protect config.json.");
    process.exit(1);
  }

  const removed = Object.keys(existing).filter((k) => !newCompetitors[k]);
  if (removed.length > 0) {
    console.log(
      `Removing ${removed.length}: ${removed.slice(0, 10).join(", ")}${removed.length > 10 ? "..." : ""}`
    );
  }

  config.global_competitors = newCompetitors;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log(`config.json updated: ${previousCount} → ${count} competitors.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
