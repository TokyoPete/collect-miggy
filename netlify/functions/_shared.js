// netlify/functions/_shared.js
// Shared constants and helpers for all Netlify functions.

export const BASE = "https://mlb26.theshow.com";

// ── Carlos Beltran Hall of Fame collection ────────────────────────────────────
// 32 series available, 30 of 32 required (2 skips).
// Keys: EXACT series names from the Items API / metadata API.
// Values: series_id used by the Listings API.
//
// Placeholder IDs (90001–90016) are used for series whose real IDs were not
// yet published in the metadata API. The items refresh buckets cards by NAME
// so card data populates correctly even with placeholder IDs. Only the listings
// price refresh is affected until real IDs appear in the metadata API — at that
// point update the placeholder values below.
export const BELTRAN_SERIES = {
  "World Baseball Classic": "10028",
  "Spotlight":              "10047",
  "Topps Now":              "10017",
  "2026 All-Star":          "90010", // placeholder — new series
  "Jolt":                   "10046",
  "Awards":                 "10005",
  "Prime":                  "10013",
  "All-Star":               "10004",
  "2026 Draft":             "90011", // placeholder — new series
  "Mural":                  "90002", // placeholder — new series
  "Summer":                 "90016", // placeholder — new series
  "Cityscapes":             "90001", // placeholder — new series
  "Vintage":                "90003", // placeholder — new series
  "Spring Breakout":        "10039",
  "New Threads":            "10050",
  "2nd Half Heroes":        "10020",
  "The Negro Leagues":      "10035",
  "Egg Hunt":               "10043",
  "Contributor":            "10044",
  "Postseason":             "10006",
  "Breakout":               "10002",
  "Veteran":                "10003",
  "Milestone":              "10022",
  "Standout":               "10034",
  "St. Patrick's Day":      "10062",
  "Rookie":                 "10001",
  "2026 Home Run Derby":    "90012", // placeholder — new series
  "Cornerstone":            "10049",
  "Finest":                 "90014", // placeholder — new series
  "Signature":              "10009",
  "Hall of Fame":           "90013", // placeholder — new series
  "Last Ride":              "10045",
};

// Backwards-compatible aliases used by other function files
export const CABRERA_SERIES    = BELTRAN_SERIES;
export const VMART_SERIES      = BELTRAN_SERIES;
export const SERIES_NAME_TO_ID = BELTRAN_SERIES;

export const SERIES_DISPLAY_NAME = {}; // no display name overrides needed

export const SERIES_ID_TO_NAME = Object.fromEntries(
  Object.entries(BELTRAN_SERIES).map(([name, id]) => [id, name])
);

// Cards required per series to earn that series' voucher toward Carlos Beltran.
export const REQUIRED_COUNTS = {
  "10028": 142, // World Baseball Classic
  "10047": 102, // Spotlight
  "10017": 87,  // Topps Now
  "90010": 60,  // 2026 All-Star
  "10046": 55,  // Jolt
  "10013": 3,   // Prime
  "10004": 47,  // All-Star
  "10005": 40,  // Awards
  "90011": 29,  // 2026 Draft
  "90002": 29,  // Mural
  "90016": 29,  // Summer
  "90001": 30,  // Cityscapes
  "90003": 27,  // Vintage
  "10039": 16,  // Spring Breakout
  "10050": 23,  // New Threads
  "10020": 19,  // 2nd Half Heroes
  "10035": 32,  // The Negro Leagues
  "10043": 18,  // Egg Hunt
  "10044": 19,  // Contributor
  "10006": 13,  // Postseason
  "10002": 19,  // Breakout
  "10003": 12,  // Veteran
  "10022": 17,  // Milestone
  "10034": 9,   // Standout
  "10062": 8,   // St. Patrick's Day
  "10001": 8,   // Rookie
  "90012": 7,   // 2026 Home Run Derby
  "10049": 5,   // Cornerstone
  "90014": 2,   // Finest
  "10009": 2,   // Signature
  "90013": 1,   // Hall of Fame
  "10045": 2,   // Last Ride
};

export const TOTAL_SERIES_COUNT    = 32;
export const REQUIRED_SERIES_COUNT = 30;

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
export function itemToCard(item) {
  const locations = (Array.isArray(item.locations) ? item.locations : [])
    .filter(l => !IGNORED_LOCATIONS.has(l.toUpperCase().trim()));
  return {
    uuid:       item.uuid,
    name:       item.name,
    position:   item.display_position || "",
    team:       item.team || "",
    rarity:     item.rarity || "",
    ovr:        item.ovr || 0,
    series:     item.series || "",
    locations,
    isSellable: item.is_sellable === true,
  };
}

// Fetch the metadata API to get the current full list of series with IDs.
// Used once per items refresh — future-proofs against new series and resolves
// real IDs for placeholder entries once the game publishes them.
export async function fetchSeriesMeta() {
  const res = await fetch(`${BASE}/apis/metadata.json`, {
    headers: { "User-Agent": "collect-miggy-netlify/1.0" },
  });
  if (!res.ok) throw new Error(`Meta API HTTP ${res.status}`);
  const data = await res.json();
  return data.series || [];
}
