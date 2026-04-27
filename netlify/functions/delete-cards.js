// netlify/functions/delete-cards.js
// POST /api/delete-cards
// Deletes card(s) from BOTH the items blob AND the listings blob.
// Does NOT touch user collected state (localStorage).
//
// Body options:
//   { uuid: "abc123" }           — delete one card by UUID
//   { series_id: "10028" }       — delete ALL cards in a collection
//   { wipe_all: true }           — delete ALL card data across all collections
//
// Returns: { ok, deletedItems, deletedListings, uuid?, series_id? }

import { getStore } from "@netlify/blobs";
import { SERIES_NAME_TO_ID, REQUIRED_COUNTS, corsHeaders, jsonResponse } from "./_shared.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST") return jsonResponse({ error:"Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error:"Invalid JSON body" }, 400); }

  const { uuid, series_id, wipe_all } = body;
  if (!uuid && !series_id && !wipe_all) {
    return jsonResponse({ error:"Provide uuid, series_id, or wipe_all:true" }, 400);
  }

  const store = getStore({ name:"card-cache", consistency:"strong" });

  // ── Wipe all card data ────────────────────────────────────────────────────
  if (wipe_all) {
    await Promise.all([
      store.delete("items").catch(()=>{}),
      store.delete("listings").catch(()=>{}),
      store.delete("items-status").catch(()=>{}),
      store.delete("items-checkpoint").catch(()=>{}),
      store.delete("items-cancel").catch(()=>{}),
      store.delete("listings-status").catch(()=>{}),
    ]);
    return jsonResponse({ ok:true, wipe_all:true, message:"All card data wiped. Refresh Cards to repopulate." });
  }

  // ── Targeted delete — read both blobs ────────────────────────────────────
  const [existingItems, existingListings] = await Promise.all([
    store.get("items",    { type:"json" }).catch(() => null),
    store.get("listings", { type:"json" }).catch(() => null),
  ]);

  // ── Update items blob ─────────────────────────────────────────────────────
  let deletedItems = 0;
  let itemsPayload = null;

  if (existingItems?.data) {
    const data = {};
    for (const id of Object.values(SERIES_NAME_TO_ID)) {
      data[id] = { cards:[], totalInCollection:REQUIRED_COUNTS[id]||0, totalInDatabase:0 };
    }

    for (const [sid, sd] of Object.entries(existingItems.data)) {
      if (!data[sid]) continue;
      if (series_id && sid === series_id) {
        deletedItems = sd.cards?.length || 0;
        data[sid].cards = []; // clear entire collection
      } else {
        for (const card of sd.cards || []) {
          if (uuid && card.uuid === uuid) { deletedItems++; continue; }
          data[sid].cards.push(card);
        }
      }
      data[sid].totalInDatabase = data[sid].cards.length;
    }

    itemsPayload = {
      updatedAt:  new Date().toISOString(),
      totalCards: Object.values(data).reduce((a,s) => a+s.cards.length, 0),
      totalUUIDs: existingItems.totalUUIDs || 0,
      data,
    };
  }

  // ── Update listings blob ──────────────────────────────────────────────────
  let deletedListings = 0;
  let listingsPayload = null;

  if (existingListings?.data) {
    const data = { ...existingListings.data };

    if (series_id) {
      // Count and clear all prices for this series
      deletedListings = Object.keys(data[series_id] || {}).length;
      data[series_id] = {};
    } else if (uuid) {
      // Remove this UUID's price entry from whichever series contains it
      for (const [sid, prices] of Object.entries(data)) {
        if (prices[uuid] !== undefined) {
          delete data[sid][uuid];
          deletedListings++;
          break;
        }
      }
    }

    listingsPayload = {
      ...existingListings,
      updatedAt:     new Date().toISOString(),
      totalListings: Object.values(data).reduce((a,p) => a+Object.keys(p).length, 0),
      data,
    };
  }

  // Nothing found to delete
  if (deletedItems === 0 && deletedListings === 0) {
    return jsonResponse({ ok:false, error:"Card not found in items or listings" }, 404);
  }

  // Persist both blobs
  await Promise.all([
    itemsPayload    ? store.setJSON("items",    itemsPayload)    : Promise.resolve(),
    listingsPayload ? store.setJSON("listings", listingsPayload) : Promise.resolve(),
  ]);

  return jsonResponse({
    ok: true,
    deletedItems,
    deletedListings,
    uuid:      uuid      || null,
    series_id: series_id || null,
    updatedAt: new Date().toISOString(),
  });
}

export const config = { path:"/api/delete-cards" };
