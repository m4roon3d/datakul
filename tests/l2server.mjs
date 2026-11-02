// Serves web/ and the real gateway (D1 on SQLite, fake LLM and embeddings) on one origin for browser tests.
// Usage: node tests/l2server.mjs [port]
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { D1Mock } from "./d1mock.mjs";
import { GOOD, fakeVec } from "./l2fixtures.mjs";
import worker from "../worker/src/index.js";

const PORT = +(process.argv[2] || 8788), WEB = new URL("../web/", import.meta.url).pathname;
const DB = new D1Mock();
for (const f of ["0001_init.sql", "0002_usage.sql", "0003_accounts.sql"]) await DB.exec(readFileSync(new URL("../worker/migrations/" + f, import.meta.url), "utf8"));
const env = { GROQ_API_KEY: "k", ADMIN_TOKEN: "test-token", GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com", MIN_ASKERS: "3", DB, AI: { run: async (m, i) => ({ data: i.text.map(fakeVec) }) } };
const sse = (t) => t.match(/[\s\S]{1,200}/g).map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join("") + "data: [DONE]\n\n";
// fake Google: a test key pair; GET /__jwt?sub=1&email=a@b.c&name=Ada returns a token the gateway will accept
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const JWK = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "t1", alg: "RS256", use: "sig" };
const b64u = (b) => Buffer.from(b).toString("base64url");
async function fakeJwt(q) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "t1" })), p = b64u(JSON.stringify({ iss: "https://accounts.google.com", aud: env.GOOGLE_CLIENT_ID, sub: q.get("sub") || "1", email: q.get("email") || "a@example.com", email_verified: true, name: q.get("name") || "Ada", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${p}.${b64u(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p))))}`;
}
globalThis.fetch = async (url, init) => {
  if (String(url).includes("googleapis.com/oauth2/v3/certs")) return new Response(JSON.stringify({ keys: [JWK] }), { status: 200 });
  const body = JSON.parse(init.body), sys = body.messages[0].content;
  if (sys.includes("You write one new entry for Datakul")) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(GOOD) } }] }), { status: 200 });
  if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 12, completion_tokens: 2 } }), { status: 200, headers: { "x-ratelimit-remaining-requests": "990" } });
  const t = sys.includes("short study card") ? JSON.stringify({ title: "Vector search basics", takeaway: "Vector search finds the nearest embeddings to a query.", example: "A bot finds similar help articles.", check: "Why is approximate search used?", points: [{ t: "Speed over exact recall", k: ["speed", "approximate", "fast"] }, { t: "Index such as HNSW", k: ["hnsw", "index", "graph"] }] }) : "**Vector databases** store embeddings and find the nearest ones fast.";
  return new Response(sse(t), { status: 200 });
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".py": "text/plain", ".svg": "image/svg+xml", ".png": "image/png" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname.startsWith("/api/") || req.method === "OPTIONS") {
    let b = ""; for await (const c of req) b += c;
    const r = await worker.fetch(new Request(u.href, { method: req.method, headers: { ...req.headers, "cf-connecting-ip": req.headers["x-test-ip"] || "127.0.0.1" }, body: b || undefined }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  if (u.pathname === "/__jwt") { res.end(await fakeJwt(u.searchParams)); return; }
  if (u.pathname === "/__run") { let p; await worker.scheduled({}, env, { waitUntil: (x) => (p = x) }); res.end(JSON.stringify(await p)); return; }
  if (u.pathname === "/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(`window.DATAKUL_CONFIG={gatewayUrl:"http://localhost:${PORT}"};`); return; }
  const f = join(WEB, u.pathname === "/" ? "index.html" : u.pathname);
  if (!f.startsWith(WEB) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
}).listen(PORT, () => { console.log("layer2 test server on " + PORT); import("node:fs").then((fs) => { fs.mkdirSync(new URL("./out/", import.meta.url), { recursive: true }); fs.writeFileSync(new URL("./out/l2.pid", import.meta.url), String(process.pid)); }); });
