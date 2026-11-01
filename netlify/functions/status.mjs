// Service status for FORBID COMMAND, the website and anyone checking: is the game up, is its storage reachable,
// and which version is live.
// GET /api/v1/status -> { ok, game, storage, version, checkedAt }
import { store, json } from "../lib/shared.mjs";

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export default async (req) => {
  if (req.method !== "GET") return json({ error: "method" }, 405);
  const out = { ok: false, game: "down", storage: "down", version: null, checkedAt: new Date().toISOString() };
  try {
    const r = await withTimeout(fetch(new URL("/data/v1/meta.json", req.url), { cache: "no-store" }), 4000);
    if (r.ok) { const m = await r.json(); out.game = "up"; out.version = m.version || null; }
  } catch {}
  try { await withTimeout(store().get("health/ping"), 4000); out.storage = "up"; } catch {}
  out.ok = out.game === "up" && out.storage === "up";
  return json(out, out.ok ? 200 : 503, { "access-control-allow-origin": "*" });
};

export const config = { path: "/api/v1/status", method: ["GET"] };
