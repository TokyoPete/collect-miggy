// netlify/functions/refresh-items-http.js
//
// HTTP-triggered function for manual "Refresh Cards" button in the frontend.
// This is a regular (synchronous) function — it returns 202 immediately and
// kicks off the same work as the scheduled background function.
//
// Because Netlify does not allow scheduled functions to have a custom path,
// this separate function handles the HTTP POST and writes the same blobs.
// The frontend polls /api/get-cache to detect when the work is done.
//
// URL: /api/refresh-items  (POST)

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
  const cards = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages) {
    const res = await fetch(
      `${BASE}/apis/items.json?type=mlb_card&series_id=${seriesId}&page=${page}`,
      { headers: { "User-Agent": "collect-miggy-netlify/1.0" } }
    );
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  const store = getStore({ name: "card-cache", consistency: "strong" });

  // Mark refresh as in-progress so the frontend poller can detect it
  await store.setJSON("items-status", {
    status: "refreshing",
    startedAt: new Date().toISOString(),
  });

  // Respond 202 immediately so the frontend isn't blocked
  // Use context.waitUntil to run the actual fetch in the background
  const work = (async () => {
    const result = {}, errors = [];
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
    await store.setJSON("items-status", {
      status: "done",
      completedAt: payload.updatedAt,
    });
  })();

  // context.waitUntil keeps the function alive after the 202 is sent
  context.waitUntil(work);

  return new Response(JSON.stringify({ ok: true, message: "Items refresh started" }), {
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
  path: "/api/refresh-items",
};
