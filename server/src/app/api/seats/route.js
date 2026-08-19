import { NextResponse } from "next/server";
import { getAllSeats, initDB } from "@/lib/db";
import { getAllSeatStatuses } from "@/lib/locks";

let dbInitialized = false;

export async function GET() {
  try {
    if (!dbInitialized) {
      await initDB();
      dbInitialized = true;
    }

    const seats = await getAllSeats();
    const seatIds = seats.map(s => s.seat_id);
    
    // Batch fetch seat statuses from Redis with defensive fallback
    let redisStatuses = new Map();
    try {
      redisStatuses = await getAllSeatStatuses(seatIds);
    } catch (redisErr) {
      console.warn("[Seats API] Redis query timed out or failed, serving PostgreSQL baseline:", redisErr.message);
    }

    const sections = {};

    for (const seat of seats) {
      let status = seat.status;
      const seatId = seat.seat_id;

      // Check Redis Authoritative Status if available
      const redisStatus = redisStatuses.get(seatId);
      if (redisStatus) {
        status = redisStatus;
      }

      if (!sections[seat.section_id]) {
        sections[seat.section_id] = [];
      }

      sections[seat.section_id].push({
        seatId: seat.seat_id,
        status,
      });
    }

    return NextResponse.json({
      sections: Object.entries(sections).map(([sectionId, seats]) => ({
        sectionId,
        seats,
      })),
    });
  } catch (err) {
    console.error("Error fetching seats:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err.message },
      { status: 500 }
    );
  }
}
