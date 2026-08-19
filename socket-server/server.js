const { createServer } = require("http");
const { Server } = require("socket.io");
const httpProxy = require("http-proxy");

// Environment variables
const NEXT_SERVER = process.env.NEXT_SERVER_URL || "http://localhost:3000";
const SOCKET_PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(",") 
  : [CLIENT_URL, NEXT_SERVER, "http://localhost:5173", "http://localhost:3000"];

console.log("🚀 Socket.IO Server Configuration:");
console.log("  - Next.js API:", NEXT_SERVER);
console.log("  - Socket.IO Port:", SOCKET_PORT);
console.log("  - Client URL:", CLIENT_URL);
console.log("  - Allowed Origins:", ALLOWED_ORIGINS);

// Create proxy to Next.js server
const proxy = httpProxy.createProxyServer({
  target: NEXT_SERVER,
  ws: true,
  changeOrigin: true,
});

const httpServer = createServer((req, res) => {
  // Proxy HTTP requests to Next.js server
  proxy.web(req, res, (err) => {
    if (err) {
      console.error("Proxy error:", err);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Bad Gateway - Next.js server not available at ${NEXT_SERVER}`);
    }
  });
});

const io = new Server(httpServer, {
  pingTimeout: 60000,   // 60s timeout before considering socket dead (handles tab throttling)
  pingInterval: 25000,  // 25s ping interval
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

global.io = io;

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // Join event room for receiving seat updates
  socket.on("join:event", ({ eventId }) => {
    socket.join(`event:${eventId}`);
    console.log(`Socket ${socket.id} joined event:${eventId}`);
  });

  // Leave event room
  socket.on("leave:event", ({ eventId }) => {
    socket.leave(`event:${eventId}`);
    console.log(`Socket ${socket.id} left event:${eventId}`);
  });

  // Join user-specific queue room for rank broadcasts
  socket.on("join:user_queue", ({ userId }) => {
    if (userId) {
      socket.join(`user:${userId}`);
      console.log(`Socket ${socket.id} joined user queue room: user:${userId}`);
    }
  });

  // Receive seat:update from API server and broadcast to ALL clients
  socket.on("seat:update", (data) => {
    console.log(`[Socket] Received seat:update from API:`, data);

    if (data && data.type === "QUEUE_GRANTED" && data.userId) {
      // Notify specific promoted user
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
      userId: data.userId,
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`Socket ${socket.id} disconnected. Reason: ${reason}`);
  });
});

httpServer.listen(SOCKET_PORT, () => {
  console.log(`✓ Socket.IO & Proxy Server running on port ${SOCKET_PORT}`);
});
