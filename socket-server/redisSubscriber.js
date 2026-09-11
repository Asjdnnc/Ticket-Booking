const Redis = require("ioredis");

/**
 * Parses and returns Redis connection options
 */
function getRedisConfig() {
  let redisHost = process.env.REDIS_HOST || "127.0.0.1";
  let redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);

  if (redisHost.includes(":") && !redisHost.startsWith("http")) {
    const parts = redisHost.split(":");
    redisHost = parts[0];
    redisPort = parseInt(parts[1], 10);
  }

  return {
    host: redisHost,
    port: redisPort,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,
    keepAlive: 10000,
    connectTimeout: 5000,
    retryStrategy(times) {
      return Math.min(times * 100, 2000);
    },
  };
}

/**
 * Initializes Redis Keyspace Notifications subscriber
 * @param {import("socket.io").Server} io 
 */
function initRedisKeyspaceSubscriber(io) {
  const config = getRedisConfig();

  console.log(`[Keyspace Subscriber] Connecting to Redis at ${config.host}:${config.port}...`);

  // Standard client for queries (e.g. checking if seat is already booked) and config
  const redisClient = new Redis(config);
  // Dedicated client for Pub/Sub (cannot issue regular commands once in pubsub mode)
  const subscriber = new Redis(config);

  // Attempt to enable keyspace notifications for expired events ('Ex')
  redisClient.on("ready", async () => {
    try {
      await redisClient.config("SET", "notify-keyspace-events", "Ex");
      console.log("✅ [Keyspace Subscriber] Enabled 'notify-keyspace-events Ex' on Redis.");
    } catch (err) {
      console.warn("ℹ️  [Keyspace Subscriber] Note: Redis CONFIG command is restricted by provider. Ensure keyspace events ('Ex') are enabled in your Redis console/config.");
    }
  });

  redisClient.on("error", (err) => {
    console.error("[Redis Client Error]", err.message || err);
  });

  subscriber.on("error", (err) => {
    console.error("[Redis Subscriber Error]", err.message || err);
  });

  subscriber.on("ready", () => {
    console.log("✅ [Keyspace Subscriber] Dedicated Redis subscriber ready.");

    // Pattern subscribe to expired key events across any database index
    subscriber.psubscribe("__keyevent@*__:expired", (err, count) => {
      if (err) {
        console.error("❌ [Keyspace Subscriber] Failed to psubscribe to expired keys:", err);
      } else {
        console.log(`📡 [Keyspace Subscriber] Subscribed to '__keyevent@*__:expired' (active subscriptions: ${count})`);
      }
    });
  });

  // Handle incoming expiration events
  subscriber.on("pmessage", async (pattern, channel, expiredKey) => {
    console.log(`🔔 [Keyspace Event] Key expired in Redis: '${expiredKey}'`);

    // 1. Check if an expired key is a seat hold: hold:seat:{seatId}
    if (expiredKey.startsWith("hold:seat:")) {
      const seatId = expiredKey.replace("hold:seat:", "");

      try {
        // Defensive check: Verify that this seat wasn't permanently BOOKED right before/during expiration
        const permanentStatus = await redisClient.get(`seat:status:${seatId}`);

        if (permanentStatus === "BOOKED") {
          console.log(`[Keyspace Subscriber] Seat ${seatId} hold expired, but seat is permanently BOOKED. Skipping release.`);
          return;
        }

        console.log(`🔄 [Keyspace Subscriber] Seat '${seatId}' 120s hold expired! Broadcasting 'AVAILABLE' to all clients.`);

        // Broadcast to all connected clients that seat is AVAILABLE again
        io.emit("seat:update", {
          seatId,
          status: "AVAILABLE",
          source: "KEYSPACE_EXPIRY",
          ts: Date.now(),
        });
      } catch (err) {
        console.error(`[Keyspace Subscriber] Error handling seat hold expiry for ${seatId}:`, err);
      }
    }

    // 2. Check if an expired key is an active buyer queue token: queue:token:{userId}
    else if (expiredKey.startsWith("queue:token:")) {
      const userId = expiredKey.replace("queue:token:", "");
      console.log(`⏱️ [Keyspace Subscriber] Buyer session token for '${userId}' expired! Triggering queue refresh.`);

      // Notify clients waiting in the line to refresh their queue status
      io.emit("queue:refresh", {
        expiredUserId: userId,
        source: "KEYSPACE_EXPIRY",
        ts: Date.now(),
      });
    }
  });

  // Active hold sweeper: Proactively touches hold keys every 3s to guarantee immediate eviction even on idle databases
  const sweepInterval = setInterval(async () => {
    try {
      const holdKeys = await redisClient.keys("hold:seat:*");
      for (const key of holdKeys) {
        const ttl = await redisClient.ttl(key);
        // If TTL is -2 (does not exist) or -1 (no expire) or 0
        if (ttl === -2 || ttl === 0) {
          const seatId = key.replace("hold:seat:", "");
          const permanentStatus = await redisClient.get(`seat:status:${seatId}`);
          if (permanentStatus !== "BOOKED") {
            io.emit("seat:update", {
              seatId,
              status: "AVAILABLE",
              source: "SWEEPER_EXPIRY",
              ts: Date.now(),
            });
          }
        }
      }
    } catch (e) {
      // Ignore sweep errors
    }
  }, 3000);

  return { redisClient, subscriber, sweepInterval };
}

module.exports = { initRedisKeyspaceSubscriber };
