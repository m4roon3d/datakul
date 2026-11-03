// Datakul AI gateway — a Cloudflare Worker that holds your free-tier API keys,
// builds the grounded prompt, and streams the answer back to the web app.
// Every provider below speaks the OpenAI-compatible chat API, so one code path serves all.
// Layer 2 (the shared library that grows from learners' questions) lives in community.js.

import { handleCommunity, runJob } from "./community.js";
import { runCertJob } from "./certq.js";
import { handleAccounts, userStats, pruneSessions } from "./accounts.js";
import { logUsage, meteredStream, promptTokens, rateHeaders, usageStatus, setMeta, pruneUsage } from "./usage.js";

const PROVIDERS = {
  groq: {
    label: "Groq",
    base: "https://api.groq.com/openai/v1",
    keyName: "GROQ_API_KEY",
    models: [
      // Groq retired Llama 3.3 70B and moved Llama 3.1 8B to enterprise-only in 2026. Each model below has its own
      // free daily allowance (about 1,000 requests and 200,000 tokens a day), so listing three triples the free answers.
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (faster)" },
      { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (preview, strong at code)" },
    ],
  },
  llama: {
    // Meta's Llama models served by Cloudflare Workers AI through the AI binding: no API key needed.
    // Free plan: 10,000 "neurons" a day (roughly 80–400 answers depending on the model).
    label: "Meta Llama (Cloudflare)",
    binding: true,
    models: [
      { id: "@cf/meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B" },
      { id: "@cf/meta/llama-3.1-8b-instruct-fp8-fast", label: "Llama 3.1 8B (most free answers)" },
    ],
  },
  gemini: {
    label: "Google Gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyName: "GEMINI_API_KEY",
    models: [
      { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite (about 500 free a day)" },
      { id: "gemini-flash-latest", label: "Gemini Flash (stronger, about 20 free a day)" },
    ],
  },
  openrouter: {
    label: "OpenRouter (free models)",
    base: "https://openrouter.ai/api/v1",
    keyName: "OPENROUTER_API_KEY",
    models: [{ id: "openrouter/free", label: "Auto-pick a free model" }],
    extraHeaders: { "X-Title": "Datakul" },
  },
  mistral: {
    label: "Mistral",
    base: "https://api.mistral.ai/v1",
    keyName: "MISTRAL_API_KEY",
    models: [{ id: "mistral-small-latest", label: "Mistral Small" }],
  },
};

// Fallback order when the chosen provider fails or hits its free-tier limit.
// Small English embedding model on Workers AI (384 dimensions); the app's concept vectors must use the same one.
const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5";

const FALLBACK_ORDER = ["groq", "llama", "gemini", "openrouter", "mistral"];

const LIMITS = {
  question: 1000,
  contextTotal: 7000,
  historyItems: 6,
  historyItemChars: 2500,
  answer: 4000,
  maxTokens: 1800,
  maxTokensGenerate: 4500,
  requestsPerWindow: 30, // per visitor IP, per isolate (best effort)
  windowMs: 10 * 60 * 1000,
};

const LEVELS = {
  new: "a beginner who is new to this topic; use plain language, define jargon, one simple analogy",
  work: "a practitioner who uses data tools at work; be concrete and technical, mention trade-offs",
  interview: "a candidate preparing for interviews; be crisp, structured, and point out what interviewers probe",
};

/* ---------------- helpers ---------------- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { count: 1, reset: now + LIMITS.windowMs });
    return false;
  }
  h.count++;
  return h.count > LIMITS.requestsPerWindow;
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") || (origin && allowed.includes(origin));
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : ok ? origin : allowed[0] || "",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Expose-Headers": "x-provider, x-model, x-provider-label",
      Vary: "Origin",
    },
  };
}

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });

const clip = (s, n) => String(s ?? "").slice(0, n);

function configured(env) {
  return Object.entries(PROVIDERS).filter(([, p]) => (p.binding ? env.AI : env[p.keyName]));
}

/* ---------------- prompts ---------------- */
function tutorPrompt(body) {
  let budget = LIMITS.contextTotal;
  const refs = (Array.isArray(body.context) ? body.context : []).slice(0, 3).map((c) => {
    const text = clip(c.text, Math.max(0, budget));
    budget -= text.length;
    return `### ${clip(c.title, 120)}\n${text}`;
  });
  const level = LEVELS[body.level] || LEVELS.work;
  return [
    "You are Datakul, a patient tutor for data engineering, data analysis, data science and data architecture.",
    `The learner is ${level}.`,
    body.focus ? `They were just studying "${clip(body.focus, 120)}", so read short follow-ups in that light.` : "",
    "Rules:",
    "- Base your explanation on the REFERENCE notes below. They are reviewed and correct; prefer them over your own memory.",
    refs.length
      ? "- If the question goes beyond the reference, start that part with \"Beyond the Datakul library, so double-check this:\" and keep it brief."
      : "- No reference matched this question. Start with \"Beyond the Datakul library, so double-check this:\" and be careful with specifics.",
    "- If the question is too vague to answer well, ask one short clarifying question instead of answering.",
    "- Never invent tool names, commands, version numbers or statistics.",
    "- Answer questions about data engineering, analysis, science and architecture, the tools around them, and data careers: interviews, résumés, job search, salaries and study plans. Politely decline anything else in one sentence.",
    "- For salaries and the job market, give rough ranges, say they vary by city, company and experience, and that you can't check live data. Never invent precise statistics.",
    ...(body.detail === "brief" ? [
    "- Keep it brief: under 90 words. Start with a one-sentence takeaway in bold, then the one idea that matters most and a one-line example. No headings, no diagram.",
    ] : [
    "- Be concise; learners skim. Under 200 words in total:",
    "  1. Start with a one-sentence takeaway in bold.",
    "  2. Then at most 3 short bullets or a short numbered list of steps.",
    "  3. Add one tiny concrete example (2–4 lines of SQL or Python, or a few sample rows in a code block) only when it really helps.",
    "- When a pipeline, flow, architecture or sequence is clearer as a picture, include exactly ONE small Mermaid diagram in a ```mermaid code block: `flowchart LR`, at most 7 nodes, labels of 1–3 words in double quotes (A[\"Raw data\"] --> B[\"Clean\"]), no parentheses outside quotes, no styling or classes. Otherwise draw nothing.",
    "- For a study plan, give one line per week or step.",
    "- For a quick factual follow-up, answer in one or two sentences.",
    ]),
    "- Don't use tables or headings.",
    "- Finish with exactly one question that checks understanding or invites the next step, on its own line starting with \"Your turn:\".",
    "",
    "REFERENCE:",
    refs.length ? refs.join("\n\n") : "(none)",
  ].join("\n");
}

function feedbackPrompt(body) {
  const points = (Array.isArray(body.points) ? body.points : []).slice(0, 8).map((p) => `- ${clip(p, 200)}`);
  return [
    `You are a fair, direct interviewer hiring for ${clip(body.role || "data", 60)} roles at ${clip(body.levelLabel || "mid", 30)} level.`,
    "Evaluate the candidate's answer against the key points. Do not invent facts beyond the key points and standard knowledge.",
    ...(body.detail === "brief" ? [
    "Reply in this shape, under 120 words, no tables:",
    "**Verdict:** one line.",
    "**Missing or wrong:** up to 3 short bullets.",
    "**Tip:** one line on how to make the answer stronger.",
    ] : [
    "Reply in this shape, about 250–400 words, no tables:",
    "**Verdict:** one line, with how an interviewer would likely rate it.",
    "**Strong:** up to 3 bullets.",
    "**Missing or wrong:** up to 4 bullets, each saying why it matters.",
    "**Model answer:** a short spoken-style answer (5–8 sentences) the candidate could give, including one concrete example such as a small SQL snippet or a real scenario.",
    "**Likely follow-up:** one question the interviewer would ask next.",
    ]),
    "",
    `QUESTION: ${clip(body.question, 400)}`,
    "KEY POINTS:",
    ...points,
  ].join("\n");
}

function selfcheckPrompt(body) {
  const ref = (Array.isArray(body.context) ? body.context : []).slice(0, 1)
    .map((c) => `### ${clip(c.title, 120)}\n${clip(c.text, LIMITS.contextTotal)}`).join("");
  const level = LEVELS[body.level] || LEVELS.work;
  return [
    "You are Datakul, a supportive tutor checking a learner's answer to a short check-yourself question.",
    `The learner is ${level}.`,
    "Use the REFERENCE notes as the source of truth.",
    "Reply in this shape, no tables:",
    "**Verdict:** Correct, Partly right, or Not yet, plus one sentence why.",
    body.detail === "brief"
      ? "**Explanation:** 2–3 sentences with the correct reasoning."
      : "**Explanation:** the correct reasoning in 120–250 words, with a small concrete example (a few sample rows, a snippet, or a real scenario) that makes it click.",
    "End with one short follow-up question on its own line starting with \"Your turn:\".",
    "",
    `QUESTION: ${clip(body.question, 400)}`,
    "",
    "REFERENCE:",
    ref || "(none)",
  ].join("\n");
}

function codereviewPrompt(body) {
  const level = LEVELS[body.level] || LEVELS.work;
  const brief = body.detail === "brief";
  return [
    `You are Datakul, a coding tutor reviewing a learner's ${clip(body.lang || "code", 20)} attempt at a practice problem.`,
    `The learner is ${level}.`,
    "Judge correctness against the PROBLEM and the REFERENCE SOLUTION. The reference is private: never quote it, and never write the full corrected solution, unless the learner's attempt is already correct.",
    "Other correct approaches are fine; judge by behaviour, not by similarity to the reference.",
    body.lang === "SQL"
      ? "The RUN RESULT shows what happened when the learner ran or submitted it; use it."
      : "The code was not executed. Trace it mentally against the example and edge cases (empty input, ties, boundaries), and name a specific input where it fails if it does.",
    "Reply in this shape, no tables:",
    "**Verdict:** Correct, Nearly there, or Not yet, plus one sentence why.",
    brief ? "**What to fix:** up to 2 short bullets pointing at the exact clause or line." : "**What works:** up to 3 bullets.\n**What to fix:** up to 4 bullets, each pointing at the exact clause or line and explaining why it's wrong, with a tiny example of the failing case.",
    "**Next step:** one concrete hint that moves them forward without giving the answer away.",
    brief ? "" : "If the verdict is Correct, replace Next step with **Make it interview-ready:** edge cases, complexity, and one alternative approach worth mentioning.",
    "",
    `PROBLEM: ${clip(body.title, 120)}`,
    clip(body.question, 2500),
    "",
    `RUN RESULT: ${clip(body.result, 600)}`,
    "",
    "REFERENCE SOLUTION (private):",
    clip(body.reference, 3000),
  ].filter(Boolean).join("\n");
}

const GEN_DOMAINS = {
  any: "any realistic Indian business",
  ecom: "an Indian e-commerce or D2C brand (orders, carts, sellers, returns, delivery)",
  fin: "an Indian fintech or UPI payments company (transactions, merchants, refunds, settlements, wallets)",
  log: "an Indian logistics or supply-chain company (shipments, carriers, hubs, warehouses, routes)",
  saas: "a SaaS product company (accounts, subscriptions, feature usage, invoices)",
};

function generatePrompt(body) {
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).slice(0, 40).map((t) => clip(t, 80)).join("; ");
  return [
    "You write ORIGINAL SQL practice problems for Datakul, a learning app for data engineers, analysts and scientists. Quality bar: as good as the best curated interview problems. Never reproduce or paraphrase problems from LeetCode, StrataScratch, DataLemur, HackerRank or similar sites.",
    "",
    `TOPIC / PATTERN: ${clip(body.topic || "any interview-relevant SQL pattern", 80)}`,
    `DIFFICULTY: ${clip(body.difficulty || "Medium", 10)} (Easy: one idea, 1–2 tables. Medium: window functions or multi-step CTEs. Hard: combines two patterns or has subtle edge cases.)`,
    `BUSINESS CONTEXT: ${GEN_DOMAINS[body.domain] || GEN_DOMAINS.any}`,
    avoid ? `ALREADY USED TITLES (pick something clearly different): ${avoid}` : "",
    "",
    "SQL RULES: SQLite 3.40 syntax only. Window functions and CTEs are fine. Do NOT use DATE_TRUNC, INTERVAL, ILIKE, :: casts, QUALIFY, FILTER, GENERATE_SERIES, RIGHT JOIN or FULL JOIN. Dates and timestamps are ISO text ('2026-10-05', '2026-10-05 14:30'); use date(), strftime(), julianday(). Use 100.0 to avoid integer division.",
    "DATA RULES: 1–3 tables, 6–25 rows each, realistic Indian names, cities and amounts in rupees. The data MUST contain the edge cases the pattern is about (ties, NULLs, duplicates, missing dates, boundary values) so careless queries fail.",
    "TASK RULES: name every output column with its exact alias, say how to sort, and make the sort fully deterministic (add a tie-breaker). The reference solution must ORDER BY exactly as described.",
    "THE TRAP: also write wrong_solution, the mistake a typical candidate would make (for example ROW_NUMBER instead of DENSE_RANK, WHERE instead of HAVING, COUNT(*) instead of COUNT(DISTINCT), inner join instead of left join). On this data it MUST run without error and return a DIFFERENT result from the solution.",
    "",
    "Reply with ONLY one JSON object, no prose, no code fences, using exactly these keys:",
    '{"title": "short specific title", "diff": "Easy|Medium|Hard", "pattern": "short pattern name",',
    ' "prompt": "the task in Markdown (use **bold**, `code`, and \\n- for lists). Describe the business situation in 1-2 sentences, then the exact output",',
    ' "setup": "CREATE TABLE ...; INSERT INTO ... VALUES (...),(...);",',
    ' "ordered": true,',
    ' "starter": "a helpful partial query with -- comments where the learner fills in logic",',
    ' "solution": "the reference query",',
    ' "wrong_solution": "the plausible wrong query",',
    ' "trap": "one or two sentences: what the wrong query gets wrong and which rows expose it",',
    ' "hints": ["a gentle nudge", "a bigger nudge naming the technique"],',
    ' "explain": {"approach": "2-4 sentences", "steps": ["step", "..."], "trace": "a short walkthrough on 2-3 of the sample rows", "pitfalls": ["mistake and why", "..."], "real": "where this pattern is used at work"}}',
  ].filter(Boolean).join("\n");
}

const PYSPARK_SUBSET = [
  "SparkSession: spark.createDataFrame(list_of_tuples, ['col', ...]) — a global `spark` already exists in tests.",
  "DataFrame: select, withColumn, withColumnRenamed, drop, filter/where (Column conditions only, no SQL strings), groupBy(...).agg(...), groupBy(...).count(), orderBy/sort, join(other, on='col' | ['a','b'] | df1.a == df2.b, how='inner'|'left'|'right'|'outer'|'left_anti'|'left_semi'), distinct, dropDuplicates, union, unionByName, limit, fillna, dropna, collect, count, show, toPandas.",
  "functions as F: col, lit, when/otherwise, sum, avg, min, max, count, countDistinct, collect_list, first, round, abs, upper, lower, trim, length, concat, concat_ws, coalesce, to_date, year, month, datediff, date_add, date_sub, date_format('yyyy-MM'), desc, asc.",
  "Window: Window.partitionBy(...).orderBy(...), rowsBetween; row_number, rank, dense_rank, lag, lead, and sum/avg/min/max/count .over(window).",
  "NOT available: spark.sql, F.expr, UDFs, RDDs, pandas_udf, explode, arrays/maps/structs, reading files.",
].join("\n");

function generatePyPrompt(body) {
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).slice(0, 40).map((t) => clip(t, 80)).join("; ");
  const lang = body.lang;
  const runtime = lang === "pyspark"
    ? "PySpark, executed on a pandas-backed engine that implements ONLY this subset of the API:\n" + PYSPARK_SUBSET + "\nThe solution must import `from pyspark.sql import functions as F` (and Window if needed), take DataFrame inputs and return a DataFrame."
    : lang === "pandas"
      ? "pandas 2.2 with numpy, on Python 3.12. The function takes DataFrame(s) and returns a DataFrame or Series. Tests build inputs with `import pandas as pd` inside setup."
      : "plain Python 3.12, standard library only (collections, heapq, itertools, bisect, datetime, re…). No third-party packages.";
  return [
    "You write ORIGINAL coding practice problems for Datakul, a learning app for data engineers, analysts and scientists. Quality bar: as good as the best curated interview problems. Never reproduce or paraphrase problems from LeetCode, StrataScratch, DataLemur, HackerRank or similar sites.",
    "",
    `LANGUAGE / RUNTIME: ${runtime}`,
    `TOPIC / PATTERN: ${clip(body.topic || "any interview-relevant data-engineering coding pattern", 80)}`,
    `DIFFICULTY: ${clip(body.difficulty || "Medium", 10)} (Easy: one idea. Medium: a known technique with edge cases. Hard: combines techniques or needs careful state/complexity.)`,
    `BUSINESS CONTEXT: ${GEN_DOMAINS[body.domain] || GEN_DOMAINS.any}`,
    avoid ? `ALREADY USED TITLES (pick something clearly different): ${avoid}` : "",
    "",
    "PROGRAM RULES: the learner writes ONE function named in `entry`. It must be deterministic: no randomness, no current time, no file or network access, no input(). Keep inputs small.",
    "TESTS: 5–7 tests. Each test is {\"name\", \"setup\" (Python statements that build the inputs; may be empty), \"call\" (one expression calling the entry function), \"observe\" (optional expression over `result` and setup variables; use it when the function mutates an argument), \"hidden\" (true for all but the first two)}. Expected outputs are computed by running YOUR solution, so do not write expected values. Cover edge cases: empty input, ties, duplicates, boundaries, unsorted input, None/NaN where relevant. If the output is a DataFrame, the solution must sort it deterministically before returning.",
    "THE TRAP: also write wrong_solution, the mistake a typical candidate would make. It MUST run without crashing on at least the first test, and MUST return a different result on at least one test.",
    "",
    "Reply with ONLY one JSON object, no prose, no code fences, with exactly these keys:",
    '{"title": "short specific title", "diff": "Easy|Medium|Hard", "pattern": "short pattern name",',
    ' "prompt": "the task in Markdown: the situation in 1-2 sentences, then the exact function signature, inputs, output and ordering",',
    ' "example": "a short example call and its output, as Python comments/code",',
    ' "entry": "function_name",',
    ' "starter": "the function signature with a docstring and pass",',
    ' "solution": "complete reference code including imports",',
    ' "wrong_solution": "complete plausible wrong code including imports",',
    ' "trap": "one or two sentences: what the wrong code gets wrong and which test exposes it",',
    ' "tests": [{"name": "...", "setup": "...", "call": "...", "observe": "", "hidden": false}],',
    ' "hints": ["a gentle nudge", "a bigger nudge naming the technique"],',
    ' "explain": {"approach": "2-4 sentences", "steps": ["step", "..."], "complexity": "time and space", "pitfalls": ["mistake and why", "..."], "real": "where this is used at work"}}',
  ].filter(Boolean).join("\n");
}


