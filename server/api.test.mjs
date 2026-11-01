// The Cloudflare router end to end on a SQLite stand-in for D1:  node --test server/
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, importOldBoard, OLD_ORIGIN } from "./api.mjs";
import { d1Store } from "./d1store.mjs";
import { d1Mock } from "./d1mock.mjs";

const mk = (extra = {}) => ({ store: d1Store(d1Mock()), env: { DEV_CODE: "dev-code", TRANSFER_ORIGINS: "http://old.test" }, importOld: false, assets: async () => new Response(JSON.stringify({ version: "1.0.16 beta" })), ...extra });
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
