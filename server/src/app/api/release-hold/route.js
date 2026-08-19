import { NextResponse } from "next/server";
import { releaseHold } from "@/lib/locks";
import { emitSeatUpdate } from "@/lib/socketEmit";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { seatId, userId } = body;

    if (!seatId) {
      return NextResponse.json({ error: "INVALID_REQUEST", message: "seatId is required" }, { status: 400 });
    }

    const released = await releaseHold(seatId, userId);

    if (released) {
      // Notify all connected clients via Socket.IO that seat is available again
      emitSeatUpdate({
        seatId,
        status: "AVAILABLE",
        ts: Date.now(),
      });
      
      return NextResponse.json({ success: true, seatId, status: "AVAILABLE" });
    } else {
      return NextResponse.json({ success: false, message: "Hold validation failed" }, { status: 400 });
    }

  } catch (err) {
    console.error("Error releasing hold:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err.message },
      { status: 500 }
    );
  }
}
