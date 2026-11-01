// Online leaderboard: one row per commander, their best campaign (1.0.15).
// GET  /api/scores?top=N  and  GET /api/v1/leaderboard?top=N  -> ranked commanders (default 20, max 100)
// POST /api/scores        -> submit or update one campaign {gid, name, nation, score, turn, result, vp, v, key, devCode?, announce?}
import { store, json, readBody, logEvent as feedLine } from "../lib/shared.mjs";
import { topBoard, submitScore, int } from "../lib/board.mjs";

const NATION_NAME = { CN: "China", JP: "Japan", KR: "South Korea", KP: "North Korea", TW: "Taiwan", PH: "the Philippines", VN: "Vietnam", TH: "Thailand", MY: "Malaysia", SG: "Singapore", ID: "Indonesia", PG: "Papua New Guinea", AU: "Australia", NZ: "New Zealand", FJ: "Fiji", US: "the United States" };
const env = () => ({ DEV_CODE: Netlify.env.get("DEV_CODE") || "" });

export default async (req) => {
  const s = store();
  if (req.method === "GET") {
    const top = int(new URL(req.url).searchParams.get("top") ?? 20, 1, 100) ?? 20;
    return json(await topBoard(s, top), 200, { "access-control-allow-origin": "*" });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const b = await readBody(req);
  if (!b) return json({ error: "bad body" }, 400);
  const r = await submitScore(s, env(), b);
  const f = r.feed;
  if (f && f.kind === "began") await feedLine(s, `${f.name} began a campaign as ${NATION_NAME[f.nation]}.`);
  if (f && f.kind === "won") await feedLine(s, `${f.name} won the Pacific as ${NATION_NAME[f.nation]} on turn ${f.turn}, scoring ${f.score.toLocaleString("en")}!`);
  if (f && f.kind === "fell") await feedLine(s, `${f.name}'s ${NATION_NAME[f.nation]} fell on turn ${f.turn}, scoring ${f.score.toLocaleString("en")}.`);
  return json(r.body, r.status);
};

export const config = { path: ["/api/scores", "/api/v1/leaderboard"], method: ["GET", "POST"] };
