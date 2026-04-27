// netlify/functions/_shared.js
// Shared constants and helpers for all Netlify functions.

export const BASE = "https://mlb26.theshow.com";

// The 22 series that make up the Miguel Cabrera collection.
// Keys are the EXACT series names returned by the Items API (and meta API).
// Values are the series_id used by the Listings API.
export const CABRERA_SERIES = {
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
  // NOTE: Items API returns "Mexico City" not "Mexico City Series"
  "Mexico City":            "10068",
  "Standout":               "10034",
  "Cornerstone":            "10049",
  "Milestone":              "10022",
  "Last Ride":              "10045",
};

// For backwards compatibility in the frontend which uses "Mexico City Series" as display name
export const SERIES_DISPLAY_NAME = {
  "Mexico City": "Mexico City Series",
};

export const SERIES_NAME_TO_ID = CABRERA_SERIES; // alias for compatibility

export const SERIES_ID_TO_NAME = Object.fromEntries(
  Object.entries(CABRERA_SERIES).map(([name, id]) => [id, SERIES_DISPLAY_NAME[name] || name])
);

export const REQUIRED_COUNTS = {
  "10028": 142, "10004": 39,  "10046": 30,  "10035": 27,
  "10017": 24,  "10050": 23,  "10044": 18,  "10005": 18,
  "10002": 17,  "10039": 16,  "10020": 15,  "10043": 15,
  "10047": 12,  "10003": 11,  "10006": 9,   "10062": 8,
  "10001": 6,   "10068": 4,   "10034": 3,   "10049": 2,
  "10022": 2,   "10045": 1,
};

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
// Used once per items refresh to future-proof against new series being added.
export async function fetchSeriesMeta() {
  const res = await fetch(`${BASE}/apis/metadata.json`, {
    headers: { "User-Agent": "collect-miggy-netlify/1.0" },
  });
  if (!res.ok) throw new Error(`Meta API HTTP ${res.status}`);
  const data = await res.json();
  // Returns { series: [{series_id, name}, ...], ... }
  return data.series || [];
}
