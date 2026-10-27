// Gateway unit test: prompt modes, provider order and embeddings, with every outside call stubbed.
import worker from "../worker/src/index.js";
const env = { GROQ_API_KEY: "k", AI: { run: async (m, i) => i.text ? { data: i.text.map(() => [0.1, 0.2, 0.3]) } : new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"response":"hi"}\n\n')); c.close(); } }) } };
let seen = null;
globalThis.fetch = async (url, init) => { seen = JSON.parse(init.body); return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{}"}}]}\n\n')); c.close(); } }), { status: 200 }); };
const post = (p, b) => worker.fetch(new Request("https://gw" + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), env);
let r = await post("/api/chat", { mode: "cardify", provider: "groq", question: "how to negotiate salary", answer: "Know the range." });
console.log("cardify:", r.status, r.headers.get("x-provider"), "model:", seen.model, "max_tokens:", seen.max_tokens, "| system starts:", seen.messages[0].content.slice(0, 60));
r = await post("/api/chat", { mode: "tutor", question: "what is cdc", context: [] });
const sys = seen.messages[0].content;
console.log("tutor default provider model:", seen.model, "| career scope:", sys.includes("data careers"), "| mermaid rule:", sys.includes("mermaid"));
r = await post("/api/embed", { texts: ["a", "b"] });
console.log("embed:", r.status, JSON.stringify(await r.json()));
const prov = await (await worker.fetch(new Request("https://gw/api/providers"), env)).json();
console.log("providers order:", prov.providers.map((p) => p.id).join(","));

// ---- assertions (the lines above print for humans; these fail the run) ----
const fail = [];
const want = (c, m) => { if (!c) fail.push(m); };
want(sys.includes("data careers") && sys.includes("mermaid"), "tutor prompt keeps career scope and the Mermaid rule");
want(prov.providers.map((p) => p.id).join(",") === "groq,llama", "providers listed in fallback order");
want(prov.providers[0].models[0].id === "openai/gpt-oss-120b", "GPT-OSS 120B is the default Groq model");
want(!JSON.stringify(prov).includes("llama-3.3-70b-versatile"), "retired Groq models are not offered");
if (fail.length) { console.error("FAILED:\n- " + fail.join("\n- ")); process.exit(1); }
console.log("ALL GATEWAY TESTS PASSED");
