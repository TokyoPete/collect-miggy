// netlify/functions/update-item.js
// POST /api/update-item
// Fetches fresh Item API data for a single UUID and writes it back to the items blob.
// Used by: per-card refresh button (items 5 & 6), player search save-back (item 7).
// Body: { uuid: "abc123" }
// Returns: { ok, card, seriesId, isNew } where isNew = was not previously stored

import { getStore } from "@netlify/blobs";
import {
  SERIES_NAME_TO_ID, REQUIRED_COUNTS,
  fetchItemDetail, itemToCard, corsHeaders, jsonResponse,
} from "./_shared.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST") return jsonResponse({ error:"Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error:"Invalid JSON body" }, 400); }

  const { uuid } = body;
  if (!uuid) return jsonResponse({ error:"uuid is required" }, 400);

  try {
    // Fetch fresh item data from TheShow API
    const item = await fetchItemDetail(uuid);
    const seriesId = SERIES_NAME_TO_ID[item.series];

    const store = getStore({ name:"card-cache", consistency:"strong" });
    const existing = await store.get("items", { type:"json" }).catch(() => null);

    // Build mutable data structure from existing blob
    const data = {};
    for (const id of Object.values(SERIES_NAME_TO_ID)) {
      data[id] = {
        cards: [],
        totalInCollection: REQUIRED_COUNTS[id] || 0,
        totalInDatabase: 0,
      };
    }

    let isNew = true;
    if (existing?.data) {
      for (const [sid, sd] of Object.entries(existing.data)) {
        if (!data[sid]) continue;
        for (const card of sd.cards || []) {
          data[sid].cards.push(card);
          if (card.uuid === uuid) isNew = false;
        }
      }
    }

    const card = itemToCard(item);

    if (seriesId && data[seriesId]) {
      if (isNew) {
        // Add to its collection
        data[seriesId].cards.push(card);
      } else {
        // Update in place — replace the existing entry for this UUID
        for (const [sid, sd] of Object.entries(data)) {
          const idx = sd.cards.findIndex(c => c.uuid === uuid);
          if (idx !== -1) {
            data[sid].cards[idx] = card;
            break;
          }
        }
      }
    }

    // Recalculate counts
    for (const sid of Object.keys(data)) {
      data[sid].totalInDatabase = data[sid].cards.length;
    }

    const payload = {
      updatedAt:  new Date().toISOString(),
      totalCards: Object.values(data).reduce((a,s) => a+s.cards.length, 0),
      totalUUIDs: existing?.totalUUIDs || 0,
      data,
    };

    await store.setJSON("items", payload);

    return jsonResponse({ ok:true, card, seriesId, isNew, updatedAt:payload.updatedAt });

  } catch(e) {
    return jsonResponse({ ok:false, error:e.message }, 500);
  }
}

export const config = { path:"/api/update-item" };
