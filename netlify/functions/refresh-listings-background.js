// netlify/functions/refresh-listings-background.js
// Scheduled: 6 AM Pacific (14:00 UTC PDT).
// Fetches market prices for ALL series found in the items blob
// (both Cabrera and other series), keyed by series_id.
// HTTP equivalent: refresh-listings-http.js

import { getStore } from "@netlify/blobs";
import { BASE, CABRERA_SERIES } from "./_shared.js";

async function fetchSeriesPrices(seriesId) {
  const prices = {};
  let page = 1, totalPages = 1;
  while (page <= totalPages) {
    const res = await fetch(
      `${BASE}/apis/listings.json?type=mlb_card&series_id=${seriesId}&page=${page}`,
      { headers: { "User-Agent": "collect-miggy-netlify/1.0" } }
    );
    if (!res.ok) throw new Error(`Listings API HTTP ${res.status} series=${seriesId} page=${page}`);
    const data = await res.json();
    totalPages = data.total_pages || 1;
    for (const listing of data.listings || []) {
      const uuid = listing.item?.uuid;
      if (!uuid) continue;
      // best_sell_price = asking price (what you pay to buy now) → sellNowPrice
      // best_buy_price  = bid price   (what you receive if you sell now) → buyNowPrice
      const sellNowPrice = listing.best_sell_price === "-" ? 0 : Number(listing.best_sell_price || 0);
      const buyNowPrice  = listing.best_buy_price  === "-" ? 0 : Number(listing.best_buy_price  || 0);
      prices[uuid] = { sellNowPrice, buyNowPrice };
    }
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, 80));
  }
  return prices;
}

// Build the full list of series to refresh:
//   1. Always include all 22 Cabrera series (hardcoded IDs)
//   2. Also include any "other" series found in the items blob (using seriesMeta)
async function buildSeriesList(store) {
  const seriesMap = {}; // { id: name }

  // Always include Cabrera series
  for (const [name, id] of Object.entries(CABRERA_SERIES)) {
    seriesMap[id] = name;
  }

  // Pull "other" series from the items blob's seriesMeta
  try {
    const items = await store.get("items", { type:"json" }).catch(() => null);
    for (const s of items?.seriesMeta || []) {
      if (s.series_id && s.series_id !== -1 && !seriesMap[String(s.series_id)]) {
        seriesMap[String(s.series_id)] = s.name;
      }
    }
  } catch {}

  return Object.entries(seriesMap).map(([id, name]) => ({ id, name }));
}

export async function runListingsRefresh(store, targetSeriesIds = null) {
  await store.setJSON("listings-status", { status:"refreshing", startedAt:new Date().toISOString() });

  // Determine which series to refresh
  let seriesList;
  if (targetSeriesIds) {
    seriesList = targetSeriesIds.map(id => ({ id, name: id }));
  } else {
    seriesList = await buildSeriesList(store);
  }

  // Load existing listings blob — preserve series not being refreshed
  const existing = await store.get("listings", { type:"json" }).catch(() => null);
  const result = existing?.data ? { ...existing.data } : {};
  const errors = [];

  for (const s of seriesList) {
    try { result[s.id] = await fetchSeriesPrices(s.id); }
    catch(e) { errors.push({ series:s.name, error:e.message }); }
  }

  const payload = {
    updatedAt:     new Date().toISOString(),
    totalListings: Object.values(result).reduce((a,p) => a+Object.keys(p).length, 0),
    seriesCount:   seriesList.length,
    errors,
    data: result,
  };

  await store.setJSON("listings", payload);
  await store.setJSON("listings-status", {
    status:"done", completedAt:payload.updatedAt,
    totalListings:payload.totalListings, seriesCount:seriesList.length,
  });
  return payload;
}

export default async function handler(req, context) {
  const store = getStore({ name:"card-cache", consistency:"strong" });
  try { await runListingsRefresh(store); }
  catch(e) { await store.setJSON("listings-status", { status:"error", error:e.message, failedAt:new Date().toISOString() }); }
}

// 6 AM Pacific PDT = 14:00 UTC (Apr-Nov). Change to "0 13 * * *" for PST Nov-Mar.
export const config = { schedule: "0 14 * * *" };
