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
  let hasInitialFit = false;
  const markerById = new Map();

  const loadingEl = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  const countEl = document.getElementById("cafe-count");
  const countFooterEl = document.getElementById("cafe-count-footer");
  const panel = document.getElementById("filter-panel");
  const panelToggle = document.getElementById("panel-toggle");
  const panelBody = document.getElementById("panel-body");
  const panelSheetTop = panel.querySelector(".panel-sheet-top");
  const panelBackdrop = document.getElementById("panel-backdrop");
  const filterBadge = document.getElementById("filter-badge");
  const cafeCard = document.getElementById("cafe-card");
  const cafeCardHeader = cafeCard.querySelector(".cafe-card-header");
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

  const isMobileLayout = () => window.matchMedia("(max-width: 720px)").matches;
  let wasMobileLayout = isMobileLayout();

  function getMapPadding() {
    if (!isMobileLayout()) {
      return { top: 70, right: 340, bottom: 90, left: 40 };
    }
    const cardOpen = document.body.classList.contains("has-cafe-card");
    return {
      top: 88,
      right: 28,
      bottom: 36,
      left: 28,
    };
  }

  function updateMapForLayout() {
    if (!map) return;
    const mobile = isMobileLayout();
    map.setOptions({
      gestureHandling: mobile ? "greedy" : "auto",
      fullscreenControl: !mobile,
      zoomControl: !mobile,
    });
  }

  function updateMobileLayout() {
    const mobile = isMobileLayout();

    if (!mobile) {
      resetPanelDragStyles();
      resetCafeCardDragStyles();
      panel.classList.remove("collapsed");
      panelToggle.setAttribute("aria-expanded", "true");
      panelToggle.setAttribute("aria-label", "Filters");
      panelBackdrop.classList.add("hidden");
      panelBackdrop.classList.remove("visible");
      document.body.classList.remove("filters-open");
    } else if (!document.body.classList.contains("filters-open")) {
      closeFilterPanel();
    }

    if (map && mobile !== wasMobileLayout) {
      wasMobileLayout = mobile;
      updateMapForLayout();
      if (clusterer) {
        clusterer.setMap(null);
        clusterer = null;
      }
      buildMarkers();
    }
  }

  updateMobileLayout();
  if (isMobileLayout()) {
    closeFilterPanel();
  }

  function resetPanelDragStyles() {
    panel.classList.remove("is-dragging");
    panel.style.transform = "";
    panel.style.transition = "";
    if (panelBackdrop) {
      panelBackdrop.style.opacity = "";
    }
  }

  function openFilterPanel() {
    if (!isMobileLayout()) return;
    resetPanelDragStyles();
    panel.classList.remove("collapsed");
    panelToggle.setAttribute("aria-expanded", "true");
    panelToggle.setAttribute("aria-label", "Close filters");
    panelBackdrop.classList.remove("hidden");
    panelBackdrop.classList.add("visible");
    panelBackdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("filters-open");
  }

  function closeFilterPanel() {
    if (!isMobileLayout()) return;
    resetPanelDragStyles();
    panel.classList.add("collapsed");
    panelToggle.setAttribute("aria-expanded", "false");
    panelToggle.setAttribute("aria-label", "Open filters");
    panelBackdrop.classList.remove("visible");
    panelBackdrop.classList.add("hidden");
    panelBackdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("filters-open");
  }

  function toggleFilterPanel() {
    if (panel.classList.contains("collapsed")) {
      openFilterPanel();
    } else {
      closeFilterPanel();
    }
  }

  panelToggle.addEventListener("click", toggleFilterPanel);
  panelBackdrop.addEventListener("click", closeFilterPanel);

  function initFilterPanelDrag() {
    const DRAG_START = 8;
    const DISMISS_RATIO = 0.22;

    let pointerId = null;
    let startY = 0;
    let dragOffset = 0;
    let dragging = false;
    let tracking = false;
    let dragFromBody = false;

    function panelIsOpen() {
      return isMobileLayout() && !panel.classList.contains("collapsed");
    }

    function isInteractiveTarget(target) {
      return Boolean(target.closest("input, button, a, label"));
    }

    function canDragFromTarget(target) {
      if (!panelIsOpen() || isInteractiveTarget(target)) return false;
      if (panelSheetTop && panelSheetTop.contains(target)) return true;
      if (panelBody && panelBody.contains(target) && panelBody.scrollTop <= 0) return true;
      return false;
    }

    function setDragOffset(offset) {
      dragOffset = Math.max(0, offset);
      panel.style.transform = "translateY(" + dragOffset + "px)";
      if (panelBackdrop) {
        const progress = Math.min(1, dragOffset / Math.max(panel.offsetHeight, 1));
        panelBackdrop.style.opacity = String(1 - progress * 0.55);
      }
    }

    function snapBack() {
      panel.classList.remove("is-dragging");
      panel.style.transition = "transform 0.25s ease";
      panel.style.transform = "translateY(0)";
      if (panelBackdrop) {
        panelBackdrop.style.transition = "opacity 0.25s ease";
        panelBackdrop.style.opacity = "1";
      }
      panel.addEventListener(
        "transitionend",
        () => {
          resetPanelDragStyles();
        },
        { once: true }
      );
    }

    function finishDrag() {
      const threshold = Math.max(96, panel.offsetHeight * DISMISS_RATIO);
      if (dragOffset >= threshold) {
        closeFilterPanel();
        return;
      }
      snapBack();
    }

    panel.addEventListener(
      "pointerdown",
      (event) => {
        if (!canDragFromTarget(event.target)) return;
        tracking = true;
        dragging = false;
        dragFromBody = panelBody && panelBody.contains(event.target) && !panelSheetTop.contains(event.target);
        pointerId = event.pointerId;
        startY = event.clientY;
        dragOffset = 0;
      },
      { passive: true }
    );

    panel.addEventListener(
      "pointermove",
      (event) => {
        if (!tracking || event.pointerId !== pointerId) return;

        const deltaY = event.clientY - startY;

        if (!dragging) {
          if (deltaY > DRAG_START && (!dragFromBody || panelBody.scrollTop <= 0)) {
            dragging = true;
            panel.classList.add("is-dragging");
            panel.setPointerCapture(pointerId);
          } else if (deltaY < -DRAG_START) {
            tracking = false;
            pointerId = null;
            return;
          } else {
            return;
          }
        }

        event.preventDefault();
        setDragOffset(deltaY);
      },
      { passive: false }
    );

    function endDrag(event) {
      if (!tracking || event.pointerId !== pointerId) return;
      tracking = false;
      pointerId = null;

      if (dragging) {
        dragging = false;
        if (panel.hasPointerCapture(event.pointerId)) {
          panel.releasePointerCapture(event.pointerId);
        }
        finishDrag();
        return;
      }

      dragFromBody = false;
    }

    panel.addEventListener("pointerup", endDrag);
    panel.addEventListener("pointercancel", endDrag);
  }

  initFilterPanelDrag();

  function resetCafeCardDragStyles() {
    cafeCard.classList.remove("is-dragging");
    cafeCard.style.transform = "";
    cafeCard.style.transition = "";
    cafeCard.style.opacity = "";
  }

  function initCafeCardDrag() {
    const DRAG_START = 8;
    const DISMISS_RATIO = 0.18;

    let pointerId = null;
    let startY = 0;
    let dragOffset = 0;
    let dragging = false;
    let tracking = false;

    function cardIsVisible() {
      return isMobileLayout() && !cafeCard.classList.contains("hidden");
    }

    function canDragFromTarget(target) {
      if (!cardIsVisible()) return false;
      if (!cafeCardHeader || !cafeCardHeader.contains(target)) return false;
      return !target.closest("#cafe-card-close, a, button");
    }

    function setDragOffset(offset) {
      dragOffset = Math.max(0, offset);
      cafeCard.style.transform = "translateY(" + dragOffset + "px)";
      cafeCard.style.opacity = String(Math.max(0.35, 1 - dragOffset / 280));
    }

    function snapBack() {
      cafeCard.classList.remove("is-dragging");
      cafeCard.style.transition = "transform 0.25s ease, opacity 0.25s ease";
      cafeCard.style.transform = "translateY(0)";
      cafeCard.style.opacity = "1";
      cafeCard.addEventListener(
        "transitionend",
        () => {
          resetCafeCardDragStyles();
        },
        { once: true }
      );
    }

    function finishDrag() {
      const threshold = Math.max(72, cafeCard.offsetHeight * DISMISS_RATIO);
      if (dragOffset >= threshold) {
        hideCafeCard();
        return;
      }
      snapBack();
    }

    cafeCard.addEventListener(
      "pointerdown",
      (event) => {
        if (!canDragFromTarget(event.target)) return;
        tracking = true;
        dragging = false;
        pointerId = event.pointerId;
        startY = event.clientY;
        dragOffset = 0;
      },
      { passive: true }
    );

    cafeCard.addEventListener(
      "pointermove",
      (event) => {
        if (!tracking || event.pointerId !== pointerId) return;

        const deltaY = event.clientY - startY;
        if (!dragging) {
          if (deltaY > DRAG_START) {
            dragging = true;
            cafeCard.classList.add("is-dragging");
            cafeCard.setPointerCapture(pointerId);
          } else if (deltaY < -DRAG_START) {
            tracking = false;
            pointerId = null;
            return;
          } else {
            return;
          }
        }

        event.preventDefault();
        setDragOffset(deltaY);
      },
      { passive: false }
    );

    function endDrag(event) {
      if (!tracking || event.pointerId !== pointerId) return;
      tracking = false;
      pointerId = null;

      if (dragging) {
        dragging = false;
        if (cafeCard.hasPointerCapture(event.pointerId)) {
          cafeCard.releasePointerCapture(event.pointerId);
        }
        finishDrag();
      }
    }

    cafeCard.addEventListener("pointerup", endDrag);
    cafeCard.addEventListener("pointercancel", endDrag);
  }

  initCafeCardDrag();

  function countActiveFilters() {
    let count = 0;
    if (!document.getElementById("filter-tried").checked) count += 1;
    if (!document.getElementById("filter-not-tried").checked) count += 1;
    if (document.getElementById("filter-closed").checked) count += 1;
    if (document.getElementById("filter-real-food").checked) count += 1;
    if (document.querySelectorAll(".rating-filter:checked").length < 6) count += 1;
    return count;
  }

  function updateFilterBadge() {
    if (!filterBadge) return;
    const count = countActiveFilters();
    if (count > 0) {
      filterBadge.textContent = String(count);
      filterBadge.classList.remove("hidden");
      filterBadge.setAttribute("aria-label", count + " active filters");
    } else {
      filterBadge.textContent = "";
      filterBadge.classList.add("hidden");
      filterBadge.removeAttribute("aria-label");
    }
  }

  cafeCardClose.addEventListener("click", hideCafeCard);

  document.querySelectorAll("#filter-panel input").forEach((input) => {
    input.addEventListener("change", () => {
      updateFilterBadge();
      applyFilters();
    });
  });

  updateFilterBadge();

  window.addEventListener("resize", updateMobileLayout);

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

  function getMarkerSize() {
    return isMobileLayout() ? 36 : 28;
  }

  function makeMarkerIcon(color, dashed) {
    const size = getMarkerSize();
    const center = size / 2;
    const outerRadius = center - 1;
    const innerRadius = outerRadius - 2.5;
    const ring = dashed
      ? '<circle cx="' +
        center +
        '" cy="' +
        center +
        '" r="' +
        (outerRadius - 0.5) +
        '" fill="none" stroke="#1565c0" stroke-width="2" stroke-dasharray="4 3"/>'
      : "";
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 ' +
      size +
      " " +
      size +
      '">' +
      ring +
      '<circle cx="' +
      center +
      '" cy="' +
      center +
      '" r="' +
      innerRadius +
      '" fill="' +
      color +
      '" stroke="#ffffff" stroke-width="2.5"/>' +
      "</svg>";
    return {
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(center, center),
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
    const ratingFilters = getSelectedValues(".rating-filter");

    if (cafe.status === "closed" || cafe.status === "unratable") {
      return showClosed;
    }

    const tried = cafe.rating !== null && cafe.rating !== undefined && cafe.rating !== "";
    if (tried && !showTried) return false;
    if (!tried && !showNotTried) return false;

    if (onlyRealFood && normalizeYesNo(cafe.food_yes_or_no) !== "Yes") return false;

    if (tried && ratingFilters.length) {
      const ratingKey = String(Number(cafe.rating));
      if (!ratingFilters.includes(ratingKey)) return false;
    }

    return true;
  }

  function hideCafeCard() {
    resetCafeCardDragStyles();
    cafeCard.classList.add("hidden");
    cafeCard.style.borderLeft = "";
    document.body.classList.remove("has-cafe-card");
  }

  function panToWithScreenOffset(lat, lng, offsetX, offsetY) {
    const projection = map.getProjection();
    const zoom = map.getZoom();
    if (!projection || zoom == null) {
      map.panTo({ lat, lng });
      return;
    }

    const scale = Math.pow(2, zoom);
    const worldPoint = projection.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
    const newCenterPoint = new google.maps.Point(
      worldPoint.x - offsetX / scale,
      worldPoint.y + offsetY / scale
    );
    map.panTo(projection.fromPointToLatLng(newCenterPoint));
  }

  function focusCafeOnMap(cafe) {
    if (!map || cafe.lat == null || cafe.lng == null || !isMobileLayout()) return;

    const cardHeight = cafeCard.getBoundingClientRect().height;
    const offsetY = Math.round(Math.min(cardHeight * 0.4 + 28, window.innerHeight * 0.2));
    panToWithScreenOffset(cafe.lat, cafe.lng, 0, offsetY);
  }

  function showCafeCard(cafe) {
    if (isMobileLayout()) {
      closeFilterPanel();
    }
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
    focusCafeOnMap(cafe);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function createClusterer(mapInstance, markerList) {
    const mobile = isMobileLayout();
    return new markerClusterer.MarkerClusterer({
      map: mapInstance,
      markers: markerList,
      algorithm: new markerClusterer.SuperClusterAlgorithm({
        minZoom: 14,
        maxZoom: mobile ? 16 : 15,
        radius: mobile ? 38 : 32,
        minPoints: 4,
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

    const countText = visible.length + " of " + allCafes.length + " kafes shown";
    countEl.textContent = countText;
    if (countFooterEl) countFooterEl.textContent = countText;

    if (visible.length && !hasInitialFit) {
      const bounds = new google.maps.LatLngBounds();
      visible.forEach((cafe) => bounds.extend({ lat: cafe.lat, lng: cafe.lng }));
      map.fitBounds(bounds, getMapPadding());
      google.maps.event.addListenerOnce(map, "idle", () => {
        const zoom = map.getZoom();
        if (zoom != null) map.setZoom(zoom + 1);
      });
      hasInitialFit = true;
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
        zoom: 15,
        styles: MAP_STYLES,
        mapTypeControl: false,
        streetViewControl: false,
        clickableIcons: false,
        disableDefaultUI: false,
      });

      updateMapForLayout();

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
