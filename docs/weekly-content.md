# Weekly library update

A scheduled Claude task runs this every Monday morning (India time). It adds about 10 reviewed topics a week to the
library and opens one pull request. Ramanaa reads it and says "Merge"; the merge deploys it. Nothing is merged
automatically.

## What goes in a week

1. **Up to 10 topics** from `content/queue.txt`, in order, skipping any already in the library
   (`status: "existing"` in `content/syllabus.json`).
2. **Up to 2 of those slots** may instead go to:
   - a **timely topic**: something that changed in data tools, platforms or careers in the last few weeks and that a learner
     would be asked about (a major release, a renamed or retired service, a new certification). Add it to
     `content/syllabus.txt` under the module it belongs to before writing it.
   - a **fix** to an existing card that is now wrong (a retired product, a renamed service, a changed limit). Edit the
     concept's text in `web/library.js` directly and say what changed and why in the PR.
3. If the queue is empty, write timely topics only and propose the next wave of topics in the PR description.

## Exam questions (until the Databricks bank reaches 300)

Also add **20 new Databricks Data Engineer Associate questions** a week to `content/certs/databricks_dea.py`, spread across the 7 sections roughly in the exam's weights, favouring sections with the fewest questions. Rules:

- Original questions only, written from the public exam guide (linked in the file) and Databricks documentation. Never use or ask for real exam questions.
- One clearly right answer (or exactly the number the question says to choose, with "(Choose two.)" in the text), and wrong options that are plausible, not silly.
- An explanation of 1–3 sentences that says why the answer is right and, where useful, why a tempting option is wrong.
- Check the exam guide's date at the top of the Databricks certification page; if a newer guide exists, update the sections and weights and say so in the PR.
- Run `python3 content/certs/databricks_dea.py && node content/build_certs.mjs` until it passes, and commit `web/certs.js` with it.

## Research

- Look up anything that changes over time before writing it: product names, versions, limits, prices, exam codes, rules.
  Use primary sources (vendor docs, release notes, regulators). Put the sources in the PR description.
- Keep Indian context where it is real (RBI, NPCI, FIU-IND, DPDP, Indian employers and salaries) and say "for example"
  rather than inventing specifics.
- If a fact is uncertain, leave it out or keep it general.

## Writing

Follow `content/batches/batch14.py` as the model.

- Plain British English, short sentences, no em dashes, no hype.
- Fields and lengths (the validator enforces them): summary `s` 60–330 characters, details `d` 250–1000, example `e`
  60–400 (concrete, with numbers), check question `c` 30–260, interview angle `i` 60–300, search keywords `kw` 30–260,
  exactly 3 related topic ids `r`.
- Two interview questions per topic, 3–5 key points each. Keywords must be specific to their point (never data, use,
  good, best, first, then, scale, team, tool) and the model answer `a` must earn every point under the app's grader.
- One `searchChecks` phrase per topic: how a learner would really ask about it.

## Steps

```bash
git checkout -b content/week-YYYY-MM-DD origin/main
cd content/batches && python3 batchNN.py && cd ../..        # next free batch number
node content/validate_batch.js content/batches/batchNN.json  # fix and repeat until PASSED
# set "added": "YYYY-MM-DD" (today, India time) in batchNN.json, then:
node content/merge_batch.js content/batches/batchNN.json
python3 content/build_syllabus.py
node --no-warnings tests/gateway.mjs && node --no-warnings tests/layer2.mjs
```

Commit the batch `.py` and `.json`, `web/library.js`, `content/syllabus.txt` and `content/syllabus.json`. Open a PR titled
"Library: week of DD Mon YYYY (N new topics)" listing each topic with its track, any fixes, and the sources. Do not merge.

## Afterwards

The app shows new topics for three weeks under "New in the library" on the Quests home and in the Library, using the
`nw` date that `merge_batch.js` adds.
