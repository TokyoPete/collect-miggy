// netlify/functions/delete-cards.js
// POST /api/delete-cards
// Deletes card(s) from the items blob. Does NOT touch user collected state.
// Body options:
//   { uuid: "abc123" }            — delete one card by UUID
//   { series_id: "10028" }        — delete ALL cards in a collection
// Returns: { ok, deleted, seriesId }

import { getStore } from "@netlify/blobs";
import { SERIES_NAME_TO_ID, REQUIRED_COUNTS, corsHeaders, jsonResponse } from "./_shared.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST") return jsonResponse({ error:"Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error:"Invalid JSON body" }, 400); }

  const { uuid, series_id } = body;
  if (!uuid && !series_id) return jsonResponse({ error:"Provide uuid or series_id" }, 400);

  const store = getStore({ name:"card-cache", consistency:"strong" });
  const existing = await store.get("items", { type:"json" }).catch(() => null);
  if (!existing?.data) return jsonResponse({ error:"No items data found" }, 404);

  const data = {};
  for (const id of Object.values(SERIES_NAME_TO_ID)) {
    data[id] = {
      cards: [],
      totalInCollection: REQUIRED_COUNTS[id] || 0,
      totalInDatabase: 0,
    };
  }

  let deleted = 0;

  for (const [sid, sd] of Object.entries(existing.data)) {
    if (!data[sid]) continue;
    if (series_id && sid === series_id) {
      // Delete all cards in this collection — just leave array empty
      deleted = sd.cards?.length || 0;
      data[sid].cards = [];
    } else {
      // Copy all cards except the one being deleted
      for (const card of sd.cards || []) {
        if (uuid && card.uuid === uuid) { deleted++; continue; }
        data[sid].cards.push(card);
      }
    }
    data[sid].totalInDatabase = data[sid].cards.length;
  }

  if (deleted === 0) return jsonResponse({ ok:false, error:"Card not found" }, 404);

  const payload = {
    updatedAt:  new Date().toISOString(),
    totalCards: Object.values(data).reduce((a,s) => a+s.cards.length, 0),
    totalUUIDs: existing.totalUUIDs || 0,
    data,
  };

  await store.setJSON("items", payload);
  return jsonResponse({ ok:true, deleted, uuid:uuid||null, series_id:series_id||null, updatedAt:payload.updatedAt });
}

export const config = { path:"/api/delete-cards" };
