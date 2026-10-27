/* Datakul coding practice: original problems written for Datakul.
   SQL problems run in the browser on SQLite (sql.js) and are checked against the reference solution's output.
   Python, pandas and PySpark problems run in the browser on Pyodide (PySpark on Datakul's pandas-backed engine) against tests;
   expected results always come from the reference solution. */

const PROBLEMS = [
/* ------------------------------------------------------------------ SQL */
{
  id: "sellers-no-sales", concept: "sql-joins", lang: "sql", diff: "Easy", pattern: "Anti join", track: "da",
  title: "Sellers who never made a sale",
  prompt: "A marketplace wants to contact sellers who signed up but have never received an order.\n\nReturn the **name** of every seller with no rows in `orders`, sorted by name.",
  setup: `CREATE TABLE sellers (seller_id INTEGER PRIMARY KEY, name TEXT, city TEXT);
INSERT INTO sellers VALUES (1,'Anand Textiles','Surat'),(2,'Bharat Spices','Kochi'),(3,'Chennai Crafts','Chennai'),(4,'Delhi Decor','Delhi'),(5,'Eastern Teas','Kolkata');
CREATE TABLE orders (order_id INTEGER PRIMARY KEY, seller_id INTEGER, order_date TEXT, amount REAL);
INSERT INTO orders VALUES (101,1,'2026-10-01',1200),(102,3,'2026-10-02',540),(103,1,'2026-10-03',860),(104,5,'2026-10-03',300);`,
  ordered: true,
  starter: "SELECT s.name\nFROM sellers s\n-- your logic here\n",
  hints: [
    "You need sellers that have no match in orders. Which join keeps every seller even when there is no match?",
    "LEFT JOIN orders and keep rows where the order side IS NULL, or use NOT EXISTS with a correlated subquery.",
  ],
  solution: `SELECT s.name
FROM sellers s
WHERE NOT EXISTS (
  SELECT 1 FROM orders o WHERE o.seller_id = s.seller_id
)
ORDER BY s.name;`,
  explain: {
    approach: "This is an anti join: keep rows from one table that have no match in another. NOT EXISTS reads naturally (\"sellers for whom no order exists\") and stops scanning as soon as it finds one match, so it is efficient.",
    steps: [
      "Start from `sellers`, because every output row is a seller.",
      "For each seller, the subquery looks for any order with the same `seller_id`.",
      "`NOT EXISTS` keeps the seller only when the subquery finds nothing.",
      "Sort by name as asked.",
    ],
    alt: `-- Equivalent LEFT JOIN version
SELECT s.name
FROM sellers s
LEFT JOIN orders o ON o.seller_id = s.seller_id
WHERE o.order_id IS NULL
ORDER BY s.name;`,
    pitfalls: [
      "`NOT IN (SELECT seller_id FROM orders)` returns nothing at all if any `seller_id` in orders is NULL. NOT EXISTS has no such trap.",
      "Putting a filter on the orders table in WHERE instead of ON turns a LEFT JOIN back into an inner join.",
    ],
    real: "The same pattern finds customers who never ordered, carriers with no shipments this week, or source rows missing from the warehouse during reconciliation.",
  },
},
{
  id: "city-gmv", concept: "group-by-having", lang: "sql", diff: "Easy", pattern: "GROUP BY and HAVING", track: "da",
  title: "Cities above ₹2,000 in sales",
  prompt: "Using `customers` and `orders`, find each city's total order value (GMV) for **delivered** orders only.\n\nReturn `city` and `gmv` for cities whose GMV is **more than 2,000**, highest GMV first.",
  setup: `CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, name TEXT, city TEXT);
INSERT INTO customers VALUES (1,'Asha','Bengaluru'),(2,'Ravi','Pune'),(3,'Meera','Bengaluru'),(4,'Kabir','Jaipur'),(5,'Divya','Pune');
CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL, status TEXT);
INSERT INTO orders VALUES (1,1,1500,'DELIVERED'),(2,3,900,'DELIVERED'),(3,2,700,'DELIVERED'),(4,5,1600,'DELIVERED'),(5,4,2500,'CANCELLED'),(6,2,400,'DELIVERED'),(7,1,300,'RETURNED'),(8,4,1800,'DELIVERED');`,
  ordered: true,
  starter: "SELECT c.city, SUM(o.amount) AS gmv\nFROM orders o\nJOIN customers c ON c.customer_id = o.customer_id\n-- filter, group and keep only big cities\n",
  hints: [
    "Filter rows (delivered only) before grouping, and filter groups (GMV > 2000) after grouping.",
    "WHERE status = 'DELIVERED' … GROUP BY city HAVING SUM(amount) > 2000 ORDER BY gmv DESC.",
  ],
  solution: `SELECT c.city, SUM(o.amount) AS gmv
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
WHERE o.status = 'DELIVERED'
GROUP BY c.city
HAVING SUM(o.amount) > 2000
ORDER BY gmv DESC;`,
  explain: {
    approach: "Two different filters are at work. WHERE removes individual rows before grouping (cancelled and returned orders). HAVING removes whole groups after aggregation (cities that are too small).",
    steps: [
      "Join orders to customers to get each order's city.",
      "WHERE keeps only delivered orders.",
      "GROUP BY city and SUM the amount to get GMV.",
      "HAVING keeps groups with GMV above 2,000.",
      "ORDER BY gmv DESC.",
    ],
    pitfalls: [
      "Putting the status filter in HAVING fails, because status is not grouped or aggregated.",
      "Filtering status after grouping would count cancelled orders in the total. Jaipur would wrongly reach 4,300.",
    ],
    real: "This is the WHERE-versus-HAVING interview question in practical form, and the shape of most KPI queries behind dashboards.",
  },
},
{
  id: "latest-status", concept: "window-functions", lang: "sql", diff: "Medium", pattern: "ROW_NUMBER", track: "de",
  title: "Latest status of each shipment",
  prompt: "`shipment_events` logs every status update from carriers.\n\nReturn each `shipment_id` with its **most recent** `status` and that event's `event_ts`, sorted by shipment_id.",
  setup: `CREATE TABLE shipment_events (event_id INTEGER PRIMARY KEY, shipment_id TEXT, status TEXT, event_ts TEXT);
INSERT INTO shipment_events VALUES
(1,'SH1','PICKED_UP','2026-10-20 09:10'),(2,'SH1','IN_TRANSIT','2026-10-20 14:30'),(3,'SH2','PICKED_UP','2026-10-20 10:00'),
(4,'SH1','DELIVERED','2026-10-21 11:05'),(5,'SH3','PICKED_UP','2026-10-21 08:45'),(6,'SH2','IN_TRANSIT','2026-10-21 09:20'),
(7,'SH3','IN_TRANSIT','2026-10-21 18:00'),(8,'SH2','OUT_FOR_DELIVERY','2026-10-22 07:40');`,
  ordered: true,
  starter: "WITH ranked AS (\n  SELECT shipment_id, status, event_ts\n  -- add a ranking here\n  FROM shipment_events\n)\nSELECT shipment_id, status, event_ts\nFROM ranked\n-- keep the latest\n",
  hints: [
    "Number each shipment's events from newest to oldest, then keep number 1.",
    "ROW_NUMBER() OVER (PARTITION BY shipment_id ORDER BY event_ts DESC) AS rn … WHERE rn = 1.",
  ],
  solution: `WITH ranked AS (
  SELECT shipment_id, status, event_ts,
         ROW_NUMBER() OVER (PARTITION BY shipment_id ORDER BY event_ts DESC) AS rn
  FROM shipment_events
)
SELECT shipment_id, status, event_ts
FROM ranked
WHERE rn = 1
ORDER BY shipment_id;`,
  explain: {
    approach: "\"Latest row per group\" is the classic ROW_NUMBER pattern. The window numbers rows inside each shipment, newest first, without collapsing them, so you can then keep only row 1 and still have every column of that row.",
    steps: [
      "PARTITION BY shipment_id restarts the numbering for each shipment.",
      "ORDER BY event_ts DESC makes the newest event number 1.",
      "The outer query keeps rn = 1: one row per shipment, with its full details.",
    ],
    alt: `-- Works too, but is fragile: two events with the same max timestamp return two rows
SELECT e.shipment_id, e.status, e.event_ts
FROM shipment_events e
JOIN (SELECT shipment_id, MAX(event_ts) AS mx FROM shipment_events GROUP BY shipment_id) m
  ON m.shipment_id = e.shipment_id AND m.mx = e.event_ts
ORDER BY e.shipment_id;`,
    pitfalls: [
      "SELECT shipment_id, MAX(event_ts), status … GROUP BY shipment_id is wrong in most databases: status is not tied to the max row (SQLite happens to allow it, others reject it).",
      "If two events share a timestamp, add a tie-breaker such as event_id DESC to the ORDER BY so the result is deterministic.",
      "Timestamps stored as text only sort correctly in ISO format (YYYY-MM-DD HH:MM).",
    ],
    real: "Exactly how a TMS or order system builds a \"current status\" table from an event log, and how you deduplicate CDC changes to the latest version per key.",
  },
},
{
  id: "upi-running-total", concept: "running-totals", lang: "sql", diff: "Medium", pattern: "Running total", track: "da",
  title: "Daily UPI volume with a running total",
  prompt: "From `payments`, consider only **SUCCESS** transactions.\n\nReturn `txn_date`, the day's total as `daily_amount`, and the cumulative total so far as `running_amount`, ordered by date.",
  setup: `CREATE TABLE payments (txn_id TEXT PRIMARY KEY, txn_date TEXT, amount REAL, status TEXT);
INSERT INTO payments VALUES
('T1','2026-10-01',500,'SUCCESS'),('T2','2026-10-01',250,'FAILED'),('T3','2026-10-01',1200,'SUCCESS'),
('T4','2026-10-02',300,'SUCCESS'),('T5','2026-10-03',800,'SUCCESS'),('T6','2026-10-03',150,'SUCCESS'),
('T7','2026-10-03',999,'PENDING'),('T8','2026-10-04',2000,'SUCCESS');`,
  ordered: true,
  starter: "WITH daily AS (\n  SELECT txn_date, SUM(amount) AS daily_amount\n  FROM payments\n  -- only successful payments\n  GROUP BY txn_date\n)\nSELECT txn_date, daily_amount\n  -- add the running total\nFROM daily\nORDER BY txn_date;\n",
  hints: [
    "First aggregate to one row per day, then run a window over those daily rows.",
    "SUM(daily_amount) OVER (ORDER BY txn_date) gives a running total.",
  ],
  solution: `WITH daily AS (
  SELECT txn_date, SUM(amount) AS daily_amount
  FROM payments
  WHERE status = 'SUCCESS'
  GROUP BY txn_date
)
SELECT txn_date,
       daily_amount,
       SUM(daily_amount) OVER (ORDER BY txn_date
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_amount
FROM daily
ORDER BY txn_date;`,
  explain: {
    approach: "Do it in two layers. The CTE collapses transactions to one row per day. The window function then adds up all days up to and including the current one.",
    steps: [
      "Filter to SUCCESS so failed and pending payments don't count.",
      "GROUP BY txn_date gives daily_amount.",
      "SUM(...) OVER (ORDER BY txn_date) accumulates in date order.",
      "The explicit ROWS frame makes the intent clear and avoids surprises when dates repeat.",
    ],
    pitfalls: [
      "Running the window on raw transactions gives one row per transaction, not per day.",
      "Without ORDER BY inside OVER, SUM() OVER () returns the grand total on every row.",
      "With the default RANGE frame, duplicate ORDER BY values share the same running total. ROWS avoids that.",
    ],
    real: "Cumulative GMV, month-to-date revenue and settlement balances are all running totals.",
  },
},
{
  id: "dod-orders", concept: "window-functions", lang: "sql", diff: "Medium", pattern: "LAG", track: "da",
  title: "Day-over-day change in orders",
  prompt: "`daily_orders` has one row per day.\n\nReturn `day`, `orders`, and `change` = today's orders minus the previous day's. The first day's change should be NULL. Order by day.",
  setup: `CREATE TABLE daily_orders (day TEXT PRIMARY KEY, orders INTEGER);
INSERT INTO daily_orders VALUES ('2026-10-20',120),('2026-10-21',135),('2026-10-22',128),('2026-10-23',160),('2026-10-24',210);`,
  ordered: true,
  starter: "SELECT day, orders\n  -- previous day's value?\nFROM daily_orders\nORDER BY day;\n",
  hints: [
    "You need a value from the previous row. Which window function looks backwards?",
    "orders - LAG(orders) OVER (ORDER BY day).",
  ],
  solution: `SELECT day,
       orders,
       orders - LAG(orders) OVER (ORDER BY day) AS change
FROM daily_orders
ORDER BY day;`,
  explain: {
    approach: "LAG returns a column's value from an earlier row in the window's order. Subtracting it from the current value gives the change. On the first row there is no earlier row, so LAG returns NULL and so does the subtraction.",
    steps: [
      "ORDER BY day inside OVER defines what \"previous\" means.",
      "LAG(orders) fetches yesterday's orders.",
      "orders - LAG(orders) is the change.",
    ],
    alt: `-- Percentage change, guarding against division by zero
SELECT day, orders,
       ROUND(100.0 * (orders - LAG(orders) OVER w) / NULLIF(LAG(orders) OVER w, 0), 1) AS pct_change
FROM daily_orders
WINDOW w AS (ORDER BY day);`,
    pitfalls: [
      "A self-join on day = previous day breaks when a date is missing. LAG simply takes the previous row.",
      "If days can be missing and you need the true calendar previous day, build a date spine first.",
      "Integer division: use 100.0 rather than 100 for percentages.",
    ],
    real: "Day-over-day and week-over-week deltas drive alerting dashboards, for example a sudden drop in payment success or order volume.",
  },
},
{
  id: "top2-products", concept: "window-functions", lang: "sql", diff: "Medium", pattern: "Top N per group", track: "da",
  title: "Top 2 products by revenue in each category",
  prompt: "Return `category`, `product`, and `revenue` for the **top 2** products by revenue within each category. If products tie, include all tied products (so a category can return more than 2 rows).\n\nOrder by category, then revenue descending, then product.",
  setup: `CREATE TABLE sales (product TEXT, category TEXT, revenue REAL);
INSERT INTO sales VALUES
('Basmati Rice 5kg','Grocery',42000),('Toor Dal 1kg','Grocery',31000),('Ghee 1L','Grocery',31000),('Atta 10kg','Grocery',18000),
('Kurta','Fashion',56000),('Saree','Fashion',72000),('Jutti','Fashion',15000),
('Pressure Cooker','Kitchen',39000),('Tawa','Kitchen',12000);`,
  ordered: true,
  starter: "WITH ranked AS (\n  SELECT category, product, revenue\n  -- rank within category\n  FROM sales\n)\nSELECT category, product, revenue\nFROM ranked\n-- keep the top 2 ranks\n",
  hints: [
    "\"Include ties\" decides which ranking function to use. ROW_NUMBER never ties; RANK leaves gaps after ties; DENSE_RANK does not.",
    "DENSE_RANK() OVER (PARTITION BY category ORDER BY revenue DESC) AS rnk … WHERE rnk <= 2.",
  ],
  solution: `WITH ranked AS (
  SELECT category, product, revenue,
         DENSE_RANK() OVER (PARTITION BY category ORDER BY revenue DESC) AS rnk
  FROM sales
)
SELECT category, product, revenue
FROM ranked
WHERE rnk <= 2
ORDER BY category, revenue DESC, product;`,
  explain: {
    approach: "Rank inside each category and keep the top two ranks. The choice of ranking function is the whole question: with ties, DENSE_RANK gives Grocery ranks 1, 2, 2, 3, so both 31,000 products are kept.",
    steps: [
      "PARTITION BY category ranks each category separately.",
      "ORDER BY revenue DESC puts the best seller at rank 1.",
      "DENSE_RANK gives tied rows the same rank without skipping the next number.",
      "WHERE rnk <= 2 keeps the top two revenue levels.",
    ],
    pitfalls: [
      "ROW_NUMBER would drop one of the tied Grocery products arbitrarily.",
      "RANK would also work for \"top 2\" here, but for \"top 3\" it would skip rank 3 after a tie at 2. Know the difference.",
      "You cannot filter on a window function in the same SELECT's WHERE. Wrap it in a CTE or subquery (or use QUALIFY where supported).",
    ],
    real: "Top SKUs per warehouse, best carriers per lane, top merchants per city. Ties matter when the result drives decisions.",
  },
},
{
  id: "dedup-events", concept: "idempotency", lang: "sql", diff: "Medium", pattern: "Deduplication", track: "de",
  title: "Remove duplicate events, keep the first",
  prompt: "A retrying producer sent some click events twice. Two rows are duplicates when `user_id`, `event_type` and `event_ts` are all the same.\n\nReturn the `event_id` of the rows to **keep**: for each duplicate group, the smallest event_id. Order by event_id.",
  setup: `CREATE TABLE events (event_id INTEGER PRIMARY KEY, user_id INTEGER, event_type TEXT, event_ts TEXT);
INSERT INTO events VALUES
(1,7,'view','2026-10-25 10:00:01'),(2,7,'view','2026-10-25 10:00:01'),(3,7,'add_to_cart','2026-10-25 10:01:10'),
(4,9,'view','2026-10-25 10:02:00'),(5,9,'view','2026-10-25 10:02:00'),(6,9,'view','2026-10-25 10:02:00'),
(7,9,'checkout','2026-10-25 10:05:30'),(8,7,'view','2026-10-25 10:03:00');`,
  ordered: true,
  starter: "SELECT event_id\nFROM events\n-- keep one row per (user_id, event_type, event_ts)\n",
  hints: [
    "Group rows by the three columns that define a duplicate, and pick one id per group.",
    "Either MIN(event_id) … GROUP BY user_id, event_type, event_ts, or ROW_NUMBER() partitioned by those columns ordered by event_id.",
  ],
  solution: `WITH ranked AS (
  SELECT event_id,
         ROW_NUMBER() OVER (PARTITION BY user_id, event_type, event_ts ORDER BY event_id) AS rn
  FROM events
)
SELECT event_id
FROM ranked
WHERE rn = 1
ORDER BY event_id;`,
  explain: {
    approach: "Define the duplicate key, then keep exactly one row per key. ROW_NUMBER is the most flexible way, because the same query can return full rows and lets you choose which copy survives via ORDER BY.",
    steps: [
      "PARTITION BY user_id, event_type, event_ts groups identical events.",
      "ORDER BY event_id makes the first-arrived copy number 1.",
      "WHERE rn = 1 keeps one per group.",
    ],
    alt: `-- Shorter when you only need the ids
SELECT MIN(event_id) AS event_id
FROM events
GROUP BY user_id, event_type, event_ts
ORDER BY event_id;

-- Deleting duplicates in place
DELETE FROM events
WHERE event_id NOT IN (
  SELECT MIN(event_id) FROM events GROUP BY user_id, event_type, event_ts
);`,
    pitfalls: [
      "SELECT DISTINCT * keeps every row, because event_id differs between duplicates.",
      "Choose the duplicate key carefully. Event 8 is a second view by user 7 at a different time, a real event, not a duplicate.",
    ],
    real: "At-least-once delivery from Kafka or retrying APIs means duplicates are normal. Deduplicating on a business key makes pipelines idempotent.",
  },
},
{
  id: "ontime-streak", concept: "gaps-islands", lang: "sql", diff: "Hard", pattern: "Gaps and islands", track: "de",
  title: "Longest on-time streak per hub",
  prompt: "`hub_days` records, for each delivery hub and day, whether all deliveries were on time (`on_time` = 1).\n\nFor each hub, return the **longest run of consecutive calendar days** with on_time = 1 as `longest_streak`. Order by hub.",
  setup: `CREATE TABLE hub_days (hub TEXT, day TEXT, on_time INTEGER);
INSERT INTO hub_days VALUES
('BLR-1','2026-10-01',1),('BLR-1','2026-10-02',1),('BLR-1','2026-10-03',0),('BLR-1','2026-10-04',1),('BLR-1','2026-10-05',1),('BLR-1','2026-10-06',1),
('PNQ-2','2026-10-01',1),('PNQ-2','2026-10-02',0),('PNQ-2','2026-10-03',1),('PNQ-2','2026-10-05',1),('PNQ-2','2026-10-06',1),
('DEL-3','2026-10-01',0),('DEL-3','2026-10-02',1),('DEL-3','2026-10-03',1),('DEL-3','2026-10-04',1),('DEL-3','2026-10-05',1);`,
  ordered: true,
  starter: "WITH good AS (\n  SELECT hub, day\n  FROM hub_days\n  WHERE on_time = 1\n)\n-- find runs of consecutive days\n",
  hints: [
    "Within one run of consecutive days, the day number minus the row's position in the run stays constant.",
    "julianday(day) - ROW_NUMBER() OVER (PARTITION BY hub ORDER BY day) gives a group key per run. Count rows per (hub, key), then take the MAX per hub.",
  ],
  solution: `WITH good AS (
  SELECT hub, day,
         julianday(day) - ROW_NUMBER() OVER (PARTITION BY hub ORDER BY day) AS grp
  FROM hub_days
  WHERE on_time = 1
),
runs AS (
  SELECT hub, grp, COUNT(*) AS run_len
  FROM good
  GROUP BY hub, grp
)
SELECT hub, MAX(run_len) AS longest_streak
FROM runs
GROUP BY hub
ORDER BY hub;`,
  explain: {
    approach: "This is the gaps-and-islands technique. Keep only on-time days. Inside a run of consecutive dates, the date and the row number both go up by 1 each step, so date minus row number is constant for the whole run and changes whenever there is a gap. That difference labels each island.",
    steps: [
      "Filter to on_time = 1.",
      "ROW_NUMBER per hub ordered by day: 1, 2, 3…",
      "julianday(day) - row_number is the same for every day in one consecutive run.",
      "GROUP BY hub, grp and COUNT(*) gives each run's length.",
      "MAX per hub gives the longest streak.",
    ],
    trace: `PNQ-2 on-time days:  10-01  10-03  10-05  10-06
row_number:            1      2      3      4
day − row_number:     X−1    X+1    X+2    X+2   → runs of 1, 1 and 2 days → longest 2`,
    pitfalls: [
      "Note PNQ-2 has no row for 10-04. A missing day must break the streak, which is why we use calendar day numbers rather than LAG on the on_time flag.",
      "In PostgreSQL write day - ROW_NUMBER() * INTERVAL '1 day'; in Snowflake DATEADD(day, -ROW_NUMBER() …, day).",
    ],
    real: "Consecutive login streaks, SLA-compliant days, machine uptime runs, and sessionisation all use islands.",
  },
},
{
  id: "tier-at-shipment", concept: "scd", lang: "sql", diff: "Hard", pattern: "Point-in-time join (SCD Type 2)", track: "ar",
  title: "Freight by carrier tier at time of shipment",
  prompt: "`carrier_tiers` is an SCD Type 2 table: each row is valid from `valid_from` (inclusive) to `valid_to` (exclusive); `valid_to` is NULL for the current row.\n\nReturn each `tier` with the total `freight` of shipments, using the tier the carrier had **on the ship date**. Order by tier.",
  setup: `CREATE TABLE carrier_tiers (carrier_id TEXT, tier TEXT, valid_from TEXT, valid_to TEXT);
INSERT INTO carrier_tiers VALUES
('CR1','Bronze','2026-01-01','2026-06-01'),('CR1','Gold','2026-06-01',NULL),
('CR2','Silver','2026-01-01',NULL),
('CR3','Silver','2026-01-01','2026-08-15'),('CR3','Bronze','2026-08-15',NULL);
CREATE TABLE shipments (shipment_id TEXT, carrier_id TEXT, ship_date TEXT, freight REAL);
INSERT INTO shipments VALUES
('S1','CR1','2026-05-20',1000),('S2','CR1','2026-06-01',1500),('S3','CR2','2026-03-10',700),
('S4','CR3','2026-08-14',900),('S5','CR3','2026-08-15',400),('S6','CR1','2026-09-30',600);`,
  ordered: true,
  starter: "SELECT t.tier, SUM(s.freight) AS freight\nFROM shipments s\nJOIN carrier_tiers t\n  ON t.carrier_id = s.carrier_id\n  -- which tier row was valid on ship_date?\nGROUP BY t.tier\nORDER BY t.tier;\n",
  hints: [
    "Join on carrier_id and also on the date falling inside the row's validity window.",
    "ship_date >= valid_from AND (valid_to IS NULL OR ship_date < valid_to).",
  ],
  solution: `SELECT t.tier, SUM(s.freight) AS freight
FROM shipments s
JOIN carrier_tiers t
  ON t.carrier_id = s.carrier_id
 AND s.ship_date >= t.valid_from
 AND (t.valid_to IS NULL OR s.ship_date < t.valid_to)
GROUP BY t.tier
ORDER BY t.tier;`,
  explain: {
    approach: "With SCD Type 2 history, each carrier has several rows. A plain join on carrier_id would match every version and double-count freight. Adding the date condition picks the one version that was true on the ship date.",
    steps: [
      "Match carrier_id as usual.",
      "Require ship_date on or after valid_from.",
      "Require ship_date before valid_to, treating NULL as \"still valid\".",
      "Group by tier and sum freight.",
    ],
    trace: `S2 ships on 2026-06-01: Bronze ends 06-01 (exclusive), Gold starts 06-01 → Gold.
S4 ships 08-14 → Silver; S5 ships 08-15 → Bronze.
Totals: Bronze 1000+400 = 1400, Gold 1500+600 = 2100, Silver 700+900 = 1600.`,
    pitfalls: [
      "Joining on carrier_id alone multiplies rows for carriers with history: S1 would count as both Bronze and Gold.",
      "Mixing inclusive and exclusive ends causes boundary-day double counts. Pick a convention (from inclusive, to exclusive) and stick to it.",
      "Some teams use '9999-12-31' instead of NULL for open rows, which simplifies the condition to BETWEEN-style logic.",
    ],
    real: "This is how facts get the dimension attributes that were true at the time: carrier tier for freight settlement, customer segment at order time, product price on sale date.",
  },
},
{
  id: "m1-retention", concept: "cohort", lang: "sql", diff: "Hard", pattern: "Cohort retention", track: "da",
  title: "Month-1 retention by signup cohort",
  prompt: "For each signup month (`cohort`, as YYYY-MM), return:\n- `users`: how many users signed up that month\n- `retained`: how many of them placed **at least one order in the following calendar month**\n- `retention_pct`: retained ÷ users × 100, rounded to 1 decimal\n\nOrder by cohort.",
  setup: `CREATE TABLE users (user_id INTEGER PRIMARY KEY, signup_date TEXT);
INSERT INTO users VALUES (1,'2026-07-03'),(2,'2026-07-15'),(3,'2026-07-28'),(4,'2026-08-02'),(5,'2026-08-19'),(6,'2026-08-30'),(7,'2026-08-31');
CREATE TABLE orders (order_id INTEGER PRIMARY KEY, user_id INTEGER, order_date TEXT);
INSERT INTO orders VALUES
(1,1,'2026-07-05'),(2,1,'2026-08-10'),(3,2,'2026-09-01'),(4,3,'2026-08-31'),(5,3,'2026-08-31'),
(6,4,'2026-09-12'),(7,5,'2026-08-25'),(8,6,'2026-09-30'),(9,7,'2026-10-01');`,
  ordered: true,
  starter: "WITH cohorts AS (\n  SELECT user_id,\n         strftime('%Y-%m', signup_date) AS cohort,\n         strftime('%Y-%m', date(signup_date, 'start of month', '+1 month')) AS next_month\n  FROM users\n)\n-- count users and those who ordered in next_month\n",
  hints: [
    "Compute each user's cohort and the month after it, then check whether any order falls in that next month.",
    "Use a LEFT JOIN (or EXISTS) to orders on user_id and strftime('%Y-%m', order_date) = next_month. Count DISTINCT user_ids, because a user may order twice.",
  ],
  solution: `WITH cohorts AS (
  SELECT user_id,
         strftime('%Y-%m', signup_date) AS cohort,
         strftime('%Y-%m', date(signup_date, 'start of month', '+1 month')) AS next_month
  FROM users
)
SELECT c.cohort,
       COUNT(DISTINCT c.user_id) AS users,
       COUNT(DISTINCT o.user_id) AS retained,
       ROUND(100.0 * COUNT(DISTINCT o.user_id) / COUNT(DISTINCT c.user_id), 1) AS retention_pct
FROM cohorts c
LEFT JOIN orders o
  ON o.user_id = c.user_id
 AND strftime('%Y-%m', o.order_date) = c.next_month
GROUP BY c.cohort
ORDER BY c.cohort;`,
  explain: {
    approach: "Label each user with their cohort month and the month after it. A LEFT JOIN keeps every user, attaching only orders from that next month. COUNT(DISTINCT c.user_id) is the cohort size; COUNT(DISTINCT o.user_id) counts only users who matched, because unmatched users contribute NULL.",
    steps: [
      "strftime('%Y-%m', signup_date) gives the cohort.",
      "date(signup_date, 'start of month', '+1 month') gives the first day of the next month, formatted as YYYY-MM.",
      "LEFT JOIN orders with the month condition in ON, so users without such orders stay in the count.",
      "COUNT(DISTINCT …) avoids double-counting users with several orders (user 3 ordered twice).",
      "Multiply by 100.0 to avoid integer division, then ROUND.",
    ],
    trace: `July cohort: users 1, 2, 3. August orders from 1 (08-10) and 3 (08-31) → 2 of 3 = 66.7%.
User 2's order is in September, which is month 2, so it doesn't count.
August cohort: 4, 5, 6, 7. September orders from 4 and 6 → 2 of 4 = 50.0%.`,
    pitfalls: [
      "Putting the month condition in WHERE removes non-retained users entirely, so the cohort size shrinks.",
      "Adding 30 days instead of moving to the next calendar month breaks for signups at the end of a month.",
      "COUNT(*) instead of COUNT(DISTINCT) inflates retention when users order more than once.",
    ],
    real: "Cohort retention is the core metric for D2C, food delivery and fintech apps. Interviewers ask for exactly this query.",
  },
},

/* ------------------------------------------------------------- Python */
{
  id: "merge-windows", concept: "python-for-de", lang: "python", diff: "Easy", pattern: "Interval merging", track: "de",
  entry: "merge_windows",
  tests: [
    {"name": "Example", "call": "merge_windows([(540, 600), (590, 660), (720, 780), (780, 800), (900, 930)])"},
    {"name": "Empty list", "call": "merge_windows([])"},
    {"name": "Unsorted input", "hidden": true, "call": "merge_windows([(900, 930), (540, 600), (590, 660)])"},
    {"name": "Window inside another", "hidden": true, "call": "merge_windows([(540, 700), (550, 560), (690, 720)])"},
    {"name": "Single window", "hidden": true, "call": "merge_windows([(60, 120)])"},
    {"name": "Touching edges merge", "hidden": true, "call": "merge_windows([(0, 10), (10, 20), (21, 30)])"}
  ],
  title: "Merge overlapping delivery slots",
  prompt: "A route planner receives delivery time windows as `(start, end)` pairs in minutes since midnight. Windows that overlap or touch should be merged.\n\nWrite `merge_windows(windows)` returning the merged list sorted by start.",
  example: `merge_windows([(540, 600), (590, 660), (720, 780), (780, 800), (900, 930)])
# → [(540, 660), (720, 800), (900, 930)]

merge_windows([])           # → []
merge_windows([(60, 120)])  # → [(60, 120)]`,
  starter: "def merge_windows(windows):\n    # windows: list of (start, end) tuples\n    pass\n",
  hints: [
    "Sort by start time first. Then each window can only overlap the one you merged last.",
    "Walk the sorted list. If start <= last_end, extend last_end to max(last_end, end); otherwise start a new window.",
  ],
  solution: `def merge_windows(windows):
    if not windows:
        return []
    windows = sorted(windows)               # sort by start, then end
    merged = [list(windows[0])]
    for start, end in windows[1:]:
        last = merged[-1]
        if start <= last[1]:                # overlaps or touches
            last[1] = max(last[1], end)     # extend, never shrink
        else:
            merged.append([start, end])
    return [tuple(w) for w in merged]`,
  explain: {
    approach: "Once windows are sorted by start, overlaps can only happen with the most recently merged window, so one pass is enough.",
    steps: [
      "Handle the empty list.",
      "Sort the windows.",
      "Keep a list of merged windows; compare each new window with the last merged one.",
      "Overlapping or touching (start <= last end): extend the end with max().",
      "Otherwise: start a new merged window.",
    ],
    complexity: "O(n log n) time for the sort, O(n) extra space.",
    pitfalls: [
      "Using last[1] = end instead of max(...) shrinks the window when a short window sits inside a long one, e.g. (540, 700) then (550, 560).",
      "Mutating the caller's list with windows.sort() can surprise callers. sorted() returns a new list.",
    ],
    real: "Merging time windows shows up in route planning, calendar availability, combining overlapping SCD validity ranges, and computing machine downtime.",
  },
},
{
  id: "stream-dedup", concept: "idempotency", lang: "python", diff: "Medium", pattern: "Sliding window and hashing", track: "de",
  entry: "dedup",
  tests: [
    {"name": "Example", "call": "list(dedup([('e1', 0), ('e2', 5), ('e1', 30), ('e3', 400), ('e1', 700), ('e2', 1200)]))"},
    {"name": "Exactly at the window edge", "call": "list(dedup([('a', 0), ('a', 600), ('a', 601)]))"},
    {"name": "Custom window", "hidden": true, "call": "list(dedup([('a', 0), ('a', 50), ('a', 100), ('b', 120)], window=100))"},
    {"name": "Long stream keeps memory bounded", "hidden": true, "setup": "events = [('e%d' % (i % 3), i * 250) for i in range(12)]", "call": "list(dedup(events))"},
    {"name": "No events", "hidden": true, "call": "list(dedup([]))"}
  ],
  title: "Drop duplicates seen in the last 10 minutes",
  prompt: "A payment webhook may deliver the same event more than once. Events arrive in timestamp order as `(event_id, ts)` with ts in seconds.\n\nWrite a generator `dedup(events, window=600)` that yields each event unless the same `event_id` was already yielded **within the previous `window` seconds**. Memory must stay bounded: forget ids older than the window.",
  example: `events = [("e1", 0), ("e2", 5), ("e1", 30), ("e3", 400), ("e1", 700), ("e2", 1200)]
list(dedup(events))
# → [("e1", 0), ("e2", 5), ("e3", 400), ("e1", 700), ("e2", 1200)]
# e1 at 30 is dropped (seen 30 s ago); e1 at 700 is kept (last seen 700 s ago)`,
  starter: "from collections import deque\n\ndef dedup(events, window=600):\n    # yield events that are not repeats within `window` seconds\n    pass\n",
  hints: [
    "Keep a dict of event_id → last time you yielded it, so lookups are O(1).",
    "To bound memory, also keep a deque of (ts, event_id) in arrival order, and pop from the left while the oldest entry is older than ts - window, deleting it from the dict if it is still the latest entry for that id.",
  ],
  solution: `from collections import deque

def dedup(events, window=600):
    last_seen = {}            # event_id -> ts it was last yielded
    order = deque()           # (ts, event_id) in yield order

    for event_id, ts in events:
        # 1. Expire ids that fell out of the window
        while order and order[0][0] <= ts - window:
            old_ts, old_id = order.popleft()
            if last_seen.get(old_id) == old_ts:
                del last_seen[old_id]

        # 2. Drop a repeat that is still inside the window
        if event_id in last_seen:
            continue

        # 3. New (or expired) event: remember it and emit
        last_seen[event_id] = ts
        order.append((ts, event_id))
        yield event_id, ts`,
  explain: {
    approach: "Two structures work together. A dict answers \"have I seen this id recently?\" in O(1). A deque records ids in time order so expired ones can be evicted from the front cheaply, which keeps memory proportional to the number of events in one window rather than the whole stream.",
    steps: [
      "Before handling each event, evict entries whose timestamp is at least `window` seconds old.",
      "The `last_seen.get(old_id) == old_ts` check makes sure you only delete the dict entry if it hasn't been refreshed.",
      "If the id is still in the dict, it's a duplicate within the window: skip it.",
      "Otherwise record it in both structures and yield it.",
    ],
    complexity: "Amortised O(1) per event; memory O(events within one window).",
    pitfalls: [
      "A plain set of every id ever seen grows forever and also drops legitimate repeats from hours later.",
      "Boundary choice: here an id seen exactly 600 s ago is expired (<=). State the convention in an interview.",
      "This assumes ordered timestamps. With out-of-order arrival you would need a watermark and some allowed lateness.",
    ],
    real: "Idempotent consumers for UPI or order webhooks, and stream processors' state with TTL, work exactly like this.",
  },
},
{
  id: "sessionise", concept: "gaps-islands", lang: "pandas", diff: "Medium", pattern: "groupby + diff + cumsum", track: "ds",
  entry: "sessionise",
  tests: [
    {"name": "Example", "setup": "import pandas as pd\ndf = pd.DataFrame({'user_id': [1, 1, 1, 2, 2], 'ts': pd.to_datetime(['2026-10-25 09:00', '2026-10-25 09:20', '2026-10-25 10:05', '2026-10-25 09:10', '2026-10-25 09:39'])})", "call": "sessionise(df)[['user_id', 'ts', 'session_id']]"},
    {"name": "Unsorted input, exactly 30 minutes", "setup": "import pandas as pd\ndf = pd.DataFrame({'user_id': [2, 1, 1, 1], 'ts': pd.to_datetime(['2026-10-25 08:00', '2026-10-25 09:30', '2026-10-25 09:00', '2026-10-25 10:01'])})", "call": "sessionise(df)[['user_id', 'ts', 'session_id']]"},
    {"name": "Many users interleaved", "hidden": true, "setup": "import pandas as pd\nts = pd.to_datetime(['2026-10-25 09:00','2026-10-25 09:05','2026-10-25 09:50','2026-10-25 09:55','2026-10-25 11:00','2026-10-25 11:20'])\ndf = pd.DataFrame({'user_id': [3, 4, 3, 4, 3, 4], 'ts': ts})", "call": "sessionise(df)[['user_id', 'ts', 'session_id']]"},
    {"name": "Single event", "hidden": true, "setup": "import pandas as pd\ndf = pd.DataFrame({'user_id': [9], 'ts': pd.to_datetime(['2026-10-25 12:00'])})", "call": "sessionise(df)[['user_id', 'ts', 'session_id']]"}
  ],
  title: "Sessionise app clickstream",
  prompt: "Given a DataFrame `df` with columns `user_id` and `ts` (datetime), assign a `session_id` to each row. A new session starts on a user's first event, or when **more than 30 minutes** pass since that user's previous event.\n\nSession ids should be numbered 1, 2, 3… **per user**. Return the DataFrame sorted by user_id and ts.",
  example: `user_id  ts                  session_id
1        2026-10-25 09:00    1
1        2026-10-25 09:20    1
1        2026-10-25 10:05    2     # 45 min gap
2        2026-10-25 09:10    1
2        2026-10-25 09:39    1     # 29 min gap, same session`,
  starter: "import pandas as pd\n\ndef sessionise(df: pd.DataFrame) -> pd.DataFrame:\n    df = df.sort_values(['user_id', 'ts']).copy()\n    # your code here\n    return df\n",
  hints: [
    "Compute the time since each user's previous event with groupby('user_id')['ts'].diff().",
    "Mark a new session where the gap is NaT (first event) or > 30 minutes, then cumulative-sum that flag within each user.",
  ],
  solution: `import pandas as pd

def sessionise(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["user_id", "ts"]).copy()

    gap = df.groupby("user_id")["ts"].diff()                   # NaT on each user's first row
    new_session = gap.isna() | (gap > pd.Timedelta(minutes=30))

    df["session_id"] = new_session.astype(int).groupby(df["user_id"]).cumsum()
    return df`,
  explain: {
    approach: "Turn \"start a new session\" into a 0/1 flag, then a running count of flags within each user is the session number. It's fully vectorised, so it scales to millions of rows without Python loops.",
    steps: [
      "Sort by user and time: diff() depends on order.",
      "groupby('user_id')['ts'].diff() is the gap to the user's previous event (NaT for the first).",
      "new_session is True for first events and gaps over 30 minutes.",
      "Cumulative sum of the flag per user gives 1, 1, 2, … .",
    ],
    complexity: "O(n log n) for the sort, then O(n).",
    pitfalls: [
      "Calling diff() without groupby leaks gaps across users.",
      "Using cumsum() without groupby numbers sessions globally instead of per user.",
      "Strictly greater than 30 minutes is the rule here; exactly 30 minutes stays in the same session.",
    ],
    sql: `-- The same logic in SQL
WITH g AS (
  SELECT user_id, ts,
         CASE WHEN LAG(ts) OVER (PARTITION BY user_id ORDER BY ts) IS NULL
                OR (julianday(ts) - julianday(LAG(ts) OVER (PARTITION BY user_id ORDER BY ts))) * 1440 > 30
              THEN 1 ELSE 0 END AS new_session
  FROM clicks
)
SELECT user_id, ts,
       SUM(new_session) OVER (PARTITION BY user_id ORDER BY ts) AS session_id
FROM g;`,
    real: "Sessionisation feeds funnel analysis, engagement metrics and feature engineering for churn models.",
  },
},
{
  id: "top-skus-spark", concept: "window-functions", lang: "pyspark", diff: "Medium", pattern: "Window functions in Spark", track: "de",
  entry: "top_skus",
  tests: [
    {"name": "Example warehouse with ties", "setup": "picks = spark.createDataFrame([('BLR-1','SKU-101',500,'2026-10-03'),('BLR-1','SKU-101',440,'2026-10-20'),('BLR-1','SKU-220',610,'2026-10-05'),('BLR-1','SKU-087',610,'2026-10-09'),('BLR-1','SKU-310',455,'2026-10-11'),('BLR-1','SKU-999',100,'2026-10-12')], ['warehouse','sku','units','pick_date'])", "call": "top_skus(picks)"},
    {"name": "September and November excluded", "setup": "picks = spark.createDataFrame([('PNQ-2','SKU-1',900,'2026-09-30'),('PNQ-2','SKU-2',50,'2026-10-01'),('PNQ-2','SKU-3',70,'2026-10-31'),('PNQ-2','SKU-1',10,'2026-11-01')], ['warehouse','sku','units','pick_date'])", "call": "top_skus(picks)"},
    {"name": "Two warehouses", "hidden": true, "setup": "picks = spark.createDataFrame([('A','x',5,'2026-10-02'),('A','y',7,'2026-10-02'),('A','z',7,'2026-10-03'),('A','w',1,'2026-10-04'),('A','v',3,'2026-10-04'),('B','x',2,'2026-10-05')], ['warehouse','sku','units','pick_date'])", "call": "top_skus(picks)"},
    {"name": "Several days per SKU add up", "hidden": true, "setup": "picks = spark.createDataFrame([('C','a',1,'2026-10-01'),('C','a',1,'2026-10-02'),('C','a',1,'2026-10-03'),('C','b',2,'2026-10-01'),('C','c',2,'2026-10-02'),('C','d',1,'2026-10-02')], ['warehouse','sku','units','pick_date'])", "call": "top_skus(picks)"}
  ],
  title: "Top 3 SKUs per warehouse in PySpark",
  prompt: "`picks` is a Spark DataFrame with columns `warehouse`, `sku`, `units`, `pick_date`.\n\nFor **October 2026**, return the top 3 SKUs per warehouse by total units, keeping ties, with columns `warehouse`, `sku`, `total_units`, `rnk`.",
  example: `+---------+--------+-----------+---+
|warehouse|sku     |total_units|rnk|
+---------+--------+-----------+---+
|BLR-1    |SKU-101 |940        |1  |
|BLR-1    |SKU-220 |610        |2  |
|BLR-1    |SKU-087 |610        |2  |
|BLR-1    |SKU-310 |455        |3  |
...`,
  starter: "from pyspark.sql import functions as F\nfrom pyspark.sql.window import Window\n\ndef top_skus(picks):\n    # filter October, aggregate, rank within warehouse, keep top 3\n    pass\n",
  hints: [
    "Filter by date and aggregate first; rank on the aggregated (much smaller) data.",
    "Window.partitionBy('warehouse').orderBy(F.desc('total_units')) with F.dense_rank(), then filter rnk <= 3.",
  ],
  solution: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

def top_skus(picks):
    october = picks.filter(
        (F.col("pick_date") >= "2026-10-01") & (F.col("pick_date") < "2026-11-01")
    )

    totals = october.groupBy("warehouse", "sku").agg(F.sum("units").alias("total_units"))

    w = Window.partitionBy("warehouse").orderBy(F.desc("total_units"))

    return (totals
            .withColumn("rnk", F.dense_rank().over(w))
            .filter(F.col("rnk") <= 3)
            .orderBy("warehouse", "rnk", "sku"))`,
  explain: {
    approach: "Same shape as top-N in SQL, written with the DataFrame API. The performance point interviewers look for: filter and aggregate before the window, so the window's shuffle and sort run on one row per warehouse-SKU instead of every pick.",
    steps: [
      "Filter to October with a half-open date range, which works for both date and timestamp columns.",
      "groupBy warehouse and sku, summing units.",
      "Define a window partitioned by warehouse, ordered by total_units descending.",
      "dense_rank keeps ties; filter rnk <= 3.",
    ],
    complexity: "Two shuffles: one for the groupBy, one for the window partitioning. Both run on reduced data.",
    pitfalls: [
      "row_number would silently drop tied SKUs.",
      "A window with no partitionBy pulls all data onto one executor, and Spark warns about exactly that.",
      "If one warehouse dominates the data, the window partition for it can be skewed; aggregating first mostly solves it.",
    ],
    sql: `-- Spark SQL equivalent
SELECT * FROM (
  SELECT warehouse, sku, SUM(units) AS total_units,
         DENSE_RANK() OVER (PARTITION BY warehouse ORDER BY SUM(units) DESC) AS rnk
  FROM picks
  WHERE pick_date >= '2026-10-01' AND pick_date < '2026-11-01'
  GROUP BY warehouse, sku
) WHERE rnk <= 3;`,
    real: "Slotting decisions in warehouses (fast movers near the dock) are driven by exactly this ranking.",
  },
},
{
  id: "watermark-upsert", concept: "incremental-loads", lang: "python", diff: "Hard", pattern: "Idempotent incremental load", track: "de",
  entry: "apply_batch",
  tests: [
    {"name": "Example", "setup": "target = {'C1': {'key': 'C1', 'city': 'Pune', 'updated_at': '2026-10-20T10:00'}}\nbatch = [{'key': 'C1', 'city': 'Mumbai', 'updated_at': '2026-10-21T09:00'}, {'key': 'C1', 'city': 'Nagpur', 'updated_at': '2026-10-21T08:00'}, {'key': 'C2', 'city': 'Chennai', 'updated_at': '2026-10-21T07:30'}]", "call": "apply_batch(target, batch, '2026-10-20T12:00')", "observe": "(result, target)"},
    {"name": "Replay leaves target unchanged", "setup": "target = {'C1': {'key': 'C1', 'city': 'Mumbai', 'updated_at': '2026-10-21T09:00'}}\nbatch = [{'key': 'C1', 'city': 'Mumbai', 'updated_at': '2026-10-21T09:00'}]", "call": "apply_batch(target, batch, '2026-10-21T09:00')", "observe": "(result, target)"},
    {"name": "Older than target is ignored", "hidden": true, "setup": "target = {'K': {'key': 'K', 'city': 'Goa', 'updated_at': '2026-10-22T10:00'}}\nbatch = [{'key': 'K', 'city': 'Agra', 'updated_at': '2026-10-21T10:00'}]", "call": "apply_batch(target, batch, '2026-10-01T00:00')", "observe": "(result, target)"},
    {"name": "Empty batch", "hidden": true, "setup": "target = {}\nbatch = []", "call": "apply_batch(target, batch, '2026-10-01T00:00')", "observe": "(result, target)"},
    {"name": "Caller's rows are not aliased", "hidden": true, "setup": "target = {}\nbatch = [{'key': 'Z', 'city': 'Kochi', 'updated_at': '2026-10-23T10:00'}]", "call": "apply_batch(target, batch, '2026-10-01T00:00')", "observe": "(result, target, batch[0].update({'city': 'Changed'}), target['Z']['city'])"}
  ],
  title: "Idempotent upsert with a watermark",
  prompt: "You maintain a target table as a dict `{key: row}`, where each row has an `updated_at` (ISO string). A batch of changed rows arrives from the source; batches can be **replayed** and can contain **several versions of the same key**.\n\nWrite `apply_batch(target, batch, watermark)` that:\n1. ignores rows with `updated_at <= watermark` (already processed),\n2. for each key keeps only the newest version in the batch,\n3. upserts it only if it is newer than what the target already holds,\n4. returns the new watermark (max updated_at applied, or the old one).\n\nRunning the same batch twice must leave the target unchanged.",
  example: `target = {"C1": {"key": "C1", "city": "Pune", "updated_at": "2026-10-20T10:00"}}
batch = [
  {"key": "C1", "city": "Mumbai",  "updated_at": "2026-10-21T09:00"},
  {"key": "C1", "city": "Nagpur",  "updated_at": "2026-10-21T08:00"},   # older version
  {"key": "C2", "city": "Chennai", "updated_at": "2026-10-21T07:30"},
]
wm = apply_batch(target, batch, "2026-10-20T12:00")
# target["C1"]["city"] == "Mumbai"; target["C2"] added; wm == "2026-10-21T09:00"
apply_batch(target, batch, wm)   # replay: no changes, returns the same watermark`,
  starter: "def apply_batch(target, batch, watermark):\n    # target: dict key -> row; batch: list of rows; watermark: ISO string\n    pass\n",
  hints: [
    "First collapse the batch to the latest version per key, skipping anything at or below the watermark.",
    "Then compare each candidate with target.get(key) and only write if it is newer. Track the max updated_at you actually saw.",
  ],
  solution: `def apply_batch(target, batch, watermark):
    # 1 + 2: newest version per key, ignoring already-processed rows
    latest = {}
    for row in batch:
        ts = row["updated_at"]
        if ts <= watermark:
            continue
        current = latest.get(row["key"])
        if current is None or ts > current["updated_at"]:
            latest[row["key"]] = row

    # 3: upsert only if newer than the target's copy
    new_watermark = watermark
    for key, row in latest.items():
        existing = target.get(key)
        if existing is None or row["updated_at"] > existing["updated_at"]:
            target[key] = dict(row)          # copy, don't alias the batch row
        new_watermark = max(new_watermark, row["updated_at"])

    # 4: the caller stores this for the next run
    return new_watermark`,
  explain: {
    approach: "Idempotency comes from comparing versions instead of trusting arrival order. Every write is \"only if newer\", so replays, duplicates and out-of-order versions inside a batch cannot move the target backwards.",
    steps: [
      "Skip rows at or below the watermark: a replayed batch is filtered out at this step.",
      "Collapse multiple versions of a key to the newest, so Nagpur (08:00) never overwrites Mumbai (09:00).",
      "Write to the target only when the candidate is newer than the existing row.",
      "Advance the watermark to the newest timestamp seen and return it, to be saved only after the writes succeed.",
    ],
    complexity: "O(n) for a batch of n rows.",
    pitfalls: [
      "Saving the new watermark before the writes commit loses data if the job crashes in between.",
      "ISO strings compare correctly only when they share a format and time zone. In real pipelines, compare timestamps or LSNs.",
      "A strict > watermark filter can miss rows that share the exact watermark timestamp but arrived late. Many teams re-read a small overlap and rely on the idempotent upsert to absorb it.",
    ],
    sql: `-- The warehouse version of the same idea
MERGE INTO dim_customer t
USING (
  SELECT * FROM (
    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY key ORDER BY updated_at DESC) AS rn
    FROM staging_customer s
    WHERE updated_at > :watermark
  ) WHERE rn = 1
) s
ON t.key = s.key
WHEN MATCHED AND s.updated_at > t.updated_at THEN UPDATE SET city = s.city, updated_at = s.updated_at
WHEN NOT MATCHED THEN INSERT (key, city, updated_at) VALUES (s.key, s.city, s.updated_at);`,
    real: "Every CDC or incremental ETL load needs this. It's also a favourite senior data engineering interview question.",
  },
},
];

const PRACTICE_LINKS = [
  { label: "LeetCode Top SQL 50", url: "https://leetcode.com/studyplan/top-sql-50/" },
  { label: "LeetCode Introduction to pandas", url: "https://leetcode.com/studyplan/introduction-to-pandas/" },
];
