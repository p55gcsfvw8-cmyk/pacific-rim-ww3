// Leaderboard rules, tested against an in-memory stand-in for Netlify Blobs:  node --test server/
import { test } from "node:test";
import assert from "node:assert/strict";
import { submitScore, topBoard, ensureBest, recentEvents, checkClaim, plausible, isDev } from "./board.mjs";

class Mem {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
  async setJSON(k, v, o = {}) { if (o.onlyIfNew && this.m.has(k)) return { modified: false }; this.m.set(k, JSON.stringify(v)); return { modified: true }; }
  async list({ prefix = "" } = {}) { return { blobs: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; }
  async delete(k) { this.m.delete(k); }
}
const ENV = { DEV_CODE: "correct horse battery" };
const KEY = { a: "a".repeat(32), b: "b".repeat(32), dev: "d".repeat(32), dev2: "e".repeat(32) };
let gidN = 0; const gid = () => "camp" + String(++gidN).padStart(4, "0");
const post = (s, o) => submitScore(s, ENV, { nation: "TH", result: "In progress", vp: 10, v: "1.0.15 beta", ...o });

test("one row per commander: their best campaign, with a campaign count", async () => {
  const s = new Mem(), g1 = gid(), g2 = gid(), g3 = gid();
  await post(s, { gid: g1, name: "Mai", score: 900, turn: 10, key: KEY.a });
  await post(s, { gid: g2, name: "Mai", score: 2500, turn: 30, key: KEY.a, nation: "VN" });
  await post(s, { gid: g3, name: "Mai", score: 1200, turn: 12, key: KEY.a });
  await post(s, { gid: g2, name: "Mai", score: 2100, turn: 31, key: KEY.a, nation: "VN" }); // the best campaign later dipped: best stays at its highest
  const top = await topBoard(s);
  assert.equal(top.length, 1);
  assert.deepEqual({ name: top[0].name, score: top[0].score, nation: top[0].nation, campaigns: top[0].campaigns, verified: top[0].verified }, { name: "Mai", score: 2500, nation: "VN", campaigns: 3, verified: true });
});

test("names are owned: another device can't post under a claimed name", async () => {
  const s = new Mem();
  assert.equal((await post(s, { gid: gid(), name: "Admiral Kai", score: 500, turn: 5, key: KEY.a })).status, 200);
  const r = await post(s, { gid: gid(), name: "admiral  kai", score: 9000, turn: 20, key: KEY.b });
  assert.equal(r.status, 409); assert.equal(r.body.error, "name taken");
  const r2 = await post(s, { gid: gid(), name: "Admiral Kai", score: 9000, turn: 20 }); // old game version with no key
  assert.equal(r2.status, 409);
  assert.equal((await topBoard(s))[0].score, 500);
});

test("MR FORBID.DEV is reserved for the developer code, on any of his devices", async () => {
  const s = new Mem();
  assert.equal((await post(s, { gid: gid(), name: "MR FORBID.DEV", score: 3000, turn: 20, key: KEY.a })).status, 403);
  assert.equal((await post(s, { gid: gid(), name: "Mr Forbid Dev", score: 3000, turn: 20, key: KEY.a, devCode: "guess" })).status, 403);
  assert.equal((await post(s, { gid: gid(), name: "MR FORBID.DEV", score: 3000, turn: 20, key: KEY.dev, devCode: ENV.DEV_CODE })).status, 200);
  assert.equal((await post(s, { gid: gid(), name: "MR FORBID.DEV", score: 3100, turn: 22, key: KEY.dev })).status, 200); // that device is now known
  assert.equal((await post(s, { gid: gid(), name: "MR FORBID.DEV", score: 3200, turn: 23, key: KEY.dev2, devCode: ENV.DEV_CODE })).status, 200); // second device
  assert.equal((await post(s, { gid: gid(), name: "MR FORBID.DEV", score: 9000, turn: 23, key: KEY.b })).status, 403); // impostor
  const top = await topBoard(s); assert.equal(top[0].name, "MR FORBID.DEV"); assert.equal(top[0].dev, true); assert.equal(top[0].score, 3200);
  assert.equal(await isDev(s, "MR FORBID.DEV", KEY.dev2), true); assert.equal(await isDev(s, "MR FORBID.DEV", KEY.b), false);
  assert.equal((await checkClaim(new Mem(), {}, "MR FORBID.DEV", KEY.dev, "anything")).ok, false); // no DEV_CODE set: nobody can take it
});

test("implausible scores are stored but never ranked", async () => {
  assert.equal(plausible(60000, 3, "In progress"), false); assert.equal(plausible(5200, 61, "Victory"), true); assert.equal(plausible(3000, 2, "Victory"), false);
  const s = new Mem(); const r = await post(s, { gid: gid(), name: "Cheater", score: 60000, turn: 3, key: KEY.a });
  assert.equal(r.status, 200); assert.equal(r.body.counted, false); assert.equal((await topBoard(s)).length, 0);
});

test("finished campaigns are locked; turns can't go backwards", async () => {
  const s = new Mem(), g = gid();
  await post(s, { gid: g, name: "Mai", score: 4000, turn: 60, key: KEY.a, result: "Victory" });
  assert.equal((await post(s, { gid: g, name: "Mai", score: 9000, turn: 61, key: KEY.a })).body.kept, "final");
  const g2 = gid(); await post(s, { gid: g2, name: "Lee", score: 100, turn: 9, key: KEY.b });
  assert.equal((await post(s, { gid: g2, name: "Lee", score: 999, turn: 8, key: KEY.b })).body.kept, "newer");
});

test("events only for owned, opted-in names: new leader, top five, passing the developer", async () => {
  const s = new Mem();
  await post(s, { gid: gid(), name: "MR FORBID.DEV", score: 3000, turn: 30, key: KEY.dev, devCode: ENV.DEV_CODE, announce: true });
  for (const [n, sc] of [["P1", 2000], ["P2", 1900], ["P3", 1800], ["P4", 1700]]) await post(s, { gid: gid(), name: n, score: sc, turn: 20, key: n.padEnd(24, "x"), announce: true });
  await post(s, { gid: gid(), name: "Quiet", score: 2900, turn: 20, key: KEY.b }); // not opted in: no events
  await post(s, { gid: gid(), name: "John Doe", score: 1000, turn: 10, key: KEY.a, announce: true });
  const t0 = (await recentEvents(s)).length;
  await post(s, { gid: gid(), name: "John Doe", score: 3500, turn: 40, key: KEY.a, announce: true });
  const ev = (await recentEvents(s)).slice(t0);
  assert.deepEqual(ev.map(e => e.type), ["new_leader", "passed_dev"]);
  assert.equal(ev[0].passed, "MR FORBID.DEV"); assert.equal(ev[1].devName, "MR FORBID.DEV"); assert.equal(ev[1].name, "John Doe");
  assert.ok(!(await recentEvents(s)).some(e => e.name === "Quiet"));
  const all = await recentEvents(s), last = all.at(-1);
  assert.equal((await recentEvents(s, 0, 50, last.id)).length, 0);
  assert.deepEqual((await recentEvents(s, 0, 50, all.at(-3).id)).map(e => e.id), all.slice(-2).map(e => e.id));
});

test("old one-row-per-campaign data moves over once, keeping every campaign", async () => {
  const s = new Mem();
  const old = [["g000001", "Jacob", 1200, 30], ["g000002", "Jacob", 2400, 50], ["g000003", "Mai", 800, 12], ["g000004", "Hacker", 60000, 2]];
  for (const [g, n, sc, t] of old) await s.setJSON(`scores/${g}`, { gid: g, name: n, nation: "AU", score: sc, turn: t, result: "In progress", vp: 5, final: false, at: 1 });
  assert.equal(await ensureBest(s), true); assert.equal(await ensureBest(s), false);
  const top = await topBoard(s);
  assert.deepEqual(top.map(r => [r.name, r.score, r.campaigns, r.verified]), [["Jacob", 2400, 2, false], ["Mai", 800, 1, false]]);
  assert.equal((await s.list({ prefix: "scores/" })).blobs.length, 4);
  // the first post with a key claims a legacy name
  assert.equal((await post(s, { gid: gid(), name: "Jacob", score: 100, turn: 3, key: KEY.a })).status, 200);
  assert.equal((await topBoard(s))[0].verified, true);
});
