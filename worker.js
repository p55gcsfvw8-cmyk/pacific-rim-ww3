// Cloudflare Workers entry (alternative to Pages): static game files from site/, /api/* through the shared router.
// Same storage and logic as functions/api/[[path]].js; D1 database bound as DB (see wrangler.jsonc).
import { handle } from "./server/api.mjs";
import { d1Store } from "./server/d1store.mjs";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!env.DB) return new Response(JSON.stringify({ error: "storage not connected (bind a D1 database as DB)" }), { status: 503, headers: { "content-type": "application/json" } });
    try {
      return await handle(request, { store: d1Store(env.DB), env, assets: path => env.ASSETS.fetch(new Request(new URL(path, request.url))) });
    } catch (e) {
      console.error("api error", (e && e.stack) || e);
      return new Response(JSON.stringify({ error: "server error" }), { status: 500, headers: { "content-type": "application/json" } });
    }
  },
};
