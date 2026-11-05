// Leaderboard logic (1.0.15): one row per commander (their best campaign), owned names, the developer's
// reserved name, a plausibility check, and a log of verified, opt-in events for FORBID COMMAND.
// Pure logic over a store with get/setJSON/list/delete, so it can be tested without Netlify.
// Web Crypto only, so the same file runs on Cloudflare (Pages Functions), Netlify Functions and Node 20+.

export const NATIONS = ["CN", "JP", "KR", "KP", "TW", "PH", "VN", "TH", "MY", "SG", "ID", "PG", "AU", "NZ", "FJ", "US"];
export const RESULTS = ["In progress", "Victory", "Defeat"];
export const RESERVED = { "mr-forbid-dev": { dev: true } }; // names only the developer (with DEV_CODE) can use
export const TOP_EVENTS = 5;

export function cleanName(n) {
  const s = String(n ?? "").normalize("NFKC").replace(/[^\p{L}\p{N} _.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 18);
  return s.length >= 2 ? s : null;
}
// the same slug the game uses for saves: "MR FORBID.DEV" -> "mr-forbid-dev"
export const slugOf = n => String(n || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "commander";
export const cleanId = id => (/^[a-z0-9]{6,32}$/i.test(String(id ?? "")) ? String(id) : null);
export const cleanKey = k => (/^[a-z0-9]{20,64}$/i.test(String(k ?? "")) ? String(k) : null);
export const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
async function sha(s) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }; // constant time

// Generous ceiling from the scoring formula (territory up to 4,000, captures, kills, capitals, victory bonus up to 3,800):
// real campaigns stay far below it; a hand-made 60,000 on turn 3 does not.
export const plausible = (score, turn, result) => score <= 8500 + 600 * turn && (result !== "Victory" || turn >= 5);

// 1.0.19: `now` is the commander's most recent campaign when it isn't the best one (or has moved on since), so a
// player can see their current campaign posting even while an older best stays on top. `seen` is their last post.
const nowOf = b => { const l = b.latest; return l && (l.gid !== b.gid || l.turn !== b.turn || l.score !== b.score) ? { nation: l.nation, score: l.score, turn: l.turn, result: l.result } : undefined; };
const pub = b => ({ name: b.name, nation: b.nation, score: b.score, turn: b.turn, result: b.result, vp: b.vp, at: b.at, dev: !!b.dev, verified: !!b.claimed, campaigns: b.campaigns || 1, now: nowOf(b), seen: b.latest ? b.latest.at : b.at });
export const rankSort = (a, b) => b.score - a.score || a.at - b.at;

async function readAll(s, prefix) {
  if (s.values) return s.values(prefix); // stores that can read a whole prefix in one query (D1)
  const { blobs } = await s.list({ prefix });
  const rows = await Promise.all(blobs.map(b => s.get(b.key, { type: "json" }).catch(() => null)));
  return rows.filter(Boolean);
}

// one-time move from one row per campaign to one row per commander (keeps every campaign record)
export async function ensureBest(s) {
  if (await s.get("meta/best-v1", { type: "json" }).catch(() => null)) return false;
  const all = await readAll(s, "scores/"), best = new Map(), count = new Map();
  for (const e of all) {
    const slug = slugOf(e.name); count.set(slug, (count.get(slug) || 0) + 1);
    if (!plausible(e.score, e.turn, e.result)) continue;
    const b = best.get(slug); if (!b || e.score > b.score || (e.score === b.score && e.at < b.at)) best.set(slug, e);
  }
  for (const [slug, e] of best) await s.setJSON(`best/${slug}`, { slug, name: e.name, nation: e.nation, score: e.score, turn: e.turn, result: e.result, vp: e.vp || 0, gid: e.gid, at: e.at, campaigns: count.get(slug), claimed: false, dev: false, announce: false });
  await s.setJSON("meta/best-v1", { at: Date.now(), commanders: best.size, campaigns: all.length });
  return true;
}

export async function topBoard(s, n = 20) {
  await ensureBest(s);
  const rows = (await readAll(s, "best/")).filter(b => !b.hidden).sort(rankSort);
  return rows.slice(0, n).map((b, i) => ({ rank: i + 1, ...pub(b) }));
}

// who owns a name: a device key (hashed), or the developer code for reserved names
export async function checkClaim(s, env, name, key, devCode) {
  const slug = slugOf(name), reserved = RESERVED[slug], rec = await s.get(`names/${slug}`, { type: "json" }).catch(() => null);
  const kh = key ? await sha(key) : null;
  if (reserved) {
    const code = env.DEV_CODE || "";
    const okCode = !!(code && devCode && same(await sha(devCode), await sha(code)));
    if (rec && kh && rec.hashes.includes(kh)) return { ok: true, slug, claimed: true, dev: true };
    if (!okCode) return { ok: false, status: 403, error: "reserved", slug };
    const hashes = [...new Set([kh, ...((rec && rec.hashes) || [])].filter(Boolean))].slice(0, 6); // the developer may play on several devices
    await s.setJSON(`names/${slug}`, { name, hashes, dev: true, at: rec ? rec.at : Date.now() });
    return { ok: true, slug, claimed: !!kh, dev: true };
  }
  if (rec) {
    if (kh && rec.hashes.includes(kh)) return { ok: true, slug, claimed: true, dev: false };
    return { ok: false, status: 409, error: "name taken", slug };
  }
  if (!kh) return { ok: true, slug, claimed: false, dev: false }; // an older game version without a key: posts, but can't claim
  const r = await s.setJSON(`names/${slug}`, { name, hashes: [kh], dev: false, at: Date.now() }, { onlyIfNew: true });
  if (r && r.modified === false) { // someone claimed it a moment ago
    const now = await s.get(`names/${slug}`, { type: "json" });
    return now && now.hashes.includes(kh) ? { ok: true, slug, claimed: true, dev: false } : { ok: false, status: 409, error: "name taken", slug };
  }
  return { ok: true, slug, claimed: true, dev: false };
}

let seq = 0; // keeps events written in the same millisecond in the order they happened
export async function logEvent(s, ev) {
  const at = Date.now(), id = `${String(at).padStart(15, "0")}-${String(seq++ % 1e4).padStart(4, "0")}${Math.random().toString(36).slice(2, 6)}`;
  await s.setJSON(`events/${id}`, { ...ev, id, at });
}

// newer than `since` (ms) or, exactly, after event id `after` (what FORBID COMMAND uses)
export async function recentEvents(s, since = 0, n = 50, after = null) {
  const { blobs } = await s.list({ prefix: "events/" });
  const keys = blobs.map(b => b.key).sort();
  const old = keys.filter(k => Number(k.slice(7, 22)) < Date.now() - 30 * 864e5);
  if (old.length) await Promise.all(old.slice(0, 50).map(k => s.delete(k).catch(() => {})));
  const fresh = (after ? keys.filter(k => k > `events/${after}`) : keys.filter(k => Number(k.slice(7, 22)) > since)).slice(after ? 0 : -n, after ? n : undefined);
  const rows = await Promise.all(fresh.map(k => s.get(k, { type: "json" }).catch(() => null)));
  return rows.filter(Boolean); // keys sort in the order the events happened
}

// accept one campaign's score; returns { status, body, feed? } where feed is a line for the activity log
export async function submitScore(s, env, b) {
  const gid = cleanId(b.gid), name = cleanName(b.name), nation = NATIONS.includes(b.nation) ? b.nation : null;
  const score = int(b.score, 0, 60000), turn = int(b.turn, 1, 2000), vp = int(b.vp ?? 0, 0, 100);
  const result = RESULTS.includes(b.result) ? b.result : null;
  if (!gid || !name || !nation || score == null || turn == null || !result) return { status: 400, body: { error: "invalid entry" } };
  await ensureBest(s);
  const claim = await checkClaim(s, env, name, cleanKey(b.key), typeof b.devCode === "string" ? b.devCode.slice(0, 100) : null);
  if (!claim.ok) return { status: claim.status, body: { error: claim.error } };

  const key = `scores/${gid}`, prev = await s.get(key, { type: "json" }).catch(() => null);
  if (prev && prev.final) return { status: 200, body: { ok: true, kept: "final" } };
  if (prev && (slugOf(prev.name) !== claim.slug || prev.nation !== nation)) return { status: 409, body: { error: "campaign mismatch" } };
  if (prev && turn < prev.turn) return { status: 200, body: { ok: true, kept: "newer" } };
  const final = result !== "In progress", ok = plausible(score, turn, result);
  await s.setJSON(key, { gid, name, slug: claim.slug, nation, score, turn, result, vp, final, at: Date.now(), v: String(b.v ?? "").slice(0, 16), implausible: !ok || undefined });
  const out = { status: 200, body: { ok: true } };
  if (!prev) out.feed = { kind: "began", name, nation };
  if (final) out.feed = { kind: result === "Victory" ? "won" : "fell", name, nation, turn, score };
  if (!ok) { out.body.counted = false; return out; }

  // the commander's best campaign
  const bk = `best/${claim.slug}`, best = await s.get(bk, { type: "json" }).catch(() => null);
  const campaigns = (best ? best.campaigns || 1 : 0) + (prev ? 0 : 1);
  const announce = b.announce === true;
  const better = !best || score > best.score || (best.gid === gid && score === best.score);
  const flags = { claimed: claim.claimed || !!(best && best.claimed), dev: claim.dev, announce };
  const latest = { gid, nation, score, turn, result, at: Date.now() };
  if (!better) { // 1.0.19: the row still records this campaign as the commander's latest, so the board shows it moving
    await s.setJSON(bk, { ...best, campaigns, ...flags, latest });
    out.body.best = best.score; return out;
  }
  const before = (await readAll(s, "best/")).filter(x => !x.hidden).sort(rankSort);
  const row = { slug: claim.slug, name, nation, score, turn, result, vp, gid, at: Date.now(), campaigns, ...flags, latest };
  await s.setJSON(bk, row);
  out.body.best = score;
  if (announce && claim.claimed) await eventsFor(s, before, row);
  return out;
}

// verified, opt-in milestones only: a new leader, a new top-five entry, passing the developer
async function eventsFor(s, before, row) {
  const rankIn = list => list.findIndex(x => x.slug === row.slug);
  const after = before.filter(x => x.slug !== row.slug).concat(row).sort(rankSort);
  const r0 = rankIn(before), r1 = rankIn(after), base = { name: row.name, nation: row.nation, score: row.score, rank: r1 + 1, dev: row.dev };
  if (r1 === 0 && r0 !== 0 && before.length) await logEvent(s, { type: "new_leader", ...base, passed: before[0].name });
  else if (r1 < TOP_EVENTS && (r0 < 0 || r0 >= TOP_EVENTS)) await logEvent(s, { type: "top_five", ...base });
  const devB = before.findIndex(x => x.dev), devA = after.findIndex(x => x.dev);
  if (!row.dev && devB >= 0 && devA >= 0 && (r0 < 0 || r0 > devB) && r1 < devA)
    await logEvent(s, { type: "passed_dev", ...base, devName: before[devB].name, devScore: before[devB].score });
}

// true when this device owns the developer's reserved name (for the dev tag in Players online)
export async function isDev(s, name, key) {
  const slug = slugOf(name), k = cleanKey(key);
  if (!RESERVED[slug] || !k) return false;
  const rec = await s.get(`names/${slug}`, { type: "json" }).catch(() => null);
  return !!(rec && rec.dev && rec.hashes.includes(await sha(k)));
}
