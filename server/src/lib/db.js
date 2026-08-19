import { Pool } from "pg";
import { startWorker } from "./worker.js";

// Initialize Postgres connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL && process.env.POSTGRES_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

/**
 * Ensure tables exist and seed data
 */
export async function initDB() {
  await ensureTables();
  await seedSeats();
  
  // Start the background worker (Singleton)
  startWorker();
  
  console.log("✓ PostgreSQL initialized");
}

async function ensureTables() {
  const client = await pool.connect();
  try {
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS Users (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seats table
    await client.query(`
      CREATE TABLE IF NOT EXISTS Seats (
        seat_id VARCHAR(50) PRIMARY KEY,
        section_id VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL
      )
    `);

    // Bookings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS Bookings (
        booking_id VARCHAR(255) PRIMARY KEY,
        seat_id VARCHAR(50) NOT NULL,
        section_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        movie_title VARCHAR(255),
        show_time VARCHAR(100),
        hall VARCHAR(255),
        movie_poster TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add missing columns if Bookings table already exists from an older schema
    try {
      await client.query("ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS seat_id VARCHAR(50) NOT NULL DEFAULT 'unknown'");
      await client.query("ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS section_id VARCHAR(50) NOT NULL DEFAULT 'unknown'");
      await client.query("ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'BOOKED'");
      await client.query("ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS movie_title VARCHAR(255)");
      await client.query("ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS show_time VARCHAR(100)");
      await client.query("ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS hall VARCHAR(255)");
      await client.query("ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS movie_poster TEXT");
    } catch (e) {
      // Ignore if table doesn't exist yet
    }

    // Payments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS Payments (
        idempotency_key VARCHAR(255) PRIMARY KEY,
        booking_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Drop legacy foreign key constraint if present from older migrations
    try {
      await client.query("ALTER TABLE Payments DROP CONSTRAINT IF EXISTS payments_booking_id_fkey");
    } catch (e) {
      // Ignore if constraint does not exist
    }
    
    console.log("✓ PostgreSQL tables checked/created");
  } catch (err) {
    console.error("Error creating tables:", err);
    throw err;
  } finally {
    client.release();
  }
}

async function seedSeats() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT COUNT(*) FROM Seats");
    if (parseInt(rows[0].count) > 0) return;

    console.log("Seeding seats...");
    const sections = { A: 24, B: 40, C: 60 };
    
    await client.query("BEGIN");
    
    for (const [sectionId, count] of Object.entries(sections)) {
      for (let i = 1; i <= count; i++) {
        await client.query(
          "INSERT INTO Seats (seat_id, section_id, status) VALUES ($1, $2, $3) ON CONFLICT (seat_id) DO NOTHING",
          [`${sectionId}${i}`, sectionId, "AVAILABLE"]
        );
      }
    }
    
    await client.query("COMMIT");
    console.log("✓ Seeded seats table");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error seeding seats:", err);
    throw err;
  } finally {
    client.release();
  }
}

// User Helpers
export async function createUser({ id, name, email, passwordHash }) {
  const { rows } = await pool.query(
    "INSERT INTO Users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email, created_at",
    [id, name, email, passwordHash]
  );
  return rows[0];
}

export async function getUserByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM Users WHERE email = $1", [email]);
  return rows[0] || null;
}

export async function getUserById(id) {
  const { rows } = await pool.query("SELECT id, name, email, created_at FROM Users WHERE id = $1", [id]);
  return rows[0] || null;
}

export async function getUserBookings(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM Bookings WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows;
}

export async function getAllSeats() {
  const { rows } = await pool.query(
    "SELECT * FROM Seats ORDER BY section_id, LENGTH(seat_id), seat_id"
  );
  return rows;
}

export async function getSeat(seatId) {
  const { rows } = await pool.query(
    "SELECT * FROM Seats WHERE seat_id = $1",
    [seatId]
  );
  return rows[0] || null;
}

export async function createBooking({ bookingId, seatId, sectionId, userId, movieTitle, showTime, hall, moviePoster }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Update Seat status
    await client.query(
      "UPDATE Seats SET status = $1 WHERE seat_id = $2",
      ["BOOKED", seatId]
    );

    // Create Booking
    await client.query(
      `INSERT INTO Bookings (booking_id, seat_id, section_id, user_id, status, movie_title, show_time, hall, movie_poster) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (booking_id) DO UPDATE SET status = EXCLUDED.status`,
      [bookingId, seatId, sectionId, userId, "BOOKED", movieTitle || "Dune: Part Two", showTime || "03:15 PM", hall || "PVR IMAX", moviePoster || ""]
    );

    await client.query("COMMIT");
    return { bookingId, seatId, sectionId, userId, status: "BOOKED" };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Transaction failed:", err);
    throw err;
  } finally {
    client.release();
  }
}

export async function getBooking(bookingId) {
  const { rows } = await pool.query(
    "SELECT * FROM Bookings WHERE booking_id = $1",
    [bookingId]
  );
  return rows[0] || null;
}

export async function getPaymentByKey(idempotencyKey) {
  const { rows } = await pool.query(
    "SELECT * FROM Payments WHERE idempotency_key = $1",
    [idempotencyKey]
  );
  return rows[0] || null;
}

export async function savePayment({ bookingId, status, idempotencyKey }) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO Payments (idempotency_key, booking_id, status) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (idempotency_key) DO NOTHING 
       RETURNING *`,
      [idempotencyKey, bookingId, status]
    );
    
    if (rows.length === 0) {
      return await getPaymentByKey(idempotencyKey);
    }
    
    return rows[0];
  } catch (err) {
    console.error("Error saving payment:", err.message);
    if (err.code === "23503") {
      // Foreign key constraint violation (booking_id not yet in Bookings)
      console.warn(`[DB] FK violation on Payments table for booking_id ${bookingId}. Returning unconstrained payment status.`);
      return { idempotency_key: idempotencyKey, booking_id: bookingId, status };
    }
    throw err;
  } finally {
    client.release();
  }
}
