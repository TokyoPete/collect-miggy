// netlify/functions/refresh-items-http.js
// POST /api/refresh-items — manual "Refresh Cards" button.
// Returns 202 immediately; delegates to runItemsRefresh via context.waitUntil.

import { getStore } from "@netlify/blobs";
import { corsHeaders, jsonResponse } from "./_shared.js";
import { runItemsRefresh } from "./refresh-items-background.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST")   return jsonResponse({ error:"Method not allowed" }, 405);

  const store = getStore({ name:"card-cache", consistency:"strong" });

  await store.setJSON("items-status", {
    status:"refreshing", pctComplete:0, phase:"Starting…",
    updatedAt:new Date().toISOString(),
  });

  context.waitUntil(
    runItemsRefresh(store).catch(async e => {
      if (e.cancelled) return;
      await store.setJSON("items-status", {
        status:"error", error:e.message, failedAt:new Date().toISOString(),
      });
    })
  );

  return jsonResponse({ ok:true, message:"Card refresh started in background" }, 202);
}

export const config = { path:"/api/refresh-items" };
