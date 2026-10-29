const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const portArg = process.argv[2];
const PORT = Number(portArg || process.env.PORT || 8080);
const MAX_REQUEST_BYTES = 2048;
const DEFAULT_SESSION_SECONDS = 180;
const MAX_SESSION_SECONDS = 900;
const sessions = new Map();
const sessionCleanup = setInterval(() => {
  for (const [sessionId, session] of sessions) {
    if (session.expiresAt <= Date.now()) sessions.delete(sessionId);
  }
}, 60_000);
sessionCleanup.unref();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
};

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (
        address.family === "IPv4" &&
        !address.internal &&
        !address.address.startsWith("169.254.")
      ) {
        return address.address;
      }
    }
  }
  return null;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BYTES) {
        reject(new Error("Request body terlalu besar."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Format JSON tidak valid."));
      }
    });
    req.on("error", reject);
  });
}

function getActiveSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");

  let requestUrl;
  try {
    requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    sendJson(res, 400, { error: "URL request tidak valid." });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/qr-session") {
    try {
      const body = await readJson(req);
      const requestedSeconds = Number(body.expiresIn);
      const expiresIn = Number.isFinite(requestedSeconds)
        ? Math.min(MAX_SESSION_SECONDS, Math.max(30, Math.floor(requestedSeconds)))
        : DEFAULT_SESSION_SECONDS;
      const localIPv4 = getLocalIPv4();
      if (!localIPv4) {
        sendJson(res, 503, {
          error: "IPv4 lokal tidak ditemukan. Pastikan komputer terhubung ke Wi-Fi/LAN.",
        });
        return;
      }

      const sessionId = crypto.randomUUID();
      const expiresAt = Date.now() + expiresIn * 1000;
      const confirmUrl = `http://${localIPv4}:${PORT}/confirm.html?session_id=${encodeURIComponent(sessionId)}&expires_at_ms=${expiresAt}`;
      const qrDataUrl = await QRCode.toDataURL(confirmUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 400,
      });

      sessions.set(sessionId, {
        expiresAt,
        approved: false,
      });
      const serverTime = Date.now();
      sendJson(res, 201, {
        session_id: sessionId,
        confirm_url: confirmUrl,
        qr_data_url: qrDataUrl,
        expires_in: expiresIn,
        expires_in_ms: Math.max(0, expiresAt - serverTime),
      });
    } catch (error) {
      console.error("Gagal membuat sesi QR:", error);
      sendJson(res, 400, { error: error.message || "Sesi QR gagal dibuat." });
    }
    return;
  }

  const deleteSessionMatch = requestUrl.pathname.match(/^\/api\/qr-session\/([0-9a-f-]{36})$/i);
  if (req.method === "DELETE" && deleteSessionMatch) {
    sessions.delete(deleteSessionMatch[1]);
    sendJson(res, 200, { success: true });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD, POST, DELETE" });
    res.end("Method Not Allowed");
    return;
  }

  let safePath;
  try {
    safePath = path.normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[\\/])+/, "");
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }
  if (safePath === "/" || safePath === "\\") safePath = "/admin.html";

  const filePath = path.join(__dirname, safePath);
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`404 Not Found: ${safePath}`);
      console.log(`[404] ${req.method} ${requestUrl.pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    if (req.method === "HEAD") {
      res.end();
    } else {
      fs.createReadStream(filePath).pipe(res);
    }
    console.log(`[200] ${req.method} ${requestUrl.pathname}`);
  });
});

const io = new Server(server);
io.on("connection", (socket) => {
  socket.on("watch_session", (sessionId, acknowledge) => {
    const session = getActiveSession(sessionId);
    if (!session) {
      if (typeof acknowledge === "function") {
        acknowledge({ success: false, error: "Sesi QR tidak ditemukan atau sudah kedaluwarsa." });
      }
      return;
    }

    socket.join(sessionId);
    if (typeof acknowledge === "function") {
      acknowledge({
        success: true,
        expires_in_ms: Math.max(0, session.expiresAt - Date.now()),
      });
    }
    if (session.approved) {
      socket.emit("session_approved", { session_id: sessionId });
    }
  });

  socket.on("confirm_session", (sessionId, acknowledge) => {
    const session = getActiveSession(sessionId);
    if (!session) {
      if (typeof acknowledge === "function") {
        acknowledge({ success: false, error: "Sesi QR tidak ditemukan atau sudah kedaluwarsa." });
      }
      return;
    }

    session.approved = true;
    io.to(sessionId).emit("session_approved", { session_id: sessionId });
    if (typeof acknowledge === "function") acknowledge({ success: true });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n========================================");
  console.log("  GNRD Photobooth Server Berjalan!");
  console.log(`  👉 http://localhost:${PORT}/admin.html`);
  console.log(`  👉 http://127.0.0.1:${PORT}/admin.html`);
  const localIPv4 = getLocalIPv4();
  if (localIPv4) console.log(`  👉 http://${localIPv4}:${PORT}/admin.html (akses Wi-Fi/LAN)`);
  console.log("========================================\n");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} sedang dipakai. Coba jalankan: node serve.js 3000`);
  } else {
    console.error("Server error:", err);
  }
});
