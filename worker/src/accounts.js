// Optional learner accounts: Google sign-in checked here, a revocable session, and the learner's progress so it follows
// them between devices. Off unless the GOOGLE_CLIENT_ID secret is set. The gateway never sees a Google password.
//
//   GET    /api/auth/config   { enabled, clientId }            (public)
//   POST   /api/auth/google   { credential } -> { token, user } (Google ID token checked against Google's public keys)
//   POST   /api/auth/signout                                    (Bearer session token)
//   GET    /api/me                                              user
//   DELETE /api/me                                              deletes the user, sessions and progress
//   GET    /api/sync                                            { data, updated_at }
//   PUT    /api/sync          { data, base }                    409 with the newer copy if base is behind

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
export const SESSION_MS = 90 * 24 * 3600 * 1000;
export const MAX_SYNC_BYTES = 300_000;
const enc = new TextEncoder();
const json = (o, status, cors) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });

const b64uToBytes = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const bytesToB64u = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s) => bytesToB64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));

let keyCache = { at: 0, keys: [] };
async function googleKeys(force) {
  if (!force && keyCache.keys.length && Date.now() - keyCache.at < 3600_000) return keyCache.keys;
  const r = await fetch(GOOGLE_CERTS);
  if (!r.ok) throw new Error("Could not fetch Google's signing keys.");
  keyCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return keyCache.keys;
}

/** Checks a Google ID token: signature, audience (our client id), issuer, expiry, verified email. Returns the claims. */
export async function verifyGoogleToken(credential, env, now = Date.now()) {
  if (!env.GOOGLE_CLIENT_ID) throw new Error("Sign-in is not set up.");
  const parts = String(credential || "").split(".");
  if (parts.length !== 3) throw new Error("Not a sign-in token.");
  let header, claims;
  try { header = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0]))); claims = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[1]))); } catch { throw new Error("Not a sign-in token."); }
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported token.");
  let jwk = (await googleKeys(false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown signing key.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64uToBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!good) throw new Error("Bad signature.");
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error("Token is for a different app.");
  if (!ISSUERS.includes(claims.iss)) throw new Error("Wrong issuer.");
  if (!claims.exp || claims.exp * 1000 < now - 60_000) throw new Error("Token expired.");
  if (!claims.sub) throw new Error("No account id.");
  if (claims.email && claims.email_verified === false) throw new Error("Email not verified.");
  return claims;
}

async function sessionUser(request, env) {
  const h = request.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!tok || tok.length < 20) return null;
  const hash = await sha256(tok);
  const row = await env.DB.prepare("SELECT u.id, u.email, u.name, u.picture, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(hash).first();
  if (!row || row.expires < Date.now()) return null;
  return { ...row, hash };
}
const publicUser = (u) => ({ name: u.name, email: u.email, picture: u.picture });

export async function handleAccounts(request, url, env, cors) {
  const p = url.pathname, m = request.method;
  if (!p.startsWith("/api/auth/") && p !== "/api/me" && p !== "/api/sync") return null;
  if (p === "/api/auth/config" && m === "GET") return json({ enabled: !!(env.GOOGLE_CLIENT_ID && env.DB), clientId: env.GOOGLE_CLIENT_ID || "" }, 200, cors);
  if (!env.GOOGLE_CLIENT_ID || !env.DB) return json({ error: "Sign-in is not set up." }, 503, cors);

  if (p === "/api/auth/google" && m === "POST") {
    let body; try { body = await request.json(); } catch { return json({ error: "Request body must be JSON." }, 400, cors); }
    let c; try { c = await verifyGoogleToken(body.credential, env); } catch (e) { return json({ error: "Sign-in failed: " + e.message }, 401, cors); }
    const id = "g:" + c.sub, now = Date.now();
    const email = String(c.email || "").slice(0, 254), name = String(c.name || "").slice(0, 120), picture = ""; // the profile picture is deliberately not stored
    await env.DB.prepare("INSERT INTO users (id, email, name, picture, created, last_seen) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, last_seen = excluded.last_seen").bind(id, email, name, picture, now, now).run();
    const token = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)").bind(await sha256(token), id, now, now + SESSION_MS).run();
    return json({ token, expires: now + SESSION_MS, user: { name, email, picture } }, 200, cors);
  }

  const u = await sessionUser(request, env);
  if (!u) return json({ error: "Please sign in again." }, 401, cors);

  if (p === "/api/auth/signout" && m === "POST") { await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(u.hash).run(); return json({ ok: true }, 200, cors); }
  if (p === "/api/me" && m === "GET") return json({ user: publicUser(u) }, 200, cors);
  if (p === "/api/me" && m === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM progress WHERE user_id = ?").bind(u.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(u.id),
    ]);
    return json({ ok: true }, 200, cors);
  }
  if (p === "/api/sync" && m === "GET") {
    const r = await env.DB.prepare("SELECT data, updated_at FROM progress WHERE user_id = ?").bind(u.id).first();
    return json({ data: r ? JSON.parse(r.data) : null, updated_at: r ? r.updated_at : 0 }, 200, cors);
  }
  if (p === "/api/sync" && m === "PUT") {
    const raw = await request.text();
    if (raw.length > MAX_SYNC_BYTES) return json({ error: "Progress is too large to sync." }, 413, cors);
    let body; try { body = JSON.parse(raw); } catch { return json({ error: "Request body must be JSON." }, 400, cors); }
    if (!body || typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) return json({ error: "Nothing to save." }, 400, cors);
    const cur = await env.DB.prepare("SELECT data, updated_at FROM progress WHERE user_id = ?").bind(u.id).first();
    if (cur && cur.updated_at > (+body.base || 0)) return json({ conflict: true, data: JSON.parse(cur.data), updated_at: cur.updated_at }, 409, cors);
    const at = Math.max(Date.now(), (cur ? cur.updated_at : 0) + 1);
    await env.DB.prepare("INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(u.id, JSON.stringify(body.data), at).run();
    await env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(Date.now(), u.id).run();
    return json({ ok: true, updated_at: at }, 200, cors);
  }
  return json({ error: "Not found." }, 404, cors);
}

/** For the review page: how many learners have an account. Never lists them. */
export async function userStats(env) {
  if (!env.DB || !env.GOOGLE_CLIENT_ID) return { enabled: false };
  try {
    const now = Date.now(), week = now - 7 * 86400_000;
    const r = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN created >= ? THEN 1 ELSE 0 END) AS joined FROM users").bind(week, week).first();
    return { enabled: true, total: r.total || 0, active7: r.active || 0, joined7: r.joined || 0 };
  } catch { return { enabled: true, error: "The accounts tables are missing. They are created by migration 0003 on the next deploy." }; }
}

export async function pruneSessions(env) {
  if (!env.DB) return;
  try { await env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(Date.now()).run(); } catch {}
}
