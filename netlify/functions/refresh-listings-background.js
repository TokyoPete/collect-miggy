// netlify/functions/refresh-listings-background.js
//
// Background function — runs asynchronously with a 15-minute timeout.
// Returns 202 immediately; client polls /api/get-cache to detect completion.
//
// Triggered by:
//   - Scheduled cron: every hour on the hour (0 * * * *)
//   - Manual POST from the frontend refresh button

import { getStore } from "@netlify/blobs";

const BASE = "https://mlb26.theshow.com";

const SERIES_LIST = [
  { id: "10028", name: "World Baseball Classic", required: 142 },
  { id: "10004", name: "All-Star",               required: 39  },
  { id: "10046", name: "Jolt",                   required: 30  },
  { id: "10035", name: "The Negro Leagues",       required: 27  },
  { id: "10017", name: "Topps Now",              required: 24  },
  { id: "10050", name: "New Threads",            required: 23  },
  { id: "10044", name: "Contributor",            required: 18  },
  { id: "10005", name: "Awards",                 required: 18  },
  { id: "10002", name: "Breakout",               required: 17  },
  { id: "10039", name: "Spring Breakout",        required: 16  },
  { id: "10020", name: "2nd Half Heroes",        required: 15  },
  { id: "10043", name: "Egg Hunt",               required: 15  },
  { id: "10047", name: "Spotlight",              required: 12  },
  { id: "10003", name: "Veteran",                required: 11  },
  { id: "10006", name: "Postseason",             required: 9   },
  { id: "10062", name: "St. Patrick's Day",      required: 8   },
  { id: "10001", name: "Rookie",                 required: 6   },
  { id: "10068", name: "Mexico City Series",     required: 4   },
  { id: "10034", name: "Standout",               required: 3   },
  { id: "10049", name: "Cornerstone",            required: 2   },
  { id: "10022", name: "Milestone",              required: 2   },
  { id: "10045", name: "Last Ride",              required: 1   },
];

async function fetchSeriesPages(seriesId) {
  // Returns { uuid: { sellPrice, buyPrice } } for all market listings in a series
  const prices = {};
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const url = `${BASE}/apis/listings.json?type=mlb_card&series_id=${seriesId}&page=${page}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "collect-miggy-netlify/1.0" },
    });
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
  const store = getStore({ name: "card-cache", consistency: "strong" });

  // Write in-progress marker
  await store.setJSON("listings-status", { status: "refreshing", startedAt: new Date().toISOString() });

  const result = {};
  const errors = [];

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
  // Clear in-progress marker
  await store.setJSON("listings-status", { status: "done", completedAt: payload.updatedAt });
}

// Scheduled functions must NOT have a path — Netlify forbids it.
// Manual HTTP triggers use the separate refresh-listings-http.js function.
export const config = {
  schedule: "0 * * * *",
};