function cardifyPrompt() {
  return [
    "You turn a tutor's answer into a short study card for a data learner. Output ONLY a JSON object, no prose, no code fence:",
    '{"title": "3-6 word topic name", "takeaway": "one plain sentence, under 30 words", "example": "one concrete example sentence, under 35 words",',
    ' "check": "one question that tests understanding",',
    ' "points": [{"t": "key point a good answer to the check question makes", "k": ["2-4 lowercase keywords or short phrases a correct answer would literally contain"]}]}',
    "Rules: 2 to 4 points. Each point needs at least 2 specific keywords (never generic words like data, use, the). Base everything on the answer given; do not add new facts.",
    "If the question is not about data or data careers, output {\"skip\": true}.",
  ].join("\n");
}

function buildMessages(body) {
  if (body.mode === "cardify") {
    return [
      { role: "system", content: cardifyPrompt() },
      { role: "user", content: `QUESTION:\n${clip(body.question, LIMITS.question)}\n\nANSWER:\n${clip(body.answer, LIMITS.answer)}` },
    ];
  }
  if (body.mode === "generate") {
    const isPy = ["python", "pandas", "pyspark"].includes(body.lang);
    const msgs = [
      { role: "system", content: isPy ? generatePyPrompt(body) : generatePrompt(body) },
      { role: "user", content: "Write the problem now. Output only the JSON object." },
    ];
    if (body.previous && body.error) {
      msgs.push(
        { role: "assistant", content: clip(body.previous, 14000) },
        { role: "user", content: `Automatic checks failed: ${clip(body.error, 800)}\nFix the problem so every check passes. Change the data, the queries, or the task as needed. Output only the full corrected JSON object.` },
      );
    }
    return msgs;
  }
  if (body.mode === "codereview") {
    return [
      { role: "system", content: codereviewPrompt(body) },
      { role: "user", content: `LEARNER'S CODE:\n${clip(body.code, 6000)}` },
    ];
  }
  if (body.mode === "selfcheck") {
    return [
      { role: "system", content: selfcheckPrompt(body) },
      { role: "user", content: `LEARNER'S ANSWER:\n${clip(body.answer, LIMITS.answer)}` },
    ];
  }
  if (body.mode === "feedback") {
    return [
      { role: "system", content: feedbackPrompt(body) },
      { role: "user", content: `CANDIDATE ANSWER:\n${clip(body.answer, LIMITS.answer)}` },
    ];
  }
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-LIMITS.historyItems)
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: clip(m.content, LIMITS.historyItemChars) }))
    // Some providers require strict user/assistant alternation starting with a user turn.
    .reduce((acc, m) => {
      if (!acc.length && m.role === "assistant") return acc;
      const last = acc[acc.length - 1];
      if (last && last.role === m.role) last.content += "\n\n" + m.content;
      else acc.push({ ...m });
      return acc;
    }, []);
  if (history.length && history[history.length - 1].role === "user") history.pop();
  return [
    { role: "system", content: tutorPrompt(body) },
    ...history,
    { role: "user", content: clip(body.question, LIMITS.question) },
  ];
}

