/* Job simulator: your first week on the job.
   One fictional company per career path, one ticket a day for five days. A colleague writes in with a real-world
   problem (a failed load, a doubtful number, a risky request) and an attachment; the learner replies as they would at
   work. Quick check scores the reply against the key points with the same grader as interview answers; with AI on,
   the colleague can also review it in character. 60% clears the day. Progress is stored as dp_sim (synced). */

const SIM = {
  de: {
    role: "Data Engineer", co: "Chaiwala Pay", about: "a UPI payments startup in Bengaluru: about 2 million payments a day, a small data team, pipelines on Airflow, Kafka and a cloud warehouse.",
    days: [
      {
        id: "de1", from: "Priya Nair", fromRole: "Finance lead", time: "Mon 9:40", subj: "Yesterday's settlement total has doubled??",
        msg: "Morning! The settlement report for yesterday shows ₹84 crore. We normally do about ₹42 crore. The bank file says ₹42 crore. I have to send numbers to the CFO by 11. What happened, and can I trust it?",
        art: { kind: "log", title: "airflow · load_settlements · 2026-11-09", body: "02:10 load_settlements started (attempt 1)\n02:10 INSERT INTO settlements SELECT * FROM staging_settlements WHERE day = '2026-11-09'\n02:41 Task timed out after 30m. Rows written: 1,912,442\n02:46 load_settlements started (attempt 2)\n02:46 INSERT INTO settlements SELECT * FROM staging_settlements WHERE day = '2026-11-09'\n03:09 Success. Rows written: 1,912,442" },
        ask: "Reply to Priya: what went wrong, how you'll fix today's numbers, how you'll stop it happening again, and when she can have correct figures.",
        p: [
          { t: "The retry appended the same day twice, so every row is duplicated", k: ["retry", "twice", "duplicate", "appended", "double"] },
          { t: "Fix today: delete or overwrite that day's partition and reload it once", k: ["overwrite", "delete", "reload", "partition"] },
          { t: "Make the load idempotent: MERGE or upsert on the transaction ID", k: ["merge", "upsert", "idempotent", "transaction id", "unique key"] },
          { t: "Add a check against the bank total or row count before publishing", k: ["reconcile", "check", "row count", "validate", "compare"] },
          { t: "Give Priya a clear time for corrected numbers", k: ["minutes", "by 10", "by 10:30", "eta", "within"] },
        ],
        a: "Hi Priya, don't use yesterday's figure. The load job timed out, Airflow ran it a second time, and the retry appended the same day again, so every settlement is counted twice: that's why it shows ₹84 crore. I'll delete yesterday's partition and reload it once now. You'll have corrected numbers within 30 minutes, by 10:30. To stop this happening again, I'll change the load to a MERGE (upsert) on the transaction ID so a retry can't create a duplicate. I'll also add a check that reconciles the daily total with the bank file before the report is published, and alert us if they don't match.",
      },
      {
        id: "de2", from: "Arjun Mehta", fromRole: "Head of Risk", time: "Tue 11:15", subj: "Fraud dashboard is 2 hours behind",
        msg: "The live fraud dashboard is showing payments from two hours ago. My analysts are blind during the lunch peak. Can you sort it out fast?",
        art: { kind: "table", title: "Kafka consumer group fraud-scorer · lag by partition", head: ["Partition", "Lag (messages)", "Top merchant key"], rows: [["0", "1,204", "mixed"], ["1", "980", "mixed"], ["2", "1,577", "mixed"], ["3", "2,410,889", "m_00042 (BigBazaarOnline)"], ["4", "1,102", "mixed"], ["5", "1,320", "mixed"]] },
        ask: "Reply to Arjun with what's causing the delay, what you'll do now and what you'll change so it doesn't recur.",
        p: [
          { t: "Almost all the lag sits on one partition: one hot merchant key is skewing it", k: ["skew", "hot key", "one partition", "partition 3", "single merchant"] },
          { t: "Adding consumers won't help one partition; spread the key (salt or repartition)", k: ["salt", "repartition", "spread", "split the key", "more partitions"] },
          { t: "Check the consumer for slow processing or errors on that key", k: ["slow", "error", "processing time", "log"] },
          { t: "Add a lag alert so it's caught before users notice", k: ["alert", "monitor", "threshold"] },
          { t: "Keep Arjun's team informed while it catches up", k: ["update", "catch up", "let you know", "eta"] },
        ],
        a: "Hi Arjun, the delay is almost entirely on one Kafka partition: partition 3 has 2.4 million messages waiting while the others are near zero. One hot key, the merchant BigBazaarOnline, is sending a flash-sale burst and all of it lands on the same partition, so it's skew rather than overall load. Adding more consumers won't help, because one partition is read by one consumer. Right now I'll check the consumer logs for slow processing or errors on that merchant, then salt that merchant's key so its events spread across partitions and the backlog can catch up. I'll update you every 30 minutes with an ETA. Next week I'll add a lag alert with a 10-minute threshold so we hear about this before your analysts do.",
      },
      {
        id: "de3", from: "Sneha Rao", fromRole: "Growth marketing", time: "Wed 10:05", subj: "Quick favour: customer list in a Google Sheet",
        msg: "Hey! For our cashback campaign can you export all customers with name, phone number, UPI ID and last 6 months of spend into a Google Sheet? Share it with me and our agency. Need it today if possible 🙏",
        art: { kind: "text", title: "customers table (columns)", body: "customer_id · full_name · phone · upi_id · email · city · kyc_status · spend_6m · last_txn_at" },
        ask: "Reply to Sneha. Help her run the campaign without creating a privacy problem.",
        p: [
          { t: "Raw personal data (phone, UPI ID) can't go into a shared sheet or to an agency without approval", k: ["pii", "personal data", "privacy", "approval", "dpdp", "consent"] },
          { t: "Share only the columns and level of detail the campaign really needs", k: ["only the columns", "minimum", "aggregate", "segment", "need"] },
          { t: "Mask or hash identifiers if individuals must be targeted", k: ["mask", "hash", "pseudonym", "tokenize", "anonymise", "anonymize"] },
          { t: "Use a governed, access-controlled view or the campaign tool, not a spreadsheet", k: ["access control", "permission", "secure", "governed view", "campaign tool"] },
          { t: "Keep it logged and time-limited", k: ["audit", "log", "expire", "expiry", "delete after"] },
        ],
        a: "Hi Sneha, happy to help with the campaign, but I can't put names, phone numbers and UPI IDs into a Google Sheet or send them to the agency. That's personal data, and under the DPDP Act and our policy it needs approval from our privacy team and customer consent for marketing. Here's what I can do today: tell me the segment you want, for example customers in Pune who spent over ₹5,000 in six months. I'll share only the columns you need, with customer IDs hashed, as a secure view with access control limited to you. If the agency must send messages, the list can be loaded straight into our campaign tool so they never see raw numbers. Access will be logged and will expire after the campaign.",
      },
      {
        id: "de4", from: "Karthik S", fromRole: "On-call engineer", time: "Thu 07:52", subj: "Merchant pipeline failed overnight",
        msg: "The merchant_daily pipeline failed at 3am and it's blocking the merchant payouts report. Logs below. Can you take it?",
        art: { kind: "log", title: "merchant_daily · transform step", body: "ERROR casting column 'amount': invalid input syntax for type numeric: \"₹1,299.00\"\nSource: payments_api.export v2.4 (deployed 2026-11-11 18:30)\nPrevious version sent amount in paise as integer: 129900\nRows affected so far: 418,220 of 418,220" },
        ask: "Reply in the on-call channel with the cause, your fix for today, and how you'll prevent the next surprise.",
        p: [
          { t: "An upstream schema change: amount changed from integer paise to a formatted string", k: ["schema change", "upstream", "type", "format", "contract"] },
          { t: "Fix today: parse and convert the new format, and quarantine rows that still fail", k: ["parse", "convert", "cast", "quarantine", "dead letter", "reject"] },
          { t: "Agree a data contract with the API team and get notice of changes", k: ["data contract", "api team", "source team", "notify", "versioning"] },
          { t: "Add schema and type validation before loading", k: ["validation", "schema check", "test", "expectation"] },
          { t: "Rerun the failed day and check payouts", k: ["rerun", "backfill", "reprocess"] },
        ],
        a: "Taking it. Cause: an upstream schema change. The payments API v2.4 release last night changed amount from an integer in paise (129900) to a formatted string (\"₹1,299.00\"), so our cast fails on every row. Fix for today: I'll parse the new format and convert it back to paise, and quarantine any row that still fails into a dead letter table instead of failing the whole run. Then I'll rerun last night's load and check the payout totals against yesterday before the report goes out, ETA 9:30. To prevent the next surprise, I'll ask the API team for a data contract on this export with versioning and notice before changes, and add a schema validation test that checks types before loading, so a change like this is caught in staging.",
      },
      {
        id: "de5", from: "Meera Iyer", fromRole: "CFO", time: "Fri 16:20", subj: "Why did our warehouse bill triple?",
        msg: "Our cloud warehouse bill for October is 3x September. Nothing big launched as far as I know. What's driving it and what can we do?",
        art: { kind: "table", title: "Most expensive queries, October", head: ["Query", "Runs", "Data scanned / run", "Share of cost"], rows: [["SELECT * FROM payments (ops dashboard, every 5 min)", "8,928", "1.8 TB", "61%"], ["fraud features (hourly)", "744", "220 GB", "14%"], ["finance month-end", "4", "900 GB", "2%"]] },
        ask: "Reply to Meera in plain language with the cause and a plan to bring the cost down.",
        p: [
          { t: "Found the driver in query history: one dashboard query is most of the cost", k: ["query history", "dashboard", "61%", "most expensive", "one query"] },
          { t: "Scan less: select only needed columns and filter on partitions", k: ["partition", "only the columns", "select only", "prune", "filter"] },
          { t: "Pre-aggregate into a small summary table refreshed incrementally", k: ["summary table", "aggregate", "materialise", "materialize", "incremental"] },
          { t: "Refresh less often and right-size or auto-suspend the warehouse", k: ["every 5 minutes", "less often", "auto suspend", "auto-suspend", "smaller warehouse", "frequency"] },
          { t: "Set a budget alert so this is caught early", k: ["budget", "alert", "resource monitor", "limit"] },
        ],
        a: "Hi Meera, the query history shows one cause: the ops dashboard runs a query that reads the entire payments table (1.8 TB) every 5 minutes, and that one query is 61% of October's bill. It was added in early October. The plan: first, change it to select only the columns it shows and filter on the date partition, so it reads today's data, not all history. Second, point the dashboard at a small summary table that we aggregate incrementally every 15 minutes, so refreshing it is cheap. Third, refresh less often outside business hours and set the warehouse to auto-suspend when idle. Together that should bring the bill back near September's level within a week. I'll also set a budget alert so we hear about any spike within days, not at month end.",
      },
    ],
  },
  da: {
    role: "Data Analyst", co: "Kirana Cart", about: "a 15-minute grocery delivery app in six Indian cities, with dark stores, a busy ops team and dashboards everyone watches.",
    days: [
      {
        id: "da1", from: "Rohit Verma", fromRole: "Head of Operations", time: "Mon 9:05", subj: "Orders fell 30% yesterday. What happened?!",
        msg: "The daily dashboard says orders dropped 30% yesterday. The CEO has seen it. I need to know why before our 11am review.",
        art: { kind: "table", title: "orders_daily (dashboard source)", head: ["Date", "Orders", "Last order time loaded"], rows: [["Sat 7 Nov", "182,410", "23:59"], ["Sun 8 Nov", "196,033", "23:59"], ["Mon 9 Nov", "137,880", "15:02"]] },
        ask: "Reply to Rohit before the review: is the drop real, and what will you check?",
        p: [
          { t: "Check freshness first: yesterday's data stops at 3pm, so it's incomplete", k: ["incomplete", "partial", "fresh", "loaded", "15:02", "3pm", "late data"] },
          { t: "Compare like with like: same weekday or same hours last week", k: ["same day last week", "same hours", "weekday", "week over week", "like for like"] },
          { t: "Break it down by city, store or channel to find where any real drop is", k: ["city", "store", "channel", "breakdown", "segment"] },
          { t: "Rule out tracking or an app release causing missing events", k: ["tracking", "release", "outage", "events", "app version"] },
          { t: "Say what you'll confirm and when, with a caveat on the number", k: ["confirm", "caveat", "by 10:30", "update", "before the review"] },
        ],
        a: "Hi Rohit, I don't think the 30% drop is real. Yesterday's data stops at 15:02: the load after 3pm is late, so the dashboard is showing a partial day. Comparing the same hours with last Monday, orders up to 3pm are actually up 4%. Before the review I'll confirm three things: that the late data loads and the full-day number is normal; a breakdown by city and store, in case one location really did drop; and that there was no app release or tracking outage losing order events. I'll send you a confirmed number by 10:30, and until then please treat yesterday's figure as incomplete. I'll also add a freshness warning to the dashboard so a partial day is flagged.",
      },
      {
        id: "da2", from: "Ananya Gupta", fromRole: "Marketing manager", time: "Tue 14:30", subj: "Diwali coupon = huge success?",
        msg: "Customers who used the DIWALI100 coupon ordered 2.3x more than those who didn't! I'm putting this in the board deck. Can you just double-check the number?",
        art: { kind: "table", title: "Orders per customer, 20 Oct to 5 Nov", head: ["Group", "Customers", "Orders / customer", "Orders / customer before (Sep)"], rows: [["Used DIWALI100", "48,200", "6.9", "5.8"], ["Did not use", "910,400", "3.0", "2.6"]] },
        ask: "Reply to Ananya. Is 2.3x the effect of the coupon? What would you measure instead?",
        p: [
          { t: "Coupon users were already heavier buyers before (5.8 vs 2.6), so this is selection bias", k: ["selection bias", "already", "before", "self-select", "heavier"] },
          { t: "Compare against a control or holdout of similar customers", k: ["control", "holdout", "matched", "similar customers", "comparison group"] },
          { t: "Measure the incremental lift, not the total", k: ["incremental", "uplift", "lift"] },
          { t: "Account for the discount cost and margin", k: ["cost", "margin", "discount", "roi", "profit"] },
          { t: "Check for pull-forward: orders shifted from later weeks", k: ["pull forward", "pull-forward", "after the campaign", "november", "later weeks"] },
        ],
        a: "Hi Ananya, the 2.3x is real but it isn't the coupon's effect, so I wouldn't put it in the board deck as is. Coupon users were already heavier buyers before Diwali: 5.8 orders each in September against 2.6 for everyone else, so we're seeing selection bias. A fairer measure is the incremental lift: compare coupon users with a matched control group of similar customers who didn't get the coupon, or a holdout if we kept one. On a before-and-after basis, coupon users rose from 5.8 to 6.9 (+19%) and non-users from 2.6 to 3.0 (+15%), so the extra lift is closer to 4 points. We should also take off the discount cost to see the margin, and check for pull-forward: whether those customers simply ordered less in the weeks after. I can have that analysis to you by Thursday.",
      },
      {
        id: "da3", from: "Vikram Joshi", fromRole: "Analyst (your teammate)", time: "Wed 12:10", subj: "Can you review my category revenue query?",
        msg: "Finance says my revenue by category is 40% higher than their total. Query below. I can't see the problem. Help!",
        art: { kind: "code", title: "category_revenue.sql", body: "SELECT i.category, SUM(o.order_total) AS revenue\nFROM orders o\nJOIN order_items i ON i.order_id = o.order_id\nWHERE o.order_date >= '2026-10-01'\nGROUP BY i.category;" },
        ask: "Reply to Vikram with the problem, a corrected approach and how to check it.",
        p: [
          { t: "The join fans out: each order repeats once per item, so order_total is counted several times", k: ["fan out", "fan-out", "repeats", "once per item", "duplicates", "multiplied"] },
          { t: "Sum the item-level amount (or aggregate before joining)", k: ["item amount", "line amount", "item level", "aggregate first", "before joining", "cte"] },
          { t: "Reconcile the total against Finance's number", k: ["reconcile", "match", "total", "finance"] },
          { t: "Filter out cancelled or refunded orders", k: ["cancel", "refund", "status"] },
          { t: "Keep the tone helpful", k: ["happy to", "pair", "shout", "let me know"] },
        ],
        a: "Hi Vikram, found it. The join fans out: an order with three items appears three times after joining order_items, so order_total is counted once per item and multiplied. Instead, sum the item-level amount, SUM(i.quantity * i.unit_price) grouped by category, or aggregate first in a CTE before joining. Then reconcile: the sum across all categories should match Finance's total for October. Also check the order status filter, because Finance excludes cancelled and refunded orders. Happy to pair on it after lunch if that helps, let me know.",
      },
      {
        id: "da4", from: "Kavya Reddy", fromRole: "CEO's chief of staff", time: "Thu 17:40", subj: "One number for delivery speed",
        msg: "The CEO wants a single 'average delivery time' on the board dashboard. Ours is 24 minutes, but customers keep saying we're slow. Which number should we show?",
        art: { kind: "table", title: "Delivery time, last 30 days (minutes)", head: ["Measure", "Value"], rows: [["Mean", "24.1"], ["Median", "13.0"], ["90th percentile", "41.0"], ["Orders with no delivered time", "6.2%"]] },
        ask: "Reply to Kavya with your recommendation.",
        p: [
          { t: "The mean is pulled up by a long tail: show the median and a 90th percentile", k: ["median", "percentile", "p90", "outlier", "long tail", "skew"] },
          { t: "Define the measure: from order placed to delivered", k: ["define", "from order", "to delivered", "definition", "placed"] },
          { t: "Split by city or store, where the slow orders are", k: ["city", "store", "segment", "split"] },
          { t: "Show the trend against the 15-minute promise", k: ["trend", "target", "15 minutes", "promise", "sla"] },
          { t: "Flag the data gap: 6% of orders have no delivered time", k: ["missing", "6.2%", "data quality", "no delivered time"] },
        ],
        a: "Hi Kavya, I'd avoid a single average. The mean of 24 minutes is pulled up by a long tail of very late orders: the median order takes 13 minutes, but 1 in 10 takes over 41. Customers remember those slow ones. I'd show two numbers: the median, and the 90th percentile (p90) as 'slowest 10%', with the trend over time against our 15-minute promise. We should define it clearly as from the order being placed to delivered at the door. A split by city and store would show the board where the slow orders come from. One caveat: 6.2% of orders have no delivered time, a data quality gap I'll raise with the app team, as those are probably among the slowest.",
      },
      {
        id: "da5", from: "Nikhil Bansal", fromRole: "Product manager", time: "Fri 11:00", subj: "New checkout button: ship it?",
        msg: "Our A/B test of the green checkout button: control 4.1% conversion, new button 4.3%. That's a 5% improvement! Can I ship it today?",
        art: { kind: "table", title: "Checkout test, Tue to Thu", head: ["Group", "Users", "Conversion", "Avg order value"], rows: [["Control", "21,050", "4.1%", "₹412"], ["Green button", "20,940", "4.3%", "₹391"]], note: "p = 0.18 · test ran 3 days" },
        ask: "Reply to Nikhil: ship, wait or stop? Explain why simply.",
        p: [
          { t: "Not statistically significant: p = 0.18 means it could easily be chance", k: ["significant", "p value", "p = 0.18", "chance", "noise"] },
          { t: "Three days is too short: run full weeks with enough sample size", k: ["sample size", "full week", "two weeks", "run longer", "power"] },
          { t: "Check guardrail metrics: average order value fell", k: ["guardrail", "order value", "aov", "₹391"] },
          { t: "Check the split was even and users were assigned properly", k: ["split", "sample ratio", "assignment", "even"] },
          { t: "Recommend: keep the test running, don't ship yet", k: ["keep running", "don't ship", "wait", "continue the test"] },
        ],
        a: "Hi Nikhil, I'd wait. The difference isn't statistically significant yet: p = 0.18 means a gap this size could easily be chance, so we can't call it a 5% improvement. The test also ran only three weekdays, and shopping changes at weekends; I'd run two full weeks, which also gets us the sample size to detect a lift this small. One guardrail worries me: average order value fell from ₹412 to ₹391, so even if conversion rises, revenue might not. The split looks even (21,050 vs 20,940), so assignment seems fine. My recommendation: don't ship today, keep running the test until the 24th and I'll share the readout then.",
      },
    ],
  },
  ds: {
    role: "Data Scientist", co: "Dabba Express", about: "a last-mile delivery company running 40,000 deliveries a day across Maharashtra, with an ETA model and a late-delivery alert model in production.",
    days: [
      {
        id: "ds1", from: "Farhan Shaikh", fromRole: "Pune city manager", time: "Mon 10:20", subj: "ETAs in Pune are way off since the rains",
        msg: "Customers in Pune are angry: the app promises 25 minutes and we take 40. It started around when the monsoon got heavy. Can your model be fixed?",
        art: { kind: "table", title: "ETA error (actual minus predicted), minutes", head: ["City", "May", "Jun", "Jul"], rows: [["Mumbai", "+1.2", "+2.0", "+2.4"], ["Pune", "+0.8", "+9.6", "+14.1"], ["Nagpur", "+1.0", "+1.3", "+1.1"]] },
        ask: "Reply to Farhan with what's wrong and what you'll do short term and long term.",
        p: [
          { t: "Drift: conditions changed (monsoon) and the model hasn't seen them", k: ["drift", "changed", "monsoon", "season", "conditions"] },
          { t: "Add features the model is missing, such as rain and traffic", k: ["weather", "rain", "traffic", "feature"] },
          { t: "Retrain on recent data", k: ["retrain", "recent data", "last few weeks"] },
          { t: "Monitor error by city and alert on drift", k: ["monitor", "alert", "by city", "dashboard", "per city"] },
          { t: "Short-term fix: add a buffer for Pune while the model is improved", k: ["buffer", "adjust", "add minutes", "fallback", "correction"] },
        ],
        a: "Hi Farhan, you're right: Pune's error grew from under a minute in May to 14 minutes in July. This is drift: conditions changed with the monsoon (flooded roads, slower traffic) and the model was trained on dry-season data with no weather features, so it can't see rain. Short term, from today I'll add a correction buffer of about 12 minutes to Pune ETAs, so promises are honest while we fix the model. Over the next two weeks I'll add rain and live traffic as features and retrain on recent data from June onwards. I'll also set up monitoring of ETA error by city, with an alert when any city drifts more than 5 minutes, so we catch this in days, not months.",
      },
      {
        id: "ds2", from: "Isha (intern)", fromRole: "Data science intern", time: "Tue 15:45", subj: "My fraud model is 99% accurate 🎉",
        msg: "I trained a model to flag fake delivery confirmations and it gets 99% accuracy on the test set! Can we put it live?",
        art: { kind: "table", title: "Test set results", head: ["", "Predicted genuine", "Predicted fake"], rows: [["Actually genuine", "49,480", "20"], ["Actually fake", "470", "30"]], note: "1% of confirmations are fake" },
        ask: "Reply to Isha kindly: is it ready, and what should she look at?",
        p: [
          { t: "With only 1% fakes, accuracy is misleading: predicting 'genuine' always scores 99%", k: ["imbalanced", "misleading", "always", "baseline", "1%"] },
          { t: "Use precision and recall (or PR-AUC) on the fake class", k: ["precision", "recall", "pr auc", "f1"] },
          { t: "Read the confusion matrix: it misses 470 of 500 fakes", k: ["confusion matrix", "false negative", "misses", "470", "6%"] },
          { t: "Choose the threshold based on the cost of misses and false alarms", k: ["threshold", "cost"] },
          { t: "Handle the imbalance: class weights or resampling", k: ["class weight", "oversample", "undersample", "resample", "smote"] },
        ],
        a: "Hi Isha, great start, and nice that you kept a clean test set! It isn't ready yet though. Only 1% of confirmations are fake, so the data is heavily imbalanced and accuracy is misleading: a model that always says 'genuine' would also score 99%, so that's the baseline to beat. The confusion matrix shows the real story: it catches 30 of 500 fakes, so recall is 6% and it misses 470. Precision is 30 of 50, about 60%. Look at precision and recall, or PR AUC, for the fake class instead. Then try class weights or resampling so the model pays attention to the rare class, and choose the threshold by the cost of a missed fake against a false alarm for ops. Happy to go through it with you tomorrow!",
      },
      {
        id: "ds3", from: "Gaurav Kulkarni", fromRole: "Retention lead", time: "Wed 9:30", subj: "Churn model AUC 0.99. Launch the campaign?",
        msg: "The agency built a churn model for our merchant partners: AUC 0.99! They want to use it to pick who gets a retention offer next week. Thoughts?",
        art: { kind: "table", title: "Top features by importance", head: ["Feature", "Importance"], rows: [["days_since_last_order", "0.71"], ["account_closed_flag", "0.18"], ["orders_last_90d", "0.05"], ["avg_rating", "0.02"]], note: "Train/test split: random 80/20 over Jan to Oct" },
        ask: "Reply to Gaurav: can you trust this model? What needs to change?",
        p: [
          { t: "An AUC of 0.99 is too good to be true: suspect leakage", k: ["leak", "too good", "suspicious"] },
          { t: "Features like account_closed_flag use information from after the outcome", k: ["future", "after", "account_closed_flag", "label", "outcome"] },
          { t: "Use a time-based split instead of a random one", k: ["time-based", "time based", "out of time", "chronological"] },
          { t: "Build features as of the prediction date only", k: ["as of", "prediction date", "point in time", "cut-off", "cutoff"] },
          { t: "Re-evaluate before choosing who gets offers", k: ["re-evaluate", "retrain", "realistic", "before launching"] },
        ],
        a: "Hi Gaurav, I'd hold the campaign. An AUC of 0.99 is too good to be true for churn, which almost always means leakage. The top features give it away: account_closed_flag is set when a merchant leaves, so it is the outcome itself, and days_since_last_order measured after the churn date grows because they left. The model is reading the future. The random 80/20 split makes it worse, because January and October are mixed together. The fix: build every feature as of the prediction date, the point in time when we'd actually send the offer, and use a time-based split (train on Jan to Jul, test on Aug to Oct). Then re-evaluate: a realistic AUC is probably 0.7 to 0.8, which is still useful. I can review the agency's retrained version by Monday, before launching anything.",
      },
      {
        id: "ds4", from: "Sanjana Pillai", fromRole: "Pricing product manager", time: "Thu 11:50", subj: "Testing a rain surcharge",
        msg: "We want to try a ₹20 rain surcharge to get more riders out in bad weather. How should we test it properly?",
        art: { kind: "text", title: "Context", body: "Riders and customers in a city share the same pool: if surcharged orders get riders faster, others wait longer. Rainy days are irregular. 6 cities, about 40,000 deliveries a day." },
        ask: "Reply to Sanjana with an experiment design.",
        p: [
          { t: "State the hypothesis and one primary metric", k: ["hypothesis", "primary metric", "metric"] },
          { t: "Randomise by city or time block (switchback), because users share one rider pool", k: ["switchback", "time block", "by city", "network effect", "spillover", "shared pool"] },
          { t: "Plan the sample size and duration, enough rainy days", k: ["sample size", "duration", "weeks", "power", "rainy days"] },
          { t: "Track guardrails: cancellations, complaints, rider supply", k: ["guardrail", "cancellations", "complaints", "rider supply"] },
          { t: "Agree the decision rule before starting", k: ["decision rule", "before we start", "upfront", "pre-register", "agree in advance"] },
        ],
        a: "Hi Sanjana, here's how I'd test it. Hypothesis: a ₹20 rain surcharge raises rider supply in rain enough to cut late deliveries. Primary metric: the share of deliveries late by more than 10 minutes during rain. Because riders and customers share one pool, randomising by customer would cause spillover, a network effect where surcharged orders steal riders from others. So I'd use a switchback design: each city flips between surcharge on and off in two-hour time blocks, at random. Sample size depends on rainy days, so plan for about six weeks of duration and check the power for a 3-point drop. Guardrails: cancellations, complaints and rider supply in dry hours. We should agree the decision rule upfront, before we start: for example, ship if late deliveries fall by 3 points with no rise in cancellations.",
      },
      {
        id: "ds5", from: "Prakash Yadav", fromRole: "Control room supervisor", time: "Fri 18:05", subj: "Why does the model keep flagging Kothrud orders?",
        msg: "Your late-delivery model flags a lot of orders in Kothrud as high risk. My team doesn't know why, so they ignore it. Can you explain it in a way we can act on?",
        art: { kind: "table", title: "SHAP explanation, order #K-88213 (risk 0.81)", head: ["Feature", "Value", "Pushes risk"], rows: [["distance_km", "7.9", "+0.22"], ["rain_mm_last_hour", "11", "+0.18"], ["rider_orders_in_hand", "3", "+0.12"], ["store_prep_time_min", "4", "−0.03"]] },
        ask: "Reply to Prakash in plain language, with what his team can do.",
        p: [
          { t: "Explain with per-order contributions (SHAP), not just overall importance", k: ["shap", "contribution", "explain", "this order"] },
          { t: "Give the top reasons in plain words: long distance, rain, a busy rider", k: ["distance", "rain", "busy rider", "orders in hand", "because"] },
          { t: "Be clear these are associations, not proof of cause", k: ["correlation", "not the cause", "associated", "not proof"] },
          { t: "Turn reasons into actions the team can take", k: ["action", "reassign", "warn the customer", "notify", "extra time"] },
          { t: "Ask for feedback to improve the model", k: ["feedback", "tell us", "mark", "review"] },
        ],
        a: "Hi Prakash, good question, and it helps to know the team ignores it. For each order the model gives SHAP contributions, which show how much each factor pushed the risk up or down for this order. For order K-88213 the main reasons are: the distance is long (7.9 km, many Kothrud orders come from a far store), it's raining heavily, and the rider already has 3 orders in hand. Store prep time was fine. These are patterns the model learned, associated with late deliveries, not proof of cause. Actions your team can take when an order is flagged: reassign it to a free rider, or notify the customer early and add extra time. I'll add the top three reasons to the alert screen. Please give us feedback too: if your team marks flags as useful or wrong, we can review them and improve the model.",
      },
    ],
  },
  ar: {
    role: "Data Architect", co: "Mandi Mart", about: "a retail chain with 300 stores, an online shop and a 15-year-old on-premise data warehouse that leadership wants to modernise.",
    days: [
      {
        id: "ar1", from: "Suresh Menon", fromRole: "CTO", time: "Mon 10:00", subj: "Warehouse or lakehouse?",
        msg: "Two vendors are pitching us: one says cloud data warehouse, the other says lakehouse. I need your recommendation for the board in two weeks. Where do we start?",
        art: { kind: "text", title: "What we know", body: "Today: on-prem warehouse, 18 TB, nightly batch. Users: 60 analysts (SQL), BI dashboards. New asks: demand forecasting (ML), near real-time stock. Team: strong in SQL, little Spark. Budget: tight." },
        ask: "Reply to Suresh with how you'll decide and an initial recommendation.",
        p: [
          { t: "Start from requirements: workloads, data volume, latency, users", k: ["requirement", "workload", "volume", "latency", "use case"] },
          { t: "Compare the trade-offs of warehouse and lakehouse fairly", k: ["trade-off", "trade off", "warehouse", "lakehouse"] },
          { t: "Prefer open table formats to avoid lock-in", k: ["open format", "iceberg", "delta", "parquet", "lock-in", "lock in"] },
          { t: "Weigh cost and the team's skills", k: ["cost", "skills", "team", "sql"] },
          { t: "De-risk with a pilot or proof of concept on real workloads", k: ["pilot", "proof of concept", "poc", "phase", "start small"] },
        ],
        a: "Hi Suresh, I'd decide from our requirements, not the pitches. The workloads are BI and SQL for 60 analysts, ML for demand forecasting, and near real-time stock; volume is moderate (18 TB) and latency needs are minutes, not seconds. The trade-off: a cloud warehouse is the simplest fit for SQL analysts and BI, while a lakehouse handles ML and streaming data more cheaply but needs Spark skills we lack. Both now support open formats such as Iceberg or Delta on Parquet, and I'd insist on one to avoid lock-in. Weighing cost and our team's SQL skills, my initial recommendation is a warehouse that can read open tables, with ML added later. Before the board, I'd run a two-week proof of concept with both vendors on three real workloads and compare cost and speed.",
      },
      {
        id: "ar2", from: "Lakshmi Narayan", fromRole: "Head of BI", time: "Tue 16:10", subj: "Three teams, three 'active customer' numbers",
        msg: "Marketing says 4.1 million active customers, Finance says 2.8 million, the app team says 5.6 million. The CEO is fed up. How do we fix this for good?",
        art: { kind: "table", title: "Current definitions", head: ["Team", "Active customer means…"], rows: [["Marketing", "opened the app or an email in 90 days"], ["Finance", "paid for an order in 30 days"], ["App", "logged in once in 180 days"]] },
        ask: "Reply to Lakshmi with a lasting fix.",
        p: [
          { t: "Agree one shared definition per metric, held in a semantic or metrics layer", k: ["semantic layer", "metrics layer", "single definition", "shared definition", "one definition"] },
          { t: "Give each metric an owner", k: ["owner", "steward", "accountable"] },
          { t: "Document it in a catalog or business glossary", k: ["catalog", "glossary", "document"] },
          { t: "A governance process to approve changes", k: ["governance", "approve", "change process", "council"] },
          { t: "Mark certified datasets so people know what to trust", k: ["certified", "trusted", "gold"] },
        ],
        a: "Hi Lakshmi, all three numbers are 'right' for their own definition, so the fix is agreement, not a better query. First, get the three teams to agree one shared definition of active customer, for example paid in the last 30 days. Keep the other two as separately named metrics, such as 'engaged' and 'registered'. Define them once in a semantic layer (metrics layer) so every dashboard pulls the same logic. Second, give each metric an owner: Finance for active customers. Third, document it in the data catalog's business glossary. Fourth, set up a light governance process where changes to a key metric are reviewed and approved by a small data council. Finally, mark certified datasets in the BI tool so people know which numbers are trusted.",
      },
      {
        id: "ar3", from: "Deepak Chauhan", fromRole: "Supply chain director", time: "Wed 13:25", subj: "We need live stock levels, not yesterday's",
        msg: "Our stock data reaches the warehouse once a night from the store POS databases (Oracle). Online orders get accepted for items that sold out hours ago. Can we get stock within a few minutes?",
        art: { kind: "text", title: "Current flow", body: "300 store POS databases (Oracle) → nightly export → FTP → on-prem warehouse (02:00). ~4 million stock movements a day." },
        ask: "Reply to Deepak with a target design and the main risks.",
        p: [
          { t: "Capture changes with log-based CDC from the POS databases", k: ["cdc", "change data capture", "log-based", "debezium", "redo log"] },
          { t: "Stream the changes through an event bus such as Kafka", k: ["kafka", "stream", "event"] },
          { t: "Land raw, then build curated layers", k: ["raw", "bronze", "layer", "curated", "medallion"] },
          { t: "Handle ordering, duplicates and late events (idempotent merges)", k: ["order", "duplicate", "late", "idempotent", "merge"] },
          { t: "Agree an SLA and monitor latency", k: ["sla", "monitor", "latency", "alert"] },
        ],
        a: "Hi Deepak, yes, a few minutes is realistic. Target design: use change data capture (CDC) that reads the Oracle redo logs at each store, using a log-based tool such as Debezium or GoldenGate. This puts no load on the POS and catches every stock movement. The changes stream as events through Kafka to the cloud. There we land them raw (bronze) and maintain a curated stock table that online ordering reads. Main risks: events can arrive late, out of order or twice when a store's connection drops, so we merge on the item and store key in an idempotent way and keep the latest movement. We'll agree an SLA, such as stock no more than 5 minutes old, monitor latency for each store, and alert when a store falls behind. I suggest a 10-store pilot first.",
      },
      {
        id: "ar4", from: "Rekha Das", fromRole: "Internal audit", time: "Thu 11:05", subj: "Audit: how is customer PII protected?",
        msg: "For the annual audit and the DPDP Act, I need a short description of how customer personal data is protected across the data platform.",
        art: { kind: "text", title: "Personal data held", body: "Customer name, phone, email, address, loyalty ID, purchase history. Copies in: warehouse, analyst sandboxes, ML feature store, nightly exports to two vendors." },
        ask: "Reply to Rekha with the controls you have or will put in place.",
        p: [
          { t: "Classify and tag personal data so controls follow it", k: ["classify", "tag", "classification", "sensitive"] },
          { t: "Encrypt data at rest and in transit", k: ["encrypt", "encryption", "at rest", "in transit"] },
          { t: "Least-privilege, role-based access control", k: ["least privilege", "role-based", "rbac", "access control"] },
          { t: "Mask columns and apply row-level policies; tokenise for vendors", k: ["mask", "masking", "row-level", "column-level", "tokenise", "tokenize"] },
          { t: "Audit logs, retention limits and deletion on request", k: ["audit log", "retention", "deletion", "erase", "delete"] },
        ],
        a: "Hi Rekha, here is a short summary. Classification: personal fields (name, phone, email, address) are tagged as sensitive in the catalog, and controls follow the tags wherever the data is copied. Encryption: all data is encrypted at rest and in transit. Access: least privilege with role-based access control (RBAC); only the customer service and fraud roles see raw contact details. Masking: everyone else sees masked columns through column-level policies, row-level policies limit store managers to their region, and the two vendor exports use tokenised IDs instead of phone numbers. Accountability: every query on sensitive data is kept in an audit log for a year, retention limits delete data we no longer need, and a deletion request removes a customer's data everywhere, including analyst sandboxes and the feature store, within 30 days, as the DPDP Act requires.",
      },
      {
        id: "ar5", from: "Suresh Menon", fromRole: "CTO", time: "Fri 15:30", subj: "What if the cloud region goes down?",
        msg: "The board asked: if our cloud region has an outage on a sale day, how long are we blind and how much data do we lose? What's your answer?",
        art: { kind: "table", title: "Systems on the platform", head: ["System", "Used for"], rows: [["Live stock", "online orders"], ["Sales warehouse", "daily reports"], ["ML features", "weekly forecasts"], ["Archive", "audit, 7 years"]] },
        ask: "Reply to Suresh with a disaster recovery approach.",
        p: [
          { t: "Agree RPO and RTO (how much data loss, how long down) with the business", k: ["rpo", "rto", "recovery point", "recovery time"] },
          { t: "Tier systems by how critical they are", k: ["tier", "critical", "priority"] },
          { t: "Replicate or back up across regions", k: ["replicate", "replication", "backup", "cross-region", "second region", "snapshot"] },
          { t: "Write a runbook and run failover drills", k: ["runbook", "drill", "failover", "test it"] },
          { t: "Be explicit about the cost trade-off", k: ["cost", "trade-off", "trade off"] },
        ],
        a: "Hi Suresh, the honest answer depends on two numbers we should agree with the business: RPO, the recovery point (how much data we can afford to lose), and RTO, the recovery time (how long we can be down). I'd tier the systems by how critical they are. Tier 1, live stock: replicate continuously to a second region with automatic failover, RPO about 1 minute, RTO 15 minutes. Tier 2, the sales warehouse: cross-region replication of snapshots every hour, RTO 4 hours. Tier 3, ML features and the archive: daily backups, RTO 2 days. Each tier has a runbook, and we run a failover drill every quarter, since an untested plan isn't a plan. The trade-off is cost: tier 1 roughly doubles that system's spend, so it's worth it only where downtime costs more.",
      },
    ],
  },
};
const SIM_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const SIM_PASS = 60, SIM_XP = 40, SIM_WEEK_XP = 100;

