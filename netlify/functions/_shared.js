// netlify/functions/_shared.js
// Shared constants and helper functions used across all refresh functions.
// Imported by refresh-items-background.js, refresh-items-http.js, etc.

export const BASE = "https://mlb26.theshow.com";

export const SERIES_NAME_TO_ID = {
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

export const SERIES_ID_TO_NAME = Object.fromEntries(
  Object.entries(SERIES_NAME_TO_ID).map(([name, id]) => [id, name])
);

export const REQUIRED_COUNTS = {
  "10028": 142, "10004": 39,  "10046": 30,  "10035": 27,
  "10017": 24,  "10050": 23,  "10044": 18,  "10005": 18,
  "10002": 17,  "10039": 16,  "10020": 15,  "10043": 15,
  "10047": 12,  "10003": 11,  "10006": 9,   "10062": 8,
  "10001": 6,   "10068": 4,   "10034": 3,   "10049": 2,
  "10022": 2,   "10045": 1,
};

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
    headers: { "Content-Type": "application/json", ...corsHeaders("POST, GET, OPTIONS"), ...extraHeaders },
  });
}

// Fetch a single item's full detail from the Item API
export async function fetchItemDetail(uuid) {
  const res = await fetch(`${BASE}/apis/item.json?uuid=${uuid}`, {
    headers: { "User-Agent": "collect-miggy-netlify/1.0" },
  });
  if (!res.ok) throw new Error(`Item API HTTP ${res.status} uuid=${uuid}`);
  return await res.json();
}

// Convert a raw Item API response into our stored card shape
export function itemToCard(item) {
  const locations = Array.isArray(item.locations) ? item.locations : [];
  const isSellable = locations.some(l =>
    l.toUpperCase().includes("MARKET") || l.toUpperCase().includes("EXCHANGE")
  );
  return {
    uuid:      item.uuid,
    name:      item.name,
    position:  item.display_position || "",
    team:      item.team || "",
    rarity:    item.rarity || "",
    ovr:       item.ovr || 0,
    series:    item.series || "",
    locations,
    isSellable,
  };
}
