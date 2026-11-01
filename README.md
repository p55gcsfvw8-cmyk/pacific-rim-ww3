# The Fractured Coasts: WW3

*(formerly Pacific Rim WW3)*

This is a turn-based grand strategy game across the Asia-Pacific, played in a phone browser. Sixteen powers and fifteen AI-run minor nations start neutral; you win by holding 30% of the region's victory points.

- **Status:** 1.0 Beta, early access playtest
- **Play:** https://fractured-coasts.pages.dev (Cloudflare Pages, free plan)
- **Old address:** https://pacific-rim-ww3.netlify.app now only shows a "We've moved" page that carries saves across. It goes live with the first Netlify deploy after the team's credits reset on 29 Nov 2026.
- **Community:** https://discord.gg/jv8T6Pxz3e. The bot, FORBID COMMAND, has its own repository: `forbid-command`.

## Layout

| Path | What it is |
| --- | --- |
| `src/template.html` | The whole game (HTML, CSS, JavaScript), with the map as a `__MAP_DATA__` placeholder |
| `src/map.json` | The map: cells, lanes, borders, labels |
| `src/moved.html` | The old address's "We've moved" page (template) |
| `build.py` | Builds everything listed below |
| `site/` | What Cloudflare Pages publishes: `index.html`, `_headers`, `_redirects`, `data/v1/` (the public feed) |
| `dist/claude-artifact.html` | The Claude artifact version of the game (no server) |
| `moved/index.html` | What the old Netlify address publishes (see `netlify.toml`) |
| `worker.js`, `wrangler.jsonc` | Cloudflare Workers entry and config (static files from `site/`, `/api/*` through the router) |
| `functions/api/[[path]].js` | Cloudflare Pages Functions entry: every `/api/...` request |
| `server/api.mjs` | The router for all online services |
| `server/board.mjs` | Leaderboard rules: best campaign per commander, owned names, the developer's reserved name, plausibility, events |
| `server/d1store.mjs` | Storage: one D1 (SQLite) table of key to JSON |
| `server/*.test.mjs` | Tests: `npm test` (Node 22.5+; uses `node:sqlite` as a stand-in for D1) |
| `tools/export_feed.py` | Writes the public feed from the built game (run by `build.py`; needs Python Playwright) |

## Cloudflare setup

The game deploys either as a **Worker** (`wrangler.jsonc` + `worker.js`; Build command empty, Deploy command `npx wrangler deploy`; the D1 database is created on the first deploy) or as a **Pages** project (below). Both use the same router and storage.

### As a Pages project

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `site` |
| Root directory | *(repository root, so `functions/` is found)* |
| Binding | a D1 database, variable name **`DB`** (Settings > Bindings) |
| Variable (optional) | `DEV_CODE`: the developer code for the reserved name MR FORBID.DEV |

The table is created automatically on the first request.

## Online services

| Address | What it does |
| --- | --- |
| `GET /api/scores?top=N`, `GET /api/v1/leaderboard?top=N` | One row per commander (their best campaign): `rank, name, nation, score, turn, result, vp, at, dev, verified, campaigns` |
| `POST /api/scores` | A campaign's score `{gid, name, nation, score, turn, result, vp, v, key, devCode?, announce?}` |
| `GET /api/v1/events?after=<id>` | Verified, opt-in milestones: `new_leader`, `top_five`, `passed_dev` |
| `GET` / `POST /api/presence` | Commanders online and the activity feed |
| `GET /api/v1/status` | `{ ok, game, storage, version, checkedAt }`; HTTP 503 when something is down |
| `POST /api/v1/transfer`, `GET /api/v1/transfer?code=` | One-time save transfer from the old address (24 hours, one use) |
| `/data/v1/meta.json`, `/data/v1/codex.json` | Public feed: version, patch notes, nations, units, buildings, battalions, guide |
| `/discord` | Redirect to the Discord invite |

On its first request, the new leaderboard copies every commander's best score from the old site.

## Leaderboard rules

- **One row per commander:** each row shows that commander's best campaign. Every campaign is still stored under `scores/<gid>`.
- **Owned names:** a commander name belongs to the first device that posts with it. That device holds a private key in its browser; the server stores only a hash of it.
- **Reserved name:** `MR FORBID.DEV` needs `DEV_CODE`, entered once per device. It gets the ✦ DEV tag.
- **Plausibility:** scores above `8,500 + 600 × turn`, or a victory before turn 5, are stored but not ranked.
- **Events:** written only for commanders who own their name and turned on "Announce my milestones on the official Discord".

## Patch workflow

1. Edit `src/template.html`.
2. Run `python3 build.py`.
3. Stress test before every release, however small: 60-turn AI simulations, combat duels, UI flow, saves and `npm test`.
4. Commit and push to `main`. Cloudflare Pages deploys automatically.

Saves live in each player's browser, under keys starting `prww3-`. Keep those keys and the save format backward compatible.
