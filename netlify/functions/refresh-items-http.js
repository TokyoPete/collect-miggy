// netlify/functions/refresh-items-http.js
//
// HTTP-triggered equivalent of refresh-items-background.js.
// Called by the "Refresh Cards" button in the frontend.
// Returns 202 immediately; uses context.waitUntil to run in background.
// Frontend polls /api/get-cache every 5s to detect completion.
//
// Two-phase process:
//   Phase 1 — Items API (paginated): harvest all mlb_card UUIDs
//   Phase 2 — Item API (per UUID, batched): fetch series + location for each card
//
// URL: POST /api/refresh-items

import { getStore } from "@netlify/blobs";

const BASE = "https://mlb26.theshow.com";

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

const REQUIRED_COUNTS = {
  "10028": 142, "10004": 39,  "10046": 30,  "10035": 27,
  "10017": 24,  "10050": 23,  "10044": 18,  "10005": 18,
  "10002": 17,  "10039": 16,  "10020": 15,  "10043": 15,
  "10047": 12,  "10003": 11,  "10006": 9,   "10062": 8,
  "10001": 6,   "10068": 4,   "10034": 3,   "10049": 2,
  "10022": 2,   "10045": 1,
};

async function harvestAllUUIDs() {
  const uuids = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages) {
    const res = await fetch(`${BASE}/apis/items.json?type=mlb_card&page=${page}`, {
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

async function fetchItemDetail(uuid) {
  const res = await fetch(`${BASE}/apis/item.json?uuid=${uuid}`, {
    headers: { "User-Agent": "collect-miggy-netlify/1.0" },
  });
  if (!res.ok) throw new Error(`Item API HTTP ${res.status} uuid=${uuid}`);
  return await res.json();
}

async function fetchItemDetailsBatched(uuids, batchSize = 10, delayMs = 150) {
  const results = [];
  for (let i = 0; i < uuids.length; i += batchSize) {
    const batch = uuids.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(uuid => fetchItemDetail(uuid))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
    if (i + batchSize < uuids.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

async function runRefresh(store) {
  await store.setJSON("items-status", {
    status: "refreshing",
    phase: "Harvesting UUIDs…",
    startedAt: new Date().toISOString(),
  });

  // Phase 1
  const allUUIDs = await harvestAllUUIDs();

  await store.setJSON("items-status", {
    status: "refreshing",
    phase: `Fetching details for ${allUUIDs.length} cards…`,
    startedAt: new Date().toISOString(),
  });

  // Phase 2
  const itemDetails = await fetchItemDetailsBatched(allUUIDs, 10, 150);

  // Bucket by series
  const bySeriesId = {};
  for (const id of Object.values(SERIES_NAME_TO_ID)) {
    bySeriesId[id] = [];
  }

  for (const item of itemDetails) {
    const seriesId = SERIES_NAME_TO_ID[item.series];
    if (!seriesId) continue;

    const locations = Array.isArray(item.locations) ? item.locations : [];
    const isSellable = locations.some(l =>
      l.toUpperCase().includes("MARKET") || l.toUpperCase().includes("EXCHANGE")
    );

    bySeriesId[seriesId].push({
      uuid:      item.uuid,
      name:      item.name,
      position:  item.display_position || "",
      team:      item.team || "",
      rarity:    item.rarity || "",
      locations,
      isSellable,
    });
  }

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
}

export default async function handler(req, context) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  const store = getStore({ name: "card-cache", consistency: "strong" });

  // Mark as starting before returning 202
  await store.setJSON("items-status", {
    status: "refreshing",
    phase: "Starting…",
    startedAt: new Date().toISOString(),
  });

  context.waitUntil(
    runRefresh(store).catch(async e => {
      await store.setJSON("items-status", {
        status: "error",
        error: e.message,
        failedAt: new Date().toISOString(),
      });
    })
  );

  return new Response(
    JSON.stringify({ ok: true, message: "Card database refresh started in background" }),
    { status: 202, headers: { "Content-Type": "application/json", ...corsHeaders() } }
  );
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "https://collect-miggy.netlify.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const config = {
  path: "/api/refresh-items",
};
