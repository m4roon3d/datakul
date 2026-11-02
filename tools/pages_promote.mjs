// Re-promotes the current production deployment so the pages.dev address re-syncs, then shows what is served.
const { CLOUDFLARE_API_TOKEN: T, CLOUDFLARE_ACCOUNT_ID: A } = process.env;
const api = async (p, m = "GET") => (await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}${p}`, { method: m, headers: { authorization: `Bearer ${T}` } })).json();
const ds = (await api("/pages/projects/datakul/deployments?per_page=3")).result;
const [cur, prev] = ds;
console.log("current", cur.short_id, "previous", prev.short_id);
for (const id of [prev.id, cur.id]) {
  const r = await api(`/pages/projects/datakul/deployments/${id}/rollback`, "POST");
  console.log("promote", id.slice(0, 8), r.success, (r.errors || []).map((e) => `${e.code} ${e.message}`).join("; "));
  await new Promise((s) => setTimeout(s, 20000));
}
const p = (await api("/pages/projects/datakul")).result;
console.log("canonical now:", p.canonical_deployment?.short_id);
