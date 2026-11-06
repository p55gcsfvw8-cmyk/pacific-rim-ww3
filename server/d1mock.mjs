// A stand-in for Cloudflare D1 in tests and local runs, on Node's built-in SQLite (node:sqlite, Node 22.5+).
import { DatabaseSync } from "node:sqlite";
// `limit` mimics the free plan's 50 queries per Worker invocation (a batch counts as one): call `newRequest()` per request.
export function d1Mock(file = ":memory:", limit = Infinity) {
  const db = new DatabaseSync(file);
  const mock = { queries: 0, max: 0, newRequest() { mock.queries = 0; } };
  const count = () => { if (++mock.queries > limit) throw new Error("D1: too many queries in one invocation"); mock.max = Math.max(mock.max, mock.queries); };
  const exec = (sql, args, how) => { const p = db.prepare(sql); if (how === "first") return p.get(...args) ?? null; if (how === "all") return { results: p.all(...args) }; const r = p.run(...args); return { meta: { changes: Number(r.changes) } }; };
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => { count(); return exec(sql, args, "first"); },
    all: async () => { count(); return exec(sql, args, "all"); },
    run: async () => { count(); return exec(sql, args, "run"); },
  });
  mock.prepare = sql => stmt(sql);
  mock.batch = async list => { count(); db.exec("BEGIN"); try { const out = list.map(x => exec(x.sql, x.args, /^\s*select/i.test(x.sql) ? "all" : "run")); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  return mock;
}
