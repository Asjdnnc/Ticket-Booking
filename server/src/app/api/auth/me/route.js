import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { initDB, getUserById } from "@/lib/db";

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_12345";
let dbInitialized = false;

export async function GET(req) {
  try {
    if (!dbInitialized) {
      await initDB();
      dbInitialized = true;
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await getUserById(decoded.id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.name)}`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
