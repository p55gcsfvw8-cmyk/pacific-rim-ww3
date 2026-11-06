// The Cloudflare router end to end on a SQLite stand-in for D1:  node --test server/
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, importOldBoard, OLD_ORIGIN } from "./api.mjs";
import { d1Store } from "./d1store.mjs";
import { d1Mock } from "./d1mock.mjs";

const mk = (extra = {}) => ({ store: d1Store(d1Mock()), env: { DEV_CODE: "dev-code", TRANSFER_ORIGINS: "http://old.test" }, importOld: false, reset: false, assets: async () => new Response(JSON.stringify({ version: "1.0.16 beta" })), ...extra });
const call = (ctx, method, path, b, headers = {}) => handle(new Request("https://new.test" + path, { method, headers: { "content-type": "application/json", ...headers }, body: b ? JSON.stringify(b) : undefined }), ctx);
const K = "k".repeat(32);

test("scores: best per commander, claims, dev name, CORS on reads", async () => {
  const c = mk();
  assert.equal((await call(c, "POST", "/api/scores", { gid: "aaaaaa1", name: "Mai", nation: "VN", score: 900, turn: 10, result: "In progress", key: K })).status, 200);
  assert.equal((await call(c, "POST", "/api/scores", { gid: "aaaaaa2", name: "Mai", nation: "VN", score: 1900, turn: 20, result: "In progress", key: K })).status, 200);
  assert.equal((await call(c, "POST", "/api/scores", { gid: "aaaaaa3", name: "mai", nation: "JP", score: 9000, turn: 20, result: "In progress", key: "z".repeat(32) })).status, 409);
  assert.equal((await call(c, "POST", "/api/scores", { gid: "aaaaaa4", name: "MR FORBID.DEV", nation: "AU", score: 100, turn: 3, result: "In progress", key: K })).status, 403);
  const r = await call(c, "GET", "/api/v1/leaderboard?top=5"); assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const rows = await r.json(); assert.deepEqual(rows.map(x => [x.name, x.score, x.campaigns]), [["Mai", 1900, 2]]);
  const p = await (await call(c, "GET", "/api/presence")).json(); assert.ok(p.feed.some(f => /Mai began a campaign as Vietnam/.test(f.text)));
});

test("presence and status", async () => {
  const c = mk();
  await call(c, "POST", "/api/presence", { did: "device000001", name: "Lee", nation: "TH", turn: 4, view: "game" });
  const p = await (await call(c, "GET", "/api/presence")).json();
  assert.equal(p.online.length, 1); assert.equal(p.online[0].name, "Lee"); assert.match(p.feed[0].text, /Lee came online/);
  const st = await call(c, "GET", "/api/v1/status"); assert.equal(st.status, 200); assert.deepEqual((({ ok, game, storage, version }) => ({ ok, game, storage, version }))(await st.json()), { ok: true, game: "up", storage: "up", version: "1.0.16 beta" });
  const down = await call(mk({ assets: async () => new Response("", { status: 404 }) }), "GET", "/api/v1/status"); assert.equal(down.status, 503);
});

test("save transfer: only from the old site, one use, large saves in pieces", async () => {
  const c = mk(), data = "x".repeat(1_200_000);
  assert.equal((await call(c, "POST", "/api/v1/transfer", { data }, { origin: "https://evil.test" })).status, 403);
  const pre = await call(c, "OPTIONS", "/api/v1/transfer", null, { origin: "http://old.test" }); assert.equal(pre.headers.get("access-control-allow-origin"), "http://old.test");
  const r = await call(c, "POST", "/api/v1/transfer", { data }, { origin: "http://old.test" }); assert.equal(r.status, 200);
  const { code } = await r.json(); assert.match(code, /^[a-z2-9]{12}$/);
  const g = await call(c, "GET", "/api/v1/transfer?code=" + code); assert.equal(g.status, 200); assert.equal((await g.json()).data, data);
  assert.equal((await call(c, "GET", "/api/v1/transfer?code=" + code)).status, 404); // used up
  assert.equal((await call(c, "POST", "/api/v1/transfer", { data: "a" }, { origin: OLD_ORIGIN })).status, 200); // the real old site is allowed
});

