// netlify/functions/_shared.js
// Shared constants and helpers for all Netlify functions.

export const BASE = "https://mlb26.theshow.com";

// The 26 series that make up the Victor Martinez Legends & Flashbacks collection.
// Keys are the EXACT series names returned by the Items API (and meta API).
// Values are the series_id used by the Listings API.
//
// NOTE: Cityscapes, Mural, and Vintage are new series introduced alongside this
// collection. Their series_ids were not yet available in the metadata API at
// the time this was written, so placeholder IDs (90001-90003) are used.
// fetchSeriesMeta() runs on every items refresh and the items refresh buckets
// cards by NAME (not ID) — so card data for these series will populate correctly
// even with placeholder IDs. The placeholder IDs only affect the LISTINGS
// (price) refresh for these 3 series until corrected. Once the real series_ids
// appear in the metadata API, update VMART_SERIES below with the correct values.
export const VMART_SERIES = {
  "World Baseball Classic": "10028",
  "Spotlight":              "10047",
  "Topps Now":              "10017",
  "All-Star":               "10004",
  "Awards":                 "10005",
  "The Negro Leagues":      "10035",
  "Cityscapes":             "90001", // placeholder — update once known
  "Jolt":                   "10046",
  "Mural":                  "90002", // placeholder — update once known
  "Vintage":                "90003", // placeholder — update once known
  "New Threads":            "10050",
  "Contributor":            "10044",
  "Breakout":               "10002",
  "2nd Half Heroes":        "10020",
  "Egg Hunt":               "10043",
  "Spring Breakout":        "10039",
  "Postseason":             "10006",
  "Veteran":                "10003",
  "Milestone":              "10022",
  "Standout":               "10034",
  "St. Patrick's Day":      "10062",
  "Rookie":                 "10001",
  "Cornerstone":            "10049",
  "Last Ride":              "10045",
  "Prime":                  "10013",
  "Signature":              "10009",
};

// Backwards-compatible aliases (previous Cabrera-era names referenced this export)
export const CABRERA_SERIES   = VMART_SERIES;
export const SERIES_NAME_TO_ID = VMART_SERIES;

// Display name overrides — none needed currently for V-Mart series,
// kept for forward compatibility with the frontend's display-name lookup.
export const SERIES_DISPLAY_NAME = {};

export const SERIES_ID_TO_NAME = Object.fromEntries(
  Object.entries(VMART_SERIES).map(([name, id]) => [id, SERIES_DISPLAY_NAME[name] || name])
);

// Cards required per series to earn that series' voucher/reward,
// per the Victor Martinez Legends & Flashbacks collection (24 of 26 required).
export const REQUIRED_COUNTS = {
  "10028": 142, // World Baseball Classic
  "10047": 70,  // Spotlight
  "10017": 63,  // Topps Now
  "10004": 45,  // All-Star
  "10005": 32,  // Awards
  "10035": 31,  // The Negro Leagues
  "90001": 30,  // Cityscapes
  "10046": 40,  // Jolt
  "90002": 29,  // Mural
  "90003": 27,  // Vintage
  "10050": 23,  // New Threads
  "10044": 19,  // Contributor
  "10002": 18,  // Breakout
  "10020": 18,  // 2nd Half Heroes
  "10043": 17,  // Egg Hunt
  "10039": 16,  // Spring Breakout
  "10006": 12,  // Postseason
  "10003": 12,  // Veteran
  "10022": 9,   // Milestone
  "10034": 8,   // Standout
  "10062": 8,   // St. Patrick's Day
  "10001": 7,   // Rookie
  "10049": 4,   // Cornerstone
  "10045": 2,   // Last Ride
  "10013": 2,   // Prime
  "10009": 1,   // Signature
};

// Total series in the collection and how many must be completed (24 of 26)
export const TOTAL_SERIES_COUNT    = 26;
export const REQUIRED_SERIES_COUNT = 24;

// Locations to completely ignore — redundant with Community Market
export const IGNORED_LOCATIONS = new Set([
  "DAILY LOGIN REWARD",
  "THE SHOW PACK",
]);

export const CORS_ORIGIN = "https://collect-miggy.netlify.app";

export function corsHeaders(methods = "GET, OPTIONS") {
  return {
    "Access-Control-Allow-Origin":  CORS_ORIGIN,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders("POST, GET, OPTIONS"),
      ...extraHeaders,
    },
  });
}

// Convert a raw item from the Items API page response into our stored card shape.
// The Items API already includes series and locations — no individual Item API call needed.
export function itemToCard(item) {
  // Filter out ignored locations
  const locations = (Array.isArray(item.locations) ? item.locations : [])
    .filter(l => !IGNORED_LOCATIONS.has(l.toUpperCase().trim()));

  // Use the API's is_sellable field directly
  const isSellable = item.is_sellable === true;

  return {
    uuid:       item.uuid,
    name:       item.name,
    position:   item.display_position || "",
    team:       item.team || "",
    rarity:     item.rarity || "",
    ovr:        item.ovr || 0,
    series:     item.series || "",
    locations,
    isSellable,
  };
}

// Fetch the meta data API to get the current full list of series with IDs.
// Used once per items refresh to future-proof against new series being added,
// and to discover/resolve real series_ids for placeholder entries (Cityscapes,
// Mural, Vintage) once MLB The Show publishes them.
export async function fetchSeriesMeta() {
  const res = await fetch(`${BASE}/apis/metadata.json`, {
    headers: { "User-Agent": "collect-miggy-netlify/1.0" },
  });
  if (!res.ok) throw new Error(`Meta API HTTP ${res.status}`);
  const data = await res.json();
  // Returns { series: [{series_id, name}, ...], ... }
  return data.series || [];
}
