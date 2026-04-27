// netlify/functions/refresh-listings-http.js
// POST /api/refresh-listings — manual "Refresh Prices" button (all series).
// Returns 202 immediately, runs in background via context.waitUntil.

import { getStore } from "@netlify/blobs";
import { corsHeaders, jsonResponse } from "./_shared.js";
import { runListingsRefresh } from "./refresh-listings-background.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST") return jsonResponse({ error:"Method not allowed" }, 405);

  const store = getStore({ name:"card-cache", consistency:"strong" });
  await store.setJSON("listings-status", { status:"refreshing", startedAt:new Date().toISOString() });

  context.waitUntil(
    runListingsRefresh(store).catch(async e => {
      await store.setJSON("listings-status", { status:"error", error:e.message, failedAt:new Date().toISOString() });
    })
  );

  return jsonResponse({ ok:true, message:"Listings refresh started" }, 202);
}

export const config = { path:"/api/refresh-listings" };