/* ---------------- provider call with fallback ---------------- */
// Workers AI streams {"response": "..."} events; convert them to the OpenAI shape the app reads.
function toOpenAIStream(stream) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  let buf = "";
  const emit = (ctrl, line) => {
    if (!line.startsWith("data:")) return;
    const d = line.slice(5).trim();
    if (d === "[DONE]") { ctrl.enqueue(enc.encode("data: [DONE]\n\n")); return; }
    try {
      const j = JSON.parse(d);
      const t = j.response ?? j.choices?.[0]?.delta?.content;
      if (t) ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`));
    } catch {}
  };
  return stream.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      buf += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { emit(ctrl, buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    },
    flush(ctrl) { if (buf.trim()) emit(ctrl, buf.trim()); },
  }));
}

async function callProvider(id, model, messages, env, maxTokens = LIMITS.maxTokens) {
  const p = PROVIDERS[id];
  if (p.binding) {
    const stream = await env.AI.run(model, { messages, stream: true, temperature: 0.4, max_tokens: maxTokens });
    return new Response(toOpenAIStream(stream), { status: 200 });
  }
  return fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env[p.keyName]}`,
      ...(p.extraHeaders || {}),
      ...(id === "openrouter" && env.SITE_URL ? { "HTTP-Referer": env.SITE_URL } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.4, max_tokens: maxTokens }),
  });
}

