#!/usr/bin/env node
/**
 * Local static server with a small API so discover review can persist blocklist Nos.
 *
 *   npm start  →  http://localhost:3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const BLOCKLIST_PATH = path.join(ROOT, "data", "discover", "blocklist.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

function ensureBlocklistFile() {
  fs.mkdirSync(path.dirname(BLOCKLIST_PATH), { recursive: true });
  if (!fs.existsSync(BLOCKLIST_PATH)) {
    fs.writeFileSync(
      BLOCKLIST_PATH,
      JSON.stringify({ names: [], entries: [] }, null, 2) + "\n"
    );
  }
}

function readBlocklist() {
  ensureBlocklistFile();
  try {
    const data = JSON.parse(fs.readFileSync(BLOCKLIST_PATH, "utf8"));
    return {
      names: Array.isArray(data.names) ? data.names : [],
      entries: Array.isArray(data.entries) ? data.entries : [],
    };
  } catch {
    return { names: [], entries: [] };
  }
}

function writeBlocklist(data) {
  ensureBlocklistFile();
  fs.writeFileSync(BLOCKLIST_PATH, JSON.stringify(data, null, 2) + "\n");
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
    "Cache-Control": "no-store",
  });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function addToBlocklist({ name, placeId }) {
  const data = readBlocklist();
  const trimmedName = String(name || "").trim();
  const id = String(placeId || "").trim();

  if (id && data.entries.some((e) => e.placeId === id)) {
    return { data, added: false, reason: "already_present" };
  }

  if (id || trimmedName) {
    data.entries.push({
      name: trimmedName,
      placeId: id || null,
      addedAt: new Date().toISOString(),
      source: "review",
    });
  }

  if (trimmedName && !data.names.includes(trimmedName)) {
    data.names.push(trimmedName);
  }

  writeBlocklist(data);
  return { data, added: true };
}

function removeFromBlocklist({ placeId, name }) {
  const data = readBlocklist();
  const id = String(placeId || "").trim();
  const trimmedName = String(name || "").trim();
  const before = data.entries.length;

  data.entries = data.entries.filter((e) => {
    if (e.source !== "review") return true;
    if (id && e.placeId === id) return false;
    return true;
  });

  // Drop the exact name from names[] only if no remaining entry uses it
  // and it was only present via a review rejection (heuristic: remove if
  // no other entry shares the name and it matches the removed place).
  if (trimmedName) {
    const stillUsed = data.entries.some((e) => e.name === trimmedName);
    const isSeedChain = !id; // keep seed-only names unless explicitly tied to a review place
    if (!stillUsed && id) {
      data.names = data.names.filter((n) => n !== trimmedName);
    }
    void isSeedChain;
  }

  const removed = before !== data.entries.length;
  if (removed) writeBlocklist(data);
  return { data, removed };
}

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const cleaned = decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(root, cleaned));
  if (!full.startsWith(root)) return null;
  return full;
}

function serveStatic(req, res, urlPath) {
  let filePath = safeJoin(ROOT, urlPath === "/" ? "/index.html" : urlPath);
  if (!filePath) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }

  const raw = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Content-Length": raw.length,
  });
  res.end(raw);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/api/blocklist") {
      if (req.method === "GET") {
        return sendJson(res, 200, readBlocklist());
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const result = addToBlocklist(body);
        return sendJson(res, 200, result);
      }
      if (req.method === "DELETE") {
        const body = await readBody(req);
        const result = removeFromBlocklist(body);
        return sendJson(res, 200, result);
      }
      res.writeHead(405).end("Method not allowed");
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end("Method not allowed");
      return;
    }

    serveStatic(req, res, url.pathname);
  } catch (e) {
    sendJson(res, 500, { error: e.message || "server error" });
  }
});

ensureBlocklistFile();
server.listen(PORT, () => {
  console.log(`Kate's Kafes local server → http://localhost:${PORT}`);
  console.log(`Discover review → http://localhost:${PORT}/discover/`);
});
