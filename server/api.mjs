// All of the game's online services behind one router (1.0.16, Cloudflare Pages Functions):
//   GET  /api/scores?top=N, /api/v1/leaderboard?top=N   ranked commanders (best campaign each)
//   POST /api/scores                                     submit a campaign's score
//   GET  /api/v1/events?after=<id>                       verified, opt-in leaderboard milestones
//   GET  /api/presence  POST /api/presence               players online and the activity feed
//   GET  /api/v1/status                                  game, storage and live version
//   POST /api/v1/transfer  GET /api/v1/transfer?code=    one-time save transfer from the old site
// `ctx` = { store, env, assets(path) -> Response|null, now? }. Storage logic lives in board.mjs and here.
import { topBoard, submitScore, recentEvents, isDev, cleanName, cleanId, int, NATIONS, slugOf, ensureBest } from "./board.mjs";

export const OLD_ORIGIN = "https://pacific-rim-ww3.netlify.app";
const ONLINE_MS = 150 * 1000;
const NATION_NAME = { CN: "China", JP: "Japan", KR: "South Korea", KP: "North Korea", TW: "Taiwan", PH: "the Philippines", VN: "Vietnam", TH: "Thailand", MY: "Malaysia", SG: "Singapore", ID: "Indonesia", PG: "Papua New Guinea", AU: "Australia", NZ: "New Zealand", FJ: "Fiji", US: "the United States" };

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
const OPEN = { "access-control-allow-origin": "*" };
async function body(req, max = 4000) { try { const t = await req.text(); if (t.length > max) return null; return JSON.parse(t); } catch { return null; } }

// ---------- activity feed ----------
export async function feedLine(s, text) {
  const at = Date.now();
  await s.setJSON(`feed/${String(at).padStart(15, "0")}-${Math.random().toString(36).slice(2, 7)}`, { text: String(text).slice(0, 160), at });
}
async function recentFeed(s, n = 25) {
  const { blobs } = await s.list({ prefix: "feed/" });
  const keys = blobs.map(b => b.key).sort();
  const old = keys.filter(k => Number(k.slice(5, 20)) < Date.now() - 7 * 864e5);
  if (old.length) await Promise.all(old.slice(0, 50).map(k => s.delete(k).catch(() => {})));
  const rows = await Promise.all(keys.slice(-n).map(k => s.get(k, { type: "json" }).catch(() => null)));
  return rows.filter(Boolean).sort((a, b) => b.at - a.at);
}

// ---------- the old site's leaderboard, copied over once ----------
export async function importOldBoard(s, fetcher = fetch, origin = OLD_ORIGIN) {
  if (await s.get("meta/imported-netlify", { type: "json" })) return false;
  const tries = (await s.get("meta/import-tries", { type: "json" })) || 0;
  if (tries >= 20) return false;
  await s.setJSON("meta/import-tries", tries + 1);
  let rows;
  try {
    const r = await Promise.race([fetcher(`${origin}/api/v1/leaderboard?top=100`), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))]);
    if (!r.ok) return false; rows = await r.json();
  } catch { return false; }
  if (!Array.isArray(rows)) return false;
  let n = 0;
  for (const e of rows) {
    const name = cleanName(e.name); if (!name || !NATIONS.includes(e.nation) || !(e.score >= 0)) continue;
    const slug = slugOf(name);
    if (await s.get(`best/${slug}`, { type: "json" })) continue; // someone already posted here
    await s.setJSON(`best/${slug}`, { slug, name, nation: e.nation, score: Math.round(e.score), turn: Math.round(e.turn) || 1, result: e.result || "In progress", vp: e.vp || 0, gid: "imported", at: e.at || Date.now(), campaigns: e.campaigns || 1, claimed: false, dev: false, announce: false, imported: true });
    n++;
  }
  if (!(await s.get("meta/best-v1", { type: "json" }))) await s.setJSON("meta/best-v1", { at: Date.now(), from: "netlify" });
  await s.setJSON("meta/imported-netlify", { at: Date.now(), commanders: n });
  return true;
}

