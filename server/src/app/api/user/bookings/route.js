import { NextResponse } from "next/server";
import { initDB, getUserBookings } from "@/lib/db";

let dbInitialized = false;

export async function GET(req) {
  try {
    if (!dbInitialized) {
      await initDB();
      dbInitialized = true;
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const bookings = await getUserBookings(userId);

    return NextResponse.json({ bookings });
  } catch (err) {
    console.error("Error fetching user bookings:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
