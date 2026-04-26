// netlify/functions/refresh-items-background.js
//
// Background function — Netlify detects the -background suffix and runs this
// asynchronously with a 15-minute timeout (vs 10s for synchronous functions).
// Returns 202 immediately; the client polls /api/get-cache to detect completion.
//
// Triggered by:
//   - Scheduled cron: daily at 2 PM Pacific (22:00 UTC during PDT, Apr–Nov)
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
  const cards = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const url = `${BASE}/apis/items.json?type=mlb_card&series_id=${seriesId}&page=${page}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "collect-miggy-netlify/1.0" },
    });
    if (!res.ok) throw new Error(`Items API HTTP ${res.status} series=${seriesId} page=${page}`);
    const data = await res.json();
    totalPages = data.total_pages || 1;
    for (const item of data.items || []) {
      cards.push({
        uuid:       item.uuid,
        name:       item.name,
        position:   item.display_position || item.type || "",
        team:       item.team || "",
        rarity:     item.rarity || "",
        isSellable: item.is_sellable !== false,
      });
    }
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, 80));
  }
  return cards;
}

export default async function handler(req, context) {
  const store = getStore({ name: "card-cache", consistency: "strong" });

  // Write a "refresh in progress" marker so the frontend knows work has started
  await store.setJSON("items-status", { status: "refreshing", startedAt: new Date().toISOString() });

  const result = {};
  const errors = [];

  for (const series of SERIES_LIST) {
    try {
      result[series.id] = await fetchSeriesPages(series.id);
    } catch (e) {
      errors.push({ series: series.name, error: e.message });
      result[series.id] = [];
    }
  }

  const payload = {
    updatedAt:   new Date().toISOString(),
    seriesCount: SERIES_LIST.length,
    totalCards:  Object.values(result).reduce((a, c) => a + c.length, 0),
    errors,
    data: result,
  };

  await store.setJSON("items", payload);
  // Clear the in-progress marker
  await store.setJSON("items-status", { status: "done", completedAt: payload.updatedAt });
}

// Scheduled functions must NOT have a path — Netlify forbids it.
// Manual HTTP triggers use the separate refresh-items-http.js function.
export const config = {
  schedule: "0 22 * * *",
};
