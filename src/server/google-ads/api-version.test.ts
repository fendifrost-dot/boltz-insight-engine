import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { GOOGLE_ADS_API_BASE, GOOGLE_ADS_API_VERSION } from "./api-version.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const versionFile = join(repoRoot, "src/server/google-ads/api-version.ts");

/** Sunset major version, built so this test is not itself a leftover pin. */
const retiredMajor = `v${22}`;

const skipDirs = new Set(["node_modules", ".git", "dist", ".output", ".vinxi", "coverage"]);

function walk(dir: string, visit: (file: string, text: string) => void): void {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      walk(path, visit);
      continue;
    }
    if (!info.isFile() || info.size > 2_000_000) continue;
    if (!/\.(ts|tsx|js|mjs|md|json|sql|toml|yml|yaml)$/.test(entry)) continue;
    visit(path, readFileSync(path, "utf8"));
  }
}

test("Google Ads REST uses the newest stable major version", () => {
  assert.equal(GOOGLE_ADS_API_VERSION, "v26");
  assert.equal(GOOGLE_ADS_API_BASE, `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`);
});

test("the version pin is a single assignment and the only Ads REST version", () => {
  const versionSource = readFileSync(versionFile, "utf8");
  assert.deepEqual(versionSource.match(/GOOGLE_ADS_API_VERSION\s*=\s*"v\d+"/g), [
    'GOOGLE_ADS_API_VERSION = "v26"',
  ]);

  const hits: string[] = [];
  walk(repoRoot, (file, text) => {
    const rel = relative(repoRoot, file);
    if (text.includes(retiredMajor)) hits.push(`${rel}: retired Google Ads API version`);
    if (/googleads\.googleapis\.com\/v\d+/.test(text)) {
      hits.push(`${rel}: hardcoded googleads host version`);
    }
    if (
      rel === "src/server/google-ads/api-version.ts" ||
      rel === "src/server/google-ads/api-version.test.ts"
    ) {
      return;
    }
    if (/GOOGLE_ADS_API_VERSION\s*=/.test(text)) {
      hits.push(`${rel}: second Google Ads API version assignment`);
    }
  });
  assert.deepEqual(hits, []);
});

test("the weekly cron and both ads MCP tools share the client pin", () => {
  const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
  const client = read("src/server/google-ads/client.server.ts");
  const reports = read("src/server/google-ads/reports.server.ts");
  const calls = read("src/server/google-ads/call-report.server.ts");
  const weekly = read("src/routes/api/public/cron/ads-weekly.ts");
  const adsCallsRoute = read("src/routes/api/public/cron/ads-calls.ts");
  const tools = read("src/server/mcp/tools.server.ts");

  assert.match(client, /GOOGLE_ADS_API_BASE/);
  assert.match(client, /from "\.\/api-version"/);
  assert.equal(client.split("googleAds:searchStream").length - 1, 1);
  assert.equal(client.split(":mutate").length - 1, 1);
  assert.match(reports, /from "\.\/client\.server"/);
  assert.match(reports, /adsSearch/);
  assert.match(calls, /adsSearch/);
  assert.match(weekly, /getAdsWeeklyReport/);
  assert.match(adsCallsRoute, /pullAdsCallReport/);
  assert.match(tools, /getAdsWeeklyReport/);
  assert.match(tools, /pullAdsCallReport/);
  assert.match(tools, /"boltz_ads_weekly"/);
  assert.match(tools, /"boltz_ads_calls"/);
});
