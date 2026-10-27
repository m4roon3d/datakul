// A Cloudflare D1 stand-in backed by Node's built-in SQLite, so the gateway's real SQL runs in tests.
import { DatabaseSync } from "node:sqlite";
class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...a) {
    a.forEach((x, i) => { if (x === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound at ${i} in: ${this.sql}`); });
    return new Stmt(this.db, this.sql, a);
  }
  async first(col) { const r = this.db.prepare(this.sql).get(...this.args); return r ? (col ? r[col] : { ...r }) : null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })), success: true }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
}
export class D1Mock {
  constructor() { this.db = new DatabaseSync(":memory:"); }
  async exec(sql) { this.db.exec(sql); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) { return Promise.all(stmts.map((s) => s.run())); }
}