test("the old leaderboard is copied once; existing commanders aren't overwritten", async () => {
  const c = mk(); const s = c.store;
  await call(c, "POST", "/api/scores", { gid: "bbbbbb1", name: "Admiral Kai", nation: "JP", score: 50, turn: 3, result: "In progress", key: K });
  let calls = 0;
  const old = async url => { calls++; assert.equal(url, OLD_ORIGIN + "/api/v1/leaderboard?top=100"); return new Response(JSON.stringify([{ rank: 1, name: "Admiral Kai", nation: "JP", score: 3300, turn: 55, result: "In progress", campaigns: 2 }, { rank: 2, name: "Jacob", nation: "AU", score: 1200, turn: 30, result: "In progress", campaigns: 3 }])); };
  assert.equal(await importOldBoard(s, old), true); assert.equal(await importOldBoard(s, old), false); assert.equal(calls, 1);
  const rows = await (await call(c, "GET", "/api/v1/leaderboard")).json();
  assert.deepEqual(rows.map(x => [x.name, x.score, x.verified]), [["Jacob", 1200, false], ["Admiral Kai", 50, true]]);
  const failing = mk(); assert.equal(await importOldBoard(failing.store, async () => { throw new Error("offline"); }), false);
  assert.equal(await failing.store.get("meta/imported-netlify", { type: "json" }), null); // tries again later
});

// ---- 1.0.20: fresh leaderboard, every nation, and the free plan's 50 queries per request
const req = (c, db, method, path, b) => { db.newRequest(); return call(c, method, path, b); };
test("1.0.20: every playable nation can post (India, Myanmar, Russia... were refused)", async () => {
  const c = mk();
  for (const [i, n] of ["IN", "MM", "RU", "KH", "BD", "TO"].entries()) {
    const r = await call(c, "POST", "/api/scores", { gid: "natgid" + i, name: "Cmdr " + n, nation: n, score: 200 + i, turn: 3, result: "In progress", key: String(i).repeat(32) });
    assert.equal(r.status, 200, n);
  }
  const rows = await (await call(c, "GET", "/api/scores?top=20")).json();
  assert.equal(rows.length, 6);
  const p = await (await call(c, "GET", "/api/presence")).json(); assert.ok(p.feed.some(f => /began a campaign as India/.test(f.text)));
});

