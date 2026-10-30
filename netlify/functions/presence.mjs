// Players online and the activity log.
// POST /api/presence  -> heartbeat {did, name, nation, turn, view} every minute while the game is open
// GET  /api/presence  -> { online: [...], feed: [...] }
import { store, cleanName, cleanId, int, json, readBody, logEvent, recentFeed, NATIONS, ONLINE_MS } from "../lib/shared.mjs";

export default async (req) => {
  const s = store();
  if (req.method === "POST") {
    const b = await readBody(req);
    const did = b && cleanId(b.did);
    if (!did) return json({ error: "invalid" }, 400);
    const name = cleanName(b.name) || "A commander";
    const nation = NATIONS.includes(b.nation) ? b.nation : null;
    const key = `presence/${did}`, prev = await s.get(key, { type: "json" }).catch(() => null);
    await s.setJSON(key, { name, nation, turn: int(b.turn, 1, 2000), view: b.view === "game" ? "game" : "menu", at: Date.now() });
    if (!prev || Date.now() - prev.at > 30 * 60 * 1000) await logEvent(s, `${name} came online.`);
    return json({ ok: true });
  }
  if (req.method !== "GET") return json({ error: "method" }, 405);
  const { blobs } = await s.list({ prefix: "presence/" });
  const keys = blobs.map(b => b.key);
  const rows = await Promise.all(keys.map(k => s.get(k, { type: "json" }).catch(() => null)));
  const now = Date.now();
  const online = rows.filter(p => p && now - p.at < ONLINE_MS).sort((a, b) => b.at - a.at).slice(0, 50);
  // forget devices not seen for a week
  const stale = keys.filter((k, i) => rows[i] && now - rows[i].at > 7 * 864e5).slice(0, 50);
  if (stale.length) await Promise.all(stale.map(k => s.delete(k).catch(() => {})));
  return json({ online: online.map(({ name, nation, turn, view, at }) => ({ name, nation, turn, view, at })), feed: await recentFeed(s, 25) });
};

export const config = { path: "/api/presence", method: ["GET", "POST"] };
