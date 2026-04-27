// netlify/functions/refresh-items-background.js
//
// Weekly scheduled: Sunday 2 AM Pacific (10:00 UTC PDT).
//
// Single-phase, page-by-page. Items API already includes series + locations.
// Each page is fetched, merged into the live blob immediately (progressive),
// checkpoint saved, then moves to next page.
//
// Resume: reads checkpoint.lastCompletedPage and starts from next page.
// Cancel: checked before each page. Checkpoint rolled back one page by cancel-refresh.js.
// Integrity: items-manifest tracks expectedPages vs completedPages.

import { getStore } from "@netlify/blobs";
import {
  BASE, CABRERA_SERIES, REQUIRED_COUNTS,
  itemToCard, fetchSeriesMeta,
} from "./_shared.js";

const PAGE_DELAY = 150; // ms between pages

class CancelledError extends Error {
  constructor() { super("Cancelled by user"); this.cancelled = true; }
}

async function checkCancel(store) {
  const flag = await store.get("items-cancel", { type:"json" }).catch(() => null);
  if (flag?.cancelled) {
    await store.delete("items-cancel").catch(() => {});
    throw new CancelledError();
  }
}

async function setStatus(store, pctComplete, phase, extra = {}) {
  await store.setJSON("items-status", {
    status: "refreshing", pctComplete, phase,
    updatedAt: new Date().toISOString(), ...extra,
  });
}

// Process one item into the correct bucket (no API call needed)
function processItem(item, cabData, otherData, seenUUIDs) {
  if (!item?.uuid || seenUUIDs.has(item.uuid)) return;
  seenUUIDs.add(item.uuid);

  const card       = itemToCard(item);
  const seriesName = item.series || "Unknown";
  const seriesId   = CABRERA_SERIES[seriesName]; // undefined if not a Cabrera series

  if (seriesId && cabData[seriesId]) {
    cabData[seriesId].cards.push(card);
  } else {
    if (!otherData[seriesName]) otherData[seriesName] = { cards:[] };
    otherData[seriesName].cards.push(card);
  }
}

// Write the live items blob after each page
async function writeBlob(store, cabData, otherData, seriesMeta, pagesLoaded, totalPages) {
  for (const sd of Object.values(cabData))  sd.totalInDatabase = sd.cards.length;
  for (const sd of Object.values(otherData)) sd.totalInDatabase = sd.cards.length;

  const totalCab   = Object.values(cabData).reduce((a,s) => a+s.cards.length, 0);
  const totalOther = Object.values(otherData).reduce((a,s) => a+s.cards.length, 0);

  await store.setJSON("items", {
    updatedAt:         new Date().toISOString(),
    pagesLoaded,
    totalPages,
    complete:          pagesLoaded >= totalPages,
    totalCards:        totalCab + totalOther,
    totalCabreraCards: totalCab,
    totalOtherCards:   totalOther,
    seriesMeta,        // full series list from meta API for frontend display
    cabData,           // { [series_id]: { cards[], totalInCollection, totalInDatabase } }
    otherData,         // { [series_name]: { cards[], totalInDatabase } }
  });
}

