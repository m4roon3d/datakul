"""Figures for the Databricks DE Associate study chapters.

Each chapter gets a "map" (one picture of the whole section, shown under the intro) and a figure for most key ideas, keyed by
the idea's title. Specs use the kinds in web/diagrams.js (flow, cols, vs, layers, hub, table, tables, bars, line, grid2, tree,
dag). Figures only show facts already in the chapter text; example rows are invented and labelled as examples.
Build: python3 content/certs/study_figs.py && node content/build_certs.mjs"""
import json, pathlib

FIGS = {
 "platform": {
  "map": {"k": "cols", "n": [["Storage", "Delta Lake", "Parquet files + a log"], ["Governance", "Unity Catalog", "access, lineage, audit"], ["Compute", "Serverless", "Classic", "SQL warehouses"]],
          "cap": "Three parts to know. Every later section builds on them."},
  "ideas": {
   "Two planes": {"k": "layers", "n": [["Control plane", "Databricks' side: web app, job scheduler, Unity Catalog"], ["Compute plane", "serverless: Databricks' account · classic: your cloud account"], ["Cloud object storage", "your tables and files stay here either way"]]},
   "Delta Lake: tables on files": {"k": "flow", "n": [["Parquet files", "the data"], ["_delta_log", "one commit per change", "hi"], ["Delta table", "ACID, time travel, MERGE", "end"]]},
   "Unity Catalog: one place for access and lineage": {"k": "tree", "n": [[0, "Metastore", "shared by attached workspaces"], [1, "Catalog"], [2, "Schema"], [3, "Tables · views · volumes · functions · models", "catalog.schema.object", "end"]]},
   "Serverless first": {"k": "vs", "a": ["Serverless gives you", "Starts in seconds", "Scales on its own", "No idle machines to pay for"], "b": ["It does not support", "R or RDD APIs", "Executor memory settings", "Most Spark settings"]},
   "Classic compute": {"k": "vs", "a": ["Jobs compute", "Made for one run, then shut down", "Lower rate", "Scheduled work"], "b": ["All-purpose compute", "Shared, interactive", "Costs while idle", "Until auto termination"]},
   "SQL warehouses": {"k": "bars", "n": [["Serverless", 6, "end"], ["Pro", 240], ["Classic", 240]], "cap": "Seconds to start, roughly: serverless 2 to 6, Pro and Classic about 4 minutes."},
   "How it is charged": {"k": "grid2", "r": ["Serverless", "Classic"], "c": ["DBUs", "Cloud VM charge"], "v": [["Yes", "No separate charge"], ["Yes", "Yes"]], "hi": [[1, 1]],
                         "cap": "Scheduled work: serverless or jobs compute, never all-purpose."},
  }},
 "ingest": {
  "map": {"k": "cols", "n": [["Files", "Auto Loader", "COPY INTO"], ["Databases", "Lakeflow Connect (CDC)", "JDBC notebook in a job"], ["APIs", "REST notebook in a job"], ["Leave it in place", "Lakehouse Federation"]],
          "cap": "Where the data comes from decides the tool."},
  "ideas": {
   "Three layers, start at the top": {"k": "layers", "n": [["Lakeflow Connect", "managed connectors · start here"], ["Lakeflow pipelines", "declarative"], ["Structured Streaming", "Spark APIs · most control, most code"]],
                                      "cap": "Move down a layer only when the one above cannot do the job."},
   "Incremental means remembering": {"k": "cols", "n": [["Auto Loader", "remembers in its checkpoint", "new checkpoint = reload"], ["COPY INTO", "tracks files already loaded into the table"], ["DB connectors", "read the source's change log"]]},
   "Files: Auto Loader or COPY INTO": {"k": "vs", "a": ["COPY INTO", "Thousands of files", "Easy to reload a subset"], "b": ["Auto Loader", "Millions of files or more", "Fewer discovery operations", "Better with schema change"],
                                       "cap": "SQL users loading from cloud storage: CREATE STREAMING TABLE."},
   "Three ways Auto Loader finds new files": {"k": "cols", "n": [["File events", "preferred", "reads a cache of storage events", "needs a UC external location"], ["File notification", "own queue per stream", "a bit lower latency"], ["Directory listing", "simplest", "small folders, backfills", "highest cost at scale"]]},
   "Run style: availableNow": {"k": "flow", "n": [["Start", "job schedule or file arrival"], ["Process", "everything available", "hi"], ["Stop", "compute stops, billing stops", "end"]],
                               "cap": "Serverless supports only availableNow. Trigger.Once is deprecated."},
   "Databases and APIs": {"k": "flow", "n": [["Connection"], ["Ingestion gateway", "always on"], ["Staging volume"], ["Ingestion pipeline", "", "hi"], ["Streaming tables", "", "end"]],
                          "cap": "A managed database connector (CDC), step by step."},
   "Semi-structured data": {"k": "table", "cap": "Example: one events table", "cols": ["column", "type", "why"],
                            "rows": [["event_id", "STRING", "filtered often"], ["event_date", "DATE", "can be a clustering key"], ["payload", "VARIANT", "shape keeps changing"]], "hi": [2]},
  }},
 "transform": {
  "map": {"k": "flow", "n": [["Bronze", "raw"], ["Clean", "types, nulls"], ["Join", "keys, row counts"], ["De-duplicate", "latest wins", "hi"], ["Gold", "aggregates, views", "end"]]},
  "ideas": {
   "Bronze, silver, gold": {"k": "cols", "n": [["Bronze", "raw, as it arrived", "lets you rebuild"], ["Silver", "right types, nulls handled", "no duplicates, joinable keys"], ["Gold", "aggregates, business models", "what BI tools read"]]},
   "Cleaning is mostly types and nulls": {"k": "table", "cap": "ANSI mode on (serverless)", "cols": ["value", "cast AS INT", "try_cast AS INT"],
                                          "rows": [["'42'", "42", "42"], ["'N/A'", "error", "NULL"]], "hi": [1]},
   "Joins: keys, row counts and shuffles": {"k": "tables", "tables": [
       {"cap": "orders: 3 rows", "cols": ["order_id", "cust"], "rows": [["1", "A"], ["2", "B"], ["3", "C"]]},
       {"cap": "left join customers: 4 rows", "cols": ["order_id", "cust", "name"], "rows": [["1", "A", "Asha"], ["2", "B", "Bala"], ["2", "B", "Bala"], ["3", "C", "Chitra"]], "hi": [2]}],
     "cap": "Example. A jump in rows means the right side has a duplicate key."},
   "union matches by position": {"k": "tables", "tables": [
       {"cap": "union (by position)", "cols": ["id", "city"], "rows": [["1", "Pune"], ["Delhi", "2"]], "hi": [1]},
       {"cap": "unionByName", "cols": ["id", "city"], "rows": [["1", "Pune"], ["2", "Delhi"]]}],
     "cap": "Example: the second DataFrame has its columns as (city, id)."},
   "Duplicates: say which row wins": {"k": "table", "cap": "row_number() over (partition by order_id order by updated_at desc)", "cols": ["order_id", "updated_at", "rn"],
                                      "rows": [["7", "10:05", "1  keep"], ["7", "09:40", "2"], ["7", "08:15", "3"]], "hi": [0]},
   "Spark settings: few, measured, and set in the right place": {"k": "flow", "n": [["Change one setting"], ["Run"], ["Measure", "Spark UI or query profile", "hi"], ["Keep or undo", "", "end"]]},
   "Gold objects for BI": {"k": "cols", "n": [["Table", "stores data you write", "INSERT, MERGE"], ["View", "stores only the query", "runs it on every read"], ["Materialized view", "stores the result", "refreshed, incrementally if it can"], ["Streaming table", "each new row once", "append-only data"]]},
   "Quality rules": {"k": "dag", "n": [[["Bronze"]], [["WHERE valid", "", "hi"], ["WHERE NOT valid"]], [["Silver", "", "end"], ["Quarantine", "kept for inspection"]]],
                     "cap": "Splitting keeps bad rows. Pipeline expectations: warn, DROP ROW or FAIL UPDATE."},
  }},
 "jobs": {
  "map": {"k": "flow", "n": [["Trigger", "time or data"], ["Task graph", "Depends on"], ["Control flow", "Run if, If/else, For each", "hi"], ["Recover", "retries, repair", "end"]]},
  "ideas": {
   "A job is a graph of tasks": {"k": "dag", "n": [[["Ingest", "notebook"]], [["Clean", "pipeline"], ["Validate", "notebook"]], [["Refresh", "dashboard", "end"]]],
                                 "cap": "Example. Clean and Validate run in parallel; Refresh waits for both."},
   "Pick the task type for the step": {"k": "cols", "n": [["Notebook", "runs a notebook"], ["SQL", "query, .sql file or alert"], ["Dashboard", "refresh, email a snapshot"], ["Pipeline", "one update"], ["Run Job", "starts another job"]]},
   "Run if: when a task starts": {"k": "table", "cap": "Example: a task after Load A and Load B", "cols": ["Load A", "Load B", "All succeeded", "All done", "At least one failed"],
                                  "rows": [["✓", "✓", "runs", "runs", "Excluded"], ["✓", "✗", "Upstream failed", "runs", "runs"]], "hi": [1]},
   "Retries, timeouts and repairs": {"k": "line", "n": [["Try 1", "fails: network error"], ["Wait", "retry interval"], ["Try 2", "timeout applies again", "hi"], ["Repair", "reruns failed + downstream", "end"]],
                                     "cap": "Retries are off by default (max_retries 0)."},
   "Passing values between tasks": {"k": "flow", "n": [["validate", "taskValues.set('bad_rows', 12)", "hi"], ["report", "{{tasks.validate.values.bad_rows}}", "end"]],
                                    "cap": "JSON-serialisable, at most 48 KiB."},
   "If/else and For each": {"k": "table", "cap": "If/else comparisons", "cols": ["condition", "compares as", "result"],
                            "rows": [["12.0 == 12", "text", "false"], ["12.0 >= 12", "numbers", "true"]], "hi": [0]},
   "Triggers: time or data": {"k": "cols", "n": [["Schedule", "fixed times"], ["File arrival", "checks about once a minute", "volume or external location"], ["Table update", "up to 25 UC tables"], ["Continuous", "one run, always on"]]},
   "Concurrency and queueing": {"k": "line", "n": [["09:00", "run 1 starts"], ["09:10", "run 2 arrives: queued", "hi"], ["09:30", "run 1 ends, run 2 starts", "end"]],
                                "cap": "Example with max_concurrent_runs = 1. Queued runs wait up to 48 hours instead of being skipped."},
  }},
 "gov": {
  "map": {"k": "flow", "n": [["Where it lives", "catalog.schema.table"], ["Who owns the files", "managed or external"], ["Who can do what", "grants flow down", "hi"], ["What each person sees", "filters, masks, ABAC", "end"]]},
  "ideas": {
   "Three levels, one name": {"k": "tree", "n": [[0, "Metastore"], [1, "Catalog", "e.g. sales"], [2, "Schema", "e.g. silver"], [3, "Table, view, volume, function", "e.g. sales.silver.orders", "end"]]},
   "Managed or external: who owns the files": {"k": "vs", "a": ["Managed", "Unity Catalog manages the files", "Predictive optimization", "DROP deletes files after 7 days"], "b": ["External", "Points at an external location", "Other systems read the files", "DROP removes only the definition"]},
   "Converting external to managed": {"k": "line", "n": [["Start", "SET MANAGED copies data + log", "hi"], ["End of copy", "a minute or two of blocked writes"], ["Up to 14 days", "UNSET MANAGED rolls back"], ["After 14 days", "old files no longer kept", "end"]]},
   "Privileges flow down": {"k": "tree", "n": [[0, "Catalog", "USE CATALOG"], [1, "Schema", "USE SCHEMA"], [2, "Table", "SELECT", "end"]],
                            "cap": "All three to read one table. A grant on a parent covers its children, future ones included."},
   "Who can grant": {"k": "hub", "c": ["GRANT and REVOKE", "on an object"], "n": ["Its owner", "Catalog or schema owner", "Metastore admin", "Anyone with MANAGE"]},
   "There is no DENY statement": {"k": "table", "cap": "Example: Asha is in the analysts group", "cols": ["grant", "after REVOKE from Asha"],
                                  "rows": [["SELECT to Asha", "removed"], ["SELECT to analysts", "still applies: Asha can read"]], "hi": [1]},
   "Row filters and column masks": {"k": "tables", "tables": [
       {"cap": "Stored", "cols": ["name", "region", "ssn"], "rows": [["Asha", "IN", "123-45-6789"], ["Ben", "US", "987-65-4321"]]},
       {"cap": "What one user sees", "cols": ["name", "region", "ssn"], "rows": [["Asha", "IN", "***-**-6789"]], "hi": [0]}],
     "cap": "Example: a row filter keeps region IN; a column mask hides most of ssn."},
   "ABAC: one policy, many tables": {"k": "flow", "n": [["Governed tag", "pii = ssn"], ["Tag columns"], ["Policy", "on a catalog or schema", "hi"], ["Every tagged table", "new ones too", "end"]]},
  }},
 "cicd": {
  "map": {"k": "cols", "n": [["Git folders", "code in Git"], ["Bundles", "the project as code"], ["Targets", "dev, test, prod"], ["CLI", "validate, deploy, run"]]},
  "ideas": {
   "Git folders: Git inside the workspace": {"k": "flow", "n": [["Branch"], ["Commit & Push", "message required"], ["Pull request", "in your Git provider", "hi"], ["Pull", "back in the workspace", "end"]]},
   "A bundle is the project as code": {"k": "tree", "n": [[0, "Bundle root"], [1, "databricks.yml", "bundle name and targets", "hi"], [1, "Resource files", "jobs, pipelines, dashboards"], [1, "Source files", "notebooks, Python, SQL"]],
                                       "cap": "Deployed as one unit: prod runs what was reviewed."},
   "Targets are environments": {"k": "vs", "a": ["mode: development", "[dev your_name] prefix", "Schedules and triggers paused", "Each developer's own copy"], "b": ["mode: production", "run_as and permissions checked", "No cluster overrides", "Can require a Git branch"]},
   "Variables and overrides": {"k": "layers", "n": [["--var or BUNDLE_VAR_", "wins"], ["Target value", "per environment"], ["Default", "in databricks.yml"]], "cap": "Top wins."},
   "The CLI lifecycle": {"k": "flow", "n": [["init"], ["validate"], ["plan"], ["deploy", "", "hi"], ["run", "", "end"]],
                         "cap": "summary lists what is deployed; destroy removes it. Every command takes -t."},
   "CI/CD flow": {"k": "flow", "n": [["Dev", "own dev target"], ["Pull request", "tests + bundle validate", "hi"], ["Merge to main", "CI runs deploy -t prod"], ["Prod", "runs as a service principal", "end"]]},
  }},
 "tune": {
  "map": {"k": "cols", "n": [["Slow", "skew, shuffle, spill"], ["Failing", "statuses, first red task"], ["Won't start", "event log codes"], ["Storage", "clustering, predictive optimization"]]},
  "ideas": {
   "Start from the job, then go down": {"k": "flow", "n": [["Matrix view", "runs over time"], ["Timeline", "slowest task"], ["Spark UI or query profile", "that task's stages", "hi"], ["Fix one thing", "", "end"]]},
   "Read the statuses": {"k": "dag", "n": [[["Extract", "Succeeded"]], [["Transform", "Failed", "hi"]], [["Load", "Upstream failed"], ["Notify", "Upstream failed"]]],
                         "cap": "Look for the first red task, not the last."},
   "Skew": {"k": "bars", "n": [["Median", 22], ["75th percentile", 25], ["Max", 140, "hi"]], "cap": "Example task durations in seconds. Max far above the 75th percentile means skew."},
   "Shuffle and spill": {"k": "flow", "n": [["Shuffle", "rows move between executors"], ["Memory full", "", "hi"], ["Spill to disk", "slow", "hi"]],
                         "cap": "Fixes: shuffle partitions auto, read less, broadcast a small side, more memory."},
   "Liquid clustering": {"k": "vs", "a": ["Partitioning, ZORDER", "Replaced by liquid clustering", "Cannot be combined with it"], "b": ["CLUSTER BY (up to 4 keys)", "Change keys without rewriting old data", "OPTIMIZE: incremental; FULL: all", "AUTO: Databricks picks keys"]},
   "Predictive optimization": {"k": "hub", "c": ["Predictive optimization", "UC managed tables only"], "n": ["OPTIMIZE", "VACUUM", "ANALYZE"],
                               "cap": "Runs on serverless, billed to you. Does nothing for external tables."},
   "Compute that will not start": {"k": "table", "cap": "From the compute event log", "cols": ["cause", "first fix"],
                                   "rows": [["Capacity or quota", "another instance type or zone"], ["Network", "firewall, DNS, routes"], ["INIT_SCRIPT_FAILURE", "read the init script logs"]]},
   "Libraries and memory": {"k": "vs", "a": ["Driver out of memory", "collect() or toPandas()", "on large data"], "b": ["Executor out of memory", "Skew, too few partitions", "Oversized broadcast, heavy UDF"]},
  }},
}

out = pathlib.Path(__file__).parent / "figs"
out.mkdir(exist_ok=True)
for dom, f in FIGS.items():
    (out / f"dbx-dea.{dom}.json").write_text(json.dumps(f, ensure_ascii=False, indent=1))
print("wrote", len(FIGS), "figure files")
