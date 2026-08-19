
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import fs from "fs";
import path from "path";

// Load .env manually for standalone script
try {
  const envConfig = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf-8");
  envConfig.split("\n").forEach(line => {
    const [key, value] = line.split("=");
    if (key && value && !process.env[key]) {
      process.env[key.trim()] = value.trim();
    }
  });
} catch (e) {
  console.log("Note: Could not load .env file");
}

const baseURL = process.env.API_URL || "http://localhost:3000/api";

// Use local credentials from environment (or same ones as server)
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

async function verifyArchitecture() {
  try {
    const seatId = "C45";
    const sectionId = "C";
    const userId = "verifier-" + Date.now();

    console.log(`\n=== 1. Booking Seat ${seatId} ===`);
    let res = await fetch(`${baseURL}/book-seat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatId, sectionId, userId }),
    });
    let data = await res.json();
    const bookingId = data.bookingId;
    console.log("Booking Response:", res.status, data);

    if (!bookingId) return;

    console.log(`\n=== 2. Paying for ${seatId} via API ===`);
    res = await fetch(`${baseURL}/pay`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Idempotency-Key": bookingId
      },
      body: JSON.stringify({ bookingId }),
    });
    data = await res.json();
    console.log("Payment Response:", res.status, data);

    console.log(`\n=== 3. Checking DynamoDB for Async Update ===`);
    console.log("Waiting 10s for SQS -> Lambda/Worker -> DynamoDB...");
    
    // Poll loop
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        process.stdout.write(".");
        const { Item } = await docClient.send(new GetCommand({
            TableName: "Bookings",
            Key: { booking_id: bookingId }
        }));
        
        if (Item) {
            console.log("\n✅ SUCCESS: Booking found in DynamoDB!");
            console.log(Item);
            return;
        }
    }
    
    console.log("\n❌ TIMEOUT: Booking NOT found in DynamoDB after 20s.");
    console.log("Check: AWS SQS Console (Messages visible?) or CloudWatch Logs (Lambda errors?)");

  } catch (err) {
    console.error("Test failed:", err);
  }
}

verifyArchitecture();
