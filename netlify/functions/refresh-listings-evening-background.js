// netlify/functions/refresh-listings-evening-background.js
// Second daily listings refresh: 8 PM Pacific (03:00 UTC PDT next day).
// Netlify only supports one schedule per function name, so this is a separate file
// that delegates to the same runListingsRefresh logic.

import { getStore } from "@netlify/blobs";
import { runListingsRefresh } from "./refresh-listings-background.js";

export default async function handler(req, context) {
  const store = getStore({ name:"card-cache", consistency:"strong" });
  try { await runListingsRefresh(store); }
  catch(e) {
    await store.setJSON("listings-status", { status:"error", error:e.message, failedAt:new Date().toISOString() });
  }
}

export const config = { schedule:"0 3 * * *" };