let simTrack = null, simDay = null, simDraft = {};
const simState = () => Object.assign({ best: {}, week: {} }, store.get("sim", {}));
function simSave(st) { store.set("sim", st); if (typeof qsSave === "function") qsSave(); }
const simTrackNow = () => simTrack || (typeof pathTrack === "function" ? pathTrack() : "de");
const simCleared = (st, id) => (st.best[id] || 0) >= SIM_PASS;
// The first day not yet cleared, so a returning learner lands where they left off.
const simNext = (t, st) => { const i = SIM[t].days.findIndex((d) => !simCleared(st, d.id)); return i < 0 ? 4 : i; };

function simArt(a) {
  if (a.kind === "table") return `<div class="simart"><span class="simart-t">${esc(a.title)}</span><div class="simtbl"><table><thead><tr>${a.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${a.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${a.note ? `<small class="muted">${esc(a.note)}</small>` : ""}</div>`;
  if (a.kind === "text") return `<div class="simart"><span class="simart-t">${esc(a.title)}</span><p>${esc(a.body)}</p></div>`;
  return `<div class="simart"><span class="simart-t">${esc(a.title)}</span><pre><code>${esc(a.body)}</code></pre></div>`;
}
const initials = (n) => n.replace(/\(.*?\)/g, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function renderSim() {
  const host = $("#simBoard"); if (!host) return;
  const t = simTrackNow(), S = SIM[t], st = simState();
  if (simDay === null || simDay >= S.days.length) simDay = simNext(t, st);
  const d = S.days[simDay], done = S.days.filter((x) => simCleared(st, x.id)).length;
  host.innerHTML = `<div class="simhead card">
      <span class="eyebrow">Job simulator · your first week</span>
      <h2>${esc(S.role)} at ${esc(S.co)}</h2>
      <p class="muted">${esc(S.co)} is a made-up company: ${esc(S.about)} One ticket a day. Reply as you would at work; ${SIM_PASS}% clears the day.</p>
      <div class="seg" role="group" aria-label="Role">${Object.entries(SIM).map(([k, v]) => `<button class="pill" type="button" aria-pressed="${k === t}" data-simtrack="${k}">${esc(v.role)}</button>`).join("")}</div>
      <div class="simweek" role="group" aria-label="Days of the week">${S.days.map((x, i) => {
        const ok = simCleared(st, x.id), sc = st.best[x.id];
        return `<button type="button" class="simday${ok ? " ok" : ""}${i === simDay ? " cur" : ""}" aria-pressed="${i === simDay}" data-simday="${i}"><b>${SIM_DAYS[i]}</b><small>${ok ? "✓ " + sc + "%" : sc != null ? sc + "%" : i === simNext(t, st) ? "Up next" : "Open"}</small></button>`;
      }).join("")}</div>
      <div class="meter"><div class="tr"><div class="fl" style="width:${done * 20}%"></div></div><b>${done} of 5 days</b></div>
      ${st.week[t] ? `<p class="simdone">Week one done at ${esc(S.co)}. Try another role, or replay a day to beat your score.</p>` : ""}
    </div>
    <article class="card simtk" aria-label="Ticket for ${SIM_DAYS[simDay]}">
      <div class="simfrom"><span class="av" aria-hidden="true">${esc(initials(d.from))}</span><span><b>${esc(d.from)}</b><small>${esc(d.fromRole)} · ${esc(d.time)}</small></span></div>
      <h3>${esc(d.subj)}</h3>
      <p>${esc(d.msg)}</p>
      ${simArt(d.art)}
      <p class="simask"><b>Your task:</b> ${esc(d.ask)}</p>
      <label class="sr" for="simAns">Your reply</label>
      <textarea class="ans-in" id="simAns" placeholder="Write your reply as you'd send it at work…">${esc(simDraft[d.id] || "")}</textarea>
      <div class="acts"><button class="btn" type="button" id="simSend">Send reply</button><button class="btn quiet" type="button" id="simModel" ${st.best[d.id] == null ? "hidden" : ""}>See how a senior would reply</button></div>
      <div id="simOut"></div>
    </article>`;
}

function simResult(g, d) {
  return `<div class="simres">
    <div class="meter"><div class="tr"><div class="fl" style="width:${g.pct}%"></div></div><b>${g.n} of ${g.res.length}</b></div>
    <ul class="pts">${g.res.map((r) => `<li class="${r.ok ? "ok" : "miss"}"><span class="mk">${r.ok ? "✓" : "–"}</span><span>${esc(r.t)}</span></li>`).join("")}</ul>
    <p class="muted" style="font-size:13.5px">${g.pct >= SIM_PASS ? `Day cleared. ${esc(d.from.split(" ")[0])} has what they need.` : `Not quite: cover the missing points and send it again.`} Quick check looks for the key ideas, so a good reply in unusual words can score lower.</p>
    ${aiOn() ? `<div class="acts"><button class="btn quiet" type="button" id="simReview">Ask ${esc(d.from.split(" ")[0])} for feedback</button></div>` : ""}
    <div id="simAI"></div>
  </div>`;
}

function simSend() {
  const t = simTrackNow(), S = SIM[t], d = S.days[simDay], v = $("#simAns").value;
  if (tooShort(v)) { $("#simOut").innerHTML = SHORT_MSG; return; }
  const g = grade(v, d), st = simState(), first = !simCleared(st, d.id);
  st.best[d.id] = Math.max(st.best[d.id] || 0, g.pct);
  const weekNow = S.days.every((x) => simCleared(st, x.id)), weekFirst = weekNow && !st.week[t];
  if (weekFirst) st.week[t] = true;
  simSave(st);
  if (g.pct >= SIM_PASS && first && typeof award === "function") award(SIM_XP, `Job sim: ${SIM_DAYS[simDay]} cleared`);
  if (weekFirst && typeof award === "function") setTimeout(() => award(SIM_WEEK_XP, `Week one at ${S.co} done`), 1400);
  if (typeof checkBadges === "function") checkBadges();
  renderSim();
  $("#simOut").innerHTML = simResult(g, d);
  $("#simModel").hidden = false;
  $("#simOut").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "nearest" });
}

