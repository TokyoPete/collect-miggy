// netlify/functions/refresh-listings-http.js
//
// HTTP-triggered function for manual "Refresh Prices" button in the frontend.
// Returns 202 immediately and runs the fetch in the background via context.waitUntil.
// The frontend polls /api/get-cache every 5 seconds to detect completion.
//
// URL: /api/refresh-listings  (POST)

import { getStore } from "@netlify/blobs";

const BASE = "https://mlb26.theshow.com";

const SERIES_LIST = [
  { id: "10028", name: "World Baseball Classic" },
  { id: "10004", name: "All-Star"               },
  { id: "10046", name: "Jolt"                   },
  { id: "10035", name: "The Negro Leagues"       },
  { id: "10017", name: "Topps Now"              },
  { id: "10050", name: "New Threads"            },
  { id: "10044", name: "Contributor"            },
  { id: "10005", name: "Awards"                 },
  { id: "10002", name: "Breakout"               },
  { id: "10039", name: "Spring Breakout"        },
  { id: "10020", name: "2nd Half Heroes"        },
  { id: "10043", name: "Egg Hunt"               },
  { id: "10047", name: "Spotlight"              },
  { id: "10003", name: "Veteran"                },
  { id: "10006", name: "Postseason"             },
  { id: "10062", name: "St. Patrick's Day"      },
  { id: "10001", name: "Rookie"                 },
  { id: "10068", name: "Mexico City Series"     },
  { id: "10034", name: "Standout"               },
  { id: "10049", name: "Cornerstone"            },
  { id: "10022", name: "Milestone"              },
  { id: "10045", name: "Last Ride"              },
];

async function fetchSeriesPages(seriesId) {
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
      const sp = listing.best_sell_price === "-" ? 0 : Number(listing.best_sell_price || 0);
      const bp = listing.best_buy_price  === "-" ? 0 : Number(listing.best_buy_price  || 0);
      prices[uuid] = { sellPrice: sp, buyPrice: bp };
    }
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, 80));
  }
  return prices;
}

export default async function handler(req, context) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  const store = getStore({ name: "card-cache", consistency: "strong" });

  await store.setJSON("listings-status", {
    status: "refreshing",
    startedAt: new Date().toISOString(),
  });

  const work = (async () => {
    const result = {}, errors = [];
    for (const series of SERIES_LIST) {
      try {
        result[series.id] = await fetchSeriesPages(series.id);
      } catch (e) {
        errors.push({ series: series.name, error: e.message });
        result[series.id] = {};
      }
    }
    const payload = {
      updatedAt:     new Date().toISOString(),
      seriesCount:   SERIES_LIST.length,
      totalListings: Object.values(result).reduce((a, p) => a + Object.keys(p).length, 0),
      errors,
      data: result,
    };
    await store.setJSON("listings", payload);
    await store.setJSON("listings-status", {
      status: "done",
      completedAt: payload.updatedAt,
    });
  })();

  context.waitUntil(work);

  return new Response(JSON.stringify({ ok: true, message: "Listings refresh started" }), {
    status: 202,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "https://collect-miggy.netlify.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const config = {
  path: "/api/refresh-listings",
};
