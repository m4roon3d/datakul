# Datakul

Quest-based learning for data engineering, analysis, science and architecture careers: an AI tutor that answers anything about data and data careers, interview practice, and coding practice. It runs for ₹0 on free tiers.

## How it fits together

```
Browser (web/)                         Cloudflare Worker (worker/)            Free-tier LLMs
──────────────                         ───────────────────────────            ──────────────
library.js  ── reviewed content        holds your API keys (secrets)          Groq (GPT-OSS, Qwen)
app.js      ── finds the matching   ─► builds the grounded prompt      ─►     Meta Llama (Workers AI)
               library entries         streams the reply back                 Google Gemini (Flash-Lite)
               (retrieval)             switches provider on 429/errors        OpenRouter (free), Mistral
quests.js   ── quests, XP, reviews     /api/embed for semantic search          BGE embeddings (Workers AI)
```

- **Ask anything, grounded where possible (RAG):** every question in AI mode goes to the LLM. The browser first matches it to library entries (keyword search, plus semantic search when `emb.js` is present) and sends strong matches as reference notes. Anything beyond the library is flagged. Answers are short: a bold takeaway, a few points, and a Mermaid diagram when a flow is clearer as a picture. The tutor covers data topics and data careers (interviews, résumés, salaries, study plans) and declines the rest.
- **Personal study cards:** when a question has no library match, the gateway's `cardify` mode turns the answer into a small card with a check question. It's saved in that learner's Library as a side quest.
- **Community picks (shared library):** questions the library can't answer are shared anonymously, grouped every night, drafted into new concept cards by the LLM, checked automatically, and published to everyone once a reviewer approves them. See "Growing the library" below.
- **Library-only mode:** with no gateway configured, everything still works offline from the library, including quests. Concept cards opened from quests and the Library always come from the library, so they cost nothing.
- **Automatic fallback:** if the chosen provider is busy or out of free quota, the gateway tries the next one with a key: Groq → Meta Llama → Gemini → OpenRouter → Mistral.
- **Keys never reach the browser.** They live as Worker secrets.

## Deploying

Deploys are automatic. Every merge to `main` runs `.github/workflows/deploy.yml`, which creates or updates the D1 database, applies migrations, deploys the AI gateway with its secrets, locks it to the website's address, publishes the website with the gateway address filled in, and checks the live app. The run's summary shows the addresses.

One-time setup (about 20 minutes, four GitHub secrets): see [docs/setup.md](docs/setup.md). Pull requests run `.github/workflows/checks.yml`: gateway and layer 2 tests, a Cloudflare bundle dry run, and browser tests of the app and review page.

The numbered steps below are the same deploy done by hand, if you ever need it.

## 1. Get free API keys (add any or all)

| Provider | Where | Notes |
|---|---|---|
| Groq (recommended first) | console.groq.com → API Keys | Fast. GPT-OSS 120B, GPT-OSS 20B and Qwen 3.8 27B (preview) each allow about 1,000 requests and 200,000 tokens a day on the free plan, so roughly 80 tutor answers a day per model. Groq no longer offers Llama 3.3 70B or Llama 3.1 8B outside enterprise plans |
| Google Gemini | aistudio.google.com → Get API key | Free tier is now small: roughly 500 a day on Flash-Lite and 20 on Flash (check your project in AI Studio). Free-tier prompts may be used to improve Google's products |
| OpenRouter | openrouter.ai → Keys | Uses `openrouter/free`, which auto-picks a free model |
| Meta Llama | Nothing to sign up for | Runs on Cloudflare Workers AI inside the gateway. Free plan gives 10,000 "neurons" a day: roughly 80 answers on Llama 3.3 70B, 200 on Llama 4 Scout, 400 on Llama 3.1 8B. Resets at midnight UTC |
| Mistral | console.mistral.ai → choose the free "Experiment" plan | Needs phone verification |

Free tiers can change their limits without notice, and some may use your prompts to improve their models. Read each provider's terms before going public.

## 2. Deploy the gateway (Cloudflare Workers, free plan)

Needs Node.js 18+ and a free Cloudflare account.

```bash
cd worker
npx wrangler login
npx wrangler secret put GROQ_API_KEY        # paste the key when asked
npx wrangler secret put GEMINI_API_KEY      # optional
npx wrangler secret put OPENROUTER_API_KEY  # optional
npx wrangler secret put MISTRAL_API_KEY     # optional
npx wrangler deploy
```

Wrangler prints an address such as `https://datakul-gateway.<you>.workers.dev`. Check it by opening `<that address>/api/providers`; it should list the providers you added keys for.

## 3. Connect and publish the web app

1. Put the gateway address in `web/config.js` as `gatewayUrl`.
2. Publish the `web/` folder as a static site, either:
   - **Cloudflare Pages:** `npx wrangler pages deploy web --project-name datakul`, or
   - **GitHub Pages:** push the repo and serve the `web/` folder.
