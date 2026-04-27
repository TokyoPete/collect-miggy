// netlify/functions/get-cache.js
// Public read endpoint — serves items blob, listings blob, and refresh statuses.
// Polled every 5s by the frontend during background refreshes.

import { getStore } from "@netlify/blobs";
import { corsHeaders } from "./_shared.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders() });

  const store = getStore({ name:"card-cache", consistency:"strong" });

  const [itemsPayload, listingsPayload, itemsStatus, listingsStatus, checkpoint, cancelFlag] =
    await Promise.all([
      store.get("items",            { type:"json" }).catch(() => null),
      store.get("listings",         { type:"json" }).catch(() => null),
      store.get("items-status",     { type:"json" }).catch(() => null),
      store.get("listings-status",  { type:"json" }).catch(() => null),
      store.get("items-checkpoint", { type:"json" }).catch(() => null),
      store.get("items-cancel",     { type:"json" }).catch(() => null),
    ]);

  const response = {
    items: itemsPayload ? {
      updatedAt:  itemsPayload.updatedAt,
      totalCards: itemsPayload.totalCards,
      totalUUIDs: itemsPayload.totalUUIDs,
      data:       itemsPayload.data,
    } : null,
    listings: listingsPayload ? {
      updatedAt:     listingsPayload.updatedAt,
      totalListings: listingsPayload.totalListings,
      data:          listingsPayload.data,
    } : null,
    itemsRefreshing:    itemsStatus?.status === "refreshing",
    itemsCancelled:     itemsStatus?.status === "cancelled",
    cancelPending:      !!cancelFlag?.cancelled,   // cancel was requested but function hasn't stopped yet
    itemsPhase:         itemsStatus?.phase  || null,
    itemsError:         itemsStatus?.status === "error" ? itemsStatus.error : null,
    listingsRefreshing: listingsStatus?.status === "refreshing",
    listingsError:      listingsStatus?.status === "error" ? listingsStatus.error : null,
    hasCheckpoint:      !!checkpoint,
    checkpointPhase:    checkpoint?.phase || null,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=15, stale-while-revalidate=30",
      ...corsHeaders(),
    },
  });
}

export const config = { path:"/api/get-cache" };
