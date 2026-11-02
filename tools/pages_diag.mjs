// Read-only: prints which Pages deployment is live and what the latest ones are. Changes nothing.
const { CLOUDFLARE_API_TOKEN: T, CLOUDFLARE_ACCOUNT_ID: A } = process.env;
const get = async (p) => { const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}${p}`, { headers: { authorization: `Bearer ${T}` } }); const j = await r.json(); return j; };
const p = await get("/pages/projects/datakul");
const pr = p.result || {};
console.log("project ok:", p.success, (p.errors || []).map((e) => e.message).join("; "));
console.log("production_branch:", pr.production_branch);
const cd = pr.canonical_deployment || {}; const ld = pr.latest_deployment || {};
console.log("canonical (live):", cd.short_id, cd.environment, cd.deployment_trigger?.metadata?.branch, cd.created_on);
console.log("latest:", ld.short_id, ld.environment, ld.deployment_trigger?.metadata?.branch, ld.created_on, JSON.stringify(ld.latest_stage));
const d = await get("/pages/projects/datakul/deployments?per_page=8");
for (const x of d.result || []) console.log("deploy:", x.short_id, x.environment, x.deployment_trigger?.metadata?.branch, x.created_on, x.latest_stage?.name, x.latest_stage?.status, (x.aliases || []).join(","));
console.log("deployments list ok:", d.success, (d.errors || []).map((e) => e.message).join("; "));
