// netlify/functions/refresh-listings-background.js
// Scheduled: 6 AM Pacific (14:00 UTC PDT) and 8 PM Pacific (04:00 UTC next day PDT).
// Fetches market buy/sell prices for all 22 series from Listings API.
// HTTP equivalent: refresh-listings-http.js

import { getStore } from "@netlify/blobs";
import { BASE, SERIES_NAME_TO_ID } from "./_shared.js";

const SERIES_LIST = Object.entries(SERIES_NAME_TO_ID).map(([name, id]) => ({ id, name }));

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
      // API: best_sell_price = what sellers ask (cost to buy now)
      //      best_buy_price  = what buyers offer (revenue if you sell now)
      const sellNowPrice  = listing.best_sell_price === "-" ? 0 : Number(listing.best_sell_price || 0);
      const buyNowPrice   = listing.best_buy_price  === "-" ? 0 : Number(listing.best_buy_price  || 0);
      prices[uuid] = { sellNowPrice, buyNowPrice };
    }
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, 80));
  }
  return prices;
}

export async function runListingsRefresh(store, targetSeriesIds = null) {
  // targetSeriesIds: null = all series, array of ids = specific series only
  const series = targetSeriesIds
    ? SERIES_LIST.filter(s => targetSeriesIds.includes(s.id))
    : SERIES_LIST;

  await store.setJSON("listings-status", { status:"refreshing", startedAt:new Date().toISOString() });

  // Load existing listings to merge into (preserve series not being refreshed)
  const existing = await store.get("listings", { type:"json" }).catch(() => null);
  const result = existing?.data ? { ...existing.data } : {};
  const errors = [];

  for (const s of series) {
    try { result[s.id] = await fetchSeriesPrices(s.id); }
    catch(e) { errors.push({ series:s.name, error:e.message }); }
  }

  const payload = {
    updatedAt:     new Date().toISOString(),
    totalListings: Object.values(result).reduce((a,p) => a+Object.keys(p).length, 0),
    seriesCount:   SERIES_LIST.length,
    errors,
    data: result,
  };

  await store.setJSON("listings", payload);
  await store.setJSON("listings-status", { status:"done", completedAt:payload.updatedAt, totalListings:payload.totalListings });
  return payload;
}

export default async function handler(req, context) {
  const store = getStore({ name:"card-cache", consistency:"strong" });
  try { await runListingsRefresh(store); }
  catch(e) { await store.setJSON("listings-status", { status:"error", error:e.message, failedAt:new Date().toISOString() }); }
}

// 6 AM Pacific PDT = 14:00 UTC (Apr-Nov). Change to "0 13 * * *" for PST Nov-Mar.
export const config = { schedule: "0 14 * * *" };
