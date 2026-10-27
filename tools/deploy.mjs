// Deploys Datakul to Cloudflare: the database (D1), the AI gateway (Worker) and the website (Pages).
// Run by .github/workflows/deploy.yml after every merge to main. Safe to re-run: it creates what's missing and updates the rest.
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. AI keys and ADMIN_TOKEN are passed through as Worker secrets.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = ["--yes", "wrangler@4.112.0"];
const PROJECT = process.env.PAGES_PROJECT || "datakul";
const DB_NAME = "datakul";
const SECRET_NAMES = ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "ADMIN_TOKEN"];
const { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } = process.env;

const step = (s) => console.log(`\n▶ ${s}`);
function fail(title, msg) {
  console.log(`::error title=${title}::${String(msg).replace(/\r?\n/g, " | ").slice(0, 1500)}`);
  process.exit(1);
}
function wrangler(args, { cwd = join(ROOT, "worker"), input } = {}) {
  try {
    return execFileSync("npx", [...WRANGLER, ...args], { cwd, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } });
  } catch (e) {
    const out = `${e.stdout || ""}\n${e.stderr || ""}`.trim().split("\n").filter((l) => l.trim()).slice(-12).join("\n");
    fail(`wrangler ${args.slice(0, 2).join(" ")} failed`, out || e.message);
  }
}
async function cf(path, init = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.success !== false, status: r.status, result: j.result, errors: (j.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ") };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(url, test, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (await test(r)) return true; } catch {}
    await sleep(5000);
  }
  return false;
}

if (!TOKEN || !ACCOUNT) fail("Setup needed", "Add the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID repository secrets (see docs/setup.md).");

/* 1. Check the token can see the account */
step("Checking the Cloudflare token");
const who = await cf("/workers/subdomain");
if (who.status === 401 || who.status === 403) fail("Cloudflare token refused", `The token can't use this account (${who.errors}). Check its permissions and the account ID (docs/setup.md).`);
const workersSub = who.ok && who.result && who.result.subdomain;
if (!workersSub) fail("workers.dev address missing", "Open Workers & Pages in the Cloudflare dashboard once so Cloudflare gives your account a workers.dev address, then re-run this workflow.");
console.log(`workers.dev address: ${workersSub}.workers.dev`);

/* 2. Database */
step("Database (D1)");
let db = await cf(`/d1/database?name=${DB_NAME}`);
if (!db.ok) fail("Can't read D1 databases", `${db.errors}. Give the token the "D1: Edit" permission.`);
let dbId = (db.result || []).find((d) => d.name === DB_NAME)?.uuid;
if (!dbId) {
  const made = await cf("/d1/database", { method: "POST", body: JSON.stringify({ name: DB_NAME }) });
  if (!made.ok) fail("Couldn't create the database", made.errors);
  dbId = made.result.uuid;
  console.log(`created database ${DB_NAME} (${dbId})`);
} else console.log(`using database ${DB_NAME} (${dbId})`);

/* 3. Website project, so the gateway can be locked to its address */
step("Website project (Pages)");
let pg = await cf(`/pages/projects/${PROJECT}`);
if (!pg.ok && pg.status === 404) {
  pg = await cf("/pages/projects", { method: "POST", body: JSON.stringify({ name: PROJECT, production_branch: "main" }) });
  if (!pg.ok) fail("Couldn't create the website project", `${pg.errors}. Give the token the "Cloudflare Pages: Edit" permission.`);
  console.log(`created Pages project ${PROJECT}`);
} else if (!pg.ok) fail("Can't read the website project", `${pg.errors}. Give the token the "Cloudflare Pages: Edit" permission.`);
const site = `https://${pg.result.subdomain}`;
const origins = [site, ...String(process.env.EXTRA_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)];
console.log(`website address: ${site}`);

