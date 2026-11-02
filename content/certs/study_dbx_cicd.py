"""Study chapter for Databricks Certified Data Engineer Associate: Implementing CI/CD (10%).

Schaum-style: what the exam expects, key ideas, solved problems, mistakes to avoid, read more. Written for Datakul in our own
words from the public exam guide (6 Aug 2026) and Databricks documentation read on 2 Nov 2026 (AWS docs). It links to the docs
and never copies them. Anything not confirmed in a page is marked "check in a workspace".
Build: python3 content/certs/study_dbx_cicd.py && node content/build_certs.mjs"""
import json, pathlib

D = "https://docs.databricks.com/aws/en/"
CH = {
 "cert": "dbx-dea", "dom": "cicd",
 "intro": "CI/CD is 10% of the exam: keeping notebooks and code in Git, and moving the same jobs and pipelines from dev to test to prod with bundles and the Databricks CLI. Bundles are now called Declarative Automation Bundles in the docs (formerly Databricks Asset Bundles); you may see either name, and the commands are the same. Work the solved problems with the answer hidden, then practise.",
 "expects": [
  "Work in a Git folder from the workspace: create and switch branches, commit and push, pull, and get changes reviewed through a pull request.",
  "Describe jobs, pipelines and other workspace assets as code in a bundle.",
  "Keep one codebase for dev, test and prod with targets, variables and overrides.",
  "Validate, deploy and run a bundle with the Databricks CLI, by hand and from a CI pipeline.",
 ],
 "ideas": [
  {"t": "Git folders: Git inside the workspace", "b": "A Git folder is a clone of a remote repository in the workspace. From its Git dialog you create a branch, switch branches, Commit & Push (one action, with a required message), Pull, Merge and Rebase. Pull requests are not created in the Git folder; you push the branch and open the pull request in your Git provider. Reset is git reset --hard plus a force push, so it throws away changes on the remote branch too."},
  {"t": "A bundle is the project as code", "b": "databricks.yml at the root names the bundle and its targets, and resource files describe jobs, pipelines, dashboards and other assets. Source files (notebooks, Python, SQL) live next to them. Deploying puts all of it into a workspace as one unit, so what runs in prod is exactly what was reviewed in Git."},
  {"t": "Targets are environments", "b": "targets: lists dev, test, prod and so on, each with its workspace host, mode and settings. One target has default: true and is used when you do not pass -t. mode: development prefixes resource names with [dev your_name], pauses schedules and triggers, and is meant for each developer's own copy. mode: production checks that run_as and permissions are set, does not allow overriding clusters, and can require a Git branch."},
  {"t": "Variables and overrides", "b": "Declare variables at the top (with a default, or a lookup that turns a warehouse or policy name into its ID), use them as ${var.name}, and give each target its own values. Values can also come from --var or BUNDLE_VAR_ environment variables, which win over the file. A target can also override resource settings: they merge with the top-level ones by key (task_key, job_cluster_key), and the target value wins."},
  {"t": "The CLI lifecycle", "b": "databricks bundle init starts from a template. validate checks the configuration. plan shows what a deploy would change. deploy uploads files and creates or updates resources. run starts a job or pipeline from the bundle. summary lists what is deployed. destroy removes it. Every command takes -t to pick the target."},
  {"t": "CI/CD flow", "b": "Developers deploy to their own dev target. A pull request runs tests and bundle validate. A merge to main runs bundle deploy -t prod from the CI system, authenticated as a service principal, with run_as set to that service principal so production jobs never run as a person."},
 ],
 "tables": [
  {"title": "Bundle CLI commands you need",
   "head": ["Command", "What it does", "Typical use"],
   "rows": [
    ["databricks bundle init", "Creates a project from a template", "Starting a new bundle"],
    ["databricks bundle validate -t dev", "Checks the configuration and resolves variables", "Before every deploy; first step in CI"],
    ["databricks bundle plan -t prod", "Shows what a deploy would change, without changing anything", "Reviewing a production change"],
    ["databricks bundle deploy -t prod", "Uploads files and creates or updates jobs, pipelines and other resources", "After a merge to main"],
    ["databricks bundle run -t dev my_job", "Runs a job or pipeline defined in the bundle", "Testing after a deploy"],
    ["databricks bundle summary -t prod", "Lists deployed resources with workspace links", "Checking what is live"],
    ["databricks bundle destroy -t dev", "Deletes the deployed resources", "Removing a developer's copy"],
   ]},
  {"title": "Development and production modes (our summary of the docs)",
   "head": ["", "mode: development", "mode: production"],
   "rows": [
    ["Resource names", "Prefixed [dev your_name] and tagged dev", "As written"],
    ["Schedules and triggers", "Paused", "As written"],
    ["Concurrent runs", "Allowed on all jobs", "As written"],
    ["Pipelines", "Marked development", "Must not be development"],
    ["Cluster override (--cluster-id)", "Allowed", "Not allowed"],
    ["Checks", "Deployment lock off", "run_as and permissions required unless a service principal deploys; Git branch must match git.branch if set"],
   ]},
 ],
 "problems": [
  {"t": "A feature branch in a Git folder",
   "q": "You must change a notebook in the team repository, have it reviewed, and get it into main. The repository is already a Git folder in your workspace. List the steps.",
   "steps": [
    "Open the Git dialog for the folder and Pull, so you start from the latest main.",
    "Create Branch, for example feature/fix-dedup, based on main. The folder switches to it.",
    "Edit and test the notebook.",
    "Enter a commit message and click Commit & Push. Committing and pushing are one action in the Git folder.",
    "Open a pull request in the Git provider (GitHub, GitLab, Azure DevOps and so on). The Git folder does not create pull requests.",
    "After review and merge, switch the folder back to main and Pull.",
   ],
   "answer": "Pull, Create Branch, edit, Commit & Push, open the pull request in the Git provider, then switch back to main and Pull after the merge.",
   "code": None},
  {"t": "Conflicts and a bad reset",
   "q": "Two colleagues edited the same notebook. When you merge main into your branch the Git folder reports a conflict. Separately, someone suggests Reset to fix a messy branch. What do you do?",
   "steps": [
    "The Git folder lists the conflicting files. For each one, edit it by hand, keep your changes, or take the incoming changes, then mark it resolved and continue the merge. Abort if you need to start again.",
    "Reset in a Git folder is git reset --hard followed by a force push. It discards local changes and rewrites the remote branch too.",
    "Use Reset only on a branch nobody else uses, and only when you really want the remote branch to match another state.",
    "Several people working in one shared Git folder causes exactly these conflicts. Give each person their own Git folder.",
   ],
   "answer": "Resolve the listed conflicts in the UI and continue the merge. Avoid Reset on shared branches, because it force-pushes. Use one Git folder per person.",
   "code": None},
  {"t": "One bundle, three environments",
   "q": "The same job must deploy to a dev workspace and a prod workspace. It reads catalog dev_main in dev and main in prod, and uses a different SQL warehouse in each. Write the bundle skeleton.",
   "steps": [
    "Declare a variable catalog with no hard-coded environment in the job, and reference it as ${var.catalog}.",
    "For the warehouse, a lookup variable resolves the warehouse ID from its name, so the YAML does not hold IDs that differ per workspace.",
    "Under targets, give dev and prod their workspace host, mode and variable values. Make dev the default target.",
    "Pass ${var.catalog} to the job as a job parameter, so the notebook reads it at run time. Bundle variables are resolved at deploy time; job runs need parameters.",
   ],
   "answer": "Variables catalog and warehouse_id (by lookup), referenced as ${var.*} in the job, with values set per target; dev default in development mode, prod in production mode.",
   "code": "bundle:\n  name: sales_etl\n\nvariables:\n  catalog:\n    description: Catalog for this environment\n  warehouse_id:\n    lookup:\n      warehouse: \"etl-warehouse\"\n\nresources:\n  jobs:\n    daily_sales:\n      name: daily_sales\n      parameters:\n        - name: catalog\n          default: ${var.catalog}\n      tasks:\n        - task_key: gold\n          sql_task:\n            warehouse_id: ${var.warehouse_id}\n            file: {path: ./src/gold.sql}\n\ntargets:\n  dev:\n    default: true\n    mode: development\n    workspace: {host: https://dev.cloud.databricks.com}\n    variables: {catalog: dev_main}\n  prod:\n    mode: production\n    workspace: {host: https://prod.cloud.databricks.com}\n    variables: {catalog: main}"},
  {"t": "Bigger compute only in prod",
   "q": "The job cluster has 2 workers. In prod it needs 8 workers; everything else stays the same. Do it without copying the whole job into the prod target.",
   "steps": [
    "Target resources merge with top-level resources. Repeat only the job, the job_cluster_key and the field that changes.",
    "Job clusters are matched by job_cluster_key and tasks by task_key, so the keys must be the same in both places.",
    "Fields set in only one place are kept; fields set in both take the target's value. Here num_workers becomes 8 and spark_version and node type stay.",
    "Run databricks bundle validate -t prod (or --output json) to see the merged result before deploying.",
   ],
   "answer": "In targets.prod.resources, repeat the job with the same job_cluster_key and set only num_workers: 8.",
   "code": "targets:\n  prod:\n    resources:\n      jobs:\n        daily_sales:\n          job_clusters:\n            - job_cluster_key: main\n              new_cluster:\n                num_workers: 8"},
  {"t": "Why the dev job did not run on schedule",
   "q": "You deployed with databricks bundle deploy (no -t). The job appears as \"[dev asha] daily_sales\", and its 6 am schedule never fires. A colleague's copy shows \"[dev ravi] daily_sales\". Explain.",
   "steps": [
    "Without -t, the CLI uses the target with default: true, here dev.",
    "dev is in mode: development, which prefixes names with [dev user] so each developer gets a separate copy, and pauses all schedules and triggers so dev copies do not run on their own.",
    "That is intended. To test the schedule, set the job's pause_status to UNPAUSED in the dev target, or run it with databricks bundle run.",
    "Production deploys must say -t prod explicitly in CI, so nobody deploys to prod by accident.",
   ],
   "answer": "The default target is dev in development mode: names are prefixed per user and schedules are paused. Run it with bundle run, or unpause it in dev if you need to test the schedule.",
   "code": "databricks bundle deploy            # uses the default target (dev)\ndatabricks bundle run daily_sales   # run the dev copy now\ndatabricks bundle deploy -t prod    # production, explicitly"},
  {"t": "Automating deploys",
   "q": "Design the CI pipeline: every pull request should be checked, and every merge to main should deploy to prod. Production jobs must not run as a person.",
   "steps": [
    "On a pull request: install the Databricks CLI, run unit tests, then databricks bundle validate -t prod. Validation catches bad YAML and unresolved variables before anything is deployed.",
    "Optionally run databricks bundle plan -t prod to show reviewers what would change.",
    "On a merge to main: databricks bundle deploy -t prod. Authenticate the CI system as a service principal using a secret stored in the CI system, never in the repository.",
    "In the prod target, set run_as to the service principal (service_principal_name is its application ID), so jobs run as it, not as whoever deployed.",
    "Add permissions in the target so the team can view runs, and keep CAN MANAGE with the platform group.",
    "If you want, add a test target between dev and prod and deploy there first, then run the job with bundle run as an integration test.",
   ],
   "answer": "PR: tests plus bundle validate (and plan) for prod. Merge: bundle deploy -t prod authenticated as a service principal, with run_as set to that service principal.",
   "code": "# pull request\ndatabricks bundle validate -t prod\n\n# merge to main\ndatabricks bundle deploy -t prod\n\n# databricks.yml (prod target)\n    run_as:\n      service_principal_name: \"6a1b...\"\n    permissions:\n      - level: CAN_VIEW\n        group_name: data-engineers"},
  {"t": "Bring an existing job under the bundle",
   "q": "A job was built by hand in the UI months ago and now must be managed by the bundle, without creating a second copy.",
   "steps": [
    "databricks bundle generate job --existing-job-id <id> writes YAML for the job (and downloads its notebooks) into the bundle.",
    "Review the generated YAML, replace environment-specific values with variables, and commit it.",
    "databricks bundle deployment bind links the bundle's job to the existing job, so the next deploy updates it rather than creating a duplicate.",
    "From then on, change the job only through the bundle; edits made in the UI are overwritten at the next deploy.",
   ],
   "answer": "bundle generate job to create its YAML, then bundle deployment bind to link it to the existing job, then deploy as usual.",
   "code": "databricks bundle generate job --existing-job-id 123456789\ndatabricks bundle deployment bind daily_sales 123456789 -t prod\ndatabricks bundle deploy -t prod"},
 ],
 "mistakes": [
  "Looking for a Create pull request button in the Git folder; pull requests are opened in the Git provider.",
  "Using Reset on a shared branch; it force-pushes and rewrites the remote branch.",
  "Copying the whole job into each target instead of using variables and small overrides.",
  "Using bundle variables for values that change per run; they are fixed at deploy time, so use job parameters.",
  "Deploying without -t and surprising yourself with the default target.",
  "Expecting a development-mode deploy to run on schedule; development mode pauses schedules and triggers.",
  "Deploying to prod as a person, or storing CI tokens in the repository.",
  "Skipping bundle validate in CI, so a typo is found only during the production deploy.",
  "Editing a bundle-managed job in the UI; the next deploy overwrites it.",
 ],
 "links": [
  {"u": D + "repos/git-operations-with-repos", "t": "Create and manage Git folders", "why": "Branch, Commit & Push, pull, merge, rebase, reset and conflicts."},
  {"u": D + "repos/ci-cd", "t": "CI/CD with Databricks Git folders", "why": "How Git folders fit into a CI/CD process."},
  {"u": D + "dev-tools/bundles/", "t": "What are Declarative Automation Bundles?", "why": "What a bundle is, what it can deploy, and the former name."},
  {"u": D + "dev-tools/bundles/settings", "t": "Bundle configuration", "why": "databricks.yml mappings: targets, run_as, permissions, include."},
  {"u": D + "dev-tools/bundles/variables", "t": "Substitutions and variables", "why": "Defining variables, lookups and their order of precedence."},
  {"u": D + "dev-tools/bundles/overrides", "t": "Override with target settings", "why": "How target resources merge with top-level ones."},
  {"u": D + "dev-tools/bundles/deployment-modes", "t": "Bundle deployment modes", "why": "Exactly what development and production modes change and check."},
  {"u": D + "dev-tools/cli/bundle-commands", "t": "bundle command group", "why": "Every bundle command and its flags."},
  {"u": D + "dev-tools/bundles/run-as", "t": "Specify a run identity for a bundle workflow", "why": "Running production jobs as a service principal."},
 ],
 "checked": "Checked against the exam guide of 6 August 2026 and the Databricks docs (AWS) on 2 November 2026. Bundles were renamed Declarative Automation Bundles in the docs; the exam guide may still say Databricks Asset Bundles. Check CLI flags such as --existing-job-id against your CLI version in a free Databricks workspace.",
}

out = pathlib.Path(__file__).parent / "study" / "dbx-dea.cicd.json"
out.write_text(json.dumps(CH, ensure_ascii=False, indent=1))
print(f"wrote {out.name}: {len(CH['problems'])} solved problems, {len(CH['links'])} links")
