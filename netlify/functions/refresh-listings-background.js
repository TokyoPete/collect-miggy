// netlify/functions/refresh-listings-background.js
// Scheduled: 6 AM Pacific (14:00 UTC PDT).
//
// Sweeps the ENTIRE Listings API page by page (no series_id filter) and builds
// a flat uuid -> price map.
//
// Why no series filter: several collection series carry placeholder series_ids
// because the game had not published their real ids yet. The Listings API
// cannot be queried with a fake id, so those series silently returned no
// prices. Sweeping everything and keying by uuid removes the dependency on
// series ids entirely — prices attach to cards by uuid, so new and unmapped
// series get priced automatically.
//
// Blob "listings" shape:
//   { updatedAt, totalListings, pagesLoaded, totalPages, complete,
//     prices: { [uuid]: { sellNowPrice, buyNowPrice } } }

import { getStore } from "@netlify/blobs";
import { BASE } from "./_shared.js";

const PAGE_DELAY = 80;

// Fetch one page of listings and fold it into the prices map
function foldPage(data, prices) {
  for (const listing of data.listings || []) {
    const uuid = listing.item?.uuid;
    if (!uuid) continue;
    // best_sell_price = asking price  -> what you pay to buy now
    // best_buy_price  = best bid      -> what you receive if you sell now
    const sellNowPrice = listing.best_sell_price === "-" ? 0 : Number(listing.best_sell_price || 0);
    const buyNowPrice  = listing.best_buy_price  === "-" ? 0 : Number(listing.best_buy_price  || 0);
    prices[uuid] = { sellNowPrice, buyNowPrice };
  }
}

async function fetchListingsPage(page, seriesId = null) {
  const url = seriesId
    ? `${BASE}/apis/listings.json?type=mlb_card&series_id=${seriesId}&page=${page}`
    : `${BASE}/apis/listings.json?type=mlb_card&page=${page}`;
  const res = await fetch(url, { headers: { "User-Agent": "collect-miggy-netlify/1.0" } });
  if (!res.ok) throw new Error(`Listings API HTTP ${res.status} page=${page}${seriesId?` series=${seriesId}`:""}`);
  return await res.json();
}

// Full market sweep — every listed mlb_card, keyed by uuid
export async function runListingsRefresh(store) {
  await store.setJSON("listings-status", {
    status: "refreshing", startedAt: new Date().toISOString(), phase: "Starting…",
  });

  // Preserve existing prices so a mid-run failure doesn't wipe the map
  const existing = await store.get("listings", { type: "json" }).catch(() => null);
  const prices = existing?.prices ? { ...existing.prices } : {};

  let page = 1, totalPages = 1;
  const errors = [];

  while (page <= totalPages) {
    try {
      const data = await fetchListingsPage(page);
      totalPages = data.total_pages || 1;
      foldPage(data, prices);
    } catch (e) {
      errors.push({ page, error: e.message });
    }

    const pct = Math.round((page / totalPages) * 100);
    await store.setJSON("listings-status", {
      status: "refreshing",
      phase: `Loading prices: page ${page} of ${totalPages} (${pct}%)…`,
      pctComplete: pct,
      updatedAt: new Date().toISOString(),
    });

    // Write progressively so the UI fills in as the sweep runs
    await store.setJSON("listings", {
      updatedAt:     new Date().toISOString(),
      totalListings: Object.keys(prices).length,
      pagesLoaded:   page,
      totalPages,
      complete:      page >= totalPages,
      errors,
      prices,
    });

    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, PAGE_DELAY));
  }

  const payload = {
    updatedAt:     new Date().toISOString(),
    totalListings: Object.keys(prices).length,
    pagesLoaded:   totalPages,
    totalPages,
    complete:      true,
    errors,
    prices,
  };
  await store.setJSON("listings", payload);
  await store.setJSON("listings-status", {
    status: "done", completedAt: payload.updatedAt,
    totalListings: payload.totalListings, pctComplete: 100,
  });
  return payload;
}

// Refresh prices for a single series, merging into the flat map.
// Falls back to a full sweep when the series_id is a placeholder.
export async function runSeriesListingsRefresh(store, seriesId) {
  if (!seriesId || String(seriesId).startsWith("9000")) {
    return await runListingsRefresh(store);
  }

  await store.setJSON("listings-status", { status:"refreshing", startedAt:new Date().toISOString() });

  const existing = await store.get("listings", { type:"json" }).catch(() => null);
  const prices = existing?.prices ? { ...existing.prices } : {};

  let page = 1, totalPages = 1, found = 0;
  while (page <= totalPages) {
    const data = await fetchListingsPage(page, seriesId);
    totalPages = data.total_pages || 1;
    const before = Object.keys(prices).length;
    foldPage(data, prices);
    found += Object.keys(prices).length - before;
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, PAGE_DELAY));
  }

  // A real id that returns nothing usually means the id is wrong — sweep instead
  if (Object.keys(prices).length === 0) return await runListingsRefresh(store);

  const payload = {
    ...(existing || {}),
    updatedAt:     new Date().toISOString(),
    totalListings: Object.keys(prices).length,
    prices,
  };
  await store.setJSON("listings", payload);
  await store.setJSON("listings-status", {
    status:"done", completedAt:payload.updatedAt, totalListings:payload.totalListings,
  });
  return { ...payload, seriesFound: found };
}

export default async function handler(req, context) {
  const store = getStore({ name:"card-cache", consistency:"strong" });
  try { await runListingsRefresh(store); }
  catch(e) {
    await store.setJSON("listings-status", { status:"error", error:e.message, failedAt:new Date().toISOString() });
  }
}

// 6 AM Pacific PDT = 14:00 UTC (Apr-Nov). Change to "0 13 * * *" for PST Nov-Mar.
export const config = { schedule: "0 14 * * *" };
