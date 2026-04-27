// netlify/functions/get-cache.js
// Serves items blob, listings blob, manifest, and status blobs.
// Polled every 3s by frontend during an active refresh.

import { getStore } from "@netlify/blobs";
import { corsHeaders } from "./_shared.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders() });

  const store = getStore({ name:"card-cache", consistency:"strong" });

  const [itemsPayload, listingsPayload, itemsStatus, listingsStatus, checkpoint, cancelFlag, manifest] =
    await Promise.all([
      store.get("items",           { type:"json" }).catch(() => null),
      store.get("listings",        { type:"json" }).catch(() => null),
      store.get("items-status",    { type:"json" }).catch(() => null),
      store.get("listings-status", { type:"json" }).catch(() => null),
      store.get("items-checkpoint",{ type:"json" }).catch(() => null),
      store.get("items-cancel",    { type:"json" }).catch(() => null),
      store.get("items-manifest",  { type:"json" }).catch(() => null),
    ]);

  const response = {
    // Full items blob — cabData + otherData + meta
    items: itemsPayload ? {
      updatedAt:         itemsPayload.updatedAt,
      pagesLoaded:       itemsPayload.pagesLoaded,
      totalPages:        itemsPayload.totalPages,
      complete:          itemsPayload.complete,
      totalCards:        itemsPayload.totalCards,
      totalCabreraCards: itemsPayload.totalCabreraCards,
      totalOtherCards:   itemsPayload.totalOtherCards,
      seriesMeta:        itemsPayload.seriesMeta || [],
      cabData:           itemsPayload.cabData,
      otherData:         itemsPayload.otherData,
    } : null,

    listings: listingsPayload ? {
      updatedAt:     listingsPayload.updatedAt,
      totalListings: listingsPayload.totalListings,
      data:          listingsPayload.data,
    } : null,

    // Manifest — integrity check
    manifest: manifest || null,

    // Status fields polled by frontend
    itemsRefreshing:    itemsStatus?.status    === "refreshing",
    itemsCancelled:     itemsStatus?.status    === "cancelled",
    itemsPctComplete:   itemsStatus?.pctComplete  ?? null,
    itemsPhase:         itemsStatus?.phase         || null,
    itemsError:         itemsStatus?.status    === "error" ? itemsStatus.error : null,
    cancelPending:      !!cancelFlag?.cancelled,
    listingsRefreshing: listingsStatus?.status === "refreshing",
    listingsError:      listingsStatus?.status === "error" ? listingsStatus.error : null,
    hasCheckpoint:      !!checkpoint,
    checkpointPage:     checkpoint?.lastCompletedPage || null,
    checkpointTotal:    checkpoint?.totalPages || null,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=10, stale-while-revalidate=20",
      ...corsHeaders(),
    },
  });
}

export const config = { path:"/api/get-cache" };