function simModel() {
  const d = SIM[simTrackNow()].days[simDay], box = $("#simOut");
  const all = d.p.flatMap((p) => p.k);
  box.insertAdjacentHTML("beforeend", `<div class="teach simmodel"><span class="eyebrow">How a senior would reply</span><p>${markText(d.a, all)}</p><p class="muted" style="font-size:13px">The highlighted words are what Quick check listens for. Use your own words when you try again.</p></div>`);
  $("#simModel").hidden = true;
}

async function simReview() {
  const t = simTrackNow(), S = SIM[t], d = S.days[simDay], host = $("#simAI"), btn = $("#simReview");
  if (!host || busy) return;
  btn.disabled = true;
  host.innerHTML = `<div class="aifb"><span class="eyebrow">${esc(d.from)} replies</span><div class="md cursor">${climbLoader("Reading your reply…")}</div><p class="muted foot3" style="font-size:12.5px"></p></div>`;
  const body = host.querySelector(".md");
  try {
    const out = await streamChat({ mode: "simreview", detail, provider: engine.provider, model: engine.model, role: S.role, company: S.co,
      from: d.from, fromRole: d.fromRole, ticket: `${d.subj}\n${d.msg}`, task: d.ask, points: d.p.map((p) => p.t), answer: $("#simAns").value }, (x) => { body.innerHTML = md(x); });
    body.classList.remove("cursor");
    host.querySelector(".foot3").textContent = `Written by ${out.label} · ${out.model}, playing ${d.from}. AI can be wrong; the key points above are the reviewed source.`;
  } catch (e) {
    body.classList.remove("cursor");
    body.innerHTML = `<p class="warnnote">Feedback isn't available right now: ${esc(e.message)}</p>`;
  }
  btn.disabled = false;
}

document.addEventListener("click", (e) => {
  const tk = e.target.closest("[data-simtrack]");
  if (tk) { simTrack = tk.dataset.simtrack; simDay = null; renderSim(); return; }
  const dy = e.target.closest("[data-simday]");
  if (dy) { simDay = +dy.dataset.simday; renderSim(); return; }
  if (e.target.closest("#simSend")) return simSend();
  if (e.target.closest("#simModel")) return simModel();
  if (e.target.closest("#simReview")) return simReview();
});
// Keep an unsent reply when switching days.
document.addEventListener("input", (e) => {
  if (e.target.id !== "simAns") return;
  simDraft[SIM[simTrackNow()].days[simDay].id] = e.target.value;
});
// The start-up screen is chosen before this file loads; fill it in if the app opened straight on the job sim.
if ($("#view-sim") && !$("#view-sim").hidden) renderSim();
