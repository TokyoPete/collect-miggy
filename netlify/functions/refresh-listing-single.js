// netlify/functions/refresh-listing-single.js
// POST /api/refresh-listing-single
// Refreshes market prices for one collection (series_id) or one card (uuid).
// Prices live in a flat uuid -> price map on the "listings" blob.
//
// Body: { series_id: "10028" }  OR  { uuid: "abc123" }

import { getStore } from "@netlify/blobs";
import { BASE, corsHeaders, jsonResponse } from "./_shared.js";
import { runSeriesListingsRefresh } from "./refresh-listings-background.js";

// Single card price via the singular Listing API
async function fetchSingleListing(uuid) {
  const res = await fetch(`${BASE}/apis/listing.json?uuid=${uuid}`, {
    headers: { "User-Agent":"collect-miggy-netlify/1.0" },
  });
  if (!res.ok) throw new Error(`Listing API HTTP ${res.status} uuid=${uuid}`);
  const data = await res.json();
  const listing = data.listing || data;
  if (!listing) return null;
  const sellNowPrice = listing.best_sell_price === "-" ? 0 : Number(listing.best_sell_price || 0);
  const buyNowPrice  = listing.best_buy_price  === "-" ? 0 : Number(listing.best_buy_price  || 0);
  return { sellNowPrice, buyNowPrice };
}

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST")   return jsonResponse({ error:"Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error:"Invalid JSON body" }, 400); }

  const { series_id, uuid } = body;
  if (!series_id && !uuid) return jsonResponse({ error:"Provide series_id or uuid" }, 400);

  const store = getStore({ name:"card-cache", consistency:"strong" });

  try {
    // ── Single card ────────────────────────────────────────────────────────
    if (uuid) {
      const price = await fetchSingleListing(uuid);
      const existing = await store.get("listings", { type:"json" }).catch(() => null);
      const prices = existing?.prices ? { ...existing.prices } : {};

      if (price) prices[uuid] = price;
      else delete prices[uuid]; // no active listing — drop any stale price

      const payload = {
        ...(existing || {}),
        updatedAt:     new Date().toISOString(),
        totalListings: Object.keys(prices).length,
        prices,
      };
      await store.setJSON("listings", payload);
      return jsonResponse({ ok:true, uuid, price: price || null, updatedAt: payload.updatedAt });
    }

    // ── Whole collection ───────────────────────────────────────────────────
    // Placeholder ids fall back to a full market sweep inside this helper.
    const result = await runSeriesListingsRefresh(store, series_id);
    return jsonResponse({
      ok: true,
      series_id,
      count: result.totalListings,
      updatedAt: result.updatedAt,
    });

  } catch(e) {
    return jsonResponse({ ok:false, error:e.message }, 500);
  }
}

export const config = { path:"/api/refresh-listing-single" };
