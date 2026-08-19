import { NextResponse } from "next/server";
import { checkOrJoinQueue } from "@/lib/queueManager";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId, eventId = "default_show" } = body;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const queueResult = await checkOrJoinQueue(userId, eventId);
    return NextResponse.json(queueResult);
  } catch (err) {
    console.error("Error in /api/queue/join:", err);
    return NextResponse.json(
      { error: "QUEUE_ERROR", message: err.message },
      { status: 500 }
    );
  }
}
