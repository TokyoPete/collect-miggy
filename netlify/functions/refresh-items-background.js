// netlify/functions/refresh-items-background.js
//
// Weekly scheduled background function — runs every Sunday at 2 AM Pacific
// (10:00 UTC covers PDT Apr-Nov; use 09:00 UTC for PST Nov-Mar).
//
// Two-phase process:
//   Phase 1 — Items API (paginated): harvest all mlb_card UUIDs
//   Phase 2 — Item API (per UUID, batched): fetch series + location for each card
//
// Output stored in Blob "items":
//   {
//     updatedAt, totalCards, errors,
//     data: {
//       [seriesName]: [{ uuid, name, position, team, rarity, locations, isSellable }, ...]
//     }
//   }
//
// Netlify rule: scheduled functions MUST NOT have a path.
// The HTTP-triggered equivalent is refresh-items-http.js.

import { getStore } from "@netlify/blobs";

const BASE = "https://mlb26.theshow.com";

// Series names from Item API → series IDs we use in Listings API
// Used to bucket cards by collection after Item API enrichment
const SERIES_NAME_TO_ID = {
  "World Baseball Classic": "10028",
  "All-Star":               "10004",
  "Jolt":                   "10046",
  "The Negro Leagues":      "10035",
  "Topps Now":              "10017",
  "New Threads":            "10050",
  "Contributor":            "10044",
  "Awards":                 "10005",
  "Breakout":               "10002",
  "Spring Breakout":        "10039",
  "2nd Half Heroes":        "10020",
  "Egg Hunt":               "10043",
  "Spotlight":              "10047",
  "Veteran":                "10003",
  "Postseason":             "10006",
  "St. Patrick's Day":      "10062",
  "Rookie":                 "10001",
  "Mexico City Series":     "10068",
  "Standout":               "10034",
  "Cornerstone":            "10049",
  "Milestone":              "10022",
  "Last Ride":              "10045",
};

// The 22 series IDs we care about — used to filter Item API results
const TARGET_SERIES_IDS = new Set(Object.values(SERIES_NAME_TO_ID));

const REQUIRED_COUNTS = {
  "10028": 142, "10004": 39,  "10046": 30,  "10035": 27,
  "10017": 24,  "10050": 23,  "10044": 18,  "10005": 18,
  "10002": 17,  "10039": 16,  "10020": 15,  "10043": 15,
  "10047": 12,  "10003": 11,  "10006": 9,   "10062": 8,
  "10001": 6,   "10068": 4,   "10034": 3,   "10049": 2,
  "10022": 2,   "10045": 1,
};

// ── Phase 1: Harvest all mlb_card UUIDs from Items API ────────────────────────
async function harvestAllUUIDs() {
  const uuids = [];
  let page = 1, totalPages = 1;

  while (page <= totalPages) {
    const url = `${BASE}/apis/items.json?type=mlb_card&page=${page}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "collect-miggy-netlify/1.0" },
    });
    if (!res.ok) throw new Error(`Items API HTTP ${res.status} page=${page}`);
    const data = await res.json();
    totalPages = data.total_pages || 1;
    for (const item of data.items || []) {
      if (item.uuid) uuids.push(item.uuid);
    }
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, 100));
  }
  return uuids;
}

// ── Phase 2: Fetch full item detail for a single UUID ────────────────────────
async function fetchItemDetail(uuid) {
  const url = `${BASE}/apis/item.json?uuid=${uuid}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "collect-miggy-netlify/1.0" },
  });
  if (!res.ok) throw new Error(`Item API HTTP ${res.status} uuid=${uuid}`);
  return await res.json();
}

// Run item detail fetches in batches of N concurrent requests
async function fetchItemDetailsBatched(uuids, batchSize = 10, delayMs = 150) {
  const results = [];
  for (let i = 0; i < uuids.length; i += batchSize) {
    const batch = uuids.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(uuid => fetchItemDetail(uuid))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
      // Skip failed items — they simply won't appear in the output
    }
    if (i + batchSize < uuids.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, context) {
  const store = getStore({ name: "card-cache", consistency: "strong" });

  await store.setJSON("items-status", {
    status: "refreshing",
    phase: "Harvesting UUIDs…",
    startedAt: new Date().toISOString(),
  });

  try {
    // Phase 1: get all UUIDs
    const allUUIDs = await harvestAllUUIDs();

    await store.setJSON("items-status", {
      status: "refreshing",
      phase: `Fetching details for ${allUUIDs.length} cards…`,
      startedAt: new Date().toISOString(),
    });

    // Phase 2: fetch item details in batches
    const itemDetails = await fetchItemDetailsBatched(allUUIDs, 10, 150);

    // Bucket by series ID — only keep cards belonging to our 22 target series
    const bySeriesId = {};
    for (const id of Object.values(SERIES_NAME_TO_ID)) {
      bySeriesId[id] = [];
    }

    for (const item of itemDetails) {
      const seriesId = SERIES_NAME_TO_ID[item.series];
      if (!seriesId) continue; // not one of our 22 collections — skip

      // locations is an array of strings e.g. ["PROGRAM (Team Affinity)", "MARKET"]
      const locations = Array.isArray(item.locations) ? item.locations : [];
      const isSellable = locations.some(l =>
        l.toUpperCase().includes("MARKET") || l.toUpperCase().includes("EXCHANGE")
      );

      bySeriesId[seriesId].push({
        uuid:       item.uuid,
        name:       item.name,
        position:   item.display_position || "",
        team:       item.team || "",
        rarity:     item.rarity || "",
        locations,              // raw array — used for "Where to Find" display
        isSellable,
      });
    }

    // Build final payload
    const data = {};
    for (const [seriesId, cards] of Object.entries(bySeriesId)) {
      data[seriesId] = {
        cards,
        totalInCollection: REQUIRED_COUNTS[seriesId] || 0,
        totalInDatabase:   cards.length,
      };
    }

    const payload = {
      updatedAt:  new Date().toISOString(),
      totalCards: Object.values(data).reduce((a, s) => a + s.cards.length, 0),
      totalUUIDs: allUUIDs.length,
      data,
    };

    await store.setJSON("items", payload);
    await store.setJSON("items-status", {
      status: "done",
      completedAt: payload.updatedAt,
      totalCards: payload.totalCards,
    });

  } catch (e) {
    await store.setJSON("items-status", {
      status: "error",
      error: e.message,
      failedAt: new Date().toISOString(),
    });
  }
}

// Sunday 2 AM Pacific = 10:00 UTC (PDT, Apr-Nov)
// Change to "0 9 * * 0" for PST (Nov-Mar)
export const config = {
  schedule: "0 10 * * 0",
};