// ── Main refresh logic (shared with HTTP handler) ─────────────────────────────
export async function runItemsRefresh(store) {
  await store.delete("items-cancel").catch(() => {});

  // Fetch series meta (non-fatal if unavailable)
  await setStatus(store, 0, "Fetching series metadata…");
  let seriesMeta = [];
  try { seriesMeta = await fetchSeriesMeta(); }
  catch(e) { console.warn("Meta API failed:", e.message); }

  // Check for resume checkpoint
  const checkpoint  = await store.get("items-checkpoint", { type:"json" }).catch(() => null);
  const isResume    = !!(checkpoint?.lastCompletedPage);
  const startPage   = isResume ? checkpoint.lastCompletedPage + 1 : 1;

  // Initialize data buckets
  const cabData = {};
  for (const id of Object.values(CABRERA_SERIES)) {
    cabData[id] = { cards:[], totalInCollection:REQUIRED_COUNTS[id]||0, totalInDatabase:0 };
  }
  const otherData = {};
  const seenUUIDs = new Set();

  // If resuming, reload existing blob data so we don't lose prior pages
  if (isResume) {
    const existing = await store.get("items", { type:"json" }).catch(() => null);
    if (existing?.cabData) {
      for (const [id, sd] of Object.entries(existing.cabData)) {
        if (cabData[id]) {
          cabData[id].cards = sd.cards || [];
          for (const c of cabData[id].cards) seenUUIDs.add(c.uuid);
        }
      }
    }
    if (existing?.otherData) {
      for (const [name, sd] of Object.entries(existing.otherData)) {
        otherData[name] = { cards: sd.cards || [] };
        for (const c of otherData[name].cards) seenUUIDs.add(c.uuid);
      }
    }
  }

  // Discover total pages — always fetch page 1 metadata
  // (even when resuming, in case total_pages changed)
  let totalPages = checkpoint?.totalPages || 0;
  if (!totalPages || startPage === 1) {
    await checkCancel(store);
    const r = await fetch(`${BASE}/apis/items.json?type=mlb_card&page=1`, {
      headers: { "User-Agent": "collect-miggy-netlify/1.0" },
    });
    if (!r.ok) throw new Error(`Items API HTTP ${r.status} page=1`);
    const d = await r.json();
    totalPages = d.total_pages || 1;

    // Process page 1 if this is a fresh start
    if (!isResume) {
      for (const item of d.items||[]) processItem(item, cabData, otherData, seenUUIDs);
      await writeBlob(store, cabData, otherData, seriesMeta, 1, totalPages);
      await store.setJSON("items-checkpoint", { lastCompletedPage:1, totalPages });
      await store.setJSON("items-manifest", { expectedPages:totalPages, completedPages:1, complete:false, startedAt:new Date().toISOString() });
      await setStatus(store, Math.round((1/totalPages)*100), `Page 1 of ${totalPages} (${Math.round((1/totalPages)*100)}%)…`);
    }
  }

  // Fetch remaining pages
  for (let page = Math.max(startPage, 2); page <= totalPages; page++) {
    await checkCancel(store);

    const r = await fetch(`${BASE}/apis/items.json?type=mlb_card&page=${page}`, {
      headers: { "User-Agent": "collect-miggy-netlify/1.0" },
    });
    if (!r.ok) throw new Error(`Items API HTTP ${r.status} page=${page}`);
    const d = await r.json();

    for (const item of d.items||[]) processItem(item, cabData, otherData, seenUUIDs);

    const pct = Math.round((page / totalPages) * 100);
    await writeBlob(store, cabData, otherData, seriesMeta, page, totalPages);
    await store.setJSON("items-checkpoint", { lastCompletedPage:page, totalPages });
    await store.setJSON("items-manifest", { expectedPages:totalPages, completedPages:page, complete:false });
    await setStatus(store, pct, `Loading cards: page ${page} of ${totalPages} (${pct}%)…`);

    if (page < totalPages) await new Promise(r => setTimeout(r, PAGE_DELAY));
  }

  // All pages done — finalize
  const totalCab   = Object.values(cabData).reduce((a,s)  => a+s.cards.length, 0);
  const totalOther = Object.values(otherData).reduce((a,s) => a+s.cards.length, 0);

  await store.setJSON("items-manifest", {
    expectedPages:totalPages, completedPages:totalPages, complete:true,
    completedAt:new Date().toISOString(),
    totalCabreraCards:totalCab, totalOtherCards:totalOther,
  });
  await store.delete("items-checkpoint").catch(() => {});
  await store.setJSON("items-status", {
    status:"done", pctComplete:100,
    completedAt:new Date().toISOString(),
    totalCabreraCards:totalCab, totalOtherCards:totalOther, totalPages,
  });
}

// ── Scheduled handler ─────────────────────────────────────────────────────────
export default async function handler(req, context) {
  const store = getStore({ name:"card-cache", consistency:"strong" });
  try { await runItemsRefresh(store); }
  catch(e) {
    if (e.cancelled) return;
    await store.setJSON("items-status", { status:"error", error:e.message, failedAt:new Date().toISOString() });
  }
}

export const config = { schedule:"0 10 * * 0" };
