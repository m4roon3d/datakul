// Worker tests for learner accounts: Google token checks, sessions, sync with conflicts, sign out, delete, admin counts.
import { readFileSync } from "node:fs";
import { D1Mock } from "./d1mock.mjs";
import worker from "../worker/src/index.js";
import { verifyGoogleToken } from "../worker/src/accounts.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const CLIENT = "client-123.apps.googleusercontent.com";
const b64u = (b) => Buffer.from(b).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
async function jwt(claims, key = kp.privateKey, kid = "k1") {
  const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(h + "." + p));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}
const claims = (o = {}) => ({ iss: "https://accounts.google.com", aud: CLIENT, sub: "1001", email: "ada@example.com", email_verified: true, name: "Ada L", picture: "https://x/y.png", exp: Math.floor(Date.now() / 1000) + 3600, ...o });
let certCalls = 0;
globalThis.fetch = async (url) => { if (String(url).includes("googleapis.com/oauth2/v3/certs")) { certCalls++; return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }); } return new Response("{}", { status: 404 }); };

const DB = new D1Mock();
for (const f of ["0001_init.sql", "0002_usage.sql", "0003_accounts.sql"]) await DB.exec(readFileSync(new URL("../worker/migrations/" + f, import.meta.url), "utf8"));
const env = { ADMIN_TOKEN: "adm", GOOGLE_CLIENT_ID: CLIENT, DB };
const call = async (path, { method = "GET", body, token, e = env, headers = {} } = {}) => {
  const r = await worker.fetch(new Request("https://gw.test" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), e, { waitUntil() {} });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// token checks
ok((await verifyGoogleToken(await jwt(claims()), env)).sub === "1001", "a good Google token is accepted");
const bad = async (c, label, e = env) => { try { await verifyGoogleToken(c, e); ok(false, label); } catch { ok(true, label); } };
await bad(await jwt(claims({ aud: "someone-else" })), "a token for another app is refused");
await bad(await jwt(claims({ iss: "https://evil.example" })), "a wrong issuer is refused");
await bad(await jwt(claims({ exp: Math.floor(Date.now() / 1000) - 3600 })), "an expired token is refused");
await bad(await jwt(claims({ email_verified: false })), "an unverified email is refused");
await bad(await jwt(claims(), other.privateKey), "a token signed with another key is refused");
await bad(await jwt(claims(), kp.privateKey, "nope"), "an unknown key id is refused");
await bad("a.b", "garbage is refused");
await bad(await jwt(claims()), "sign-in off without a client id", { ...env, GOOGLE_CLIENT_ID: "" });
const none = (await jwt(claims())).split(".").slice(0, 2).join(".") + ".";
await bad(none, "an unsigned token is refused");
ok(certCalls >= 1 && certCalls <= 3, "Google's keys are cached (" + certCalls + " fetches)");

// config
let r = await call("/api/auth/config");
ok(r.json.enabled && r.json.clientId === CLIENT, "config says sign-in is on");
r = await call("/api/auth/config", { e: { ...env, GOOGLE_CLIENT_ID: "" } });
ok(!r.json.enabled && r.json.clientId === "", "config says off when no client id");
r = await call("/api/me", { e: { ...env, GOOGLE_CLIENT_ID: "" } });
ok(r.status === 503, "accounts endpoints answer 503 when off");

// sign in
r = await call("/api/auth/google", { method: "POST", body: { credential: await jwt(claims({ aud: "x" })) } });
ok(r.status === 401, "a bad token cannot sign in");
r = await call("/api/auth/google", { method: "POST", body: { credential: await jwt(claims()) } });
ok(r.status === 200 && r.json.token.length > 30 && r.json.user.email === "ada@example.com", "a good token signs in");
const T = r.json.token;
const stored = await DB.prepare("SELECT token_hash FROM sessions").first();
ok(stored && stored.token_hash !== T && !JSON.stringify(await DB.prepare("SELECT * FROM sessions").all()).includes(T), "the session token itself is not stored");
r = await call("/api/me", { token: T });
ok(r.status === 200 && r.json.user.name === "Ada L", "/api/me returns the signed-in learner");
r = await call("/api/me", { token: "x".repeat(43) });
ok(r.status === 401, "an unknown session is refused");
r = await call("/api/me");
ok(r.status === 401, "no session is refused");

// sync
r = await call("/api/sync", { token: T });
ok(r.json.data === null && r.json.updated_at === 0, "a new learner has no saved progress");
r = await call("/api/sync", { method: "PUT", token: T, body: { data: { qs: { xp: 50 } }, base: 0 } });
ok(r.status === 200 && r.json.updated_at > 0, "progress saves");
const v1 = r.json.updated_at;
r = await call("/api/sync", { token: T });
ok(r.json.data.qs.xp === 50, "progress comes back");
r = await call("/api/sync", { method: "PUT", token: T, body: { data: { qs: { xp: 10 } }, base: 0 } });
ok(r.status === 409 && r.json.data.qs.xp === 50, "a stale save is refused with the newer copy");
r = await call("/api/sync", { method: "PUT", token: T, body: { data: { qs: { xp: 80 } }, base: v1 } });
ok(r.status === 200 && r.json.updated_at > v1, "a save based on the latest copy works");
r = await call("/api/sync", { method: "PUT", token: T, body: { data: "nope", base: 0 } });
ok(r.status === 400, "non-object progress is refused");
r = await call("/api/sync", { method: "PUT", token: T, body: JSON.stringify({ data: { pad: "x".repeat(310_000) }, base: 99 }) });
ok(r.status === 413, "oversized progress is refused");

// second device, second learner
r = await call("/api/auth/google", { method: "POST", body: { credential: await jwt(claims()) } });
const T2 = r.json.token;
ok(T2 !== T && (await call("/api/sync", { token: T2 })).json.data.qs.xp === 80, "a second device gets the same progress");
r = await call("/api/auth/google", { method: "POST", body: { credential: await jwt(claims({ sub: "2002", email: "bob@example.com", name: "Bob" })) } });
const TB = r.json.token;
ok((await call("/api/sync", { token: TB })).json.data === null, "another learner cannot see Ada's progress");
ok((await DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n === 2, "same Google account reuses one user row");

// admin counts, no personal data
r = await call("/api/admin/status", { token: "adm" });
ok(r.status === 200 && r.json.users && r.json.users.total === 2, "review page counts 2 learners");
ok(!JSON.stringify(r.json).includes("ada@example.com"), "the review page never lists emails");
r = await call("/api/admin/status", { token: "adm", e: { ...env, GOOGLE_CLIENT_ID: "" } });
ok(r.json.users && r.json.users.enabled === false, "the count shows sign-in off when it is");

// sign out and delete
r = await call("/api/auth/signout", { method: "POST", token: T2 });
ok(r.status === 200 && (await call("/api/me", { token: T2 })).status === 401, "sign out ends that session");
ok((await call("/api/me", { token: T })).status === 200, "other devices stay signed in");
r = await call("/api/me", { method: "DELETE", token: T });
ok(r.status === 200, "delete my account works");
ok((await call("/api/me", { token: T })).status === 401, "all sessions are gone after delete");
const left = await DB.prepare("SELECT (SELECT COUNT(*) FROM users WHERE id='g:1001') + (SELECT COUNT(*) FROM progress WHERE user_id='g:1001') + (SELECT COUNT(*) FROM sessions WHERE user_id='g:1001') AS n").first();
ok(left.n === 0, "no row about the learner is left");
ok((await call("/api/sync", { token: TB })).status === 200 && (await DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n === 1, "other learners are untouched");

// expiry and CORS
await DB.prepare("UPDATE sessions SET expires = 1 WHERE user_id = 'g:2002'").run();
ok((await call("/api/me", { token: TB })).status === 401, "an expired session is refused");
const pre = await worker.fetch(new Request("https://gw.test/api/sync", { method: "OPTIONS", headers: { origin: "https://datakul.pages.dev" } }), env, {});
ok(/PUT/.test(pre.headers.get("access-control-allow-methods")) && /DELETE/.test(pre.headers.get("access-control-allow-methods")), "CORS allows PUT and DELETE");

console.log(fails ? `\n${fails} FAILED` : "\nALL ACCOUNT TESTS PASSED");
process.exit(fails ? 1 : 0);
