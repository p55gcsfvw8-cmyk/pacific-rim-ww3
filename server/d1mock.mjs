// A stand-in for Cloudflare D1 in tests and local runs, on Node's built-in SQLite (node:sqlite, Node 22.5+).
import { DatabaseSync } from "node:sqlite";
export function d1Mock(file = ":memory:") {
  const db = new DatabaseSync(file);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: sql => stmt(sql) };
}
