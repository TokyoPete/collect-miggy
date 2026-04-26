// netlify/functions/get-cache.js
// Public read endpoint — serves cached card data, prices, and refresh status to any browser.
// Called on page load and polled every 5 seconds when a background refresh is in progress.

import { getStore } from "@netlify/blobs";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const store = getStore({ name: "card-cache", consistency: "strong" });

  // Fetch all four blobs in parallel for speed
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
          updatedAt:   itemsPayload.updatedAt,
          totalCards:  itemsPayload.totalCards,
          seriesCount: itemsPayload.seriesCount,
          errors:      itemsPayload.errors || [],
          data:        itemsPayload.data,
        }
      : null,
    listings: listingsPayload
      ? {
          updatedAt:     listingsPayload.updatedAt,
          totalListings: listingsPayload.totalListings,
          seriesCount:   listingsPayload.seriesCount,
          errors:        listingsPayload.errors || [],
          data:          listingsPayload.data,
        }
      : null,
    // Lightweight status fields — used by the frontend to poll for completion
    // without re-downloading the full data blob every time
    itemsRefreshing:    itemsStatus?.status    === "refreshing",
    listingsRefreshing: listingsStatus?.status === "refreshing",
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Short cache — 15s max so polling detects completion quickly
      // stale-while-revalidate lets the browser serve stale while refetching
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
