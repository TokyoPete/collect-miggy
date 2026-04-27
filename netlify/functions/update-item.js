// netlify/functions/update-item.js
// POST /api/update-item
// Fetches fresh Item API data for a single UUID and writes it back to the items blob.
// Optionally accepts pre-parsed cardData (from CSV import) to skip the Item API call.
//
// Body options:
//   { uuid: "abc123" }                     — fetch from Item API and save
//   { uuid: "abc123", cardData: {...} }    — use provided data (CSV import path), still saves
//
// Returns: { ok, card, seriesId, isNew }

import { getStore } from "@netlify/blobs";
import {
  SERIES_NAME_TO_ID, REQUIRED_COUNTS,
  fetchItemDetail, itemToCard, corsHeaders, jsonResponse,
} from "./_shared.js";

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST") return jsonResponse({ error:"Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error:"Invalid JSON body" }, 400); }

  const { uuid, cardData } = body;
  if (!uuid) return jsonResponse({ error:"uuid is required" }, 400);

  try {
    let item, card, seriesId;

    if (cardData) {
      // CSV import path — use provided data, derive seriesId from series name
      seriesId = SERIES_NAME_TO_ID[cardData.series];
      card = {
        uuid:      cardData.uuid      || uuid,
        name:      cardData.name      || uuid,
        position:  cardData.position  || "",
        team:      cardData.team      || "",
        rarity:    cardData.rarity    || "",
        ovr:       cardData.ovr       || 0,
        series:    cardData.series    || "",
        locations: Array.isArray(cardData.locations) ? cardData.locations : [],
        isSellable:cardData.isSellable !== undefined ? cardData.isSellable : false,
      };
    } else {
      // Item API path — fetch fresh from TheShow.com
      item = await fetchItemDetail(uuid);
      seriesId = SERIES_NAME_TO_ID[item.series];
      card = itemToCard(item);
    }

    const store = getStore({ name:"card-cache", consistency:"strong" });
    const existing = await store.get("items", { type:"json" }).catch(() => null);

    const data = {};
    for (const id of Object.values(SERIES_NAME_TO_ID)) {
      data[id] = { cards:[], totalInCollection:REQUIRED_COUNTS[id]||0, totalInDatabase:0 };
    }

    let isNew = true;
    if (existing?.data) {
      for (const [sid, sd] of Object.entries(existing.data)) {
        if (!data[sid]) continue;
        for (const c of sd.cards || []) {
          data[sid].cards.push(c);
          if (c.uuid === uuid) isNew = false;
        }
      }
    }

    if (seriesId && data[seriesId]) {
      if (isNew) {
        data[seriesId].cards.push(card);
      } else {
        // Update in place
        for (const [sid, sd] of Object.entries(data)) {
          const idx = sd.cards.findIndex(c => c.uuid === uuid);
          if (idx !== -1) { data[sid].cards[idx] = card; break; }
        }
      }
    }

    for (const sid of Object.keys(data)) data[sid].totalInDatabase = data[sid].cards.length;

    const payload = {
      updatedAt:  new Date().toISOString(),
      totalCards: Object.values(data).reduce((a,s) => a+s.cards.length, 0),
      totalUUIDs: existing?.totalUUIDs || 0,
      data,
    };

    await store.setJSON("items", payload);
    return jsonResponse({ ok:true, card, seriesId, isNew, updatedAt:payload.updatedAt });

  } catch(e) {
    return jsonResponse({ ok:false, error:e.message }, 500);
  }
}

export const config = { path:"/api/update-item" };

