// Shared helpers for the Pacific Rim WW3 online services (leaderboard, players online, activity log).
// Storage: Netlify Blobs, one key per record (no read-modify-write on shared keys).
import { getStore } from "@netlify/blobs";

export const NATIONS = ["CN", "JP", "KR", "KP", "TW", "PH", "VN", "TH", "MY", "SG", "ID", "PG", "AU", "NZ", "FJ", "US"];
export const RESULTS = ["In progress", "Victory", "Defeat"];
export const ONLINE_MS = 150 * 1000;          // seen in the last 2.5 minutes = online
export const store = () => getStore({ name: "prww3", consistency: "strong" });

// commander names: letters, numbers, spaces and a little punctuation, 2-18 characters
export function cleanName(n) {
  const s = String(n ?? "").normalize("NFKC").replace(/[^\p{L}\p{N} _.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 18);
  return s.length >= 2 ? s : null;
}
export const cleanId = id => (/^[a-z0-9]{6,32}$/i.test(String(id ?? "")) ? String(id) : null);
export const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export async function readBody(req) {
  try { const t = await req.text(); if (t.length > 4000) return null; return JSON.parse(t); } catch { return null; }
}

// read many keys in parallel, skipping any that vanish meanwhile
export async function readAll(s, keys) {
  const out = await Promise.all(keys.map(k => s.get(k, { type: "json" }).catch(() => null)));
  return out.filter(Boolean);
}

// the activity log: one key per event, newest found by sorting keys (zero-padded timestamps)
export async function logEvent(s, text) {
  const at = Date.now();
  await s.setJSON(`feed/${String(at).padStart(15, "0")}-${Math.random().toString(36).slice(2, 7)}`, { text: String(text).slice(0, 160), at });
}
export async function recentFeed(s, n = 25) {
  const { blobs } = await s.list({ prefix: "feed/" });
  const keys = blobs.map(b => b.key).sort();
  const old = keys.filter(k => Number(k.slice(5, 20)) < Date.now() - 7 * 864e5);
  if (old.length) await Promise.all(old.slice(0, 50).map(k => s.delete(k).catch(() => {}))); // tidy up week-old events
  const recent = await readAll(s, keys.slice(-n));
  return recent.sort((a, b) => b.at - a.at);
}
