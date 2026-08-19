import { NextResponse } from "next/server";
import { leaveQueueOrBuyerSession } from "@/lib/queueManager";
import { emitSeatUpdate } from "@/lib/socketEmit";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId, eventId = "default_show" } = body;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const promotedList = await leaveQueueOrBuyerSession(userId, eventId);

    if (promotedList && promotedList.length > 0) {
      for (const promoted of promotedList) {
        console.log(`[Queue] Promoted user ${promoted.userId} to active buyer via Socket!`);
        emitSeatUpdate({
          type: "QUEUE_GRANTED",
          userId: promoted.userId,
          token: promoted.token,
          eventId: promoted.eventId || eventId,
        });
      }
    }

    return NextResponse.json({
      success: true,
      promotedUsers: promotedList ? promotedList.map(p => p.userId) : []
    });
  } catch (err) {
    console.error("Error in /api/queue/leave:", err);
    return NextResponse.json(
      { error: "QUEUE_ERROR", message: err.message },
      { status: 500 }
    );
  }
}
