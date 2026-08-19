const { createServer } = require("http");
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

const rawOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(",") 
  : [CLIENT_URL, NEXT_SERVER, "http://localhost:5173", "http://localhost:3000"];

const ALLOWED_ORIGINS = rawOrigins.map(origin => sanitizeUrl(origin)).filter(Boolean);

console.log("🚀 Socket.IO Server Configuration:");
console.log("  - Next.js API:", NEXT_SERVER);
console.log("  - Socket.IO Port:", SOCKET_PORT);
console.log("  - Client URL:", CLIENT_URL);
console.log("  - Allowed Origins:", ALLOWED_ORIGINS);

// Create proxy to Next.js backend server
const proxy = httpProxy.createProxyServer({
  target: NEXT_SERVER,
  ws: true,
  changeOrigin: true,
  secure: false, // Prevent SSL certificate rejection on serverless proxy targets
});

const httpServer = createServer((req, res) => {
  const origin = req.headers.origin;

  // Set robust CORS headers on proxy server
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");

  // Handle CORS Preflight (OPTIONS) requests immediately with 204 No Content
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Proxy HTTP requests to Next.js backend server
  proxy.web(req, res, (err) => {
    if (err) {
      console.error("Proxy error:", err.message || err);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(`Bad Gateway - Next.js server not available at ${NEXT_SERVER}`);
      }
    }
  });
});

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
  console.log(`✅ Socket.IO & Proxy Server running on port ${SOCKET_PORT}`);
  console.log(`✅ Proxying HTTP API requests to ${NEXT_SERVER}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