async function chat(body, env, cors, ctx) {
  const avail = configured(env).map(([id]) => id);
  if (!avail.length) return json({ error: "No AI provider keys are set on the gateway." }, 503, cors);

  const first = avail.includes(body.provider) ? body.provider : avail[0];
  const order = [first, ...FALLBACK_ORDER.filter((id) => id !== first && avail.includes(id))];
  const messages = buildMessages(body);
  const errors = [];
  const mode = String(body.mode || "tutor").slice(0, 20), tin = promptTokens(messages);

  for (const [k, id] of order.entries()) {
    const p = PROVIDERS[id];
    const model = id === first && p.models.some((m) => m.id === body.model) ? body.model : p.models[0].id;
    const t0 = Date.now();
    try {
      const r = await callProvider(id, model, messages, env, body.mode === "generate" ? LIMITS.maxTokensGenerate : body.mode === "cardify" ? 700 : LIMITS.maxTokens);
      const rec = { provider: id, model, mode, ms: Date.now() - t0, tin, fallback: k > 0, ...rateHeaders(r) };
      if (r.ok && r.body) {
        return new Response(meteredStream(r.body, env, ctx, rec), {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            "x-provider": id,
            "x-provider-label": p.label,
            "x-model": model,
            ...cors,
          },
        });
      }
      errors.push(`${p.label}: HTTP ${r.status}`);
      ctx && ctx.waitUntil(logUsage(env, { ...rec, ok: false, status: r.status, err: `HTTP ${r.status}` }));
    } catch (e) {
      errors.push(`${p.label}: ${e.message}`);
      ctx && ctx.waitUntil(logUsage(env, { provider: id, model, mode, ms: Date.now() - t0, tin, fallback: k > 0, ok: false, err: e.message }));
    }
  }
  return json({ error: "All providers are busy or out of free quota. Try again in a minute.", details: errors }, 502, cors);
}

