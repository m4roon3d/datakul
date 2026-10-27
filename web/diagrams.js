/* Datakul concept diagrams. Each is a small spec drawn as themed HTML by drawDiagram(), so it works in light and dark and reflows on phones.
   Kinds:
     flow   n: [[label, sub?, mark?]]          boxes joined by chevrons. mark: "hi" (saffron) or "end" (peacock)
     cols   n: [[heading, line, line…]]        side-by-side columns
     vs     a/b: [heading, line, line…]        two columns with "vs"
     layers n: [[label, sub?]]                 stacked bands, top to bottom
     hub    c: [label, sub], n: [label…]       a centre with spokes (star schema, driver/executors)
     table  cap?, cols, rows, hi?: [rowIndex]  a mini table; tables: [table, table] shows two side by side
     bars   n: [[label, value 0-100, mark?]]   horizontal bars
     line   n: [[time, label, mark?]]          a timeline
     grid2  r: [rowLabel, rowLabel], c: [colLabel, colLabel], v: [[a, b], [c, d]], hi: [[r, c]]
   cap: an optional one-line caption under the diagram. */
const DIAGRAMS = {
  /* ---------- data engineering ---------- */
  "de-lifecycle": { k: "flow", n: [["Generate", "apps, devices"], ["Ingest", "batch or stream"], ["Store", "lake, warehouse"], ["Transform", "clean, model", "hi"], ["Serve", "BI, ML, APIs", "end"]] },
  "batch-stream": { k: "vs", a: ["Batch", "Runs on a schedule", "Minutes to hours late", "Simple to rerun"], b: ["Streaming", "Runs continuously", "Seconds late", "Needs state and watermarks"] },
  "etl-elt": { k: "vs", a: ["ETL", "Transform before loading", "Separate engine", "Older warehouses"], b: ["ELT", "Load raw, transform inside", "Warehouse does the work", "dbt, Snowflake, BigQuery"] },
  cdc: { k: "flow", n: [["Orders DB", "Postgres"], ["Change log", "every insert, update, delete", "hi"], ["Debezium", "reads the log"], ["Kafka", "change events"], ["Warehouse", "MERGE upserts", "end"]] },
  "incremental-loads": { k: "flow", n: [["Read watermark", "last: 10:00"], ["Pull rows", "updated_at > 10:00", "hi"], ["MERGE", "insert or update"], ["Save watermark", "now: 10:15", "end"]], cap: "Each run only touches what changed since the last one." },
  idempotency: { k: "vs", a: ["Not idempotent", "INSERT on every run", "Rerun = duplicate rows"], b: ["Idempotent", "Overwrite the partition or MERGE", "Rerun = same result"] },
  backfills: { k: "line", n: [["Mon", "bug ships"], ["Thu", "bug found", "hi"], ["Fri", "fix deployed"], ["Fri night", "rerun Mon–Thu partitions", "end"]] },
  "file-formats": { k: "tables", tables: [
    { cap: "Row format (CSV)", cols: ["id", "city", "amount"], rows: [["1", "Pune", "450"], ["2", "Delhi", "120"]] },
    { cap: "Columnar (Parquet)", cols: ["column", "values stored together"], rows: [["id", "1, 2"], ["city", "Pune, Delhi"], ["amount", "450, 120"]], hi: [2] }],
    cap: "Columnar files read only the columns a query needs, and compress far better." },
  partitioning: { k: "bars", n: [["dt=2026-10-25", 18], ["dt=2026-10-26", 22], ["dt=2026-10-27", 20, "hi"], ["dt=2026-10-28", 19]], cap: "WHERE dt = '2026-10-27' reads one folder, not all four." },
  "small-files": { k: "vs", a: ["10,000 × 1 MB files", "10,000 file opens", "Slow listing and planning"], b: ["80 × 128 MB files", "80 file opens", "Compaction fixed it"] },
  "table-formats": { k: "layers", n: [["Engines", "Spark, Trino, Snowflake, Flink"], ["Table format", "Iceberg, Delta, Hudi: snapshots, schema, ACID"], ["Files", "Parquet on S3, ADLS or GCS"]] },
  "spark-architecture": { k: "hub", c: ["Driver", "plans the job"], n: ["Executor 1", "Executor 2", "Executor 3", "Executor 4"], cap: "The driver splits work into tasks; executors run them on partitions in parallel." },
  "spark-shuffle": { k: "flow", n: [["Map tasks", "read partitions"], ["Shuffle", "repartition by key over the network", "hi"], ["Reduce tasks", "aggregate per key", "end"]], cap: "groupBy, join and distinct shuffle. It is usually the slowest stage." },
  "spark-joins": { k: "vs", a: ["Broadcast join", "Small table copied to every executor", "No shuffle of the big table", "Small side under ~10 MB to a few hundred MB"], b: ["Sort-merge join", "Both sides shuffled by key", "Then sorted and merged", "Default for two large tables"] },
  "kafka-basics": { k: "flow", n: [["Producers", "checkout app"], ["Topic: orders", "3 partitions, ordered within each", "hi"], ["Consumer group", "one reader per partition", "end"]] },
  "delivery-semantics": { k: "cols", n: [["At most once", "Can lose events", "Never duplicates"], ["At least once", "Never loses", "Can duplicate: dedupe downstream"], ["Exactly once", "Transactions + idempotent writes", "Costs latency"]] },
  "event-time": { k: "line", n: [["10:01", "A happens"], ["10:03", "B happens"], ["10:04", "C happens, arrives 10:06", "hi"], ["10:07", "watermark closes 10:00–10:05", "end"]], cap: "C is late but still counted, because the watermark waited 2 minutes." },
  orchestration: { k: "flow", n: [["Extract orders"], ["Extract payments"], ["Join + clean", "", "hi"], ["Load mart"], ["Refresh dashboard", "", "end"]], cap: "A DAG: each task starts only when the ones before it succeed." },
  "dbt-basics": { k: "flow", n: [["Sources", "raw tables"], ["Staging", "rename, cast"], ["Intermediate", "joins, logic"], ["Marts", "facts and dims", "end"]], cap: "Models reference each other with ref(), so dbt knows the build order." },
  "data-observability": { k: "cols", n: [["Freshness", "Updated on time?"], ["Volume", "Row counts normal?"], ["Schema", "Columns changed?"], ["Distribution", "Values odd?"], ["Lineage", "What breaks downstream?"]] },
  "data-quality": { k: "cols", n: [["Completeness", "no missing keys"], ["Validity", "amount > 0"], ["Uniqueness", "one row per order"], ["Timeliness", "loaded by 7 am"]] },
  "data-contracts": { k: "flow", n: [["Producer team", "checkout service"], ["Contract", "schema, meaning, SLA, owner", "hi"], ["CI check", "blocks breaking changes"], ["Consumers", "analytics, ML", "end"]] },
  "pii-handling": { k: "cols", n: [["Masking", "XXXXXX4521", "for analysts"], ["Hashing", "salted SHA-256", "for joins"], ["Tokenisation", "token ↔ vault", "reversible"], ["Encryption", "at rest and in transit", "with keys"]] },
  medallion: { k: "layers", n: [["Gold", "business-ready marts and features"], ["Silver", "cleaned, deduplicated, joined"], ["Bronze", "raw data as it landed"]] },
  "lambda-kappa": { k: "vs", a: ["Lambda", "Batch layer + speed layer", "Two code paths to keep in sync"], b: ["Kappa", "One streaming path", "Replay the log to reprocess"] },
  lakehouse: { k: "layers", n: [["BI, SQL, ML", "one copy of the data for all"], ["Table format", "ACID, time travel, schema"], ["Cheap object storage", "open Parquet files"]] },
  "star-schema": { k: "hub", c: ["fact_orders", "one row per order item"], n: ["dim_customer", "dim_product", "dim_date", "dim_store"] },
  scd: { k: "table", cap: "SCD Type 2: a city change adds a row instead of overwriting", cols: ["customer", "city", "valid_from", "valid_to", "current"], rows: [["C42", "Pune", "2024-01-01", "2026-03-31", "no"], ["C42", "Bengaluru", "2026-04-01", "9999-12-31", "yes"]], hi: [1] },
  normalization: { k: "vs", a: ["Normalised", "Each fact stored once", "More joins", "Good for writes (OLTP)"], b: ["Denormalised", "Repeated values", "Fewer joins", "Good for reads (analytics)"] },
  "data-mesh": { k: "hub", c: ["Self-serve platform", "shared tools and governance"], n: ["Orders domain", "Payments domain", "Logistics domain", "Marketing domain"], cap: "Each domain owns its data as a product." },
  /* ---------- SQL ---------- */
  "sql-joins": { k: "cols", n: [["INNER", "only matches"], ["LEFT", "all left rows", "NULLs where no match"], ["FULL", "everything from both"], ["Anti join", "LEFT … WHERE right IS NULL", "rows with no match"]] },
  "group-by-having": { k: "flow", n: [["FROM + WHERE", "filter rows"], ["GROUP BY", "one row per group", "hi"], ["HAVING", "filter groups"], ["SELECT + ORDER BY", "", "end"]] },
  "window-functions": { k: "table", cap: "RANK() OVER (PARTITION BY city ORDER BY sales DESC) keeps every row", cols: ["city", "store", "sales", "rank"], rows: [["Pune", "A", "90", "1"], ["Pune", "B", "70", "2"], ["Delhi", "C", "80", "1"], ["Delhi", "D", "80", "1"]], hi: [3] },
  "running-totals": { k: "table", cap: "SUM(amount) OVER (ORDER BY day)", cols: ["day", "amount", "running total"], rows: [["Mon", "100", "100"], ["Tue", "50", "150"], ["Wed", "80", "230"]], hi: [2] },
  "gaps-islands": { k: "table", cap: "date − ROW_NUMBER() is constant within a streak", cols: ["login date", "row_number", "group key"], rows: [["Oct 1", "1", "Sep 30"], ["Oct 2", "2", "Sep 30"], ["Oct 5", "3", "Oct 2"], ["Oct 6", "4", "Oct 2"]], hi: [2, 3] },
  "sql-performance": { k: "flow", n: [["Read the plan", "EXPLAIN"], ["Scan less", "filter on partitions, select columns", "hi"], ["Join smarter", "filter before joining"], ["Index or cluster", "on filter keys", "end"]] },
  "null-handling": { k: "cols", n: [["NULL = NULL", "is not true", "use IS NULL"], ["COUNT(col)", "skips NULLs", "COUNT(*) doesn't"], ["COALESCE", "first non-NULL", "fill defaults"]] },
  /* ---------- analytics ---------- */
  "kpi-metrics": { k: "flow", n: [["Goal", "grow repeat orders"], ["KPI", "month-1 repeat rate", "hi"], ["Driver metrics", "delivery time, first-order rating"], ["Guardrail", "discount spend", "end"]] },
  funnels: { k: "bars", n: [["Visit", 100], ["View product", 40], ["Add to cart", 8, "hi"], ["Checkout", 3], ["Pay", 2.1]], cap: "The biggest drop is from viewing to adding to cart." },
  cohort: { k: "table", cap: "Share of each signup month still ordering", cols: ["cohort", "M0", "M1", "M2", "M3"], rows: [["Jan", "100%", "38%", "27%", "21%"], ["Feb", "100%", "35%", "24%", "–"], ["Mar", "100%", "29%", "–", "–"]], hi: [2] },
  "retention-churn": { k: "bars", n: [["Month 0", 100], ["Month 1", 38], ["Month 2", 27], ["Month 3", 21, "hi"]], cap: "Retention curve for one cohort. Churn is what falls away." },
  "ab-testing": { k: "flow", n: [["Hypothesis", "new button lifts conversion"], ["Random split", "50% control, 50% variant"], ["Run full weeks", "fixed sample size", "hi"], ["Test once", "p-value + effect size"], ["Decide", "ship, iterate or drop", "end"]] },
  "hypothesis-testing": { k: "flow", n: [["Null: no difference"], ["Collect data"], ["p-value", "chance of this result if null true", "hi"], ["p < 0.05?", "reject the null", "end"]] },
  "metric-rca": { k: "flow", n: [["Is the data right?", "pipeline, tracking"], ["Seasonality?", "vs last week, last year"], ["Decompose", "sessions × conversion × AOV", "hi"], ["Segment", "platform, city, channel"], ["Find the event", "release, outage, campaign", "end"]] },
  segmentation: { k: "grid2", r: ["Bought recently", "Not recently"], c: ["Buys often", "Buys rarely"], v: [["Champions", "New customers"], ["At risk", "Lost"]], hi: [[1, 0]] },
  "unit-economics": { k: "bars", n: [["CAC", 40], ["LTV (good channel)", 100, "end"], ["LTV (bad channel)", 64, "hi"]], cap: "Healthy channels earn about 3× what they cost to acquire." },
  "correlation-causation": { k: "hub", c: ["City size", "the confounder"], n: ["More delivery partners", "More late deliveries"], cap: "Both rise with city size; one doesn't cause the other." },
  "power-sample-size": { k: "cols", n: [["Baseline rate", "4%"], ["Smallest lift", "+0.4 pts"], ["Significance", "5%"], ["Power", "80%"], ["Sample", "≈39,000 per group"]] },
  /* ---------- data science ---------- */
  "precision-recall": { k: "grid2", r: ["Predicted fraud", "Predicted fine"], c: ["Actually fraud", "Actually fine"], v: [["True positive", "False positive"], ["False negative", "True negative"]], hi: [[0, 0]], cap: "Precision = TP ÷ (TP + FP). Recall = TP ÷ (TP + FN)." },
  "bias-variance": { k: "cols", n: [["High bias", "too simple", "underfits"], ["Just right", "generalises", "lowest test error"], ["High variance", "too complex", "overfits"]] },
  overfitting: { k: "vs", a: ["Training score", "98% accurate", "memorised noise"], b: ["Test score", "71% accurate", "fails on new data"] },
  "cross-validation": { k: "table", cap: "5-fold: every row is tested exactly once", cols: ["round", "1", "2", "3", "4", "5"], rows: [["1", "test", "train", "train", "train", "train"], ["2", "train", "test", "train", "train", "train"], ["3", "train", "train", "test", "train", "train"]], hi: [] },
  "data-leakage": { k: "vs", a: ["Leaky feature", "refund_issued", "Known only after the outcome"], b: ["Safe feature", "orders in last 30 days", "Known at prediction time"] },
  "gradient-descent": { k: "line", n: [["Step 1", "loss 2.3"], ["Step 10", "loss 0.9"], ["Step 30", "loss 0.4", "hi"], ["Step 60", "loss 0.38 (converged)", "end"]] },
  "decision-trees": { k: "flow", n: [["Distance > 12 km?"], ["Yes: raining?", "", "hi"], ["Yes: peak hour?"], ["Predict: late", "", "end"]] },
  "random-forests": { k: "flow", n: [["Bootstrap samples", "rows + feature subsets"], ["300 trees", "each slightly different", "hi"], ["Vote or average", "", "end"]] },
  "gradient-boosting": { k: "flow", n: [["Tree 1", "rough fit"], ["Tree 2", "fits tree 1's errors", "hi"], ["Tree 3", "fits what's left"], ["Sum of trees", "", "end"]] },
  clustering: { k: "vs", a: ["k-means", "You pick k", "Round, similar-sized clusters", "Every point assigned"], b: ["DBSCAN", "Finds k itself", "Any shape", "Sparse points marked as noise"] },
  "feature-engineering": { k: "flow", n: [["Raw events", "orders, logins"], ["Features", "orders last 30d, days since last", "hi"], ["Model", "", "end"]] },
  forecasting: { k: "layers", n: [["Forecast", "trend + seasonality + events"], ["Seasonality", "weekly, Diwali peaks"], ["Trend", "steady growth"]] },
  backtesting: { k: "table", cap: "Train on the past, test on the next period, roll forward", cols: ["fold", "train", "test"], rows: [["1", "Jan–Jun", "Jul"], ["2", "Jan–Jul", "Aug"], ["3", "Jan–Aug", "Sep"]], hi: [2] },
  embeddings: { k: "flow", n: [["\"parcel arrived broken\""], ["Embedding model", "", "hi"], ["Vector", "[0.12, −0.4, …]"], ["Nearest match", "\"Reporting damaged deliveries\"", "end"]] },
  transformers: { k: "flow", n: [["Tokens"], ["Embeddings + positions"], ["Self-attention", "each token looks at all others", "hi"], ["Feed-forward layers"], ["Next token", "", "end"]] },
  "llm-fundamentals": { k: "flow", n: [["Prompt", "split into tokens"], ["Context window", "prompt + documents + answer", "hi"], ["Predict next token", "temperature sets randomness"], ["Answer", "", "end"]] },
  rag: { k: "flow", n: [["Question"], ["Search the docs", "embeddings + keywords", "hi"], ["Top chunks"], ["LLM answers from them", "with citations", "end"]] },
  "model-deployment": { k: "vs", a: ["Batch scoring", "Nightly job writes a table", "Cheap, simple", "Churn scores for CRM"], b: ["Online inference", "API answers in ms", "Needs fresh features", "Fraud check on payment"] },
  "model-monitoring": { k: "cols", n: [["Inputs", "drift (PSI)"], ["Predictions", "score shifts"], ["Performance", "once labels arrive"], ["Operations", "latency, errors"]] },
  "ml-pipelines": { k: "flow", n: [["Validate data"], ["Build features"], ["Train challenger"], ["Beat the champion?", "backtest", "hi"], ["Register + deploy", "", "end"]] },
  /* ---------- architecture ---------- */
  "modern-data-stack": { k: "flow", n: [["Connectors", "Fivetran, Airbyte"], ["Warehouse", "Snowflake, BigQuery", "hi"], ["dbt", "transform"], ["BI + semantic layer"], ["Reverse ETL", "back to CRM", "end"]] },
  "integration-patterns": { k: "cols", n: [["Batch files", "SFTP, EDI", "hours"], ["APIs", "request/response", "instant, coupled"], ["Events", "publish/subscribe", "seconds, decoupled"], ["CDC", "database log", "seconds, no app change"]] },
  "event-driven": { k: "hub", c: ["ShipmentDelivered", "event on Kafka"], n: ["Billing raises invoice", "Customer gets SMS", "Analytics logs time"] },
  "data-vault": { k: "hub", c: ["Hub: Customer", "business key"], n: ["Satellite: details + history", "Link: places Order", "Satellite: CRM attributes"] },
  "semantic-layer": { k: "flow", n: [["Warehouse tables"], ["Semantic layer", "net_revenue defined once", "hi"], ["Power BI, Looker, notebooks, AI", "same number everywhere", "end"]] },
  "reverse-etl": { k: "flow", n: [["Warehouse", "churn_risk, LTV"], ["Reverse ETL", "changed rows hourly", "hi"], ["CRM + support tools", "agents see the flag", "end"]] },
  "canonical-models": { k: "hub", c: ["Canonical Shipment", "one shared format"], n: ["TMS", "WMS", "ERP", "Carriers"], cap: "Each system maps once, instead of to every other system." },
  "dr-ha": { k: "line", n: [["10:00", "last good copy"], ["10:05", "region outage", "hi"], ["11:05", "service back", "end"]], cap: "RPO = 5 minutes of data lost. RTO = 1 hour to recover." },
  /* ---------- domains ---------- */
  "upi-lifecycle": { k: "flow", n: [["Payer app", "PSP"], ["NPCI switch", "routes", "hi"], ["Remitter bank", "debits after PIN"], ["Beneficiary bank", "credits payee"], ["Status to both apps", "success, failed or pending", "end"]] },
  "payment-reconciliation": { k: "flow", n: [["Internal ledger"], ["Bank + NPCI files"], ["Match", "RRN, amount, date", "hi"], ["Breaks", "missing, mismatched, late"], ["Investigate + fix", "", "end"]] },
  "ledger-design": { k: "table", cap: "Every entry balances: debits = credits", cols: ["entry", "account", "debit", "credit"], rows: [["J1", "customer_wallet", "₹500", ""], ["J1", "merchant_payable", "", "₹500"]], hi: [] },
  "tms-data-model": { k: "flow", n: [["Order", "from ERP"], ["Load", "orders grouped", "hi"], ["Shipment", "tendered to carrier"], ["Stops + events", "pickup, delivery"], ["Freight invoice", "", "end"]] },
  "behavioural-star": { k: "cols", n: [["Situation", "brief context"], ["Task", "your job in it"], ["Action", "what you did: most of the answer"], ["Result", "numbers + lesson"]] },
  "de-system-design": { k: "flow", n: [["Clarify", "users, freshness, scale"], ["Estimate", "events/sec, TB/yr"], ["Sketch", "ingest → store → serve", "hi"], ["Deep dive", "late data, backfills"], ["Trade-offs + failures", "", "end"]] },
};

