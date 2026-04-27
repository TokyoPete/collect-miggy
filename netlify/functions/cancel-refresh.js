// netlify/functions/cancel-refresh.js
// POST /api/cancel-refresh
// Signals a running items refresh to stop between batches.
// Rolls the checkpoint back by one batch (BATCH_SIZE UUIDs) so the next
// resume starts from a known-safe position, never losing committed progress.
// The running function checks the cancel flag before every batch.

import { getStore } from "@netlify/blobs";
import { corsHeaders, jsonResponse } from "./_shared.js";

const BATCH_SIZE = 10; // must match refresh-items-background.js

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST") return jsonResponse({ error:"Method not allowed" }, 405);

  const store = getStore({ name:"card-cache", consistency:"strong" });

  // Read current checkpoint so we can roll it back one batch
  const checkpoint = await store.get("items-checkpoint", { type:"json" }).catch(() => null);

  // Write cancel flag — the running function checks this before each batch
  await store.setJSON("items-cancel", {
    cancelled: true,
    requestedAt: new Date().toISOString(),
  });

  // Roll back checkpoint by one batch so resume starts from a safe prior point
  if (checkpoint?.phase === 2 && checkpoint.processedUUIDs?.length > 0) {
    const rollbackCount = Math.min(BATCH_SIZE, checkpoint.processedUUIDs.length);
    const rolledBack = checkpoint.processedUUIDs.slice(0, -rollbackCount);
    await store.setJSON("items-checkpoint", {
      ...checkpoint,
      processedUUIDs: rolledBack,
      rolledBackAt: new Date().toISOString(),
      note: `Rolled back ${rollbackCount} UUIDs for safe resume`,
    });
  }
  // If phase 1, no rollback needed — page checkpoints are safe to resume from

  // Update status to show cancelled
  await store.setJSON("items-status", {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    note: "Refresh was stopped by user. Click Refresh Cards to resume from checkpoint.",
  });

  return jsonResponse({
    ok: true,
    message: "Cancel signal sent. Refresh will stop before the next batch.",
    rolledBack: checkpoint?.phase === 2,
  });
}

export const config = { path: "/api/cancel-refresh" };
