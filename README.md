# 🎟️ CinePulse: Distributed Real-Time Ticket Booking Platform

CinePulse is a distributed, production-grade ticket reservation platform engineered for high-concurrency event sales and flash-sale traffic spikes. It features **Redis Distributed Locking**, a **Virtual Waiting Room & Traffic Queue (Ticketmaster-style)**, **Razorpay Payment Gateway Integration**, **Async SQS Write-Behind Caching**, **PostgreSQL Persistence**, and **Real-time WebSockets Synchronization**.

---

## 📑 Master Table of Contents
1. [Architecture & System Design](#-architecture--system-design)
2. [Seat State Transition Lifecycle](#-seat-state-transition-lifecycle)
3. [End-to-End Detailed User Flow Journey](#-end-to-end-detailed-user-flow-journey)
4. [Master Failure Modes & Edge Case Matrix](#-master-failure-modes--edge-case-matrix)
5. [Tech Stack & Engineering Rationale](#-tech-stack--engineering-rationale)
6. [Sub-System Documentation Sitemap](#-sub-system-documentation-sitemap)
7. [Quick Start & Setup Instructions](#-quick-start--setup-instructions)

---

## 🏗️ Architecture & System Design

```mermaid
graph TD
    subgraph Client Layer
        Browser1["React App (Browser 1)"]
        Browser2["React App (Browser 2)"]
        Browser3["React App (Browser 3)"]
    end

    subgraph Communication & Proxy Layer
        SocketServer["Socket.IO Server & HTTP Proxy (Port 3001)"]
    end

    subgraph Backend Application Layer
        NextAPI["Next.js 16 API Backend (Port 3000)"]
        AuthService["JWT & User Auth Engine"]
        QueueEngine["ZSET Virtual Queue Engine"]
        LockEngine["Redis Distributed Lock Engine"]
        RazorpayEngine["Razorpay Payment Engine"]
    end

    subgraph Memory & Async Queue Layer
        RedisCache[("Redis Memory Store")]
        SQSQueue["Mock SQS Message Queue"]
    end

    subgraph Persistence Layer
        WorkerProcess["Background SQS Worker"]
        PostgresDB[("PostgreSQL Database (Neon SSL)")]
    end

    Browser1 -->|WebSockets & REST| SocketServer
    Browser2 -->|WebSockets & REST| SocketServer
    Browser3 -->|WebSockets & REST| SocketServer

    SocketServer -->|Proxy REST Requests| NextAPI
    SocketServer -->|WebSocket Broadcasts| Browser1
    SocketServer -->|WebSocket Broadcasts| Browser2
    SocketServer -->|WebSocket Broadcasts| Browser3

    NextAPI --> AuthService
    NextAPI --> QueueEngine
    NextAPI --> LockEngine
    NextAPI --> RazorpayEngine

    QueueEngine -->|ZADD / ZRANK| RedisCache
    LockEngine -->|SET NX EX 120| RedisCache
    RazorpayEngine -->|State Promotion| RedisCache
    NextAPI -->|Enqueue Message| SQSQueue
    SQSQueue -->|Poll Queue| WorkerProcess
    WorkerProcess -->|Persist Bookings| PostgresDB
```

---

## 🔄 Seat State Transition Lifecycle

```mermaid
stateDiagram-v2
    [*] --> AVAILABLE : Initial State (Postgres & Redis)
    
    AVAILABLE --> HOLD : User clicks seat (Atomic SET NX EX 120)
    
    HOLD --> AVAILABLE : 120s TTL Expires OR User cancels
    HOLD --> BOOKED : Payment Submitted via Razorpay (State Promotion)
    
    BOOKED --> PostgresDB : SQS Worker writes to DB (Async 500ms)
    BOOKED --> [*] : Permanent Confirmed Ticket Pass Issued
```

1. **`AVAILABLE`**: Seat is open for any user. Status fetched from PostgreSQL and overlaid with Redis cache.
2. **`HOLD`**: Seat locked temporarily for 120 seconds using Redis `SET hold:seat:${seatId} value NX EX 120`. Prevents concurrent selection.
3. **`BOOKED`**: Promoted synchronously in Redis to permanent status upon Razorpay payment submission. SQS worker asynchronously writes `UPDATE Seats SET status = 'BOOKED'` to PostgreSQL.

---

## 🧭 End-to-End Detailed User Flow Journey

### Step 1: Landing & Show Catalog (`/` & `/movies`)
- Users explore high-demand movies, concerts, standup comedy, and Broadway shows.
- Users select an event slot and venue hall.

### Step 2: Virtual Waiting Room Interceptor (`/booking`)
- Clicking "Book Tickets" initiates `POST /api/queue/join`.
- **Capacity Check**: If active seat pickers exceed capacity (`MAX_ACTIVE_BUYERS = 2` for demo), user enters a Redis Sorted Set (`ZSET`) queue.
- **Waiting Room Screen (`WaitingRoom.jsx`)**: Displays dynamic rank (`#3 Your Rank in Line`), users ahead counter, and animated progress ring.
- **WebSocket Promotion**: When a slot opens, Socket.IO emits `queue:granted`, and the client seamlessly transitions into the seat selection map.

### Step 3: Interactive Seat Selection (`/booking`)
- Interactive cinema hall map renders plush 3D chair headrests, armrests, aisle walkway gaps, and ticket quantity shortcuts (`1`, `2`, `3`, `4`).
- Clicking an available seat executes `POST /api/book-seat` (Redis `SET NX EX 120`).
- Real-time WebSockets broadcast `seat:update` to all connected browsers in under 10ms.

### Step 4: Razorpay Checkout & Order Summary (`/payment`)
- Displays 2-column wide layout (`max-width: 880px`) with movie showcase card and pass holder form.
- Real-time countdown timer calculates remaining seconds using `expiresAtTimestamp` in `localStorage`.
- Submitting form launches the official **Razorpay Checkout Modal** (UPI, Credit/Debit Cards, NetBanking).
- On payment confirmation, displays an official **E-Ticket Pass** with Razorpay Payment ID.

### Step 5: User Profile & Bookings (`/profile`)
- Users view confirmed E-Ticket passes, show metadata, venue hall, and QR pass codes under their profile.

---

## ⚠️ Master Failure Modes & Edge Case Matrix

| Failure Case | Root Cause / Scenario | Technical Mitigation & Recovery |
| :--- | :--- | :--- |
| **1. 120s Timer Expiry During Razorpay Modal** | User delays completing UPI approval past 120s hold. | React timer executes `closeRazorpayModal()`, strips iframe DOM elements, shows *"Time Over!"*, and `/api/pay` rejects late requests. |
| **2. DevTools Client Timer Tampering** | User edits `localStorage` timestamp to 999 minutes. | Server ignores client clock. `/api/pay` checks Redis TTL; if key is deleted, server returns HTTP 400 `PAYMENT_FAILED`. |
| **3. Concurrent Booking Collision** | Two users click same seat at exact same millisecond. | Redis `SET NX` locks atomically. First request succeeds (`OK`), second request receives `SEAT_ALREADY_TAKEN`. WebSockets updates UI. |
| **4. Abandoned Queue Tabs** | User in queue closes tab without leaving. | Heartbeat token `queue:token:${userId}` expires in 45s. `pruneStaleActiveBuyers()` auto-removes abandoned user and promotes next in line. |
| **5. Network Disconnect in Waiting Room** | Wi-Fi drops while user is waiting in line. | Displays pulsing alert *"⚡ Connection Lost • Reconnecting..."*. Auto-reconnects with `reconnectionAttempts: Infinity` and re-syncs rank. |
| **6. 25-Hour SQS Worker Delay** | Heavy DB queue backlog delays PostgreSQL writes. | Redis holds permanent `seat:status:${seatId} = "BOOKED"` key synchronously before pushing to SQS, ensuring zero double bookings. |
| **7. Redis `ETIMEDOUT` Socket Drops** | Cloud Redis drops idle TCP socket connections. | `redis.js` configures 10s TCP Keep-Alive (`keepAlive: 10000`) and 4s connection timeouts (`connectTimeout: 4000`). `/api/seats` falls back to Postgres. |
| **8. PostgreSQL FK Constraint Violation (Error 23503)** | Payment saved before worker creates `Bookings` row. | Schema execution runs `ALTER TABLE Payments DROP CONSTRAINT IF EXISTS payments_booking_id_fkey`, and `savePayment()` handles code 23503. |
| **9. Razorpay Order API Error** | API test keys unconfigured or network drop. | Backend creates fallback structured order payload (`order_mock_<hex>`), allowing local testing without crashing checkout flow. |
| **10. Browser Tab Throttling** | Chrome pauses background JS timers in inactive tabs. | Socket.IO server configured with `pingTimeout: 60000` and `pingInterval: 25000` to prevent premature socket drops. |

---

## 🛠️ Tech Stack & Engineering Rationale

| Tier | Component | Rationale |
| :--- | :--- | :--- |
| **Frontend** | React 18 + Vite | Fast build speed, modular component tree, sub-second HMR. |
| **Styling** | SCSS Modules | Scoped component styles avoiding global CSS leakage. |
| **WebSockets** | Socket.IO | Automated fallback (WebSocket + HTTP Long Polling) & room-based broadcasting. |
| **Backend API** | Next.js 16 App Router | Serverless-ready REST API endpoints with clean routing. |
| **In-Memory Cache** | Redis (`ioredis`) | Sub-millisecond atomic locking (`SET NX`) and Sorted Sets (`ZSET`). |
| **Async Queue** | SQS Simulation + Worker | Decouples DB disk writes from payment confirmation responses (50ms vs 2s). |
| **Database** | PostgreSQL (Neon SSL) | Persistent ACID-compliant storage for users and confirmed bookings. |
| **Payment Gateway** | Razorpay SDK & Orders API | Native support for Indian payment infrastructure (GPay, PhonePe, Paytm). |

---

## 🗺️ Sub-System Documentation Sitemap

- 📘 **[Client Documentation (`client/README.md`)](file:///Users/adityakumar/WEB/ticket-booking/client/README.md)**: React 18 component tree, WaitingRoom, and client failure modes.
- ⚙️ **[Backend Server Documentation (`server/README.md`)](file:///Users/adityakumar/WEB/ticket-booking/server/README.md)**: REST API specifications, Redis lock engine, and SQS worker logic.
- 🔌 **[Socket Server Documentation (`socket-server/README.md`)](file:///Users/adityakumar/WEB/ticket-booking/socket-server/README.md)**: WebSockets event spec, room channels, and proxy server setup.

---

## 🚀 Quick Start & Setup Instructions

### 1. Environment Variables

**`server/.env`**:
```env
POSTGRES_URL=postgresql://user:password@host/dbname?sslmode=require
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
RAZORPAY_KEY_ID=rzp_test_CinePulseKey123
RAZORPAY_KEY_SECRET=CinePulseSecret456789
JWT_SECRET=your_super_secret_jwt_key
SOCKET_SERVER_URL=http://localhost:3001
```

**`client/.env`**:
```env
VITE_API_URL=http://localhost:3001/api
VITE_SOCKET_SERVER_URL=http://localhost:3001
```

### 2. Run Services

```bash
# 1. Socket.IO & Proxy Server (Port 3001)
cd socket-server && npm install && node server.js

# 2. Next.js API Server (Port 3000)
cd server && npm install && npm run dev

# 3. React Frontend (Port 5173)
cd client && npm install && npm run dev
```

Open `http://localhost:5173` in your browser!
