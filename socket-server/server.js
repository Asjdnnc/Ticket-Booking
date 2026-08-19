const { createServer } = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const httpProxy = require("http-proxy");

// Clean and format origin strings
const sanitizeUrl = (urlStr) => {
  if (!urlStr) return "";
  let cleaned = urlStr.trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, "");
  if (cleaned && !cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    cleaned = `https://${cleaned}`;
  }
  return cleaned;
};

// Environment variables
let NEXT_SERVER = sanitizeUrl(process.env.NEXT_SERVER_URL || "http://localhost:3000");
const SOCKET_PORT = process.env.PORT || 3001;
let CLIENT_URL = sanitizeUrl(process.env.CLIENT_URL || "http://localhost:5173");

let targetHost = "localhost";
try {
  targetHost = new URL(NEXT_SERVER).host;
} catch (e) {
  console.warn("Could not parse host from NEXT_SERVER:", NEXT_SERVER);
}

const rawOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(",") 
  : [CLIENT_URL, NEXT_SERVER, "http://localhost:5173", "http://localhost:3000"];

const ALLOWED_ORIGINS = rawOrigins.map(origin => sanitizeUrl(origin)).filter(Boolean);

console.log("🚀 Socket.IO Server Configuration:");
console.log("  - Next.js API:", NEXT_SERVER);
console.log("  - Target Host Header:", targetHost);
console.log("  - Socket.IO Port:", SOCKET_PORT);
console.log("  - Client URL:", CLIENT_URL);
console.log("  - Allowed Origins:", ALLOWED_ORIGINS);

const app = express();

// Enable CORS for ALL HTTP routes & Preflight OPTIONS requests
app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
}));

// Handle OPTIONS preflight for any path immediately
app.options("*", cors());

// Create proxy to Next.js backend server with Host header rewrite for Vercel
const proxy = httpProxy.createProxyServer({
  target: NEXT_SERVER,
  ws: true,
  changeOrigin: true,
  autoRewrite: true,
  hostRewrite: targetHost,
  headers: {
    host: targetHost,
  },
  secure: false, // Prevent SSL certificate rejection on serverless proxy targets
});

// Inject CORS headers into proxied response headers
proxy.on("proxyRes", (proxyRes, req, res) => {
  const origin = req.headers.origin || "*";
  proxyRes.headers["access-control-allow-origin"] = origin;
  proxyRes.headers["access-control-allow-credentials"] = "true";
  proxyRes.headers["access-control-allow-methods"] = "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS";
  proxyRes.headers["access-control-allow-headers"] = "Content-Type, Authorization, X-Requested-With, Accept, Origin";
});

// Proxy HTTP requests to Next.js API server
app.use((req, res) => {
  console.log(`[HTTP Proxy] ${req.method} ${req.url} from ${req.headers.origin || 'unknown'}`);
  proxy.web(req, res, (err) => {
    if (err) {
      console.error("Proxy error:", err.message || err);
      if (!res.headersSent) {
        res.status(502).send(`Bad Gateway - Next.js server not available at ${NEXT_SERVER}`);
      }
    }
  });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  pingTimeout: 60000,   // 60s timeout before considering socket dead (handles tab throttling)
  pingInterval: 25000,  // 25s ping interval
  cors: {
    origin: true,       // Dynamically reflect requesting origin with credentials
    methods: ["GET", "POST"],
    credentials: true,
  },
});

global.io = io;

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // Join event room for receiving seat updates
  socket.on("join:event", ({ eventId }) => {
    if (eventId) {
      socket.join(`event:${eventId}`);
      console.log(`Socket ${socket.id} joined event:${eventId}`);
    }
  });

  // Leave event room
  socket.on("leave:event", ({ eventId }) => {
    if (eventId) {
      socket.leave(`event:${eventId}`);
      console.log(`Socket ${socket.id} left event:${eventId}`);
    }
  });

  // Join user-specific queue room for rank broadcasts
  socket.on("join:user_queue", ({ userId }) => {
    if (userId) {
      socket.join(`user:${userId}`);
      console.log(`Socket ${socket.id} joined user queue room: user:${userId}`);
    }
  });

  // Receive seat:update from API server and broadcast to clients
  socket.on("seat:update", (data) => {
    console.log(`[Socket] Received seat:update from API:`, data);

    if (data && data.type === "QUEUE_GRANTED" && data.userId) {
      // Notify specific promoted user in private queue room
      io.to(`user:${data.userId}`).emit("queue:granted", data);
      io.emit("queue:refresh", { eventId: data.eventId });
    }

    // Broadcast seat updates to ALL clients
    io.emit("seat:update", data);
  });

  // Broadcast seat hold to all clients
  socket.on("seat:hold", (data) => {
    console.log(`[Socket] Received seat:hold:`, data);
    io.emit("seat:update", {
      seatId: data.seatId,
      status: "HOLD",
      bookingId: data.bookingId,
      userId: data.userId,
      holdUntil: data.holdUntil,
      ts: Date.now(),
    });
  });

  // Broadcast seat booking to all clients
  socket.on("seat:book", (data) => {
    console.log(`[Socket] Received seat:book:`, data);
    io.emit("seat:update", {
      seatId: data.seatId,
      status: "BOOKED",
      bookingId: data.bookingId,
      userId: data.userId,
      ts: Date.now(),
    });
  });

  // Broadcast seat release to all clients
  socket.on("seat:release", (data) => {
    console.log(`[Socket] Received seat:release:`, data);
    io.emit("seat:update", {
      seatId: data.seatId,
      status: "AVAILABLE",
      ts: Date.now(),
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`Socket ${socket.id} disconnected. Reason: ${reason}`);
  });
});

httpServer.listen(SOCKET_PORT, () => {
  console.log(`✅ Socket.IO & Express Proxy Server running on port ${SOCKET_PORT}`);
  console.log(`✅ Proxying HTTP API requests to ${NEXT_SERVER} (Host: ${targetHost})`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
