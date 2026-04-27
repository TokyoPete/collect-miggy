// netlify/functions/refresh-items-background.js
// Weekly scheduled: Sunday 2 AM Pacific (10:00 UTC PDT / 09:00 UTC PST).
// Incremental add-only, chunked with checkpoint resume.
// See _shared.js for constants. HTTP equivalent: refresh-items-http.js.

import { getStore } from "@netlify/blobs";
import { BASE, SERIES_NAME_TO_ID, REQUIRED_COUNTS, fetchItemDetail, itemToCard } from "./_shared.js";

const BATCH_SIZE = 10, BATCH_DELAY = 150, PAGE_DELAY = 100;

async function setStatus(store, phase, extra = {}) {
  await store.setJSON("items-status", { status:"refreshing", phase, updatedAt:new Date().toISOString(), ...extra });
}

// Phase 1: harvest all UUIDs page by page, saving checkpoint after each page
async function harvestUUIDs(store, startPage, priorUUIDs) {
  const uuids = [...priorUUIDs];
  const seen = new Set(uuids);
  let page = startPage, totalPages = 999;

  while (page <= totalPages) {
    await setStatus(store, `Phase 1 of 2: building UUID list, page ${page}…`);
    const res = await fetch(`${BASE}/apis/items.json?type=mlb_card&page=${page}`, {
      headers: { "User-Agent": "collect-miggy-netlify/1.0" },
    });
    if (!res.ok) throw new Error(`Items API HTTP ${res.status} page=${page}`);
    const data = await res.json();
    totalPages = data.total_pages || 1;
    for (const item of data.items || []) {
      if (item.uuid && !seen.has(item.uuid)) { seen.add(item.uuid); uuids.push(item.uuid); }
    }
    await store.setJSON("items-checkpoint", {
      phase:1, lastCompletedPage:page, totalPages, uuids, processedUUIDs:[],
    });
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, PAGE_DELAY));
  }
  return uuids;
}

// Phase 2: fetch Item API for new UUIDs only (skip existing), checkpoint after each batch
async function enrichNewUUIDs(store, allUUIDs, existingSet, processedSoFar) {
  const processedSet = new Set(processedSoFar);
  const toFetch = allUUIDs.filter(u => !existingSet.has(u) && !processedSet.has(u));
  const newItems = [];

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(uuid => fetchItemDetail(uuid)));
    for (const r of results) { if (r.status === "fulfilled") newItems.push(r.value); }
    batch.forEach(u => processedSet.add(u));

    const done = i + batch.length, total = toFetch.length;
    await setStatus(store, `Phase 2 of 2: fetching card details, ${done}/${total} new cards…`);
    await store.setJSON("items-checkpoint", {
      phase:2, uuids:allUUIDs, processedUUIDs:[...processedSet], updatedAt:new Date().toISOString(),
    });
    if (i + BATCH_SIZE < toFetch.length) await new Promise(r => setTimeout(r, BATCH_DELAY));
  }
  return newItems;
}

// Merge new items into the existing items blob (add-only, no duplicates)
function mergeIntoBlob(existing, newItems) {
  const data = {};
  for (const id of Object.values(SERIES_NAME_TO_ID)) {
    data[id] = { cards:[], totalInCollection:REQUIRED_COUNTS[id]||0, totalInDatabase:0 };
  }
  const uuidToSeries = {};

  // Load existing cards
  if (existing?.data) {
    for (const [sid, sd] of Object.entries(existing.data)) {
      if (!data[sid]) continue;
      for (const card of sd.cards || []) {
        if (!uuidToSeries[card.uuid]) {
          data[sid].cards.push(card);
          uuidToSeries[card.uuid] = sid;
        }
      }
    }
  }

  // Add new cards — skip duplicates
  for (const item of newItems) {
    if (!item?.uuid || uuidToSeries[item.uuid]) continue;
    const sid = SERIES_NAME_TO_ID[item.series];
    if (!sid || !data[sid]) continue;
    const card = itemToCard(item);
    data[sid].cards.push(card);
    uuidToSeries[card.uuid] = sid;
  }

  for (const sid of Object.keys(data)) data[sid].totalInDatabase = data[sid].cards.length;

  return {
    updatedAt: new Date().toISOString(),
    totalCards: Object.values(data).reduce((a,s) => a+s.cards.length, 0),
    totalUUIDs: Object.keys(uuidToSeries).length,
    data,
  };
}

export async function runItemsRefresh(store) {
  const existing = await store.get("items", { type:"json" }).catch(() => null);
  const existingSet = new Set();
  if (existing?.data) {
    for (const sd of Object.values(existing.data))
      for (const c of sd.cards||[]) if (c.uuid) existingSet.add(c.uuid);
  }

  const checkpoint = await store.get("items-checkpoint", { type:"json" }).catch(() => null);
  let allUUIDs, processedSoFar = [];

  if (checkpoint?.phase === 1) {
    await setStatus(store, `Resuming UUID harvest from page ${checkpoint.lastCompletedPage+1}…`);
    allUUIDs = await harvestUUIDs(store, checkpoint.lastCompletedPage+1, checkpoint.uuids||[]);
  } else if (checkpoint?.phase === 2) {
    allUUIDs = checkpoint.uuids || [];
    processedSoFar = checkpoint.processedUUIDs || [];
    const remaining = allUUIDs.filter(u => !existingSet.has(u) && !processedSoFar.includes(u)).length;
    await setStatus(store, `Resuming card details: ${remaining} remaining…`);
  } else {
    allUUIDs = await harvestUUIDs(store, 1, []);
  }

  const newItems = await enrichNewUUIDs(store, allUUIDs, existingSet, processedSoFar);
  const payload = mergeIntoBlob(existing, newItems);

  await store.setJSON("items", payload);
  await store.delete("items-checkpoint").catch(() => {});
  await store.setJSON("items-status", {
    status:"done", completedAt:payload.updatedAt,
    totalCards:payload.totalCards, newCardsAdded:newItems.filter(i=>SERIES_NAME_TO_ID[i?.series]).length,
  });
}

export default async function handler(req, context) {
  const store = getStore({ name:"card-cache", consistency:"strong" });
  try { await runItemsRefresh(store); }
  catch(e) { await store.setJSON("items-status", { status:"error", error:e.message, failedAt:new Date().toISOString() }); }
}

export const config = { schedule:"0 10 * * 0" };