// ---------- save transfer (old site -> new site, one time, 24 hours) ----------
const CHUNK = 500000;
const allowedOrigin = (env, origin) => [OLD_ORIGIN, ...String(env.TRANSFER_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean)].includes(origin);
export async function transferCreate(s, data) {
  if (typeof data !== "string" || !data.length || data.length > 8e6) return null;
  const code = [...crypto.getRandomValues(new Uint8Array(12))].map(b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  const parts = Math.ceil(data.length / CHUNK);
  for (let i = 0; i < parts; i++) await s.setJSON(`transfer/${code}/${i}`, data.slice(i * CHUNK, (i + 1) * CHUNK));
  await s.setJSON(`transfer/${code}/meta`, { parts, at: Date.now() });
  return code;
}
export async function transferClaim(s, code) {
  if (!/^[a-z2-9]{12}$/.test(String(code || ""))) return null;
  const m = await s.get(`transfer/${code}/meta`, { type: "json" });
  if (!m) return null;
  const keys = [`transfer/${code}/meta`, ...Array.from({ length: m.parts }, (_, i) => `transfer/${code}/${i}`)];
  if (Date.now() - m.at > 864e5) { await Promise.all(keys.map(k => s.delete(k).catch(() => {}))); return null; }
  const parts = await Promise.all(keys.slice(1).map(k => s.get(k, { type: "json" })));
  await Promise.all(keys.map(k => s.delete(k).catch(() => {}))); // one use only
  return parts.every(p => typeof p === "string") ? parts.join("") : null;
}

export async function handle(req, ctx) {
  const s = ctx.store, url = new URL(req.url), path = url.pathname.replace(/\/+$/, ""), m = req.method;
  const env = ctx.env || {}, origin = req.headers.get("origin") || "";
  if (m === "OPTIONS") { // preflight: only the transfer accepts cross-site posts
    if (path === "/api/v1/transfer" && allowedOrigin(env, origin)) return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
    return new Response(null, { status: 204 });
  }

  if (path === "/api/scores" || path === "/api/v1/leaderboard") {
    if (ctx.importOld !== false) await importOldBoard(s, ctx.fetch || fetch).catch(() => {});
    if (m === "GET") return json(await topBoard(s, int(url.searchParams.get("top") ?? 20, 1, 100) ?? 20), 200, OPEN);
    if (m !== "POST" || path !== "/api/scores") return json({ error: "method" }, 405);
    const b = await body(req); if (!b) return json({ error: "bad body" }, 400);
    const r = await submitScore(s, { DEV_CODE: env.DEV_CODE || "" }, b), f = r.feed;
    if (f && f.kind === "began") await feedLine(s, `${f.name} began a campaign as ${NATION_NAME[f.nation]}.`);
    if (f && f.kind === "won") await feedLine(s, `${f.name} won the Pacific as ${NATION_NAME[f.nation]} on turn ${f.turn}, scoring ${f.score.toLocaleString("en")}!`);
    if (f && f.kind === "fell") await feedLine(s, `${f.name}'s ${NATION_NAME[f.nation]} fell on turn ${f.turn}, scoring ${f.score.toLocaleString("en")}.`);
    return json(r.body, r.status);
  }

  if (path === "/api/v1/events" && m === "GET") {
    const after = url.searchParams.get("after");
    return json(await recentEvents(s, Number(url.searchParams.get("since")) || 0, 50, after && /^[0-9]{15}-[0-9a-z]{4,12}$/.test(after) ? after : null), 200, OPEN);
  }

  if (path === "/api/presence") {
    if (m === "POST") {
      const b = await body(req), did = b && cleanId(b.did);
      if (!did) return json({ error: "invalid" }, 400);
      const name = cleanName(b.name) || "A commander", nation = NATIONS.includes(b.nation) ? b.nation : null;
      const key = `presence/${did}`, prev = await s.get(key, { type: "json" }).catch(() => null);
      const dev = await isDev(s, name, b.key);
      await s.setJSON(key, { name, nation, turn: int(b.turn, 1, 2000), view: b.view === "game" ? "game" : "menu", at: Date.now(), dev: dev || undefined });
      if (!prev || Date.now() - prev.at > 30 * 60 * 1000) await feedLine(s, `${name} came online.`);
      return json({ ok: true });
    }
    if (m !== "GET") return json({ error: "method" }, 405);
    const rows = s.values ? await s.values("presence/") : await Promise.all((await s.list({ prefix: "presence/" })).blobs.map(x => s.get(x.key, { type: "json" }).catch(() => null)));
    const now = Date.now();
    if (Math.random() < .05) { // now and then, forget devices not seen for a week
      const { blobs } = await s.list({ prefix: "presence/" });
      for (const x of blobs.slice(0, 200)) { const p = await s.get(x.key, { type: "json" }).catch(() => null); if (p && now - p.at > 7 * 864e5) await s.delete(x.key).catch(() => {}); }
    }
    const online = rows.filter(p => p && now - p.at < ONLINE_MS).sort((a, b) => b.at - a.at).slice(0, 50);
    return json({ online: online.map(({ name, nation, turn, view, at, dev }) => ({ name, nation, turn, view, at, dev: !!dev })), feed: await recentFeed(s, 25) });
  }

  if (path === "/api/v1/status" && m === "GET") {
    const out = { ok: false, game: "down", storage: "down", version: null, checkedAt: new Date().toISOString() };
    try { const r = ctx.assets ? await ctx.assets("/data/v1/meta.json") : null; if (r && r.ok) { const meta = await r.json(); out.game = "up"; out.version = meta.version || null; } } catch {}
    try { await s.get("health/ping"); out.storage = "up"; } catch {}
    out.ok = out.game === "up" && out.storage === "up";
    return json(out, out.ok ? 200 : 503, OPEN);
  }

  if (path === "/api/v1/transfer") {
    if (m === "POST") {
      if (!allowedOrigin(env, origin)) return json({ error: "origin" }, 403);
      const b = await body(req, 9e6), code = b && await transferCreate(s, b.data);
      return code ? json({ code }, 200, { "access-control-allow-origin": origin }) : json({ error: "invalid" }, 400, { "access-control-allow-origin": origin });
    }
    if (m === "GET") { const data = await transferClaim(s, url.searchParams.get("code")); return data ? json({ data }) : json({ error: "not found or already used" }, 404); }
    return json({ error: "method" }, 405);
  }
  return json({ error: "not found" }, 404);
}
