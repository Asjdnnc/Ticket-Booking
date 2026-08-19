import { redis, ensureConnection } from "./redis.js";
import { emitSeatUpdate } from "./socketEmit.js";

/**
 * Robust Virtual Waiting Room Queue Manager using Redis Sorted Sets (ZSET)
 * 
 * Redis Keys:
 *  - queue:active:{eventId}   -> Set of active buyer userIds inside seat selection (Max Capacity: N)
 *  - queue:waiting:{eventId}  -> Sorted Set (ZSET) of waiting userIds (score = join timestamp)
 *  - queue:token:{userId}     -> Temporary access token with 45s heartbeat TTL
 */

const MAX_ACTIVE_BUYERS = 3; // Active buyer capacity limit for multi-browser testing
const TOKEN_TTL_SECONDS = 45; // 45s session heartbeat window

// Normalize event ID so all browsers join the EXACT same queue key regardless of formatting
export function normalizeEventId(eventId) {
  if (!eventId) return "default_show";
  return eventId.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Prune inactive buyers whose access token has expired (e.g. tab closed or abandoned)
 */
export async function pruneStaleActiveBuyers(eventId) {
  await ensureConnection();
  const cleanEventId = normalizeEventId(eventId);
  const activeKey = `queue:active:${cleanEventId}`;

  const activeUsers = await redis.smembers(activeKey);
  if (!activeUsers || activeUsers.length === 0) return 0;

  let prunedCount = 0;
  for (const uid of activeUsers) {
    const tokenKey = `queue:token:${uid}`;
    const hasToken = await redis.exists(tokenKey);
    if (!hasToken) {
      await redis.srem(activeKey, uid);
      prunedCount++;
      console.log(`[QueueManager] Pruned inactive buyer ${uid} from hall ${cleanEventId}`);
    }
  }

  return prunedCount;
}

/**
 * Promote top waiting users (Rank 0, Rank 1...) while active buyer slots are available
 */
export async function promoteIfSlotAvailable(eventId) {
  await ensureConnection();
  const cleanEventId = normalizeEventId(eventId);

  const activeKey = `queue:active:${cleanEventId}`;
  const waitingKey = `queue:waiting:${cleanEventId}`;

  // Prune stale/expired active buyers first
  await pruneStaleActiveBuyers(cleanEventId);

  let activeCount = await redis.scard(activeKey);
  const promotedList = [];

  // Loop while active capacity has free slots and waiting queue has users
  while (activeCount < MAX_ACTIVE_BUYERS) {
    const topUsers = await redis.zrange(waitingKey, 0, 0); // Peek rank 0 user
    if (!topUsers || topUsers.length === 0) break;

    const topUserId = topUsers[0];
    await redis.zrem(waitingKey, topUserId);

    const token = `token_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const tokenKey = `queue:token:${topUserId}`;

    await redis.sadd(activeKey, topUserId);
    await redis.set(tokenKey, token, "EX", TOKEN_TTL_SECONDS);

    activeCount++;
    console.log(`[QueueManager] Promoted user ${topUserId} to active buyer (Active: ${activeCount}/${MAX_ACTIVE_BUYERS})`);

    promotedList.push({
      userId: topUserId,
      token,
      status: "GRANTED",
      eventId: cleanEventId,
    });
  }

  return promotedList;
}

/**
 * Main queue entry point for checking or joining queue
 */
export async function checkOrJoinQueue(userId, eventId) {
  await ensureConnection();
  const cleanEventId = normalizeEventId(eventId);

  const activeKey = `queue:active:${cleanEventId}`;
  const waitingKey = `queue:waiting:${cleanEventId}`;
  const tokenKey = `queue:token:${userId}`;

  // 1. Check if user already has an active, unexpired session token
  const existingToken = await redis.get(tokenKey);
  if (existingToken) {
    await redis.expire(tokenKey, TOKEN_TTL_SECONDS);
    await redis.sadd(activeKey, userId);
    return {
      status: "GRANTED",
      token: existingToken,
      queuePosition: 0,
      usersAhead: 0,
    };
  }

  // 2. Try promoting waiting users if active slots are open
  const promotedList = await promoteIfSlotAvailable(cleanEventId);
  if (promotedList && promotedList.length > 0) {
    for (const p of promotedList) {
      emitSeatUpdate({
        type: "QUEUE_GRANTED",
        userId: p.userId,
        token: p.token,
        eventId: cleanEventId,
      });
    }
  }

  // Re-check token after promotion check
  const freshToken = await redis.get(tokenKey);
  if (freshToken) {
    return {
      status: "GRANTED",
      token: freshToken,
      queuePosition: 0,
      usersAhead: 0,
    };
  }

  // 3. Prune stale buyers and check active count
  await pruneStaleActiveBuyers(cleanEventId);
  const activeCount = await redis.scard(activeKey);
  const waitingCount = await redis.zcard(waitingKey);

  // 4. If space is available and nobody is ahead in queue, grant immediate access
  if (activeCount < MAX_ACTIVE_BUYERS && waitingCount === 0) {
    const token = `token_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await redis.sadd(activeKey, userId);
    await redis.set(tokenKey, token, "EX", TOKEN_TTL_SECONDS);

    return {
      status: "GRANTED",
      token,
      queuePosition: 0,
      usersAhead: 0,
    };
  }

  // 5. Check if user is already in waiting queue
  let rank = await redis.zrank(waitingKey, userId);

  if (rank === null) {
    // Add user to waiting queue ZSET with current timestamp score
    const timestamp = Date.now();
    await redis.zadd(waitingKey, timestamp, userId);
    rank = await redis.zrank(waitingKey, userId);
  }

  const finalRank = rank !== null ? rank : 0;
  const queuePosition = finalRank + 1;

  return {
    status: "QUEUED",
    queuePosition,
    usersAhead: finalRank,
    estimatedWaitSeconds: finalRank * 10,
  };
}

/**
 * Query current queue status for polling
 */
export async function getQueueStatus(userId, eventId) {
  await ensureConnection();
  const cleanEventId = normalizeEventId(eventId);

  const waitingKey = `queue:waiting:${cleanEventId}`;
  const tokenKey = `queue:token:${userId}`;
  const activeKey = `queue:active:${cleanEventId}`;

  // 1. Check if token exists
  const token = await redis.get(tokenKey);
  if (token) {
    await redis.expire(tokenKey, TOKEN_TTL_SECONDS); // Extend heartbeat
    await redis.sadd(activeKey, userId);
    return {
      status: "GRANTED",
      token,
      queuePosition: 0,
      usersAhead: 0,
    };
  }

  // 2. Try promoting waiting users if active slots are open
  const promotedList = await promoteIfSlotAvailable(cleanEventId);
  if (promotedList && promotedList.length > 0) {
    for (const p of promotedList) {
      emitSeatUpdate({
        type: "QUEUE_GRANTED",
        userId: p.userId,
        token: p.token,
        eventId: cleanEventId,
      });
    }
  }

  // Re-check token after promotion check
  const freshToken = await redis.get(tokenKey);
  if (freshToken) {
    return {
      status: "GRANTED",
      token: freshToken,
      queuePosition: 0,
      usersAhead: 0,
    };
  }

  // 3. Get user's current rank in queue
  const rank = await redis.zrank(waitingKey, userId);

  if (rank === null) {
    // User not in queue, attempt join flow
    return await checkOrJoinQueue(userId, cleanEventId);
  }

  const queuePosition = rank + 1;
  return {
    status: "QUEUED",
    queuePosition,
    usersAhead: rank,
    estimatedWaitSeconds: rank * 10,
  };
}

export async function promoteNextInQueue(eventId) {
  const promotedList = await promoteIfSlotAvailable(eventId);
  return promotedList;
}

export async function leaveQueueOrBuyerSession(userId, eventId) {
  await ensureConnection();
  const cleanEventId = normalizeEventId(eventId);

  const activeKey = `queue:active:${cleanEventId}`;
  const waitingKey = `queue:waiting:${cleanEventId}`;
  const tokenKey = `queue:token:${userId}`;

  await redis.srem(activeKey, userId);
  await redis.zrem(waitingKey, userId);
  await redis.del(tokenKey);

  // Promote next waiting user(s) in line
  const promotedList = await promoteIfSlotAvailable(cleanEventId);
  return promotedList;
}
