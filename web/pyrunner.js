/* Datakul Python runner: Pyodide (CPython compiled to WebAssembly) in a Web Worker.
   The worker keeps the page responsive and can be terminated if learner code loops forever.
   harness.py runs each test against the learner's code and the reference; pyspark_lite.py
   provides the PySpark DataFrame API on top of pandas. */
"use strict";

const PYODIDE_BASE = (window.DATAKUL_CONFIG && window.DATAKUL_CONFIG.pyodideUrl) || "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const PY_TIMEOUT_MS = 15000;

const PY_WORKER_SRC = `
let py = null;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      importScripts(m.base + "pyodide.js");
      py = await loadPyodide({ indexURL: m.base });
      py.FS.writeFile("/home/pyodide/harness.py", m.harness);
      py.FS.writeFile("/home/pyodide/pyspark_lite.py", m.spark);
      py.runPython("import sys; sys.path.insert(0, '/home/pyodide'); import harness");
      self.postMessage({ type: "ready" });
    } else if (m.type === "pandas") {
      await py.loadPackage("pandas");
      self.postMessage({ type: "pandasReady" });
    } else if (m.type === "run") {
      py.globals.set("_dp_payload", m.payload);
      const out = py.runPython("harness.run(_dp_payload)");
      self.postMessage({ type: "result", id: m.id, out });
    }
  } catch (err) {
    self.postMessage({ type: m.type === "run" ? "result" : m.type + "Error", id: m.id, error: String((err && err.message) || err) });
  }
};`;

const PY = { worker: null, ready: null, pandas: null, seq: 0, waits: {} };

/* A page or test can supply its own runner: window.DATAKUL_PY_RUNNER = async (payloadJson) => resultJson */
function pyAvailable() {
  if (window.DATAKUL_PY_RUNNER) return true;
  return !window.DATAKUL_PREVIEW && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

function pyReset() {
  if (PY.worker) PY.worker.terminate();
  Object.values(PY.waits).forEach((w) => w.reject(new Error("Python was restarted.")));
  Object.assign(PY, { worker: null, ready: null, pandas: null, waits: {} });
}

function pyStart() {
  if (window.DATAKUL_PY_RUNNER) return Promise.resolve();
  if (PY.ready) return PY.ready;
  PY.ready = (async () => {
    const [harness, spark] = await Promise.all(["py/harness.py", "py/pyspark_lite.py"].map((u) =>
      fetch(u).then((r) => { if (!r.ok) throw new Error("Couldn't load " + u); return r.text(); })));
    const w = new Worker(URL.createObjectURL(new Blob([PY_WORKER_SRC], { type: "text/javascript" })));
    PY.worker = w;
    w.onmessage = (e) => {
      const m = e.data;
      const key = m.type === "result" ? "run" + m.id : m.type.replace(/Error$/, "").replace(/Ready$/, "").replace("ready", "init");
      const wait = PY.waits[key];
      if (!wait) return;
      delete PY.waits[key];
      if (m.error) wait.reject(new Error(m.error)); else wait.resolve(m.out);
    };
    w.onerror = (e) => { Object.values(PY.waits).forEach((x) => x.reject(new Error(e.message || "Python worker failed"))); PY.waits = {}; };
    await new Promise((resolve, reject) => {
      PY.waits.init = { resolve, reject };
      w.postMessage({ type: "init", base: PYODIDE_BASE, harness, spark });
    });
  })();
  PY.ready.catch(() => pyReset());
  return PY.ready;
}

function pyPandas() {
  if (window.DATAKUL_PY_RUNNER) return Promise.resolve();
  if (PY.pandas) return PY.pandas;
  PY.pandas = pyStart().then(() => new Promise((resolve, reject) => {
    PY.waits.pandas = { resolve, reject };
    PY.worker.postMessage({ type: "pandas" });
  }));
  PY.pandas.catch(() => { PY.pandas = null; });
  return PY.pandas;
}

/* Runs the harness. payload: {lang, entry, ordered, code, reference, tests}. Resolves {tests, error}. */
async function pyRun(payload, onStatus = () => {}) {
  const needsPandas = payload.lang === "pandas" || payload.lang === "pyspark";
  if (window.DATAKUL_PY_RUNNER) return JSON.parse(await window.DATAKUL_PY_RUNNER(JSON.stringify(payload)));
  if (!PY.ready) onStatus("Starting Python in your browser. The first time downloads about 10 MB, then it's cached.");
  await pyStart();
  if (needsPandas && !PY.pandas) onStatus(payload.lang === "pyspark" ? "Loading pandas and the PySpark engine (first time only)…" : "Loading pandas (first time only)…");
  if (needsPandas) await pyPandas();
  onStatus("Running tests…");
  const id = ++PY.seq;
  const out = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Your code ran for more than ${PY_TIMEOUT_MS / 1000} seconds, so it was stopped. Check for an infinite loop.`));
      pyReset();
    }, PY_TIMEOUT_MS);
    PY.waits["run" + id] = { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } };
    PY.worker.postMessage({ type: "run", id, payload: JSON.stringify(payload) });
  });
  return JSON.parse(out);
}
