import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import crypto from "crypto";

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_CinePulseKey123";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "CinePulseSecret456789";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { amount, bookingId } = body;

    if (!amount || !bookingId) {
      return NextResponse.json(
        { error: "Amount and bookingId are required" },
        { status: 400 }
      );
    }

    const amountInPaise = Math.round(parseFloat(amount) * 100);

    // Try initializing official Razorpay instance
    try {
      const instance = new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET,
      });

      const options = {
        amount: amountInPaise,
        currency: "INR",
        receipt: `rcpt_${bookingId.substring(0, 10)}`,
        notes: {
          bookingId,
        },
      };

      const order = await instance.orders.create(options);

      return NextResponse.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: RAZORPAY_KEY_ID,
        isMock: false,
      });
    } catch (razorpayErr) {
      console.warn("[Razorpay] Order creation via SDK failed or in test mode, fallback to standard order response:", razorpayErr.message);

      // Fallback for local testing when live API keys are not configured
      const mockOrderId = "order_" + crypto.randomBytes(8).toString("hex");

      return NextResponse.json({
        orderId: mockOrderId,
        amount: amountInPaise,
        currency: "INR",
        keyId: RAZORPAY_KEY_ID,
        isMock: true,
      });
    }
  } catch (err) {
    console.error("Create Razorpay Order Error:", err);
    return NextResponse.json(
      { error: "Failed to create payment order", message: err.message },
      { status: 500 }
    );
  }
}
