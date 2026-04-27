// netlify/functions/refresh-items-http.js
// Manual "Refresh Cards" button endpoint. Returns 202 immediately.
// Shares runItemsRefresh logic with refresh-items-background.js.
// URL: POST /api/refresh-items

import { getStore } from "@netlify/blobs";
import { corsHeaders, jsonResponse } from "./_shared.js";
import { runItemsRefresh } from "./refresh-items-background.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST") return jsonResponse({ error:"Method not allowed" }, 405);

  const store = getStore({ name:"card-cache", consistency:"strong" });

  // Mark as starting before 202 is sent
  await store.setJSON("items-status", { status:"refreshing", phase:"Starting…", updatedAt:new Date().toISOString() });

  context.waitUntil(
    runItemsRefresh(store).catch(async e => {
      await store.setJSON("items-status", { status:"error", error:e.message, failedAt:new Date().toISOString() });
    })
  );

  return jsonResponse({ ok:true, message:"Card database refresh started in background" }, 202);
}

export const config = { path:"/api/refresh-items" };
