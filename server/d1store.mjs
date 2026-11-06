// The online services' storage on Cloudflare: one D1 (SQLite) table of key -> JSON, with the same
// get / setJSON / list / delete shape as Netlify Blobs, so the leaderboard and feed logic run unchanged.
export function d1Store(db) {
  let ready = null;
  const init = () => (ready ||= db.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)").run());
  const range = prefix => [prefix, prefix + "￿"];
  return {
    async get(k, o = {}) {
      await init();
      const r = await db.prepare("SELECT v FROM kv WHERE k = ?1").bind(k).first();
      if (!r) return null;
      return o.type === "json" ? JSON.parse(r.v) : r.v;
    },
    async setJSON(k, v, o = {}) {
      await init();
      const s = JSON.stringify(v);
      if (o.onlyIfNew) { const r = await db.prepare("INSERT OR IGNORE INTO kv (k, v) VALUES (?1, ?2)").bind(k, s).run(); return { modified: (r.meta?.changes ?? 0) > 0 }; }
      await db.prepare("INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, s).run();
      return { modified: true };
    },
    async list({ prefix = "" } = {}) {
      await init();
      const r = await db.prepare("SELECT k FROM kv WHERE k >= ?1 AND k < ?2 ORDER BY k").bind(...range(prefix)).all();
      return { blobs: r.results.map(x => ({ key: x.k })) };
    },
    async values(prefix) {
      await init();
      const r = await db.prepare("SELECT v FROM kv WHERE k >= ?1 AND k < ?2 ORDER BY k").bind(...range(prefix)).all();
      return r.results.map(x => { try { return JSON.parse(x.v); } catch { return null; } }).filter(Boolean);
    },
    async delete(k) { await init(); await db.prepare("DELETE FROM kv WHERE k = ?1").bind(k).run(); },
    // 1.0.20: the free plan allows 50 queries per request and a batch counts as one, so bulk work goes through these
    async entries(prefix) {
      await init();
      const r = await db.prepare("SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 ORDER BY k").bind(...range(prefix)).all();
      return r.results.map(x => { try { return [x.k, JSON.parse(x.v)]; } catch { return null; } }).filter(Boolean);
    },
    // writes (set) and deletes (value undefined) all at once, atomically; `clear` prefixes are emptied first
    async writeMany(sets, clear = []) {
      await init();
      const st = [...clear.map(p => db.prepare("DELETE FROM kv WHERE k >= ?1 AND k < ?2").bind(...range(p))),
        ...sets.map(([k, v]) => v === undefined ? db.prepare("DELETE FROM kv WHERE k = ?1").bind(k) : db.prepare("INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, JSON.stringify(v)))];
      for (let i = 0; i < st.length; i += 500) await db.batch(st.slice(i, i + 500));
    },
  };
}
