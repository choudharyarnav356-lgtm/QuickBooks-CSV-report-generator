// scripts/fetch-quickbooks.js
//
// Runs inside GitHub Actions. Does four things:
//   1. Uses the stored refresh token to get a fresh access token from Intuit.
//   2. Fetches the four reports (Balance Sheet, P&L, A/R Aging, A/P Aging).
//   3. Maps them into the exact shapes the dashboard already understands
//      and writes them to data/reports.json.
//   4. Writes Intuit's NEW refresh token to .new_refresh_token so the
//      workflow can save it back into the repo's secrets (Intuit rotates
//      the refresh token on every use — this is what makes the setup
//      zero-maintenance).
//
// All credentials come from environment variables, which the workflow
// supplies from the repo's encrypted Actions secrets. Nothing secret is
// ever written into the committed output.

const fs = require("fs");
const path = require("path");
const { mapFinancialReport, mapAgingReport } = require("./reportMapper");

const {
  QB_CLIENT_ID,
  QB_CLIENT_SECRET,
  QB_REFRESH_TOKEN,
  QB_REALM_ID,
  QB_ENVIRONMENT = "sandbox"
} = process.env;

for (const [k, v] of Object.entries({ QB_CLIENT_ID, QB_CLIENT_SECRET, QB_REFRESH_TOKEN, QB_REALM_ID })) {
  if (!v) { console.error(`Missing required env var ${k}`); process.exit(1); }
}

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const API_BASE = QB_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";

async function main() {
  // ---- 1. Refresh the access token --------------------------------------
  const basicAuth = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString("base64");
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: QB_REFRESH_TOKEN
    })
  });
  if (!tokenRes.ok) {
    throw new Error(`Token refresh failed (${tokenRes.status}): ${await tokenRes.text()}\n` +
      `If this keeps happening, the stored refresh token may have expired — ` +
      `redo the one-time OAuth Playground step in SETUP.md and update the QB_REFRESH_TOKEN secret.`);
  }
  const tokens = await tokenRes.json();
  const accessToken = tokens.access_token;

  // Hand the rotated refresh token to the workflow (NOT committed — the
  // workflow reads this file, stores it as a secret, and deletes it).
  fs.writeFileSync(".new_refresh_token", tokens.refresh_token, "utf8");

  // ---- 2. Fetch the reports ---------------------------------------------
  async function qboGet(p) {
    const res = await fetch(`${API_BASE}/v3/company/${QB_REALM_ID}${p}`, {
      headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" }
    });
    if (!res.ok) throw new Error(`QuickBooks API error on ${p} (${res.status}): ${await res.text()}`);
    return res.json();
  }

  const info = await qboGet("/companyinfo/1");
  const companyName = info.CompanyInfo?.CompanyName || "";

  const [bsJson, plJson, arJson, apJson] = await Promise.all([
    qboGet("/reports/BalanceSheet"),
    qboGet("/reports/ProfitAndLoss"),
    qboGet("/reports/AgedReceivables"),
    qboGet("/reports/AgedPayables")
  ]);

  // ---- 3. Map and write the snapshot ------------------------------------
  const out = {
    generatedAt: new Date().toISOString(),
    company: companyName,
    bs: mapFinancialReport(bsJson, companyName),
    pl: mapFinancialReport(plJson, companyName),
    arAging: mapAgingReport(arJson, companyName),
    apAging: mapAgingReport(apJson, companyName)
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(path.join("data", "reports.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote data/reports.json for "${companyName}" at ${out.generatedAt}`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
