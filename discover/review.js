(() => {
  const DATA_URL = "/data/discover/latest.json";
  const STORAGE_KEY = "kates-kafes-discover-decisions-v1";

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

  const el = {
    meta: document.getElementById("meta"),
    counts: document.getElementById("counts"),
    countYes: document.getElementById("count-yes"),
    countNo: document.getElementById("count-no"),
    countUnratable: document.getElementById("count-unratable"),
    countLeft: document.getElementById("count-left"),
    btnReset: document.getElementById("btn-reset"),
    btnCopy: document.getElementById("btn-copy"),
    keys: document.getElementById("keys"),
    status: document.getElementById("status"),
    tabs: document.getElementById("tabs"),
    list: document.getElementById("list"),
    sidebar: document.getElementById("sidebar"),
    tabQueue: document.getElementById("tab-queue"),
    tabYes: document.getElementById("tab-yes"),
    tabUnratable: document.getElementById("tab-unratable"),
    tabNo: document.getElementById("tab-no"),
    export: document.getElementById("export"),
    exportTable: document.getElementById("export-table"),
    exportThead: document.getElementById("export-thead"),
    exportTbody: document.getElementById("export-tbody"),
    exportEmpty: document.getElementById("export-empty"),
    copyNote: document.getElementById("copy-note"),
    noteDialog: document.getElementById("note-dialog"),
    noteForm: document.getElementById("note-form"),
    notePlace: document.getElementById("note-place"),
    noteInput: document.getElementById("note-input"),
    lightbox: document.getElementById("lightbox"),
    lightboxImg: document.getElementById("lightbox-img"),
    lightboxCap: document.getElementById("lightbox-cap"),
    lightboxPrev: document.getElementById("lightbox-prev"),
    lightboxNext: document.getElementById("lightbox-next"),
  };

  let payload = null;
  let decisions = {};
  let focusedId = null;
  let pendingUnratableKey = null;
  let activeTab = "queue";
  let lightboxGallery = [];
  let lightboxIndex = 0;

  function apiKey() {
    return window.KATES_KAFES_CONFIG?.GOOGLE_MAPS_API_KEY || "";
  }

  function itemKey(c) {
    return c.reviewId || c.placeId;
  }

  function newCandidates() {
    return payload?.candidates || [];
  }

  function missedCandidates() {
    return (payload?.missedOnApp || []).filter((c) => {
      const status = String(c.status || "active").toLowerCase();
      return status !== "unratable" && status !== "closed";
    });
  }

  function findItem(key) {
    return newCandidates().find((c) => itemKey(c) === key);
  }

  function mediaUrl(photoName) {
    const key = apiKey();
    if (!key || !photoName) return "";
    return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=480&maxWidthPx=640&key=${encodeURIComponent(key)}`;
  }

  async function resolvePhotoUri(photo) {
    if (photo.photoUri) return photo.photoUri;
    const key = apiKey();
    if (!key || !photo.name) return "";
    const url = `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=480&maxWidthPx=640&skipHttpRedirect=true&key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return mediaUrl(photo.name);
      const data = await res.json();
      return data.photoUri || mediaUrl(photo.name);
    } catch {
      return mediaUrl(photo.name);
    }
  }

  function loadDecisions(runId) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed.runId !== runId) return {};
      return parsed.decisions || {};
    } catch {
      return {};
    }
  }

  function saveDecisions(runId) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ runId, decisions, savedAt: new Date().toISOString() })
    );
  }

  function setStatus(msg) {
    if (!msg) {
      el.status.classList.remove("visible");
      el.status.textContent = "";
      return;
    }
    el.status.textContent = msg;
    el.status.classList.add("visible");
  }

  function decisionKind(raw) {
    if (!raw) return null;
    if (typeof raw === "string") return raw;
    return raw.v || raw.type || null;
  }

  function decisionNote(raw) {
    if (raw && typeof raw === "object") return String(raw.note || "").trim();
    return "";
  }

  function sheetCols() {
    return payload?.sheetColumns || SHEET_COLS;
  }

  function sheetRowForCandidate(c) {
    const key = itemKey(c);
    const raw = decisions[key];
    const kind = decisionKind(raw);
    if (!c.sheetRow) return null;
    if (kind === "yes") {
      return { ...c.sheetRow, status: "active", notes: "" };
    }
    if (kind === "unratable") {
      const why = decisionNote(raw);
      return {
        ...c.sheetRow,
        status: "unratable",
        notes: why,
      };
    }
    return null;
  }

  function addedRows() {
    return newCandidates()
      .map((c) => sheetRowForCandidate(c))
      .filter(Boolean);
  }

  function buildTsv(rows, { includeHeader = false } = {}) {
    const cols = sheetCols();
    const lines = [];
    if (includeHeader) lines.push(cols.join("\t"));
    for (const row of rows) {
      lines.push(
        cols
          .map((c) => String(row[c] ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " "))
          .join("\t")
      );
    }
    return lines.join("\n");
  }

  function renderExportTable() {
    if (!el.export) return;
    el.export.hidden = false;
    const cols = sheetCols();
    const rows = addedRows();

    el.exportThead.innerHTML =
      "<tr>" + cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("") + "</tr>";
    el.exportTbody.innerHTML = "";

    if (!rows.length) {
      el.exportTable.classList.add("hidden");
      el.exportEmpty.classList.add("visible");
      el.btnCopy.disabled = true;
      return;
    }

    el.exportTable.classList.remove("hidden");
    el.exportEmpty.classList.remove("visible");
    el.btnCopy.disabled = false;

    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = cols
        .map((c) => {
          const val = row[c] ?? "";
          const wrap = c === "notes" || c === "maps_url" || c === "food" ? " cell-wrap" : "";
          return `<td class="${wrap}">${escapeHtml(val)}</td>`;
        })
        .join("");
      el.exportTbody.appendChild(tr);
    }
  }

  function candidatesForTab(tab) {
    return newCandidates().filter((c) => {
      const kind = decisionKind(decisions[itemKey(c)]);
      if (tab === "queue") return !kind;
      if (tab === "yes") return kind === "yes";
      if (tab === "unratable") return kind === "unratable";
      if (tab === "no") return kind === "no";
      return false;
    });
  }

  function updateTabCounts() {
    const items = newCandidates();
    let yes = 0;
    let no = 0;
    let unratable = 0;
    for (const c of items) {
      const kind = decisionKind(decisions[itemKey(c)]);
      if (kind === "yes") yes += 1;
      else if (kind === "no") no += 1;
      else if (kind === "unratable") unratable += 1;
    }
    const left = items.length - yes - no - unratable;
    el.countYes.textContent = String(yes);
    el.countNo.textContent = String(no);
    if (el.countUnratable) el.countUnratable.textContent = String(unratable);
    el.countLeft.textContent = String(left);
    if (el.tabQueue) el.tabQueue.textContent = String(left);
    if (el.tabYes) el.tabYes.textContent = String(yes);
    if (el.tabUnratable) el.tabUnratable.textContent = String(unratable);
    if (el.tabNo) el.tabNo.textContent = String(no);
    if (el.tabs) {
      el.tabs.querySelectorAll(".tab").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.tab === activeTab);
      });
    }
  }

  function updateCounts() {
    updateTabCounts();
    renderExportTable();
  }

  function setActiveTab(tab) {
    activeTab = tab;
    render();
  }

  function focusKey(key) {
    if (!key) return;
    const node = el.list.querySelector(`[data-review-id="${CSS.escape(key)}"]`);
    if (node) {
      node.focus();
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async function copyForSheets() {
    const rows = addedRows();
    if (!rows.length) return;
    const tsv = buildTsv(rows, { includeHeader: false });
    try {
      await navigator.clipboard.writeText(tsv);
      el.copyNote.hidden = false;
      el.copyNote.textContent = `Copied ${rows.length} row${rows.length === 1 ? "" : "s"} — paste into your sheet (no header).`;
      setTimeout(() => {
        if (el.copyNote) el.copyNote.hidden = true;
      }, 3500);
    } catch (e) {
      setStatus("Couldn't copy automatically — select the table and copy manually.");
      console.warn(e);
    }
  }

  async function syncBlocklist(c, value) {
    if (!c || c.kind === "missed") return;
    if (!c.placeId) return;
    const kind = decisionKind(value);
    try {
      if (kind === "no") {
        const res = await fetch("/api/blocklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: c.name, placeId: c.placeId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else if (kind === "yes" || kind === "unratable") {
        await fetch("/api/blocklist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: c.name, placeId: c.placeId }),
        });
      }
    } catch (e) {
      setStatus(
        "Couldn't update blocklist on disk. Restart with npm start (node server), then try again."
      );
      console.warn("blocklist sync failed", e);
    }
  }

  function applyCardDecisionClass(card, kind) {
    card.classList.toggle("is-yes", kind === "yes");
    card.classList.toggle("is-no", kind === "no");
    card.classList.toggle("is-unratable", kind === "unratable");
  }

  function setDecision(key, value) {
    // Compute next undecided before saving this decision.
    const stayOnQueue = activeTab === "queue";
    let nextKey = null;
    if (stayOnQueue) {
      const preview = { ...decisions, [key]: value };
      const items = newCandidates();
      const idx = Math.max(
        0,
        items.findIndex((c) => itemKey(c) === key)
      );
      for (let i = idx + 1; i < items.length; i++) {
        const k = itemKey(items[i]);
        if (!decisionKind(preview[k])) {
          nextKey = k;
          break;
        }
      }
      if (!nextKey) {
        for (let i = 0; i < idx; i++) {
          const k = itemKey(items[i]);
          if (!decisionKind(preview[k])) {
            nextKey = k;
            break;
          }
        }
      }
    }

    if (value == null) delete decisions[key];
    else decisions[key] = value;
    saveDecisions(payload.generatedAt);

    const item = findItem(key);
    const kind = decisionKind(value);
    if (item && (kind === "yes" || kind === "no" || kind === "unratable")) {
      syncBlocklist(item, value);
    }

    if (stayOnQueue) {
      activeTab = "queue";
      render();
      focusKey(nextKey);
    } else {
      // Changing a decision in a done-tab moves the card to another tab.
      const nextTab =
        kind === "yes"
          ? "yes"
          : kind === "unratable"
            ? "unratable"
            : kind === "no"
              ? "no"
              : "queue";
      activeTab = nextTab;
      render();
    }
  }

  function openUnratableDialog(key) {
    const item = findItem(key);
    if (!item || !el.noteDialog) return;
    pendingUnratableKey = key;
    el.notePlace.textContent = item.name;
    el.noteInput.value = decisionNote(decisions[key]);
    el.noteDialog.showModal();
    el.noteInput.focus();
  }

  function showLightboxSlide(index) {
    if (!lightboxGallery.length) return;
    lightboxIndex = ((index % lightboxGallery.length) + lightboxGallery.length) % lightboxGallery.length;
    const slide = lightboxGallery[lightboxIndex];
    el.lightboxImg.src = slide.src;
    const count = `${lightboxIndex + 1} / ${lightboxGallery.length}`;
    el.lightboxCap.textContent = slide.cap ? `${count} · ${slide.cap}` : count;
    if (el.lightboxPrev) el.lightboxPrev.hidden = lightboxGallery.length < 2;
    if (el.lightboxNext) el.lightboxNext.hidden = lightboxGallery.length < 2;
    if (!el.lightbox.open) el.lightbox.showModal();
  }

  function stepLightbox(delta) {
    if (!lightboxGallery.length) return;
    showLightboxSlide(lightboxIndex + delta);
  }

  async function openLightboxGallery(photos, startIndex, placeName) {
    const gallery = [];
    for (const photo of photos || []) {
      const src = await resolvePhotoUri(photo);
      if (!src) continue;
      const rawCap = attributionText([photo]).replace(/<[^>]+>/g, "") || placeName || "";
      gallery.push({ src, cap: rawCap });
    }
    if (!gallery.length) return;
    lightboxGallery = gallery;
    const idx = Math.min(Math.max(0, startIndex || 0), gallery.length - 1);
    showLightboxSlide(idx);
  }

  function attributionText(photos) {
    const names = [];
    const seen = new Set();
    for (const p of photos || []) {
      for (const a of p.authorAttributions || []) {
        const label = a.displayName || "";
        if (!label || seen.has(label)) continue;
        seen.add(label);
        names.push(a.uri ? `<a href="${a.uri}" target="_blank" rel="noopener">${label}</a>` : label);
      }
    }
    if (!names.length) return "";
    return `Photos: ${names.join(" · ")}`;
  }

  function renderCard(c) {
    const key = itemKey(c);
    const raw = decisions[key];
    const kind = decisionKind(raw);
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    card.dataset.reviewId = key;
    applyCardDecisionClass(card, kind);

    const walk = c.walkMins != null ? `${c.walkMins} min` : "walk ?";
    const type = c.primaryType ? c.primaryType.replaceAll("_", " ") : "place";
    const chips = [
      `<span class="chip">${escapeHtml(type)}</span>`,
      `<span class="chip">${escapeHtml(walk)}</span>`,
    ];
    if (c.meters != null) {
      chips.push(`<span class="chip chip-soft">${c.meters}m</span>`);
    }
    const why = kind === "unratable" ? decisionNote(raw) : "";

    card.innerHTML = `
      <div class="card-head">
        <div>
          <h2 class="card-title">${escapeHtml(c.name)}</h2>
          <div class="chips">${chips.join("")}</div>
          ${c.address ? `<p class="card-address">${escapeHtml(c.address)}</p>` : ""}
          ${
            why
              ? `<p class="card-address"><strong>Unratable:</strong> ${escapeHtml(why)}</p>`
              : ""
          }
          ${
            c.mapsUri
              ? `<a class="card-link" href="${escapeAttr(c.mapsUri)}" target="_blank" rel="noopener">Google Maps</a>`
              : ""
          }
        </div>
        <div class="decision">
          <button type="button" class="btn btn-yes" data-action="yes">Add</button>
          <button type="button" class="btn btn-unratable" data-action="unratable">Unratable</button>
          <button type="button" class="btn btn-no" data-action="no">Pass</button>
        </div>
      </div>
    `;

    const photos = c.photos || [];
    if (!photos.length) {
      const empty = document.createElement("p");
      empty.className = "photo-empty";
      empty.textContent = "No photos for this place.";
      card.appendChild(empty);
    } else {
      const grid = document.createElement("div");
      grid.className = "photos";
      photos.forEach((photo, photoIndex) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "photo-btn";
        const img = document.createElement("img");
        img.alt = `${c.name} photo`;
        img.loading = "lazy";
        btn.appendChild(img);
        grid.appendChild(btn);

        resolvePhotoUri(photo).then((src) => {
          if (!src) {
            img.remove();
            const err = document.createElement("span");
            err.className = "ph-err";
            err.textContent = "Couldn't load";
            btn.appendChild(err);
            return;
          }
          img.src = src;
          img.onerror = () => {
            img.remove();
            const err = document.createElement("span");
            err.className = "ph-err";
            err.textContent = "Couldn't load";
            btn.appendChild(err);
          };
          btn.addEventListener("click", () => {
            openLightboxGallery(photos, photoIndex, c.name);
          });
        });
      });
      card.appendChild(grid);
      const attr = document.createElement("p");
      attr.className = "attr";
      attr.innerHTML = attributionText(photos);
      card.appendChild(attr);
    }

    card.querySelector('[data-action="yes"]').addEventListener("click", () => {
      setDecision(key, "yes");
    });
    card.querySelector('[data-action="unratable"]').addEventListener("click", () => {
      openUnratableDialog(key);
    });
    card.querySelector('[data-action="no"]').addEventListener("click", () => {
      setDecision(key, "no");
    });

    card.addEventListener("focus", () => {
      focusedId = key;
      el.list.querySelectorAll(".card").forEach((n) => n.classList.remove("is-focused"));
      card.classList.add("is-focused");
    });

    return card;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function section(title, subtitle, items, emptyText) {
    const wrap = document.createElement("section");
    wrap.className = "section";
    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <span class="section-count">${items.length}</span>
      <p>${escapeHtml(subtitle)}</p>
    `;
    wrap.appendChild(head);
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "section-empty";
      empty.textContent = emptyText || "Nothing here.";
      wrap.appendChild(empty);
      return wrap;
    }
    const list = document.createElement("div");
    list.className = "list";
    for (const c of items) list.appendChild(renderCard(c));
    wrap.appendChild(list);
    return wrap;
  }

  function tabCopy(tab) {
    if (tab === "queue") {
      return {
        title: "To review",
        subtitle: "Add or Unratable go to the sheet table; Pass goes to the blocklist.",
        empty: "All caught up — nothing left to review.",
      };
    }
    if (tab === "yes") {
      return {
        title: "Added",
        subtitle: "Queued as active for your sheet. Change your mind anytime.",
        empty: "No added places yet.",
      };
    }
    if (tab === "unratable") {
      return {
        title: "Unratable",
        subtitle: "Queued with status=unratable and your note.",
        empty: "No unratable places yet.",
      };
    }
    return {
      title: "Passed",
      subtitle: "Skipped and added to the discover blocklist.",
      empty: "No passed places yet.",
    };
  }

  function render() {
    el.list.innerHTML = "";
    const items = candidatesForTab(activeTab);
    const copy = tabCopy(activeTab);
    el.list.appendChild(section(copy.title, copy.subtitle, items, copy.empty));
    renderSidebar();
    updateCounts();
  }

  function renderSidebar() {
    if (!el.sidebar) return;
    const items = missedCandidates();
    el.sidebar.hidden = false;
    el.sidebar.innerHTML = `
      <div class="side-head">
        <h2>Missed by search</h2>
        <span class="section-count">${items.length}</span>
        <p>On your sheet, but this scan didn’t find them.</p>
      </div>
    `;

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "side-empty";
      empty.textContent = "None this run.";
      el.sidebar.appendChild(empty);
      return;
    }

    const ul = document.createElement("ul");
    ul.className = "missed-list";
    for (const c of items) {
      const li = document.createElement("li");
      li.className = "missed-item";
      const type = c.primaryType ? c.primaryType.replaceAll("_", " ") : "place";
      const walk = c.walkMins != null ? `${c.walkMins} min` : null;
      const meta = [type, walk].filter(Boolean).join(" · ");
      const inner = `
        <span class="missed-name">${escapeHtml(c.name)}</span>
        <span class="missed-meta">${escapeHtml(meta)}</span>
      `;
      if (c.mapsUri) {
        li.innerHTML = `<a href="${escapeAttr(c.mapsUri)}" target="_blank" rel="noopener">${inner}</a>`;
      } else {
        li.innerHTML = inner;
      }
      ul.appendChild(li);
    }
    el.sidebar.appendChild(ul);
  }

  el.tabs?.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn || !btn.dataset.tab) return;
    setActiveTab(btn.dataset.tab);
  });

  el.btnCopy?.addEventListener("click", copyForSheets);
  el.btnReset.addEventListener("click", () => {
    if (!confirm("Clear all decisions for this discover run?")) return;
    decisions = {};
    activeTab = "queue";
    saveDecisions(payload.generatedAt);
    render();
  });

  el.noteForm?.addEventListener("submit", (e) => {
    const submitter = e.submitter;
    const value = submitter?.value || "cancel";
    if (value !== "confirm") {
      pendingUnratableKey = null;
      return;
    }
    e.preventDefault();
    const note = (el.noteInput.value || "").trim();
    if (!note) {
      el.noteInput.focus();
      return;
    }
    const key = pendingUnratableKey;
    pendingUnratableKey = null;
    el.noteDialog.close();
    if (!key) return;
    setDecision(key, { v: "unratable", note });
  });

  el.lightboxPrev?.addEventListener("click", () => stepLightbox(-1));
  el.lightboxNext?.addEventListener("click", () => stepLightbox(1));
  el.lightbox?.addEventListener("click", (e) => {
    if (e.target === el.lightbox) el.lightbox.close();
  });
  el.lightbox?.addEventListener("close", () => {
    lightboxGallery = [];
    lightboxIndex = 0;
  });

  document.addEventListener("keydown", (e) => {
    if (el.noteDialog?.open) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      if (el.lightbox?.open && lightboxGallery.length) {
        stepLightbox(delta);
        return;
      }
      if (focusedId) {
        const item = findItem(focusedId);
        const photos = item?.photos || [];
        if (!photos.length) return;
        const start = delta < 0 ? Math.max(0, photos.length - 1) : 0;
        openLightboxGallery(photos, start, item.name);
      }
      return;
    }

    if (el.lightbox?.open) return;
    if (!focusedId) return;
    const key = e.key.toLowerCase();
    if (key === "y") {
      e.preventDefault();
      setDecision(focusedId, "yes");
    } else if (key === "u") {
      e.preventDefault();
      openUnratableDialog(focusedId);
    } else if (key === "n") {
      e.preventDefault();
      setDecision(focusedId, "no");
    }
  });

  async function init() {
    if (!apiKey()) {
      setStatus("Missing Google Maps API key in js/config.js — photos won't load.");
    }

    let res;
    try {
      res = await fetch(DATA_URL, { cache: "no-store" });
    } catch (e) {
      setStatus("Could not load discover data. Run npm run discover, then refresh.");
      return;
    }

    if (!res.ok) {
      setStatus(
        "No discover results yet. Ask the agent (or run npm run discover), then open this page again."
      );
      el.meta.textContent = "Waiting for a discover run.";
      return;
    }

    payload = await res.json();

    // Backfill kind/reviewId for older latest.json files.
    for (const c of payload.candidates || []) {
      if (!c.kind) c.kind = "new";
      if (!c.reviewId) c.reviewId = c.placeId;
    }
    for (const c of payload.missedOnApp || []) {
      if (!c.kind) c.kind = "missed";
      if (!c.reviewId) c.reviewId = c.placeId || `missed:${c.cafeId || c.name}`;
    }

    decisions = loadDecisions(payload.generatedAt);

    for (const c of newCandidates()) {
      if (decisionKind(decisions[itemKey(c)]) === "no") syncBlocklist(c, "no");
    }

    const nNew = newCandidates().length;
    const nMissed = missedCandidates().length;
    const when = payload.generatedAt
      ? new Date(payload.generatedAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "unknown time";
    const source =
      payload.comparedAgainst === "google_sheet"
        ? "Google Sheet"
        : payload.comparedAgainst || "list";
    el.meta.textContent = `${nNew} new · ${nMissed} missed · ${when} · ${source}`;
    el.counts.hidden = false;
    el.btnReset.hidden = false;
    if (el.keys) el.keys.hidden = false;
    if (el.tabs) el.tabs.hidden = false;
    activeTab = "queue";
    render();
  }

  init();
})();
