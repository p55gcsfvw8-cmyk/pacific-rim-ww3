// Online leaderboard.
// GET  /api/scores?top=N  -> top N campaigns by score (default 20, max 100)
// POST /api/scores        -> submit or update one campaign's score {gid, name, nation, score, turn, result, vp, v}
import { store, cleanName, cleanId, int, json, readBody, readAll, logEvent, NATIONS, RESULTS } from "../lib/shared.mjs";

const NATION_NAME = { CN: "China", JP: "Japan", KR: "South Korea", KP: "North Korea", TW: "Taiwan", PH: "the Philippines", VN: "Vietnam", TH: "Thailand", MY: "Malaysia", SG: "Singapore", ID: "Indonesia", PG: "Papua New Guinea", AU: "Australia", NZ: "New Zealand", FJ: "Fiji", US: "the United States" };

export default async (req) => {
  const s = store();
  if (req.method === "GET") {
    const top = int(new URL(req.url).searchParams.get("top") ?? 20, 1, 100) ?? 20;
    const { blobs } = await s.list({ prefix: "scores/" });
    const all = await readAll(s, blobs.map(b => b.key));
    all.sort((a, b) => b.score - a.score || a.at - b.at);
    return json(all.slice(0, top).map(({ gid, name, nation, score, turn, result, vp, at }) => ({ gid, name, nation, score, turn, result, vp, at })));
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const b = await readBody(req);
  if (!b) return json({ error: "bad body" }, 400);
  const gid = cleanId(b.gid), name = cleanName(b.name), nation = NATIONS.includes(b.nation) ? b.nation : null;
  const score = int(b.score, 0, 60000), turn = int(b.turn, 1, 2000), vp = int(b.vp ?? 0, 0, 100);
  const result = RESULTS.includes(b.result) ? b.result : null;
  if (!gid || !name || !nation || score == null || turn == null || !result) return json({ error: "invalid entry" }, 400);
  const key = `scores/${gid}`, prev = await s.get(key, { type: "json" }).catch(() => null);
  if (prev && prev.final) return json({ ok: true, kept: "final" });                 // a finished campaign can't be rewritten
  if (prev && (prev.name !== name || prev.nation !== nation)) return json({ error: "campaign mismatch" }, 409);
  if (prev && turn < prev.turn) return json({ ok: true, kept: "newer" });
  const final = result !== "In progress";
  await s.setJSON(key, { gid, name, nation, score, turn, result, vp, final, at: Date.now(), v: String(b.v ?? "").slice(0, 16) });
  if (!prev) await logEvent(s, `${name} began a campaign as ${NATION_NAME[nation]}.`);
  if (final) await logEvent(s, result === "Victory" ? `${name} won the Pacific as ${NATION_NAME[nation]} on turn ${turn}, scoring ${score.toLocaleString("en")}!` : `${name}'s ${NATION_NAME[nation]} fell on turn ${turn}, scoring ${score.toLocaleString("en")}.`);
  return json({ ok: true });
};

export const config = { path: "/api/scores", method: ["GET", "POST"] };
