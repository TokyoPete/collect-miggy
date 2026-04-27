// netlify/functions/cancel-refresh.js
// POST /api/cancel-refresh
// Signals the running items refresh to stop at the next page boundary.
// Rolls checkpoint back one page so resume starts from a safe prior position.

import { getStore } from "@netlify/blobs";
import { corsHeaders, jsonResponse } from "./_shared.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST")   return jsonResponse({ error:"Method not allowed" }, 405);

  const store = getStore({ name:"card-cache", consistency:"strong" });

  const checkpoint = await store.get("items-checkpoint", { type:"json" }).catch(() => null);

  // Write cancel flag — checked before each page fetch
  await store.setJSON("items-cancel", { cancelled:true, requestedAt:new Date().toISOString() });

  // Roll back one page so the next resume re-processes the last page cleanly
  if (checkpoint?.lastCompletedPage > 0) {
    await store.setJSON("items-checkpoint", {
      ...checkpoint,
      lastCompletedPage: Math.max(0, checkpoint.lastCompletedPage - 1),
      rolledBackAt: new Date().toISOString(),
    });
  }

  await store.setJSON("items-status", {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    note: "Refresh stopped by user. Click Refresh Cards to resume from checkpoint.",
  });

  return jsonResponse({
    ok: true,
    message:"Stop signal sent. Refresh will halt before the next page.",
    rolledBackToPage: Math.max(0, (checkpoint?.lastCompletedPage||1) - 1),
  });
}

export const config = { path:"/api/cancel-refresh" };
