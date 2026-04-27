// netlify/functions/refresh-listing-single.js
// POST /api/refresh-listing-single
// Refreshes market prices for a single collection (series_id) OR a single card (uuid).
// Body: { series_id: "10028" } OR { uuid: "abc123" }
// Returns prices immediately (synchronous — single series or single card is fast).

import { getStore } from "@netlify/blobs";
import { BASE, SERIES_NAME_TO_ID, corsHeaders, jsonResponse } from "./_shared.js";

async function fetchSeriesPrices(seriesId) {
  const prices = {};
  let page = 1, totalPages = 1;
  while (page <= totalPages) {
    const res = await fetch(
      `${BASE}/apis/listings.json?type=mlb_card&series_id=${seriesId}&page=${page}`,
      { headers: { "User-Agent":"collect-miggy-netlify/1.0" } }
    );
    if (!res.ok) throw new Error(`Listings API HTTP ${res.status}`);
    const data = await res.json();
    totalPages = data.total_pages || 1;
    for (const l of data.listings || []) {
      const uuid = l.item?.uuid;
      if (!uuid) continue;
      const sellNowPrice = l.best_sell_price === "-" ? 0 : Number(l.best_sell_price || 0);
      const buyNowPrice  = l.best_buy_price  === "-" ? 0 : Number(l.best_buy_price  || 0);
      prices[uuid] = { sellNowPrice, buyNowPrice };
    }
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, 80));
  }
  return prices;
}

async function fetchSingleListing(uuid) {
  // Use the Listing API (singular) for a single card by UUID
  const res = await fetch(`${BASE}/apis/listing.json?uuid=${uuid}`, {
    headers: { "User-Agent":"collect-miggy-netlify/1.0" },
  });
  if (!res.ok) throw new Error(`Listing API HTTP ${res.status} uuid=${uuid}`);
  const data = await res.json();
  const listing = data.listing;
  if (!listing) return null;
  const sellNowPrice = listing.best_sell_price === "-" ? 0 : Number(listing.best_sell_price || 0);
  const buyNowPrice  = listing.best_buy_price  === "-" ? 0 : Number(listing.best_buy_price  || 0);
  return { sellNowPrice, buyNowPrice };
}

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST") return jsonResponse({ error:"Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error:"Invalid JSON body" }, 400); }

  const { series_id, uuid } = body;
  if (!series_id && !uuid) return jsonResponse({ error:"Provide series_id or uuid" }, 400);

  const store = getStore({ name:"card-cache", consistency:"strong" });
  const existing = await store.get("listings", { type:"json" }).catch(() => null);
  const data = existing?.data ? { ...existing.data } : {};

  try {
    if (uuid) {
      // Single card refresh
      const price = await fetchSingleListing(uuid);
      if (price) {
        // Find which series this UUID belongs to in the existing data
        let targetSeries = series_id;
        if (!targetSeries) {
          for (const [sid, prices] of Object.entries(data)) {
            if (prices[uuid]) { targetSeries = sid; break; }
          }
        }
        if (targetSeries) {
          if (!data[targetSeries]) data[targetSeries] = {};
          data[targetSeries][uuid] = price;
        }
      }
      const payload = {
        updatedAt: new Date().toISOString(),
        totalListings: Object.values(data).reduce((a,p) => a+Object.keys(p).length, 0),
        seriesCount: Object.keys(SERIES_NAME_TO_ID).length,
        errors: [],
        data,
      };
      await store.setJSON("listings", payload);
      return jsonResponse({ ok:true, uuid, price: price || null, updatedAt:payload.updatedAt });

    } else {
      // Full series refresh
      const prices = await fetchSeriesPrices(series_id);
      data[series_id] = prices;
      const payload = {
        updatedAt: new Date().toISOString(),
        totalListings: Object.values(data).reduce((a,p) => a+Object.keys(p).length, 0),
        seriesCount: Object.keys(SERIES_NAME_TO_ID).length,
        errors: [],
        data,
      };
      await store.setJSON("listings", payload);
      return jsonResponse({ ok:true, series_id, count:Object.keys(prices).length, updatedAt:payload.updatedAt });
    }
  } catch(e) {
    return jsonResponse({ ok:false, error:e.message }, 500);
  }
}

export const config = { path:"/api/refresh-listing-single" };