function drawDiagram(id) {
  const d = DIAGRAMS[id];
  if (!d) return "";
  const e = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const chev = `<i class="dg-ch" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></i>`;
  const box = ([t, s, m]) => `<div class="dg-box${m ? " " + m : ""}"><b>${e(t)}</b>${s ? `<span>${e(s)}</span>` : ""}</div>`;
  const tbl = (t) => `<div class="dg-tw">${t.cap ? `<span class="dg-tc">${e(t.cap)}</span>` : ""}<table class="dg-t"><thead><tr>${t.cols.map((c) => `<th>${e(c)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r, i) => `<tr${(t.hi || []).includes(i) ? ' class="hi"' : ""}>${r.map((c) => `<td>${e(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  let h = "";
  if (d.k === "flow") h = `<div class="dg-flow">${d.n.map(box).join(chev)}</div>`;
  else if (d.k === "cols") h = `<div class="dg-cols" style="--n:${d.n.length}">${d.n.map(([t, ...ls]) => `<div class="dg-col"><b>${e(t)}</b>${ls.map((l) => `<span>${e(l)}</span>`).join("")}</div>`).join("")}</div>`;
  else if (d.k === "vs") h = `<div class="dg-vs">${[d.a, d.b].map(([t, ...ls], i) => `<div class="dg-col${i ? " end" : ""}"><b>${e(t)}</b>${ls.map((l) => `<span>${e(l)}</span>`).join("")}</div>`).join(`<i class="dg-or">vs</i>`)}</div>`;
  else if (d.k === "layers") h = `<div class="dg-layers">${d.n.map(([t, s], i) => `<div class="dg-layer" style="--i:${i}"><b>${e(t)}</b>${s ? `<span>${e(s)}</span>` : ""}</div>`).join("")}</div>`;
  else if (d.k === "hub") h = `<div class="dg-hub"><div class="dg-box end dg-center"><b>${e(d.c[0])}</b>${d.c[1] ? `<span>${e(d.c[1])}</span>` : ""}</div><div class="dg-spokes">${d.n.map((t) => `<div class="dg-box"><b>${e(t)}</b></div>`).join("")}</div></div>`;
  else if (d.k === "table") h = tbl(d);
  else if (d.k === "tables") h = `<div class="dg-two">${d.tables.map(tbl).join("")}</div>`;
  else if (d.k === "bars") { const mx = Math.max(...d.n.map((x) => x[1])); h = `<div class="dg-bars">${d.n.map(([t, v, m]) => `<div class="dg-bar${m ? " " + m : ""}"><span>${e(t)}</span><i><b style="width:${Math.max(2, (100 * v) / mx)}%"></b></i><em>${e(v)}</em></div>`).join("")}</div>`; }
  else if (d.k === "line") h = `<div class="dg-line">${d.n.map(([t, l, m]) => `<div class="dg-tick${m ? " " + m : ""}"><i></i><b>${e(t)}</b><span>${e(l)}</span></div>`).join("")}</div>`;
  else if (d.k === "grid2") h = `<table class="dg-g2"><thead><tr><th></th>${d.c.map((c) => `<th>${e(c)}</th>`).join("")}</tr></thead><tbody>${d.v.map((row, r) => `<tr><th>${e(d.r[r])}</th>${row.map((v, c) => `<td class="${(d.hi || []).some(([a, b]) => a === r && b === c) ? "hi" : ""}">${e(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return `<figure class="dg" aria-label="Diagram">${h}${d.cap ? `<figcaption>${e(d.cap)}</figcaption>` : ""}</figure>`;
}
