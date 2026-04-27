// netlify/functions/get-cache.js
// Serves cached card data, prices, and refresh status to any browser.
// Called on page load and polled every 5s during a background refresh.

import { getStore } from "@netlify/blobs";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const store = getStore({ name: "card-cache", consistency: "strong" });

  const [itemsPayload, listingsPayload, itemsStatus, listingsStatus] =
    await Promise.all([
      store.get("items",           { type: "json" }).catch(() => null),
      store.get("listings",        { type: "json" }).catch(() => null),
      store.get("items-status",    { type: "json" }).catch(() => null),
      store.get("listings-status", { type: "json" }).catch(() => null),
    ]);

  const response = {
    items: itemsPayload
      ? {
          updatedAt:  itemsPayload.updatedAt,
          totalCards: itemsPayload.totalCards,
          totalUUIDs: itemsPayload.totalUUIDs,
          data:       itemsPayload.data,
        }
      : null,
    listings: listingsPayload
      ? {
          updatedAt:     listingsPayload.updatedAt,
          totalListings: listingsPayload.totalListings,
          data:          listingsPayload.data,
        }
      : null,
    // Status fields — polled by frontend to detect in-progress refreshes
    itemsRefreshing:    itemsStatus?.status === "refreshing",
    itemsPhase:         itemsStatus?.phase  || null,   // e.g. "Fetching details for 2400 cards…"
    itemsError:         itemsStatus?.status === "error" ? itemsStatus.error : null,
    listingsRefreshing: listingsStatus?.status === "refreshing",
    listingsError:      listingsStatus?.status === "error" ? listingsStatus.error : null,
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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "https://collect-miggy.netlify.app",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const config = {
  path: "/api/get-cache",
};
