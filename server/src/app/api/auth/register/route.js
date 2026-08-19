import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { initDB, getUserByEmail, createUser } from "@/lib/db";

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_12345";
let dbInitialized = false;

export async function POST(req) {
  try {
    if (!dbInitialized) {
      await initDB();
      dbInitialized = true;
    }

    const body = await req.json().catch(() => ({}));
    const { name, email, password } = body;

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "Missing required fields (name, email, password)" },
        { status: 400 }
      );
    }

    const existingUser = await getUserByEmail(email.toLowerCase());
    if (existingUser) {
      return NextResponse.json(
        { error: "User already exists with this email" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = "usr_" + crypto.randomUUID();

    const user = await createUser({
      id: userId,
      name,
      email: email.toLowerCase(),
      passwordHash,
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.name)}`,
      },
      token,
    });
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", message: err.message },
      { status: 500 }
    );
  }
}
