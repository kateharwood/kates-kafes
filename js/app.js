(function () {
  "use strict";

  const RATING_LABELS = {
    0: "0 — never go here again",
    0.5: "0.5",
    1: "1 — meh",
    1.5: "1.5",
    2: "2 — would regularly go",
    3: "3 — a fave",
  };

  const COLOR_STOPS = [
    [0, [211, 47, 47]],
    [0.5, [230, 81, 0]],
    [1, [251, 140, 0]],
    [1.5, [251, 192, 45]],
    [2, [156, 204, 101]],
    [2.5, [102, 187, 106]],
    [3, [46, 125, 50]],
  ];

  const STATUS_LABELS = {
    closed: "Closed",
    unratable: "Unratable",
  };

  // Muted base map so cafe markers pop.
  const MAP_STYLES = [
    { elementType: "geometry", stylers: [{ color: "#f3ede4" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#a39688" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f3ede4" }, { weight: 3 }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#8a7d70" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#e5eadf" }] },
    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#9aa892" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#faf7f2" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#ddd4c7" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#efe8dd" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#d4c9bb" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#d4dfe8" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#9aabb8" }] },
  ];

  let map;
  let clusterer;
  let allCafes = [];
  let markers = [];
  const markerById = new Map();

  const loadingEl = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  const countEl = document.getElementById("cafe-count");
  const panel = document.getElementById("filter-panel");
  const panelToggle = document.getElementById("panel-toggle");
  const cafeCard = document.getElementById("cafe-card");
  const cafeCardClose = document.getElementById("cafe-card-close");
  const cafeCardTitle = document.getElementById("cafe-card-title");
  const cafeCardBadges = document.getElementById("cafe-card-badges");
  const cafeCardDetails = document.getElementById("cafe-card-details");
  const cafeCardContent = document.getElementById("cafe-card-content");
  const cafeCardFoodWrap = document.getElementById("cafe-card-food-wrap");
  const cafeCardFood = document.getElementById("cafe-card-food");
  const cafeCardNotesWrap = document.getElementById("cafe-card-notes-wrap");
  const cafeCardNotes = document.getElementById("cafe-card-notes");
  const cafeCardMaps = document.getElementById("cafe-card-maps");

  if (window.innerWidth <= 720) {
    document.body.classList.add("has-mobile-title");
    panel.classList.add("collapsed");
    panelToggle.setAttribute("aria-expanded", "false");
  }

  panelToggle.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    panelToggle.setAttribute("aria-expanded", String(!collapsed));
  });

  cafeCardClose.addEventListener("click", hideCafeCard);

  document.querySelectorAll("#filter-panel input").forEach((input) => {
    input.addEventListener("change", applyFilters);
  });

  buildLegendScale();
  initWigglyTitle();

  function initWigglyTitle() {
    const title = document.querySelector(".site-title");
    if (!title || title.dataset.wiggly) return;

    const tilts = [-6, 4, -3, 5, 8, -4, 0, 5, -3, 4, -5, 3];
    const text = title.textContent;

    title.setAttribute("aria-label", text);
    title.innerHTML = text
      .split("")
      .map((char, index) => {
        if (char === " ") {
          return '<span class="letter letter-space" aria-hidden="true"> </span>';
        }
        const tilt = tilts[index % tilts.length];
        return (
          '<span class="letter" style="--i:' +
          index +
          ";--tilt:" +
          tilt +
          'deg" aria-hidden="true">' +
          char +
          "</span>"
        );
      })
      .join("");

    title.dataset.wiggly = "true";
  }

  function getConfig() {
    return window.KATES_KAFES_CONFIG || {};
  }

  function rgbToHex([r, g, b]) {
    return (
      "#" +
      [r, g, b]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function interpolateColor(rating) {
    const clamped = Math.max(0, Math.min(3, Number(rating)));
    for (let i = 0; i < COLOR_STOPS.length - 1; i += 1) {
      const [leftRating, leftRgb] = COLOR_STOPS[i];
      const [rightRating, rightRgb] = COLOR_STOPS[i + 1];
      if (clamped >= leftRating && clamped <= rightRating) {
        const t = (clamped - leftRating) / (rightRating - leftRating || 1);
        const rgb = leftRgb.map((value, index) =>
          Math.round(value + (rightRgb[index] - value) * t)
        );
        return rgbToHex(rgb);
      }
    }
    return rgbToHex(COLOR_STOPS[COLOR_STOPS.length - 1][1]);
  }

  function markerColor(cafe) {
    if (cafe.status === "closed" || cafe.status === "unratable") {
      return "#9e9e9e";
    }
    if (cafe.rating === null || cafe.rating === undefined || cafe.rating === "") {
      return "#1e88e5";
    }
    return interpolateColor(cafe.rating);
  }

  function makeMarkerIcon(color, dashed) {
    const ring = dashed
      ? '<circle cx="14" cy="14" r="12.5" fill="none" stroke="#1565c0" stroke-width="2" stroke-dasharray="4 3"/>'
      : "";
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
      ring +
      '<circle cx="14" cy="14" r="10" fill="' +
      color +
      '" stroke="#ffffff" stroke-width="2.5"/>' +
      "</svg>";
    return {
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(28, 28),
      anchor: new google.maps.Point(14, 14),
    };
  }

  function buildLegendScale() {
    const scale = document.getElementById("legend-scale");
    if (!scale) return;
    scale.innerHTML = "";
    for (let rating = 0; rating <= 3; rating += 0.5) {
      const span = document.createElement("span");
      span.style.background = interpolateColor(rating);
      span.title = RATING_LABELS[rating] || String(rating);
      scale.appendChild(span);
    }
  }

  function ratingLabel(rating) {
    if (rating === null || rating === undefined || rating === "") {
      return "Not tried yet";
    }
    return RATING_LABELS[rating] || String(rating);
  }

  function normalizeYesNo(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    if (normalized === "yes" || normalized === "y" || normalized === "true") {
      return "Yes";
    }
    if (normalized === "no" || normalized === "n" || normalized === "false") {
      return "No";
    }
    return "";
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && char === ",") {
        row.push(cell);
        cell = "";
        continue;
      }

      if (!inQuotes && (char === "\n" || char === "\r")) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
        cell = "";
        continue;
      }

      cell += char;
    }

    if (cell.length || row.length) {
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
    }

    if (!rows.length) return [];

    const headers = rows[0].map((header) => header.trim());
    return rows.slice(1).map((values) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = (values[index] || "").trim();
      });

      const ratingRaw = record.rating;
      let rating = null;
      if (ratingRaw !== "" && ratingRaw !== undefined) {
        const parsed = Number(ratingRaw);
        if (!Number.isNaN(parsed)) rating = parsed;
      }

      const walkRaw = record.walk_mins;
      let walkMins = null;
      if (walkRaw !== "" && walkRaw !== undefined) {
        const parsed = Number(walkRaw);
        if (!Number.isNaN(parsed)) walkMins = parsed;
      }

      const lat = record.lat ? Number(record.lat) : null;
      const lng = record.lng ? Number(record.lng) : null;

      return {
        id: record.id,
        name: record.name,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        rating,
        walk_mins: walkMins,
        walk_bucket: record.walk_bucket || "",
        food: record.food || "",
        food_yes_or_no: normalizeYesNo(record.food_yes_or_no),
        notes: record.notes || "",
        maps_url: record.maps_url || "",
        status: record.status || "active",
        auto_added: parseBoolean(record.auto_added),
        tried: parseBoolean(record.tried),
      };
    });
  }

  async function loadCafes() {
    const { SHEET_CSV_URL } = getConfig();
    if (SHEET_CSV_URL) {
      const response = await fetch(SHEET_CSV_URL);
      if (!response.ok) throw new Error("Could not load Google Sheet data.");
      return parseCSV(await response.text());
    }

    const response = await fetch("data/cafes.json");
    if (!response.ok) throw new Error("Could not load cafe data.");
    return response.json();
  }

  function showError(message) {
    loadingEl.classList.add("hidden");
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }

  function getSelectedValues(selector) {
    return Array.from(document.querySelectorAll(selector))
      .filter((input) => input.checked)
      .map((input) => input.value);
  }

  function cafeMatchesFilters(cafe) {
    const showClosed = document.getElementById("filter-closed").checked;
    const showTried = document.getElementById("filter-tried").checked;
    const showNotTried = document.getElementById("filter-not-tried").checked;
    const onlyRealFood = document.getElementById("filter-real-food").checked;
    const walkFilters = getSelectedValues(".walk-filter");
    const ratingFilters = getSelectedValues(".rating-filter");

    if (cafe.status === "closed" || cafe.status === "unratable") {
      return showClosed;
    }

    const tried = cafe.rating !== null && cafe.rating !== undefined && cafe.rating !== "";
    if (tried && !showTried) return false;
    if (!tried && !showNotTried) return false;

    if (onlyRealFood && normalizeYesNo(cafe.food_yes_or_no) !== "Yes") return false;

    if (cafe.walk_bucket && walkFilters.length && !walkFilters.includes(cafe.walk_bucket)) {
      return false;
    }

    if (tried && ratingFilters.length) {
      const ratingKey = String(Number(cafe.rating));
      if (!ratingFilters.includes(ratingKey)) return false;
    }

    return true;
  }

  function hideCafeCard() {
    cafeCard.classList.add("hidden");
    cafeCard.style.borderLeft = "";
    document.body.classList.remove("has-cafe-card");
  }

  function showCafeCard(cafe) {
    const color = markerColor(cafe);
    cafeCard.style.borderLeft = "4px solid " + color;
    cafeCardTitle.textContent = cafe.name;

    cafeCardBadges.innerHTML = "";
    const badges = [];
    if (cafe.auto_added) {
      badges.push('<span class="badge badge-auto">Auto-added</span>');
    }
    if (cafe.status === "closed" || cafe.status === "unratable") {
      badges.push(
        '<span class="badge badge-closed">' +
          (STATUS_LABELS[cafe.status] || cafe.status) +
          "</span>"
      );
    }
    if (badges.length) {
      cafeCardBadges.innerHTML = badges.join("");
      cafeCardBadges.classList.remove("hidden");
    } else {
      cafeCardBadges.classList.add("hidden");
    }

    const details = [
      '<div class="cafe-detail"><dt>Rating</dt><dd><span class="cafe-stat-dot" style="background:' +
        color +
        '"></span>' +
        escapeHtml(ratingLabel(cafe.rating)) +
        "</dd></div>",
    ];
    if (cafe.walk_mins !== null && cafe.walk_mins !== undefined) {
      details.push(
        '<div class="cafe-detail"><dt>Walk</dt><dd>' +
          cafe.walk_mins +
          " min</dd></div>"
      );
    }
    cafeCardDetails.innerHTML = details.join("");

    let hasContent = false;
    if (cafe.food?.trim()) {
      cafeCardFood.textContent = cafe.food;
      cafeCardFoodWrap.classList.remove("hidden");
      hasContent = true;
    } else {
      cafeCardFoodWrap.classList.add("hidden");
    }

    if (cafe.notes?.trim()) {
      cafeCardNotes.textContent = cafe.notes;
      cafeCardNotesWrap.classList.remove("hidden");
      hasContent = true;
    } else {
      cafeCardNotesWrap.classList.add("hidden");
    }

    if (hasContent) {
      cafeCardContent.classList.remove("hidden");
    } else {
      cafeCardContent.classList.add("hidden");
    }

    if (cafe.maps_url) {
      cafeCardMaps.href = cafe.maps_url;
      cafeCardMaps.classList.remove("hidden");
    } else {
      cafeCardMaps.classList.add("hidden");
    }

    cafeCard.classList.remove("hidden");
    document.body.classList.add("has-cafe-card");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function createClusterer(mapInstance, markerList) {
    return new markerClusterer.MarkerClusterer({
      map: mapInstance,
      markers: markerList,
      algorithm: new markerClusterer.SuperClusterAlgorithm({
        maxZoom: 13,
        radius: 48,
        minPoints: 3,
      }),
    });
  }

  function buildMarkers() {
    markers.forEach((marker) => marker.setMap(null));
    markers = [];
    markerById.clear();

    const visible = allCafes.filter((cafe) => cafe.lat != null && cafe.lng != null && cafeMatchesFilters(cafe));

    visible.forEach((cafe) => {
      const marker = new google.maps.Marker({
        position: { lat: cafe.lat, lng: cafe.lng },
        map,
        title: cafe.name,
        icon: makeMarkerIcon(markerColor(cafe), cafe.auto_added),
      });

      marker.addListener("click", () => {
        showCafeCard(cafe);
      });

      markers.push(marker);
      markerById.set(cafe.id, marker);
    });

    if (clusterer) {
      clusterer.clearMarkers();
      clusterer.addMarkers(markers);
    } else {
      clusterer = createClusterer(map, markers);
    }

    countEl.textContent = visible.length + " of " + allCafes.length + " kafes shown";

    if (visible.length) {
      const bounds = new google.maps.LatLngBounds();
      visible.forEach((cafe) => bounds.extend({ lat: cafe.lat, lng: cafe.lng }));
      const mobile = window.innerWidth <= 720;
      map.fitBounds(
        bounds,
        mobile
          ? { top: 50, right: 40, bottom: 220, left: 40 }
          : { top: 70, right: 340, bottom: 90, left: 40 }
      );
    }
  }

  function applyFilters() {
    if (!map) return;
    hideCafeCard();
    buildMarkers();
  }

  function loadGoogleMaps(apiKey) {
    return new Promise((resolve, reject) => {
      if (window.google?.maps?.Map) {
        resolve();
        return;
      }

      const callbackName = "_katesKafesMapsReady";
      window[callbackName] = () => {
        delete window[callbackName];
        resolve();
      };

      const script = document.createElement("script");
      script.src =
        "https://maps.googleapis.com/maps/api/js?key=" +
        encodeURIComponent(apiKey) +
        "&callback=" +
        callbackName;
      script.async = true;
      script.onerror = () => {
        delete window[callbackName];
        reject(new Error("Failed to load Google Maps."));
      };
      document.head.appendChild(script);
    });
  }

  function loadMarkerClusterer() {
    return new Promise((resolve, reject) => {
      if (window.markerClusterer) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load marker clusterer."));
      document.head.appendChild(script);
    });
  }

  async function init() {
    try {
      const config = getConfig();
      const apiKey = config.GOOGLE_MAPS_API_KEY;

      if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
        showError(
          "Add your Google Maps API key in js/config.js (copy from js/config.example.js). See SETUP.md."
        );
        return;
      }

      allCafes = await loadCafes();
      await Promise.all([loadGoogleMaps(apiKey), loadMarkerClusterer()]);

      map = new google.maps.Map(document.getElementById("map"), {
        center: config.HOME || { lat: 40.6706039, lng: -73.9782784 },
        zoom: 14,
        styles: MAP_STYLES,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      });

      map.addListener("click", hideCafeCard);
      buildMarkers();
      loadingEl.classList.add("hidden");
    } catch (error) {
      showError(error.message || "Something went wrong loading the map.");
      console.error(error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
