// Cloudflare Pages Functions: every /api/... request goes to the shared router (server/api.mjs).
// Needs one binding in the Pages project: a D1 database named DB (Settings > Bindings).
import { handle } from "../../server/api.mjs";
import { d1Store } from "../../server/d1store.mjs";

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return new Response(JSON.stringify({ error: "storage not connected (bind a D1 database as DB)" }), { status: 503, headers: { "content-type": "application/json" } });
  const assets = path => env.ASSETS.fetch(new Request(new URL(path, request.url)));
  try {
    return await handle(request, { store: d1Store(env.DB), env, assets });
  } catch (e) {
    console.error("api error", e && e.stack || e);
    return new Response(JSON.stringify({ error: "server error" }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
