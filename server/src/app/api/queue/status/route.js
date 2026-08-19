import { NextResponse } from "next/server";
import { getQueueStatus } from "@/lib/queueManager";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const eventId = searchParams.get("eventId") || "default_show";

    if (!userId) {
      return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 });
    }

    const queueResult = await getQueueStatus(userId, eventId);
    return NextResponse.json(queueResult);
  } catch (err) {
    console.error("Error in /api/queue/status:", err);
    return NextResponse.json(
      { error: "QUEUE_ERROR", message: err.message },
      { status: 500 }
    );
  }
}
