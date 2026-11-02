"""Study chapter for Databricks Certified Data Engineer Associate: Databricks Intelligence Platform (6%).

Schaum-style: what the exam expects, key ideas, solved problems, mistakes to avoid, read more. Written for Datakul in our own
words from the public exam guide (6 Aug 2026) and Databricks documentation read on 2 Nov 2026 (AWS docs). It links to the docs
and never copies them. Anything not confirmed in a page is marked "check in a workspace".
Build: python3 content/certs/study_dbx_platform.py && node content/build_certs.mjs"""
import json, pathlib

D = "https://docs.databricks.com/aws/en/"
CH = {
 "cert": "dbx-dea", "dom": "platform",
 "intro": "The smallest section, 6% of the exam, but every other section builds on it: how Databricks is laid out, what Delta Lake and Unity Catalog do, and which compute to pick for a job. Expect scenario questions that ask for the best compute for a workload. Work the solved problems with the answer hidden, then practise.",
 "expects": [
  "Describe the platform's main parts: the control plane, the compute plane, Delta Lake for storage and Unity Catalog for governance.",
  "Compare the compute options (serverless, classic jobs and all-purpose compute, SQL warehouses), their limits and how they are charged.",
  "Choose the right compute for a workload.",
 ],
 "ideas": [
  {"t": "Two planes", "b": "The control plane is Databricks' side: the web app, job scheduler, Unity Catalog and other services. The compute plane is where your code runs. Serverless compute runs in Databricks' own account (in your workspace's region); classic compute runs as virtual machines in your own cloud account and network. Your tables and files stay in cloud object storage either way."},
  {"t": "Delta Lake: tables on files", "b": "A Delta table is Parquet data files plus a transaction log (_delta_log). Every change is a commit to the log, which gives ACID transactions, time travel to earlier versions, schema enforcement, and MERGE, UPDATE and DELETE on files that are otherwise write-once. Delta is the default table format on Databricks."},
  {"t": "Unity Catalog: one place for access and lineage", "b": "Unity Catalog holds the metastore: catalogs, schemas, tables, views, volumes, functions and models, named catalog.schema.object. It controls who can use each object, records lineage and audit logs, and is shared by every workspace attached to the metastore. Volumes govern files the same way tables govern rows."},
  {"t": "Serverless first", "b": "Databricks recommends serverless for notebooks, jobs and pipelines when it supports what you need. It starts in seconds, scales on its own, needs no cluster settings, and you pay only while it works, with no idle machines. It does not support R or RDD APIs, and you cannot set executor memory or most Spark settings."},
  {"t": "Classic compute", "b": "Jobs compute is created for a job run and shut down after it, and is charged at a lower rate than all-purpose compute. All-purpose compute is for interactive work, shared by people, and costs money while idle until auto termination stops it. Use classic when you need R, RDD APIs, custom Spark settings, specific instance types, GPUs or init scripts. Access mode Standard (formerly shared) is for several users; Dedicated (formerly single user) is for one user or group and supports R and ML runtimes."},
  {"t": "SQL warehouses", "b": "SQL warehouses run SQL for queries, dashboards, BI tools and SQL tasks. Serverless starts in about 2 to 6 seconds and has intelligent workload management; Pro and Classic run in your account and start in about 4 minutes. Pro has Predictive IO; Classic is entry level. Choose Pro when serverless is not available in your region or you need custom networking."},
  {"t": "How it is charged", "b": "Databricks charges in DBUs (Databricks Units) for the compute you use, at a rate that depends on the compute type; classic compute also has the cloud provider's charge for the virtual machines. So: serverless or jobs compute for scheduled work, never all-purpose compute; set auto termination on all-purpose compute; and size SQL warehouses to the workload."},
 ],
 "tables": [
  {"title": "Which compute for which work (our summary of the docs)",
   "head": ["Compute", "Starts", "Best for", "Not for", "You pay for"],
   "rows": [
    ["Serverless (notebooks, jobs, pipelines)", "Seconds", "Most notebooks, jobs and pipelines", "R, RDDs, custom Spark or machine settings", "Use only"],
    ["Classic jobs compute", "Minutes", "Scheduled jobs that need custom settings", "Interactive work", "The run, at the lower jobs rate, plus VMs"],
    ["Classic all-purpose compute", "Minutes", "Interactive development, R, RDDs", "Scheduled production jobs", "Uptime until auto termination, plus VMs"],
    ["Serverless SQL warehouse", "About 2 to 6 seconds", "BI, dashboards, SQL tasks, SQL ETL", "Python or Scala code", "Use only"],
    ["Pro SQL warehouse", "About 4 minutes", "SQL where serverless is not available, or with custom networking", "Bursty use", "Uptime, plus VMs"],
   ]},
 ],
 "problems": [
  {"t": "Pick compute for five workloads",
   "q": "Choose compute for: (a) a nightly PySpark job with default settings; (b) 40 analysts running dashboards all day; (c) a data scientist exploring in R; (d) a scheduled job that needs a specific GPU instance and an init script; (e) a quick SQL ad-hoc query.",
   "steps": [
    "(a) Scheduled, standard Python, no special settings: serverless compute for jobs. Nothing idles and nothing to size.",
    "(b) Concurrent SQL from BI: a serverless SQL warehouse, which scales with the number of queries and starts in seconds.",
    "(c) R is not available on serverless or Standard access mode: classic all-purpose compute in Dedicated access mode, with auto termination.",
    "(d) Specific instance types and init scripts need classic: jobs compute, created for the run, at the lower jobs rate.",
    "(e) An ad-hoc SQL query: the serverless SQL warehouse, or serverless notebook compute.",
   ],
   "answer": "(a) Serverless jobs. (b) Serverless SQL warehouse. (c) All-purpose, Dedicated access mode. (d) Classic jobs compute. (e) Serverless SQL warehouse.",
   "code": None},
  {"t": "Why the bill is high",
   "q": "A team runs its scheduled jobs on an all-purpose cluster that is left on, so the jobs start fast. The monthly bill is far above plan. What would you change?",
   "steps": [
    "All-purpose compute charges for every minute it is up, including idle hours between jobs, and at a higher rate than jobs compute.",
    "Move the jobs to serverless compute for jobs: it starts in seconds, so the reason for keeping a cluster up disappears, and it charges only while running.",
    "If a job needs classic, use jobs compute, which is created for the run and shut down after it.",
    "Keep all-purpose compute for interactive work only, with auto termination set to a short idle period.",
   ],
   "answer": "Move scheduled jobs to serverless (or classic jobs compute) and keep all-purpose compute for interactive work with auto termination.",
   "code": None},
  {"t": "What Delta adds to Parquet",
   "q": "An engineer says \"Delta is just Parquet\". Two writers update the same table at once, a bad load must be undone, and a column of the wrong type must be rejected. What does Delta Lake provide that plain Parquet files do not?",
   "steps": [
    "The transaction log records every change as an ordered commit, so readers see a consistent snapshot and concurrent writers cannot leave half-written results: ACID transactions.",
    "Every commit is a version. DESCRIBE HISTORY lists them; you can query an older version, or RESTORE the table to one, which undoes the bad load.",
    "Schema enforcement rejects writes whose columns do not match the table; schema evolution must be asked for explicitly.",
    "MERGE, UPDATE and DELETE work on top of write-once Parquet files because the log records which files are current.",
    "VACUUM removes files no longer in the log after the retention period (7 days by default), which also limits how far back time travel can go.",
   ],
   "answer": "The transaction log gives ACID writes, versions for time travel and RESTORE, schema enforcement, and MERGE, UPDATE and DELETE.",
   "code": "DESCRIBE HISTORY main.silver.orders;\nSELECT * FROM main.silver.orders VERSION AS OF 41;\nRESTORE TABLE main.silver.orders TO VERSION AS OF 41;"},
  {"t": "Where things run and live",
   "q": "A security reviewer asks: where does our code run, and where is our table data stored, when we use (a) serverless jobs and (b) classic jobs compute?",
   "steps": [
    "The control plane (web app, scheduler, Unity Catalog services) is run by Databricks in both cases.",
    "(a) Serverless compute runs in the serverless compute plane in Databricks' account, in the same region as the workspace, inside isolation boundaries.",
    "(b) Classic compute runs as virtual machines in your own cloud account, inside the workspace's network.",
    "In both cases Unity Catalog tables and volumes live in cloud object storage (your own buckets for external locations, or managed storage), not on the compute.",
   ],
   "answer": "(a) Code runs in Databricks' serverless compute plane; (b) in your own cloud account. Table data stays in cloud object storage either way, governed by Unity Catalog.",
   "code": None},
  {"t": "Naming and finding data",
   "q": "A new engineer cannot find the orders table and asks why the same name works in one workspace but not another, and where raw CSV files should go.",
   "steps": [
    "In Unity Catalog every table has a three-part name: catalog.schema.table, such as main.sales.orders. Use the full name rather than relying on the current catalog.",
    "Workspaces attached to the same metastore see the same catalogs, subject to grants and to which catalogs are bound to which workspaces.",
    "If the name is right but the table does not appear, check privileges: BROWSE shows that it exists; USE CATALOG, USE SCHEMA and SELECT are needed to read it.",
    "Put raw files in a Unity Catalog volume, for example /Volumes/main/landing/raw/, so file access is governed like table access.",
   ],
   "answer": "Use catalog.schema.table names, check the workspace's catalog access and the user's privileges, and land raw files in a volume.",
   "code": "SELECT * FROM main.sales.orders LIMIT 10;\nLIST '/Volumes/main/landing/raw/';"},
 ],
 "mistakes": [
  "Running scheduled jobs on all-purpose compute, which charges while idle and at a higher rate.",
  "Picking classic compute out of habit when serverless supports the workload.",
  "Expecting R or RDD code to run on serverless or Standard access mode.",
  "Forgetting auto termination on all-purpose compute.",
  "Thinking table data lives on the cluster; it lives in cloud object storage.",
  "Using two-part names and getting the wrong catalog.",
 ],
 "links": [
  {"u": D + "getting-started/high-level-architecture", "t": "High-level architecture", "why": "The control plane, the serverless and classic compute planes, and where data lives."},
  {"u": D + "getting-started/concepts", "t": "Databricks components", "why": "The main parts of the platform in one place."},
  {"u": D + "compute/choose-compute", "t": "Compute selection recommendations", "why": "Which compute Databricks recommends for notebooks, jobs, pipelines and SQL."},
  {"u": D + "compute/sql-warehouse/warehouse-types", "t": "SQL warehouse types", "why": "Serverless, Pro and Classic compared."},
  {"u": D + "compute/configure", "t": "Compute configuration reference", "why": "Access modes, autoscaling, auto termination and instance types."},
  {"u": D + "jobs/compute", "t": "Configure compute for jobs", "why": "Serverless, jobs compute and why not all-purpose for jobs."},
  {"u": D + "tables/history", "t": "Work with table history", "why": "Delta versions, time travel and RESTORE."},
 ],
 "checked": "Checked against the exam guide of 6 August 2026 and the Databricks docs (AWS) on 2 November 2026. Prices and DBU rates change and differ by cloud and region; the docs pages above do not give them, so check the Databricks pricing page and your own account.",
}

out = pathlib.Path(__file__).parent / "study" / "dbx-dea.platform.json"
out.write_text(json.dumps(CH, ensure_ascii=False, indent=1))
print(f"wrote {out.name}: {len(CH['problems'])} solved problems, {len(CH['links'])} links")