3. Lock the gateway to your site: in `worker/wrangler.toml` set `ALLOWED_ORIGINS = "https://<your-site>"`, then run `npx wrangler deploy` again.

Optional, for better matching in Ask: build concept embeddings with `node tools/embed-concepts.mjs <gateway address>`, then add `<script src="emb.js"></script>` before `app.js` in `web/index.html`.

To try it on your laptop first, run `npx wrangler dev` in `worker/`, set `gatewayUrl` to `http://localhost:8787`, and run `python3 -m http.server 8000` in `web/`.

## 4. Growing the library (community picks, optional)

The library grows from what learners ask. It needs a free Cloudflare D1 database.

```
Learner asks something the library can't answer
  → app sends the question to /api/miss (anonymous; learners can turn this off in settings)
  → gateway masks emails, phone, Aadhaar-like and PAN numbers, stores the question with its embedding
Every night at 02:00 IST
  → similar questions are grouped by meaning (embeddings, cosine 0.80)
  → a group asked by enough different learners (3 at launch, up to 10 as Datakul grows) is drafted by the LLM: a concept card + 2 interview questions
  → the gateway checks the draft with the app's own grader (same rules as content/validate_batch.js);
    if a check fails, the errors go back to the model once for a repair
  → questions older than 180 days are deleted
You review in web/admin.html
  → edit, run checks, approve, redraft or reject; approval refuses drafts that fail a check
  → approved cards reach every learner's app as "Community picks", with quests, interview questions and a boss round
```

Set it up:

```bash
cd worker
npx wrangler d1 create datakul                    # paste the database_id it prints into wrangler.toml
npx wrangler d1 migrations apply datakul --remote
npx wrangler secret put ADMIN_TOKEN               # a long random password for the review page
npx wrangler deploy
```

Then open `admin.html` on your site (for example `https://<your-site>/admin.html`), enter the gateway address and the token. The token stays in that browser tab only. The page is marked `noindex`; it is useless without the token.

- **Accounts (optional):** sign-in with Google is off until you add the `GOOGLE_CLIENT_ID` secret (steps in `docs/setup.md`). Then learners can keep progress across devices; the gateway stores their name, email and progress, can delete them on request, and `web/privacy.html` says so.
- **Privacy (without an account):** no account, IP address or user id is stored. Each question gets a per-day pseudonym (a hash of the address, the day and your secret) so the gateway can count different askers without following anyone across days. The public `/api/community` feed carries only approved cards. Learners can opt out in settings, and the app says so on the Ask screen. If you serve learners in India, this supports your duties under the DPDP Act and Rules (notice, purpose limitation, retention); check the final position with a lawyer before launch.
- **Tuning** (in `wrangler.toml` `[vars]`): `MIN_ASKERS` (`auto`: 3 different askers while Datakul is small, rising to 10 as it grows; or a fixed number), `DRAFTS_PER_RUN` (default 3), `CLUSTER_SIM` (default 0.8), `RETAIN_DAYS` (default 180), and optionally `DRAFT_PROVIDER` / `DRAFT_MODEL` for the drafting model. GPT-OSS 120B on Groq passes the checks most often.
- **Cost:** three drafts a night is a few thousand tokens; embeddings are one small call per question. Both fit the free tiers. D1's free plan (5 GB, 5 million reads a day) is far more than this needs.
- **Withdrawing a card:** reject it from the Live tab. Learners lose it on their next visit.
- **Run it now:** the review page's "Run grouping now" runs the nightly job on demand.
- **Grader copy:** the gateway checks drafts with `worker/src/grader.js`, generated from `web/app.js`. After changing the grader in the app, run `node tools/sync-grader.mjs`.

Without the D1 block in `wrangler.toml`, these routes switch off and the app behaves as before.

## Exam prep (certification coaching, beta)

**Certifications** (its own section in the menu) coaches learners for a certification exam. The first track is the **Databricks Certified Data Engineer Associate** (exam published 4 May 2026: 45 scored questions, 90 minutes, 7 sections).

- **Exam date and plan:** the learner sets a date; the app counts down and names today's focus (the not-yet-ready section that matters most for the exam).
- **Diagnostic:** 2 questions from each section to see where to start.
- **Practice by section:** 10 questions at a time, unseen and previously missed first, with the right answer and an explanation after each.
- **Mock exam:** full length in the exam's section mix, timed, with no answers shown until you submit; then a score per section and a full review.
- **Readiness:** each section is Ready once the learner has answered 8 or more of its questions recently with 75% or more of their last 10 right. Book the exam when every section is ready.
- Options are shuffled each time; XP is earned for sets and mocks; progress is stored in the browser (`dp_cert`).