/* 4. Gateway settings for this account (edited in the runner's copy only; the repo keeps the placeholders) */
step("Gateway settings");
const tomlPath = join(ROOT, "worker/wrangler.toml");
let toml = readFileSync(tomlPath, "utf8");
const set = (re, line, what) => { if (!re.test(toml)) fail("wrangler.toml changed", `Couldn't find ${what} in worker/wrangler.toml.`); toml = toml.replace(re, line); };
set(/^database_id = ".*"$/m, `database_id = "${dbId}"`, "database_id");
set(/^ALLOWED_ORIGINS = ".*"$/m, `ALLOWED_ORIGINS = "${origins.join(",")}"`, "ALLOWED_ORIGINS");
set(/^SITE_URL = ".*"$/m, `SITE_URL = "${site}"`, "SITE_URL");
writeFileSync(tomlPath, toml);
console.log(`gateway accepts calls from: ${origins.join(", ")}`);

step("Database migrations");
console.log(wrangler(["d1", "migrations", "apply", DB_NAME, "--remote"]).split("\n").slice(-6).join("\n"));

step("Deploying the gateway (Worker)");
const dep = wrangler(["deploy"]);
console.log(dep.split("\n").filter((l) => /workers\.dev|schedule|Uploaded|Deployed|Current Version/i.test(l)).join("\n"));
const gateway = (dep.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [])[0] || `https://datakul-gateway.${workersSub}.workers.dev`;

step("Gateway secrets");
const secrets = Object.fromEntries(SECRET_NAMES.filter((n) => process.env[n]).map((n) => [n, process.env[n]]));
const aiKeys = Object.keys(secrets).filter((n) => n !== "ADMIN_TOKEN");
if (Object.keys(secrets).length) {
  const dir = mkdtempSync(join(tmpdir(), "dk-"));
  const f = join(dir, "secrets.json");
  writeFileSync(f, JSON.stringify(secrets), { mode: 0o600 });
  try { wrangler(["secret", "bulk", f]); } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`set: ${Object.keys(secrets).join(", ") || "none"}`);
if (!aiKeys.length) console.log("::warning title=No AI key::No AI provider key is set, so Ask uses Meta Llama on Cloudflare only. Add GROQ_API_KEY for faster, better answers.");
if (!secrets.ADMIN_TOKEN) console.log("::warning title=Review page off::ADMIN_TOKEN isn't set, so the community review page is locked. Add it to turn reviewing on.");

/* 5. Website */
step("Deploying the website (Pages)");
const out = mkdtempSync(join(tmpdir(), "dk-site-"));
cpSync(join(ROOT, "web"), out, { recursive: true });
writeFileSync(join(out, "config.js"), `// Written by tools/deploy.mjs\nwindow.DATAKUL_CONFIG = {\n  gatewayUrl: "${gateway}",\n};\n`);
console.log(wrangler(["pages", "deploy", out, "--project-name", PROJECT, "--branch", "main", "--commit-dirty=true"], { cwd: ROOT }).split("\n").filter((l) => /https:|Uploaded|Success/i.test(l)).join("\n"));

/* 6. Smoke test the live app */
step("Checking the live app");
let providers = [];
const gwOk = await poll(`${gateway}/api/providers`, async (r) => { if (!r.ok) return false; providers = (await r.json()).providers || []; return true; });
const siteOk = await poll(`${site}/`, async (r) => r.ok && (await r.text()).toLowerCase().includes("datakul"));
const comOk = await poll(`${gateway}/api/community`, async (r) => r.ok);
const lines = [
  `## Datakul is live`,
  ``,
  `| | |`, `|---|---|`,
  `| App | ${site} |`,
  `| Review page | ${site}/admin.html |`,
  `| AI gateway | ${gateway} |`,
  `| AI providers | ${providers.map((p) => p.label).join(", ") || "none answered"} |`,
  `| Checks | gateway ${gwOk ? "✅" : "❌"} · website ${siteOk ? "✅" : "❌"} · community feed ${comOk ? "✅" : "❌"} |`,
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
console.log(`::notice title=Datakul is live::App ${site} · gateway ${gateway}`);
if (!gwOk || !siteOk) fail("Live check failed", `gateway ${gwOk ? "ok" : "not answering"}, website ${siteOk ? "ok" : "not answering"}. It can take a minute for a first deploy; re-run the workflow if this was the first one.`);
