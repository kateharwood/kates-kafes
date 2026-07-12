#!/usr/bin/env node
/**
 * Discover new cafes/coffee shops near home via hex-tiled Places Nearby Search.
 *
 * Usage:
 *   npm run discover
 *
 * Writes data/discover/latest.json for the local review UI at /discover/
 *
 * Compares against your published Google Sheet (SHEET_CSV_URL in js/config.js).
 * Requires Places API (New) + Routes API. Browser-restricted keys need a
 * localhost referrer (sent automatically). Prefer a server key for scripts.
 */

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "discover");
const OUT_FILE = path.join(OUT_DIR, "latest.json");

const HOME = { lat: 40.6706039, lng: -73.9782784 };
const COVER_R = 1500;
const CELL_R = 250;
const MAX_WALK_MINS = 25;
const ALLOWED = new Set([
  "cafe",
  "coffee_shop",
  "brewery",
  "juice_shop",
  "bakery",
  "non_profit_organization",
  "library",
  "book_store",
]);
const SEARCH_TYPES = [
  "cafe",
  "coffee_shop",
  "brewery",
  "juice_shop",
  "bakery",
  "non_profit_organization",
  "library",
  "book_store",
];
const PHOTO_LIMIT = 10;

const BLOCKLIST_DEFAULTS = [
  "McDonald's",
  "Chelsea Piers Fitness",
  "Sea Lion Store and Cafe",
  "Starbucks",
  "Dunkin",
  "Blank Street",
  "Emma's Torch",
  "Auntie Anne's",
];

const PLACE_MASK =
  "places.displayName,places.formattedAddress,places.location,places.types,places.id,places.googleMapsUri,places.primaryType,places.photos";

const SHEET_COLS = [
  "id",
  "name",
  "lat",
  "lng",
  "rating",
  "walk_mins",
  "walk_bucket",
  "food",
  "food_yes_or_no",
  "notes",
  "maps_url",
  "status",
  "tried",
];

function loadApiKey() {
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY;
  const configPath = path.join(ROOT, "js", "config.js");
  if (!fs.existsSync(configPath)) {
    throw new Error("Missing js/config.js (or set GOOGLE_MAPS_API_KEY)");
  }
  const text = fs.readFileSync(configPath, "utf8");
  const m = text.match(/GOOGLE_MAPS_API_KEY:\s*"([^"]+)"/);
  if (!m) throw new Error("Could not parse GOOGLE_MAPS_API_KEY from js/config.js");
  return m[1];
}

function loadSheetUrl() {
  if (process.env.SHEET_CSV_URL) return process.env.SHEET_CSV_URL;
  const configPath = path.join(ROOT, "js", "config.js");
  if (!fs.existsSync(configPath)) return "";
  const text = fs.readFileSync(configPath, "utf8");
  const m = text.match(/SHEET_CSV_URL:\s*"([^"]*)"/);
  return m ? m[1] : "";
}

const API_KEY = loadApiKey();

const metersPerDegLat = 111320;
const metersPerDegLng = 111320 * Math.cos((HOME.lat * Math.PI) / 180);

function offset(eastM, northM) {
  return {
    lat: HOME.lat + northM / metersPerDegLat,
    lng: HOME.lng + eastM / metersPerDegLng,
  };
}

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildTiles() {
  const s = CELL_R * 1.15;
  const dy = (s * Math.sqrt(3)) / 2;
  const pts = [];
  const seen = new Set();
  for (let row = -40; row <= 40; row++) {
    const y = row * dy;
    const xOff = row % 2 === 0 ? 0 : s / 2;
    for (let col = -40; col <= 40; col++) {
      const x = col * s + xOff;
      if (Math.hypot(x, y) > COVER_R + 1) continue;
      const p = offset(x, y);
      const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push(p);
    }
  }
  return pts;
}