/* ---------------- one-shot completion (no streaming), used for drafting community cards ---------------- */
async function complete(messages, env, { maxTokens = 3000, mode = "draft", only } = {}) {
  const avail = configured(env).map(([id]) => id);
  const prefer = env.DRAFT_PROVIDER && avail.includes(env.DRAFT_PROVIDER) ? env.DRAFT_PROVIDER : null;
  const order = only ? [only.provider] : [...(prefer ? [prefer] : []), ...FALLBACK_ORDER.filter((id) => id !== prefer && avail.includes(id))];
  const errors = [], tin = promptTokens(messages);
  for (const [k, id] of order.entries()) {
    const p = PROVIDERS[id];
    const model = only ? only.model : id === prefer && env.DRAFT_MODEL ? env.DRAFT_MODEL : p.models[0].id;
    const t0 = Date.now();
    const rec = { provider: id, model, mode, tin, fallback: k > 0 };
    try {
      let text = "", usage = null, rl = {};
      if (p.binding) {
        const r = await env.AI.run(model, { messages, temperature: 0.3, max_tokens: maxTokens });
        text = typeof r.response === "string" ? r.response : r.response ? JSON.stringify(r.response) : "";
        usage = r.usage || null;
      } else {
        const r = await fetch(`${p.base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${env[p.keyName]}`, ...(p.extraHeaders || {}) },
          body: JSON.stringify({ model, messages, stream: false, temperature: 0.3, max_tokens: maxTokens }),
        });
        rl = rateHeaders(r);
        if (!r.ok) { errors.push(`${p.label}: HTTP ${r.status}`); await logUsage(env, { ...rec, ...rl, ok: false, status: r.status, ms: Date.now() - t0, err: `HTTP ${r.status}` }); continue; }
        const j = await r.json();
        text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
        usage = j.usage || null;
      }
      const ms = Date.now() - t0;
      if (text.trim()) {
        await logUsage(env, { ...rec, ...rl, ok: true, status: 200, ms, tin: usage && usage.prompt_tokens ? usage.prompt_tokens : tin, tout: usage && usage.completion_tokens ? usage.completion_tokens : Math.ceil(text.length / 4), reported: !!(usage && usage.completion_tokens) });
        return { text, provider: id, model, ms };
      }
      errors.push(`${p.label}: empty reply`);
      await logUsage(env, { ...rec, ...rl, ok: false, status: 200, ms, err: "empty reply" });
    } catch (e) {
      errors.push(`${p.label}: ${e.message}`);
      await logUsage(env, { ...rec, ok: false, ms: Date.now() - t0, err: e.message });
    }
  }
  throw new Error(order.length ? "No provider could answer: " + errors.join("; ") : "No AI provider keys are set on the gateway.");
}
async function embed(texts, env, ctx) {
  const t0 = Date.now(), rec = { provider: "llama", model: EMBED_MODEL, mode: "embed", tin: Math.ceil(texts.join(" ").length / 4) };
  try {
    const out = await env.AI.run(EMBED_MODEL, { text: texts });
    const done = logUsage(env, { ...rec, ok: true, status: 200, ms: Date.now() - t0 });
    if (ctx && ctx.waitUntil) ctx.waitUntil(done); else await done;
    return out.data;
  } catch (e) {
    await logUsage(env, { ...rec, ok: false, ms: Date.now() - t0, err: e.message });
    throw e;
  }
}
// "Check now" on the Status tab: a tiny prompt to one model, to see if it answers and how fast.
async function ping(env, provider, model) {
  const p = PROVIDERS[provider];
  if (!p || !p.models.some((m) => m.id === model)) return { ok: false, error: "Unknown model." };
  if (!(p.binding ? env.AI : env[p.keyName])) return { ok: false, error: "No key set for this provider." };
  try {
    const out = await complete([{ role: "user", content: "Reply with the single word OK." }], env, { maxTokens: 300, mode: "ping", only: { provider, model } });
    return { ok: true, ms: out.ms, reply: out.text.trim().slice(0, 40) };
  } catch (e) {
    return { ok: false, error: e.message.replace(/^No provider could answer: /, "") };
  }
}
const providerList = (env) => configured(env).map(([id, p]) => ({ id, label: p.label, models: p.models }));
const deps = (env, ctx) => ({
  json, rateLimited, complete, embed: (t) => embed(t, env, ctx),
  usageStatus: async () => ({ ...(await usageStatus(env, [...providerList(env), ...(env.AI ? [{ id: "llama", label: "Embeddings (Cloudflare)", models: [{ id: EMBED_MODEL, label: "BGE small (matching by meaning)" }] }] : [])])), users: await userStats(env) }),
  ping: (provider, model) => ping(env, provider, model), setMeta: (k, v) => setMeta(env, k, v), pruneUsage: async () => { await pruneSessions(env); return pruneUsage(env); },
});

