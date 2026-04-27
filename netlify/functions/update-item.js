// netlify/functions/update-item.js
// POST /api/update-item
// Fetches fresh data for a single card UUID from the Item API and writes it
// back into the items blob (cabData or otherData depending on series).
// Also accepts pre-parsed cardData to skip the API call (CSV import path).
//
// Body options:
//   { uuid: "abc123" }                  — fetch from Item API, save to blob
//   { uuid: "abc123", cardData: {...} } — use provided data (CSV import), save to blob
//
// Returns: { ok, card, seriesId, isNew }

import { getStore } from "@netlify/blobs";
import {
  BASE, CABRERA_SERIES, REQUIRED_COUNTS, IGNORED_LOCATIONS,
  itemToCard, corsHeaders, jsonResponse,
} from "./_shared.js";

// Fetch a single card's detail from the Item API (singular endpoint)
async function fetchItemDetail(uuid) {
  const res = await fetch(`${BASE}/apis/item.json?uuid=${uuid}`, {
    headers: { "User-Agent": "collect-miggy-netlify/1.0" },
  });
  if (!res.ok) throw new Error(`Item API HTTP ${res.status} uuid=${uuid}`);
  return await res.json();
}

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders("POST, OPTIONS") });
  if (req.method !== "POST")   return jsonResponse({ error:"Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error:"Invalid JSON body" }, 400); }

  const { uuid, cardData } = body;
  if (!uuid) return jsonResponse({ error:"uuid is required" }, 400);

  try {
    let card, seriesId;

    if (cardData) {
      // CSV import path — use caller-provided data, no API call needed
      seriesId = CABRERA_SERIES[cardData.series];
      const locations = Array.isArray(cardData.locations)
        ? cardData.locations.filter(l => !IGNORED_LOCATIONS.has(l.toUpperCase().trim()))
        : [];
      card = {
        uuid:       cardData.uuid       || uuid,
        name:       cardData.name       || uuid,
        position:   cardData.position   || "",
        team:       cardData.team       || "",
        rarity:     cardData.rarity     || "",
        ovr:        cardData.ovr        || 0,
        series:     cardData.series     || "",
        locations,
        isSellable: cardData.isSellable !== undefined ? Boolean(cardData.isSellable) : false,
      };
    } else {
      // Live API path — fetch from TheShow Item API (singular)
      const item = await fetchItemDetail(uuid);
      seriesId = CABRERA_SERIES[item.series];
      card = itemToCard(item); // itemToCard handles location filtering
    }

    const store = getStore({ name:"card-cache", consistency:"strong" });
    const existing = await store.get("items", { type:"json" }).catch(() => null);

    // Work on a copy of the existing blob
    const cabData   = {};
    const otherData = existing?.otherData ? { ...existing.otherData } : {};

    // Initialize Cabrera buckets
    for (const id of Object.values(CABRERA_SERIES)) {
      cabData[id] = {
        cards: [],
        totalInCollection: REQUIRED_COUNTS[id] || 0,
        totalInDatabase: 0,
      };
    }

    let isNew = true;

    // Load existing cabData
    if (existing?.cabData) {
      for (const [id, sd] of Object.entries(existing.cabData)) {
        if (!cabData[id]) continue;
        for (const c of sd.cards || []) {
          cabData[id].cards.push(c);
          if (c.uuid === uuid) isNew = false;
        }
      }
    }

    // Also check otherData for the UUID
    for (const [sName, sd] of Object.entries(otherData)) {
      for (const c of sd.cards || []) {
        if (c.uuid === uuid) { isNew = false; break; }
      }
    }

    if (seriesId) {
      // Card belongs to a Cabrera collection
      if (isNew) {
        cabData[seriesId].cards.push(card);
      } else {
        // Update in place — could be in cabData or otherData
        let updated = false;
        for (const [id, sd] of Object.entries(cabData)) {
          const idx = sd.cards.findIndex(c => c.uuid === uuid);
          if (idx !== -1) { sd.cards[idx] = card; updated = true; break; }
        }
        // If not found in cabData, it might have been in otherData — move it
        if (!updated) {
          for (const [sName, sd] of Object.entries(otherData)) {
            const idx = (sd.cards||[]).findIndex(c => c.uuid === uuid);
            if (idx !== -1) {
              otherData[sName].cards.splice(idx, 1);
              cabData[seriesId].cards.push(card);
              break;
            }
          }
        }
      }
    } else {
      // Card belongs to an "other" (non-Cabrera) series
      const sName = card.series || "Unknown";
      if (!otherData[sName]) otherData[sName] = { cards: [] };
      if (isNew) {
        otherData[sName].cards.push(card);
      } else {
        const idx = (otherData[sName].cards||[]).findIndex(c => c.uuid === uuid);
        if (idx !== -1) otherData[sName].cards[idx] = card;
      }
    }

    // Recalculate counts
    for (const sd of Object.values(cabData))  sd.totalInDatabase = sd.cards.length;
    for (const sd of Object.values(otherData)) sd.totalInDatabase = (sd.cards||[]).length;

    const totalCab   = Object.values(cabData).reduce((a,s) => a+s.cards.length, 0);
    const totalOther = Object.values(otherData).reduce((a,s) => a+(s.cards||[]).length, 0);

    const payload = {
      updatedAt:         new Date().toISOString(),
      pagesLoaded:       existing?.pagesLoaded   || 0,
      totalPages:        existing?.totalPages     || 0,
      complete:          existing?.complete       || false,
      totalCards:        totalCab + totalOther,
      totalCabreraCards: totalCab,
      totalOtherCards:   totalOther,
      seriesMeta:        existing?.seriesMeta     || [],
      cabData,
      otherData,
    };

    await store.setJSON("items", payload);
    return jsonResponse({ ok:true, card, seriesId, isNew, updatedAt:payload.updatedAt });

  } catch(e) {
    return jsonResponse({ ok:false, error:e.message }, 500);
  }
}

export const config = { path:"/api/update-item" };
