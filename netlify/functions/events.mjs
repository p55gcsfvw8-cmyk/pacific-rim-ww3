// Verified leaderboard events for FORBID COMMAND (1.0.15): only commanders who own their name and opted in.
// GET /api/v1/events?since=<ms> or ?after=<event id>  -> [{ type: new_leader | top_five | passed_dev, name, nation, score, rank, dev, at, ... }]
import { store, json } from "../lib/shared.mjs";
import { recentEvents } from "../lib/board.mjs";

export default async (req) => {
  if (req.method !== "GET") return json({ error: "method" }, 405);
  const q = new URL(req.url).searchParams, after = q.get("after");
  return json(await recentEvents(store(), Number(q.get("since")) || 0, 50, after && /^[0-9]{15}-[0-9a-z]{4,12}$/.test(after) ? after : null), 200, { "access-control-allow-origin": "*" });
};

export const config = { path: "/api/v1/events", method: ["GET"] };