/* ---------------- router ---------------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";
    const { ok, headers: cors } = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !ok) return json({ error: "Origin not allowed." }, 403, cors);

    if (url.pathname === "/api/providers" && request.method === "GET") {
        return json({ providers: providerList(env) }, 200, cors);
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      const ip = request.headers.get("cf-connecting-ip") || "anon";
      if (rateLimited(ip)) return json({ error: "You're asking quickly. Please wait a few minutes." }, 429, cors);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Request body must be JSON." }, 400, cors);
      }
      if (body.mode === "generate" ? false : body.mode === "codereview" ? !String(body.code || "").trim() : body.mode === "feedback" || body.mode === "selfcheck" || body.mode === "cardify" ? !String(body.answer || "").trim() : !String(body.question || "").trim()) {
        return json({ error: "Nothing to send." }, 400, cors);
      }
      return chat(body, env, cors, ctx);
    }


    if (url.pathname === "/api/embed" && request.method === "POST") {
      if (!env.AI) return json({ error: "Embeddings need the Workers AI binding." }, 503, cors);
      const ip = request.headers.get("cf-connecting-ip") || "anon";
      if (rateLimited(ip)) return json({ error: "You're asking quickly. Please wait a few minutes." }, 429, cors);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Request body must be JSON." }, 400, cors); }
      const texts = (Array.isArray(body.texts) ? body.texts : []).slice(0, 32).map((t) => clip(String(t), 1500)).filter(Boolean);
      if (!texts.length) return json({ error: "Nothing to embed." }, 400, cors);
      try {
        return json({ model: EMBED_MODEL, vectors: await embed(texts, env, ctx) }, 200, cors);
      } catch (e) {
        return json({ error: "Embedding failed: " + e.message }, 502, cors);
      }
    }
    const acct = await handleAccounts(request, url, env, cors);
    if (acct) return acct;
    const l2 = await handleCommunity(request, url, env, cors, deps(env, ctx));
    if (l2) return l2;

    if (url.pathname === "/") return json({ name: "Datakul AI gateway", ok: true }, 200, cors);
    return json({ error: "Not found." }, 404, cors);
  },

  // Nightly: group unanswered questions, draft cards for popular groups, delete old questions.
  async scheduled(event, env, ctx) {
    const d = deps(env, ctx);
    ctx.waitUntil((async () => {
      let res;
      try { res = await runJob(env, d); console.log("layer2 job", JSON.stringify(res)); } catch (e) { console.log("layer2 job failed", e.message); }
      try { const r = await runCertJob(env, d); console.log("cert questions", JSON.stringify({ added: r.added, paused: r.paused })); } catch (e) { console.log("cert questions failed", e.message); }
      return res;
    })());
  },
};