Questions are original, written from the public exam guide and vendor documentation, never from real exams (vendors treat exam content as confidential and can revoke learners' certifications for using it). The app says it is independent and not affiliated with the vendor. Banks live in `content/certs/*.py` and are checked and built into `web/certs.js` by `node content/build_certs.mjs` (schema, answer indexes, "(Choose two.)" wording, explanation length, at least 2 questions per section).

## AI status page (for the people who run Datakul)

The review page (`admin.html`, locked by `ADMIN_TOKEN`) has an **AI status** tab:

- each model's health today (working, check, failing) with the last error, and a **Check now** button that sends it a one-word test prompt;
- requests and tokens today against each free daily allowance, plus the remaining allowance Groq reports in its replies;
- calls refused as busy or over quota, and answers given by a backup provider;
- what the AI was used for (Ask, interview feedback, code reviews and so on), the last 7 days, and the last nightly community job.

The gateway logs one row per AI call in D1 (`worker/migrations/0002_usage.sql`): provider, model, feature, success, timing, token counts and any remaining-allowance headers. It never stores the question or answer text. Rows are deleted after 90 days. Free allowances reset at midnight UTC (5:30 am India time).

## Changing models or adding a vendor

To turn Meta Llama off, delete the `[ai]` lines in `worker/wrangler.toml`.


Edit the `PROVIDERS` list at the top of `worker/src/index.js`. Any vendor with an OpenAI-compatible `/chat/completions` endpoint needs only a base URL, a key name and model IDs. The settings screen in the app picks up the change automatically.

## Growing the library every week

The library grows by about 10 reviewed topics a week. A scheduled Claude task follows [docs/weekly-content.md](docs/weekly-content.md): it writes the next topics from `content/queue.txt` (wave 2 of the syllabus: GenAI and AI engineering, cloud platforms and certifications, industry packs, advanced topics), plus up to two timely topics or fixes, checks them with the same validator as every other batch, and opens a pull request. Merging it deploys the new topics. New topics show for three weeks under "New in the library" on the Quests home and in the Library.

## Editing content

All concepts and interview questions are in `web/library.js`:

- `C` holds concepts: summary, details, example, check question, interview angle, related topics.
- `Q` holds questions: roles, level, company types, key points with the keywords used for the instant answer check.

## Limits built into the gateway

- 30 AI requests per visitor every 10 minutes (best effort, per Worker instance)
- Question, context and answer length caps
- Replies capped at about 1,800 tokens; the tutor prompt asks for under 200 words
- Study cards (`cardify`) capped at 700 tokens; `/api/embed` takes up to 32 texts per call
- `/api/miss` keeps 300 characters per question, counts once per visitor per day per question, and shares the per-visitor rate limit

## Quests

The app opens on the Quests home (`web/quests.js`). It is quest-based learning on top of the library:

- **Path and chapters:** the learner picks a career path (Data Engineer, Analyst, Scientist or Architect). Each module of that track is a chapter; each concept is a quest.
- **Quest steps:** Learn (open the concept card), Answer (score 60% or more on one of its interview questions with the instant checker), and a bonus Code step when a practice problem covers the concept.
- **Boss rounds:** each chapter ends with a 5-question mock round, which opens once 60% of the chapter's quests are done. Scoring 60% clears the chapter and unlocks the next; learners can also unlock a chapter early.
- **XP and levels:** Shishya → Sadhaka → Vidvan → Acharya → Guru. XP for learning, answering, solving, reviews, daily quests and boss rounds.
- **Streak, daily quests and badges:** a daily streak, three daily quests that rotate by date, and ten badges.
- **Reviews:** spaced repetition (1, 3, 7, 16, 35, 90 days). Topics answered well come back as review quests just before they'd be forgotten.
- **Side quests from questions:** topics a learner keeps asking about, and personal study cards made from questions the library doesn't cover.
- **Diagrams:** `web/diagrams.js` holds 82 small diagram specs (flows, comparisons, layers, tables, bars, timelines, 2×2 grids) that draw in the app's theme on concept cards.

All quest progress is stored in the learner's browser (`dp_qs` and `dp_mycards` in localStorage). Approved community picks are cached in `dp_comm` and form a "Community picks" chapter in each path, open from the start; new ones also appear as side quests.

## Coding practice

The Practice tab has 15 original problems in `web/problems.js`: 10 SQL, plus Python, pandas and PySpark.

- **SQL runs in the browser** on SQLite (sql.js, loaded from jsDelivr on first use). Submit compares your result with the reference solution's output, row by row.
- **Python, pandas and PySpark run in the browser** on Pyodide (CPython compiled to WebAssembly, loaded from jsDelivr inside a Web Worker). Run executes the example tests; Submit runs every test, including hidden ones. Code that runs longer than 15 seconds is stopped. The first run downloads about 10 MB (plus pandas for pandas/PySpark problems), then the browser caches it.
- **PySpark** runs on `web/py/pyspark_lite.py`, a pandas-backed engine for the common DataFrame API: select, withColumn, filter, groupBy/agg, orderBy, joins (including left_anti and left_semi), distinct, dropDuplicates, union, column functions, when/otherwise, dates, and Window functions (row_number, rank, dense_rank, lag, lead, running aggregates). spark.sql, F.expr, UDFs and RDDs raise a clear "not supported" error. Running aggregates use a ROWS frame.
- `web/py/harness.py` runs each test twice, once against the learner's code and once against the reference solution, and compares the results. Expected outputs always come from the reference, never from hand-written values.
- Each problem has two hints, a gated step-by-step solution, common mistakes and where the pattern is used at work.
- The problems are written for Datakul. Don't copy problems from LeetCode or similar sites into the app: their content is copyrighted. The tab links out to LeetCode study plans instead.
- To add a SQL problem, give it a `setup` (CREATE + INSERT), a `solution`, and `ordered: true` if row order matters. The expected output is computed from the solution at runtime.
- To self-host the runtimes, set `sqlJsUrl` (sql-asm.js) and `pyodideUrl` (a Pyodide `full/` folder with a trailing slash) in `web/config.js`.

### Problem generator

Learners can generate new SQL, Python, pandas or PySpark problems on demand (language, pattern, difficulty, business type). The gateway's `generate` mode asks the model for a problem as JSON, including a **typical wrong solution**. Before the problem is shown, the browser checks it on SQLite:

1. the tables load and each has at least 3 rows,
2. the reference solution runs and returns rows,
3. the final ORDER BY exists when order matters,
4. the wrong solution runs and returns a **different** result, which proves the data catches the trap.

For Python, pandas and PySpark, the checks are: the starter compiles, the reference passes its own tests (run twice, which catches non-deterministic output), and the wrong solution returns a different result on at least one test.

If a check fails, the error goes back to the model for one repair attempt. Problems that still fail are discarded. Passed problems are saved in the learner's browser (up to 40).

Pick the generating model in settings under **Model for generating practice problems**. Larger free models (GPT-OSS 120B on Groq, Llama 3.3 70B, Gemini Flash) pass the checks more often than small ones. Generation uses a higher reply cap (`maxTokensGenerate`, 4,500 tokens).

## Files

```
web/index.html     page and styles
web/app.js         Ask tutor, retrieval, interview practice, Library, settings
web/quests.js      quest engine and Quests home
web/diagrams.js    concept diagrams
web/library.js     the concepts and interview questions (225 and 420 on 28 Oct 2026, growing weekly)
web/problems.js    15 coding problems with solutions
web/practice.js    Practice tab
web/pyrunner.js    Pyodide Web Worker runner
web/py/harness.py  Python test harness
web/py/pyspark_lite.py  in-browser PySpark engine
web/community.js   community picks: loads approved cards into the library
web/admin.html     review page for community drafts
web/config.js      gateway address
web/emb.js         optional concept embeddings (generated)
tools/embed-concepts.mjs  builds emb.js
worker/src/index.js   AI gateway
worker/src/community.js  layer 2: collect, group, draft, check, review, publish
worker/src/grader.js  copy of the app's answer checker (generated)
worker/src/usage.js   AI call logging and the status page data
worker/migrations/    D1 schema
worker/wrangler.toml  gateway settings
tools/sync-grader.mjs copies the grader from app.js into the gateway
```

## Brand

The logo is the **compass**: a saffron north needle in a sky-blue ring on a deep navy tile, for "find your path". The wordmark is "datakul" in Space Grotesk Bold, "data" in navy and "kul" in saffron, outlined so it looks the same everywhere.

All brand files are built by `python3 tools/make_brand.py` from one definition (the font is in `brand/fonts/`, OFL licence):

- `datakul-logo.svg` / `datakul-logo-dark.svg` (+ PNG), `datakul-logo-stacked.svg`, `datakul-wordmark.svg`, `datakul-mark.svg`
- `datakul-icon-512.png`, `datakul-icon-192.png`, `datakul-maskable-512.png` (Android adaptive icon), `datakul-apple-180.png`, `datakul-favicon-32.png`
- `inline.json`: the mark and wordmark snippets used in `web/index.html` and `web/admin.html`
- `datakul-brand.html`: the brand sheet

Colours: navy `#0B2A3A` (ink, tile), interface blue `#0B6F94` (light) / sky `#5CC3E6` (dark), saffron `#F7861F` / `#FF8A2A` (brand, progress, XP). Type: Space Grotesk (display), Atkinson Hyperlegible (body), JetBrains Mono (code).

**Themes:** Settings → Appearance offers Auto (follows the device), Light, Dark (navy) and Pitch dark (true black, kind to OLED phone batteries). The choice is saved in `dp_theme` and applied before the page paints.
