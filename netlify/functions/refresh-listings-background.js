// netlify/functions/refresh-listings-background.js
// Scheduled: 6 AM Pacific (14:00 UTC PDT).
// Fetches market prices for ALL series the game currently has (V-Mart
// collection series AND "other" series), keyed by series_id.
// HTTP equivalent: refresh-listings-http.js

import { getStore } from "@netlify/blobs";
import { BASE, VMART_SERIES } from "./_shared.js";

// Placeholder series_ids used in _shared.js for series whose real IDs were
// unknown at write time (Cityscapes, Mural, Vintage). These are never valid
// Listings API series_ids — skip them unless seriesMeta resolves a real ID.
const PLACEHOLDER_ID_PREFIX = "9000";

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
//   1. Start with seriesMeta from the items blob — this is the live, authoritative
//      list of every series currently in the game (V-Mart series AND "other" series),
//      with REAL series_ids straight from the metadata API.
//   2. Layer in VMART_SERIES for any V-Mart series not yet present in seriesMeta,
//      but SKIP placeholder ids (90001-90003) — those aren't valid Listings IDs.
//      If seriesMeta has since resolved a real id for that series name, use it.
async function buildSeriesList(store) {
  const seriesMap = {}; // { id: name }
  const nameToRealId = {}; // { seriesName: realId } from seriesMeta

  // Step 1: pull every series from seriesMeta (real ids, covers V-Mart + other)
  try {
    const items = await store.get("items", { type:"json" }).catch(() => null);
    for (const s of items?.seriesMeta || []) {
      if (s.series_id === undefined || s.series_id === -1 || !s.name) continue;
      const id = String(s.series_id);
      seriesMap[id] = s.name;
      nameToRealId[s.name] = id;
    }
  } catch {}

  // Step 2: add any V-Mart series missing from seriesMeta
  for (const [name, id] of Object.entries(VMART_SERIES)) {
    const isPlaceholder = id.startsWith(PLACEHOLDER_ID_PREFIX);

    if (isPlaceholder) {
      // Use the real id from seriesMeta if it's been resolved by now
      const realId = nameToRealId[name];
      if (realId && !seriesMap[realId]) seriesMap[realId] = name;
      // If no real id is known yet, skip — placeholder ids are not callable
      continue;
    }

    if (!seriesMap[id]) seriesMap[id] = name;
  }

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
