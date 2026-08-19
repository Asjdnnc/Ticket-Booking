/**
 * Redis client using ioredis
 * High-performance configuration with TCP Keep-Alive and Fast Timeouts
 */

import Redis from "ioredis";

let redisHost = process.env.REDIS_HOST || "127.0.0.1";
let redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);

if (redisHost.includes(":") && !redisHost.startsWith("http")) {
  const parts = redisHost.split(":");
  redisHost = parts[0];
  redisPort = parseInt(parts[1], 10);
}

const redis = new Redis({
  host: redisHost,
  port: redisPort,
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === "true" ? {} : undefined,
  keepAlive: 10000, // Send TCP Keep-Alive every 10s to prevent silent socket ETIMEDOUT
  connectTimeout: 4000, // Fast 4-second connection timeout
  commandTimeout: 3000, // Fast 3-second command execution timeout
  maxRetriesPerRequest: 2,
  enableAutoPipelining: true,
  retryStrategy(times) {
    return Math.min(times * 100, 1000);
  },
  lazyConnect: true,
});

redis.on("error", (err) => {
  // Silence noise for known timeout codes
  if (err.code === "ETIMEDOUT" || err.message?.includes("ETIMEDOUT")) {
    console.warn("[Redis Warning] Connection timed out (ETIMEDOUT). Auto-reconnecting...");
  } else {
    console.error("[Redis Error]", err.message || err);
  }
});

let connectionPromise = null;

async function ensureConnection() {
  if (redis.status === "ready") {
    return;
  }
  
  if (!connectionPromise) {
    connectionPromise = redis.connect().then(() => {
      console.log("✓ Redis connected");
    }).catch((err) => {
      console.warn("⚠ Redis connection failed/timed out, falling back gracefully:", err.message);
      connectionPromise = null;
    });
  }
  
  return connectionPromise;
}

export { redis, ensureConnection };