test("1.0.20: the board is wiped once and rebuilt only from campaigns played here", async () => {
  const db = d1Mock(":memory:", 50), c = mk({ store: d1Store(db), reset: true, importOld: true, fetch: async () => { throw new Error("must not fetch the old site again"); } }), s = c.store;
  // the state before: 100 rows copied from the old site, real campaigns, a name claim, an opt-in
  for (let i = 0; i < 100; i++) { db.newRequest(); await s.setJSON(`best/old-${i}`, { slug: `old-${i}`, name: `Old ${i}`, nation: "JP", score: 9000 - i, turn: 60, result: "In progress", gid: "imported", at: 1, campaigns: 1, claimed: false, imported: true }); }
  db.newRequest(); await s.setJSON("meta/best-v1", { at: 1 }); db.newRequest(); await s.setJSON("meta/import-tries", 3); // the import never finished
  const camps = [["g1aaaa", "Mai", "VN", 900, 10, 1000], ["g2aaaa", "Mai", "VN", 2500, 30, 2000], ["g3aaaa", "Mai", "TH", 400, 4, 3000], ["g4aaaa", "Jo", "IN", 300, 5, 1500], ["g5aaaa", "Cheat", "AU", 59000, 2, 1600]];
  for (const [gid, name, nation, score, turn, at] of camps) { db.newRequest(); await s.setJSON(`scores/${gid}`, { gid, name, slug: name.toLowerCase(), nation, score, turn, result: "In progress", vp: 5, final: false, at, implausible: score > 9000 || undefined }); }
  db.newRequest(); await s.setJSON("names/mai", { name: "Mai", hashes: ["x"], dev: false, at: 1 });
  db.newRequest(); await s.setJSON("best/mai", { slug: "mai", name: "Mai", nation: "VN", score: 2500, turn: 30, gid: "g2aaaa", at: 2000, campaigns: 3, claimed: true, announce: true });
  const r = await req(c, db, "GET", "/api/scores?top=50");
  assert.equal(r.status, 200); assert.ok(db.queries <= 50, `reset took ${db.queries} queries`);
  const rows = await r.json();
  assert.deepEqual(rows.map(x => [x.name, x.score, x.campaigns, x.verified]), [["Mai", 2500, 3, true], ["Jo", 300, 1, false]]);
  assert.deepEqual(rows[0].now, { nation: "TH", score: 400, turn: 4, result: "In progress" });
  db.newRequest(); assert.equal((await s.get("best/mai", { type: "json" })).announce, true);
  db.newRequest(); const tag = await s.get("meta/reset-1.0.20", { type: "json" }); assert.equal(tag.state, "done"); assert.equal(tag.dropped, 101);
  // only once: a later post and read keep the new board, and the old site is never copied again
  const p = await req(c, db, "POST", "/api/scores", { gid: "g6aaaa", name: "New Face", nation: "KH", score: 150, turn: 2, result: "In progress", key: K });
  assert.equal(p.status, 200); assert.ok(db.queries <= 50);
  const after = await (await req(c, db, "GET", "/api/scores?top=50")).json();
  assert.deepEqual(after.map(x => x.name), ["Mai", "Jo", "New Face"]);
  // a returning player's next turn moves their row
  const q = await req(c, db, "POST", "/api/scores", { gid: "g4aaaa", name: "Jo", nation: "IN", score: 650, turn: 6, result: "In progress", key: "q".repeat(32) });
  assert.equal(q.status, 200);
  const again = await (await req(c, db, "GET", "/api/scores?top=50")).json();
  assert.deepEqual(again.map(x => [x.name, x.score]), [["Mai", 2500], ["Jo", 650], ["New Face", 150]]);
});

test("1.0.20: busy feeds and event logs stay inside 50 queries per request", async () => {
  const db = d1Mock(":memory:", 50), c = mk({ store: d1Store(db) }), s = c.store, old = Date.now() - 40 * 864e5;
  for (let i = 0; i < 120; i++) { db.newRequest(); await s.setJSON(`feed/${String(old + i).padStart(15, "0")}-a${i}`, { text: "old " + i, at: old + i }); }
  for (let i = 0; i < 30; i++) { db.newRequest(); await s.setJSON(`feed/${String(Date.now() - i).padStart(15, "0")}-b${i}`, { text: "new " + i, at: Date.now() - i }); }
  for (let i = 0; i < 120; i++) { db.newRequest(); await s.setJSON(`events/${String(old + i).padStart(15, "0")}-${String(i).padStart(4, "0")}abcd`, { id: i, at: old + i }); }
  for (let i = 0; i < 90; i++) { db.newRequest(); await s.setJSON(`presence/dev${String(i).padStart(4, "0")}`, { name: "P" + i, at: old, view: "menu" }); }
  const p = await req(c, db, "GET", "/api/presence"); assert.equal(p.status, 200); assert.ok(db.queries <= 50, `presence: ${db.queries}`);
  const j = await p.json(); assert.equal(j.feed.length, 25); assert.ok(j.feed.every(f => /^new/.test(f.text)));
  db.newRequest(); assert.equal((await s.list({ prefix: "feed/" })).blobs.length, 30); // the week-old lines are gone
  const e = await req(c, db, "GET", "/api/v1/events?since=0"); assert.equal(e.status, 200); assert.ok(db.queries <= 50, `events: ${db.queries}`);
  db.newRequest(); assert.equal((await s.list({ prefix: "events/" })).blobs.length, 0);
});