function post(hostname, reqPath, body, fieldMask) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path: reqPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Referer: "http://localhost:3000/",
          "X-Goog-Api-Key": API_KEY,
          "X-Goog-FieldMask": fieldMask,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw || "{}") });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function get(hostname, reqPath, fieldMask) {
  return new Promise((resolve, reject) => {
    const headers = {
      Referer: "http://localhost:3000/",
      "X-Goog-Api-Key": API_KEY,
    };
    if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;
    const req = https.request(
      {
        hostname,
        path: reqPath,
        method: "GET",
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw || "{}") });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function nearby(center, primaryType) {
  const res = await post(
    "places.googleapis.com",
    "/v1/places:searchNearby",
    {
      includedPrimaryTypes: [primaryType],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: CELL_R,
        },
      },
    },
    PLACE_MASK
  );
  if (res.body.error) {
    throw new Error(res.body.error.message || JSON.stringify(res.body.error));
  }
  return res.body.places || [];
}

async function walkFor(lat, lng) {
  const res = await post(
    "routes.googleapis.com",
    "/directions/v2:computeRoutes",
    {
      origin: {
        location: { latLng: { latitude: HOME.lat, longitude: HOME.lng } },
      },
      destination: {
        location: { latLng: { latitude: lat, longitude: lng } },
      },
      travelMode: "WALK",
      units: "METRIC",
    },
    "routes.duration,routes.distanceMeters"
  );
  const route = res.body?.routes?.[0];
  if (!route) return { walkMins: null, walkDistanceMeters: null };
  const secs = Number(String(route.duration).replace("s", ""));
  return {
    walkMins: Math.round(secs / 60),
    walkDistanceMeters: route.distanceMeters ?? null,
  };
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(coffee|cafe|kaffe|coffeeshop|the|on|ave|avenue|street|st|brooklyn|company)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function loadBlocklist() {
  const file = path.join(OUT_DIR, "blocklist.json");
  let names = [...BLOCKLIST_DEFAULTS];
  let placeIds = new Set();
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(data.names)) {
        for (const n of data.names) {
          if (n && !names.includes(n)) names.push(n);
        }
      }
      if (Array.isArray(data.entries)) {
        for (const e of data.entries) {
          if (e?.placeId) placeIds.add(e.placeId);
          if (e?.name && !names.includes(e.name)) names.push(e.name);
        }
      }
    } catch (e) {
      console.error("Could not read blocklist.json:", e.message);
    }
  }
  return { names, placeIds };
}

function isBlocklisted(place, blocklist) {
  if (place.placeId && blocklist.placeIds.has(place.placeId)) return true;
  const n = normalizeName(place.name);
  if (!n) return false;
  return blocklist.names.some((entry) => {
    const b = normalizeName(entry);
    return n === b || n.includes(b) || b.includes(n);
  });
}

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / new Set([...ta, ...tb]).size;
}

function bestMatch(place, existing) {
  let best = null;
  for (const cafe of existing) {
    const dist = haversineM(
      { lat: place.lat, lng: place.lng },
      { lat: cafe.lat, lng: cafe.lng }
    );
    const sim = nameSimilarity(place.name, cafe.name);
    let matched = false;
    let reason = "";
    if (sim >= 0.9) {
      matched = true;
      reason = `name≈${sim.toFixed(2)}`;
    } else if (sim >= 0.72 && dist <= 250) {
      matched = true;
      reason = `name≈${sim.toFixed(2)} + ${Math.round(dist)}m`;
    } else if (dist <= 75 && sim >= 0.35) {
      matched = true;
      reason = `${Math.round(dist)}m + name≈${sim.toFixed(2)}`;
    } else if (dist <= 40) {
      matched = true;
      reason = `same pin ${Math.round(dist)}m`;
    }
    if (!matched) continue;
    const score = sim * 1000 - dist;
    if (!best || score > best.score) {
      best = {
        cafe,
        dist: Math.round(dist),
        sim: Number(sim.toFixed(2)),
        reason,
        score,
      };
    }
  }
  return best;
}

function cafeMatchedBySearch(cafe, searchResults) {
  for (const place of searchResults) {
    const dist = haversineM(
      { lat: cafe.lat, lng: cafe.lng },
      { lat: place.lat, lng: place.lng }
    );
    const sim = nameSimilarity(cafe.name, place.name);
    if (sim >= 0.9) return true;
    if (sim >= 0.72 && dist <= 250) return true;
    if (dist <= 75 && sim >= 0.35) return true;
    if (dist <= 40) return true;
  }
  return false;
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function walkBucket(mins) {
  if (mins == null || mins === "") return "";
  if (mins < 15) return "under_15";
  if (mins < 20) return "15_19";
  return "20_plus";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // skip
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (r[i] || "").trim();
    });
    return obj;
  });
}

