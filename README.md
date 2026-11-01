# Pacific Rim WW3

Turn-based grand strategy across the Asia-Pacific, played in a phone browser. Sixteen powers and fifteen AI-run minor nations start neutral; hold 30% of the region's victory points to win.

**Status:** 1.0 Beta, early access playtest.
**Play:** https://pacific-rim-ww3.netlify.app

## Layout

| Path | What it is |
| --- | --- |
| `site/index.html` | The playable game (one self-contained file). Netlify publishes this folder. |
| `src/template.html` | Game source: HTML, CSS and JavaScript, with the map as a `__MAP_DATA__` placeholder. |
| `src/map.json` | The map: 1,451 cells (722 land, 729 sea), lanes, borders, labels. |
| `build.py` | Builds `site/index.html` (web) and `dist/claude-artifact.html` (Claude artifact) from `src/`. |
| `netlify.toml` | Deploy settings: publish `site/`, no build command, no caching. |
| `netlify/functions/scores.mjs` | Online leaderboard API: `GET /api/scores?top=N`, `POST /api/scores`. |
| `netlify/functions/presence.mjs` | Players online + activity log: `POST /api/presence` heartbeat, `GET /api/presence`. |
| `netlify/functions/status.mjs` | Service status: `GET /api/v1/status` (game up, storage up, live version). |
| `site/data/v1/meta.json`, `codex.json` | Public read-only data feed, written by `tools/export_feed.py` during the build: version, patch notes, nations, governments, units, battalions, buildings. |
| `tools/export_feed.py` | Loads the built game headless, calls its `exportFeed()`, checks the result and writes the feed. Needs Python Playwright. |
| `netlify/lib/shared.mjs` | Validation and Netlify Blobs helpers (store `prww3`: `scores/`, `presence/`, `feed/` keys). |

## Patch workflow

1. Edit `src/template.html`.
2. `python3 build.py`
3. Stress test (60-turn AI simulations, combat duels, UI flow, saves) before every release, however small.
4. Commit and push to `main`. Netlify deploys automatically.

Saves live in each player's browser (`prww3-save-v6:<commander>`), so updates never wipe a campaign. Keep that key and the save format backward compatible.

## Public data feed (v1)

Read-only, versioned, safe to call from anywhere. FORBID COMMAND (the Discord bot, its own repository) and the future website read only these, so the game can change internally as long as the feed keeps its shape.

| Address | Contents |
| --- | --- |
| `/data/v1/meta.json` | game name, version, release date, Discord invite, all patch notes (sections and items) |
| `/data/v1/codex.json` | rules, 31 nations (start economy, capital, cells, VP share), governments, 19 units, battalion types, 10 buildings with every level |
| `/api/v1/status` | `{ ok, game, storage, version, checkedAt }`, HTTP 503 when something is down |
| `/api/scores?top=N` | leaderboard (unverified until the integrity work lands) |
| `/api/presence` | commanders online and the activity feed |
| `/discord` | redirect to the official Discord invite |

Adding a field is fine; renaming or removing one needs a `v2`.
