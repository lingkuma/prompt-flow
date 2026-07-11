import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const distRoot = resolve(appRoot, "dist");
const dataRoot = process.env.SHARE_DATA_DIR || "/data";
const dbPath = process.env.SHARE_DB_PATH || join(dataRoot, "shares.sqlite");
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = Number(process.env.SHARE_MAX_BODY_BYTES || 2 * 1024 * 1024);
const createToken = process.env.SHARE_CREATE_TOKEN || "";
const publicBaseUrl = process.env.SHARE_PUBLIC_BASE_URL || "";

mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const insertShare = db.prepare(`
  INSERT INTO shares (id, title, document_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);
const getShare = db.prepare(`
  SELECT id, title, document_json, created_at, updated_at
  FROM shares
  WHERE id = ?
`);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function getBaseUrl(req) {
  if (publicBaseUrl) return publicBaseUrl.replace(/\/+$/g, "");
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
  return `${proto}://${host}`;
}

function isValidShareId(id) {
  return /^[A-Za-z0-9_-]{6,32}$/.test(id);
}

function createShareId() {
  return randomBytes(6).toString("base64url");
}

function hasCreateAccess(req, body) {
  if (!createToken) return true;
  const headerToken = req.headers["x-share-token"];
  return headerToken === createToken || body?.token === createToken;
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeSharedDocument(input) {
  const document = input?.workflow?.nodes ? input : input?.document;
  if (!document?.workflow?.nodes || !Array.isArray(document.workflow.nodes)) {
    const error = new Error("Payload must include document.workflow.nodes.");
    error.statusCode = 400;
    throw error;
  }
  return {
    schemaVersion: document.schemaVersion || "0.1.0",
    workflow: document.workflow,
  };
}

function createShare(document, req) {
  const now = new Date().toISOString();
  const title = String(document.workflow.title || "Untitled workflow").slice(0, 200);
  const documentJson = JSON.stringify(document);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = createShareId();
    try {
      insertShare.run(id, title, documentJson, now, now);
      return { id, title, url: `${getBaseUrl(req)}/s/${id}` };
    } catch (error) {
      if (!String(error?.message || "").includes("UNIQUE")) throw error;
    }
  }

  const error = new Error("Failed to create a unique share id.");
  error.statusCode = 500;
  throw error;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/shares") {
    const body = await readJsonBody(req);
    if (!hasCreateAccess(req, body)) {
      sendJson(res, 403, { error: "Share creation token is required." });
      return;
    }

    const document = normalizeSharedDocument(body);
    const share = createShare(document, req);
    sendJson(res, 201, share);
    return;
  }

  const shareMatch = url.pathname.match(/^\/api\/shares\/([^/]+)$/);
  if (req.method === "GET" && shareMatch) {
    const id = decodeURIComponent(shareMatch[1]);
    if (!isValidShareId(id)) {
      sendJson(res, 400, { error: "Invalid share id." });
      return;
    }

    const row = getShare.get(id);
    if (!row) {
      sendJson(res, 404, { error: "Share not found." });
      return;
    }

    sendJson(res, 200, {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      document: JSON.parse(row.document_json),
    });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

function serveFile(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const requested = normalize(decodeURIComponent(cleanPath)).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(distRoot, `.${requested}`);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = resolve(distRoot, "index.html");
  }

  if (relative(distRoot, filePath).startsWith("..")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = extname(filePath);
  const cacheControl = filePath.endsWith("index.html")
    ? "no-cache"
    : "public, max-age=31536000, immutable";

  res.writeHead(200, {
    "content-type": mimeTypes.get(ext) || "application/octet-stream",
    "cache-control": cacheControl,
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }

      if (!existsSync(distRoot)) {
        sendJson(res, 500, { error: "Missing dist directory. Run npm run build first." });
        return;
      }

      serveFile(req, res, url.pathname);
    } catch (error) {
      const status = error?.statusCode || 500;
      sendJson(res, status, { error: error?.message || "Internal server error." });
    }
  })();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Prompt Workflow server listening on http://0.0.0.0:${port}`);
  console.log(`SQLite shares database: ${dbPath}`);
});