async function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "kates-kafes-discover/1.0",
            Accept: "text/csv,text/plain,*/*",
          },
        },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            redirects < 5
          ) {
            fetchText(res.headers.location, redirects + 1).then(resolve, reject);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} fetching sheet CSV`));
            return;
          }
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => resolve(raw));
        }
      )
      .on("error", reject);
  });
}

async function loadExistingCafes() {
  const sheetUrl = loadSheetUrl();
  if (!sheetUrl) {
    throw new Error(
      "SHEET_CSV_URL is required for discover. Set it in js/config.js (published Google Sheet CSV) or as an env var."
    );
  }

  console.error("Loading existing cafes from published Google Sheet…");
  const csv = await fetchText(sheetUrl);
  const rows = parseCsv(csv);
  const cafes = rows
    .filter((r) => r.name && r.lat && r.lng)
    .map((r) => ({
      id: r.id || slugify(r.name),
      name: r.name,
      lat: Number(r.lat),
      lng: Number(r.lng),
      status: r.status || "active",
      rating: r.rating || null,
      maps_url: r.maps_url || "",
      placeId: placeIdFromNotes(r.notes),
    }))
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));

  if (!cafes.length) {
    throw new Error(
      "Published sheet CSV loaded but no cafe rows with name/lat/lng were found. Check SHEET_CSV_URL and that the sheet is published."
    );
  }

  console.error(`Loaded ${cafes.length} cafes from Google Sheet`);
  return { cafes, source: "google_sheet", sheetUrl };
}

function placeIdFromNotes(notes) {
  const m = String(notes || "").match(/google_place_id:([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function loadCachedPlaceIds() {
  const file = path.join(ROOT, "data", "cafes-primary-types.json");
  if (!fs.existsSync(file)) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return new Map(
      (data.lookups || [])
        .filter((l) => l.id && l.placeId)
        .map((l) => [l.id, { placeId: l.placeId, primaryType: l.primaryType || null }])
    );
  } catch {
    return new Map();
  }
}

async function resolvePlaceIdForCafe(cafe) {
  if (cafe.placeId) return { placeId: cafe.placeId, primaryType: cafe.primaryType || null };
  const res = await post(
    "places.googleapis.com",
    "/v1/places:searchText",
    {
      textQuery: cafe.name,
      pageSize: 5,
      locationBias: {
        circle: {
          center: { latitude: cafe.lat, longitude: cafe.lng },
          radius: 120.0,
        },
      },
    },
    "places.id,places.displayName,places.location,places.primaryType,places.googleMapsUri,places.photos"
  );
  if (res.body.error) return { placeId: null, primaryType: null, photos: [] };
  const places = res.body.places || [];
  let best = null;
  for (const p of places) {
    if (!p.location || !p.id) continue;
    const dist = haversineM(
      { lat: cafe.lat, lng: cafe.lng },
      { lat: p.location.latitude, lng: p.location.longitude }
    );
    const sim = nameSimilarity(cafe.name, p.displayName?.text || "");
    if (dist > 150 && sim < 0.9) continue;
    const score = sim * 1000 - dist;
    if (!best || score > best.score) {
      best = {
        score,
        placeId: p.id,
        primaryType: p.primaryType || null,
        mapsUri: p.googleMapsUri || null,
        photos: extractPhotos(p),
      };
    }
  }
  if (!best) return { placeId: null, primaryType: null, photos: [] };
  return best;
}

function extractPhotos(place) {
  const photos = place.photos || [];
  return photos.slice(0, PHOTO_LIMIT).map((p) => ({
    name: p.name,
    widthPx: p.widthPx,
    heightPx: p.heightPx,
    authorAttributions: (p.authorAttributions || []).map((a) => ({
      displayName: a.displayName || "",
      uri: a.uri || "",
    })),
  }));
}

async function ensurePhotos(candidate) {
  let photos = candidate.photos || [];
  if (!photos.length) {
    if (!candidate.placeId) return [];
    const res = await get(
      "places.googleapis.com",
      `/v1/places/${encodeURIComponent(candidate.placeId)}`,
      "id,photos"
    );
    if (res.body.error) {
      console.error("photos fail", candidate.name, res.body.error.message);
      return [];
    }
    photos = extractPhotos(res.body);
  }
  return resolvePhotoUris(photos);
}

async function resolvePhotoUris(photos) {
  const out = [];
  for (const photo of photos) {
    if (!photo.name) continue;
    if (photo.photoUri) {
      out.push(photo);
      continue;
    }
    const path =
      `/v1/${photo.name}/media?maxHeightPx=640&maxWidthPx=800&skipHttpRedirect=true`;
    try {
      const res = await get("places.googleapis.com", path);
      if (res.body?.photoUri) {
        out.push({ ...photo, photoUri: res.body.photoUri });
      } else {
        out.push(photo);
      }
    } catch (e) {
      console.error("photoUri fail", e.message);
      out.push(photo);
    }
    await sleep(30);
  }
  return out;
}

function makeSheetRow(place, usedIds) {
  let id = slugify(place.name);
  if (!id) id = `place-${place.placeId.slice(0, 8)}`;
  if (usedIds.has(id)) id = `${id}-${place.placeId.slice(0, 6).toLowerCase()}`;
  usedIds.add(id);

  return {
    id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    rating: "",
    walk_mins: place.walkMins ?? "",
    walk_bucket: walkBucket(place.walkMins),
    food: "",
    food_yes_or_no: "",
    notes: "",
    maps_url: place.mapsUri || "",
    status: "active",
    tried: "FALSE",
  };
}

(async () => {
  const tiles = buildTiles();
  console.error(`tiles ${tiles.length} · expected Nearby calls ${tiles.length * SEARCH_TYPES.length}`);

  const byId = new Map();
  let calls = 0;
  let capped = 0;

  for (let i = 0; i < tiles.length; i++) {
    const center = tiles[i];
    for (const primaryType of SEARCH_TYPES) {
      let places;
      try {
        places = await nearby(center, primaryType);
      } catch (e) {
        console.error("retry", i, primaryType, e.message);
        await sleep(1000);
        places = await nearby(center, primaryType);
      }
      calls += 1;
      if (places.length >= 20) capped += 1;
      for (const p of places) {
        if (!p.id || !p.location) continue;
        if (!ALLOWED.has(p.primaryType)) continue;
        const meters = Math.round(
          haversineM(HOME, {
            lat: p.location.latitude,
            lng: p.location.longitude,
          })
        );
        if (meters > COVER_R) continue;
        if (!byId.has(p.id)) {
          byId.set(p.id, {
            name: p.displayName?.text,
            placeId: p.id,
            primaryType: p.primaryType,
            types: p.types || [],
            address: p.formattedAddress,
            lat: p.location.latitude,
            lng: p.location.longitude,
            meters,
            mapsUri: p.googleMapsUri,
            photos: extractPhotos(p),
          });
        }
      }
      await sleep(40);
    }
    if ((i + 1) % 10 === 0 || i === tiles.length - 1) {
      console.error(
        `tile ${i + 1}/${tiles.length} unique=${byId.size} calls=${calls} capped20=${capped}`
      );
    }
  }

  const rows = [...byId.values()].sort((a, b) => a.meters - b.meters);
  const { cafes: existing, source, sheetUrl } = await loadExistingCafes();
  const usedIds = new Set(existing.map((c) => c.id));
  const blocklist = loadBlocklist();

  const annotated = rows.map((r) => {
    const blocked = isBlocklisted(r, blocklist);
    const match = blocked ? null : bestMatch(r, existing);
    return {
      ...r,
      blocked,
      status: blocked ? "blocklisted" : match ? "already_on_list" : "new",
      matchedCafe: match
        ? {
            id: match.cafe.id,
            name: match.cafe.name,
            reason: match.reason,
            distanceMeters: match.dist,
            nameSimilarity: match.sim,
          }
        : null,
    };
  });

  const novel = annotated.filter((r) => r.status === "new");
  console.error(`computing walk times for ${novel.length} new places…`);

  const withWalk = [];
  for (const r of novel) {
    const w = await walkFor(r.lat, r.lng);
    withWalk.push({
      ...r,
      walkMins: w.walkMins,
      walkDistanceMeters: w.walkDistanceMeters,
    });
    console.error(`  ${r.name}: ${w.walkMins} min`);
    await sleep(50);
  }

  const withinWalk = withWalk
    .filter((r) => r.walkMins != null && r.walkMins < MAX_WALK_MINS)
    .sort((a, b) => a.walkMins - b.walkMins);

  const dropped = withWalk
    .filter((r) => !(r.walkMins != null && r.walkMins < MAX_WALK_MINS))
    .map((r) => ({ name: r.name, walkMins: r.walkMins }));

  console.error(`fetching photo metadata for ${withinWalk.length} new candidates…`);
  const candidates = [];
  for (const r of withinWalk) {
    const photos = await ensurePhotos(r);
    const sheetRow = makeSheetRow(r, usedIds);
    candidates.push({
      kind: "new",
      reviewId: r.placeId,
      placeId: r.placeId,
      name: r.name,
      primaryType: r.primaryType,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      meters: r.meters,
      walkMins: r.walkMins,
      walkDistanceMeters: r.walkDistanceMeters,
      mapsUri: r.mapsUri,
      photos,
      sheetRow,
    });
    await sleep(40);
  }

  const placeIdCache = loadCachedPlaceIds();
  const onAppInRadius = existing
    .map((c) => ({
      ...c,
      meters: Math.round(haversineM(HOME, { lat: c.lat, lng: c.lng })),
      placeId: c.placeId || placeIdCache.get(c.id)?.placeId || null,
      primaryType: c.primaryType || placeIdCache.get(c.id)?.primaryType || null,
    }))
    .filter((c) => c.meters <= COVER_R);

  let missedRaw = onAppInRadius
    .filter((c) => {
      const status = String(c.status || "active").toLowerCase();
      return status !== "unratable" && status !== "closed";
    })
    .filter((c) => !cafeMatchedBySearch(c, annotated))
    .sort((a, b) => a.meters - b.meters);

  console.error(`computing walk times for ${missedRaw.length} on-app misses…`);
  const missedOnApp = [];
  for (const c of missedRaw) {
    const w = await walkFor(c.lat, c.lng);
    let placeId = c.placeId;
    let primaryType = c.primaryType;
    let mapsUri = c.maps_url || "";

    if (!placeId || !primaryType) {
      const looked = await resolvePlaceIdForCafe(c);
      placeId = placeId || looked.placeId;
      primaryType = primaryType || looked.primaryType;
      if (looked.mapsUri) mapsUri = mapsUri || looked.mapsUri;
    }

    missedOnApp.push({
      kind: "missed",
      cafeId: c.id,
      reviewId: placeId || `missed:${c.id}`,
      placeId: placeId || null,
      name: c.name,
      primaryType: primaryType || null,
      address: null,
      lat: c.lat,
      lng: c.lng,
      meters: c.meters,
      walkMins: w.walkMins,
      walkDistanceMeters: w.walkDistanceMeters,
      mapsUri,
      status: c.status,
      rating: c.rating,
      sheetRow: null,
    });
    console.error(`  missed ${c.name}: ${w.walkMins} min`);
    await sleep(50);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    home: HOME,
    comparedAgainst: source,
    sheetUrl: sheetUrl || null,
    query: {
      cellRadiusM: CELL_R,
      coverRadiusM: COVER_R,
      maxWalkMins: MAX_WALK_MINS,
      allowedPrimaryTypes: [...ALLOWED],
      photoLimit: PHOTO_LIMIT,
    },
    blocklist: blocklist.names,
    sheetColumns: SHEET_COLS,
    summary: {
      tiles: tiles.length,
      nearbyCalls: calls,
      tilesHitting20Cap: capped,
      uniquePlaces: annotated.length,
      alreadyOnList: annotated.filter((r) => r.status === "already_on_list").length,
      blocklisted: annotated.filter((r) => r.status === "blocklisted").length,
      newBeforeWalkFilter: withWalk.length,
      candidates: candidates.length,
      missedOnApp: missedOnApp.length,
      droppedForWalkTime: dropped,
    },
    candidates,
    missedOnApp,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));

  console.log(
    JSON.stringify(
      {
        wrote: path.relative(ROOT, OUT_FILE),
        candidates: candidates.length,
        missedOnApp: missedOnApp.length,
        droppedForWalkTime: dropped.length,
        reviewAt: "http://localhost:3000/discover/",
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
