# Hookpoint Webhook Receiver, Dispatcher & Evaluation Server

> A production-ready, zero-dependency Node.js server demonstrating and testing the [`hookpoint`](https://github.com/hartej46/hookpoint) package for secure webhook delivery, cryptographic signature verification, replay attack prevention, fan-out dispatching, and exponential backoff retries.

---

## 📋 Table of Contents

- [Overview & Architecture](#-overview--architecture)
- [Key Features Demonstrated](#-key-features-demonstrated)
- [Quick Start](#-quick-start)
- [Interactive Evaluation Dashboard](#-interactive-evaluation-dashboard)
- [Automated Tests & Simulation](#-automated-tests--simulation)
- [Instructor Evaluation Guide & cURL Commands](#-instructor-evaluation-guide--curl-commands)
- [API Reference](#-api-reference)
- [Deployment Guide](#-deployment-guide)

---

## 🏗️ Overview & Architecture

This server is built to showcase and evaluate the unpushed `hookpoint` npm package. It implements both **Inbound Webhook Receiving** (with constant-time HMAC-SHA256 signature verification and replay prevention) and **Outbound Webhook Dispatching** (with multi-subscriber fan-out, topic matching, and exponential backoff retries).

```
+-----------------------------------------------------------------------------------+
|                                  HOOKPOINT SERVER                                 |
|                                                                                   |
|  [ INBOUND FLOW ]                                                                 |
|   External Webhook  ---> POST /webhook                                            |
|   (Stripe/Svix style)        |                                                    |
|                              v                                                    |
|                     WebhookReceiver (hookpoint)                                  |
|                      ├── 1. Check x-webhook-signature header                      |
|                      ├── 2. Timing-safe HMAC verification (crypto.timingSafeEqual)|
|                      ├── 3. Timestamp tolerance validation (default: 300s)       |
|                      └── 4. Replay attack defense (x-webhook-id deduplication)   |
|                              |                                                    |
|                      [200 OK or 401 ERROR]                                        |
|                              v                                                    |
|                     In-Memory Event Store (Audit Log)                             |
|                                                                                   |
|  [ OUTBOUND FLOW ]                                                                |
|   Application Event ---> WebhookDispatcher (hookpoint)                           |
|                              ├── Topic pattern matching (*, order.*, invoice.paid)|
|                              ├── Concurrent Fan-out to Subscribers                |
|                              ├── Automatic Retries + Exponential Backoff + Jitter |
|                              └── DeliveryTracker (Latency, Attempts, Success %)   |
+-----------------------------------------------------------------------------------+
```

---

## ⚡ Key Features Demonstrated

1. **Zero Runtime Dependencies**: The core server runs purely on native Node.js standard libraries (`node:http`, `node:crypto`, `node:events`).
2. **`WebhookReceiver` Integration**:
   - `receiver.handle(req, res, handler)` stream parsing and verification.
   - Replay protection caching seen `x-webhook-id`s within a configurable TTL window.
   - Timestamp verification against clock skew / replay tolerance.
   - Constant-time HMAC comparison to prevent timing side-channel attacks.
3. **`WebhookDispatcher` Fan-Out**:
   - Dynamic subscriber registration with topic pattern matching (`*`, `order.*`, etc.).
   - Fan-out delivery with aggregated summaries.
4. **`sendWebhook` & Automatic Retries**:
   - Configurable strategies: `exponential`, `linear`, `fixed`.
   - Randomized jitter to avoid thundering herd.
   - Automatic handling of network drops and HTTP 5xx / 429 status codes.
5. **Observability & `DeliveryTracker`**:
   - Full attempt history (durations, status codes, response snippets).
   - In-memory circular buffer with live success rate calculations.
6. **Built-in Interactive Dashboard**:
   - Web UI accessible at `http://localhost:3000/` with 1-click evaluation buttons.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0.0 or higher.
- No database or external services required.

### 1. Installation

Dependencies are installed directly from the pre-bundled `hookpoint-1.0.0.tgz` package tarball:

```bash
npm install
```

### 2. Start the Server

```bash
npm start
```

Or run with live file-watching during development:

```bash
npm run dev
```

The server will start on `http://localhost:3000`.

---

## 🖥️ Interactive Evaluation Dashboard

Open `http://localhost:3000/` in any browser to access the Webhook Testing Dashboard:

- **Live Metrics**: Real-time counter of verified inbound events, delivered outbound webhooks, and overall delivery success rate.
- **1-Click Security Scenarios**:
  - 🟢 **Valid Webhook**: Sends a signed webhook with valid HMAC and current timestamp.
  - 🛡️ **Replay Attack**: Replays an already-used `x-webhook-id` within cache TTL (expecting `401 ERR_REPLAY_ATTACK`).
  - 🔒 **Tampered Signature**: Sends forged payload or corrupt hash (expecting `401 ERR_SIGNATURE_MISMATCH`).
  - ⏱️ **Expired Timestamp**: Sends a webhook 10 minutes in the past (expecting `401 ERR_TIMESTAMP_OUT_OF_TOLERANCE`).
  - 🔄 **Exponential Backoff**: Sends to a flaky mock endpoint that fails twice with 500, then recovers on attempt 3.
- **Custom Inbound Webhook Tester**: Craft custom JSON payloads and test arbitrary event names.
- **Subscriber Fan-Out**: Register subscriber endpoints and trigger topic-filtered events.
- **Live Response Inspector**: Displays status code badge, latency in ms, and response JSON in real time.

---

## 🧪 Automated Tests & Simulation

### 1. Automated Test Suite (`npm test`)

Runs 11 automated unit and integration tests using native `node:test`:

```bash
npm test
```

Test coverage includes:
- `GET /health` online check.
- `POST /webhook` missing signature check (`401 ERR_MISSING_SIGNATURE`).
- `POST /webhook` invalid signature check (`401 ERR_SIGNATURE_MISMATCH`).
- `POST /webhook` expired timestamp check (`401 ERR_TIMESTAMP_OUT_OF_TOLERANCE`).
- `POST /webhook` valid HMAC verification (`200 OK`).
- `POST /webhook` replay attack prevention (`401 ERR_REPLAY_ATTACK`).
- Non-POST HTTP method rejection (`405 Method Not Allowed`).
- Inbound event listing & pagination.
- WebhookDispatcher subscriber topic matching & fan-out.
- Automatic retry on HTTP 500 flaky endpoint.
- DeliveryTracker performance statistics.

### 2. End-to-End CLI Simulation (`npm run simulate`)

Runs an interactive, colorized terminal simulation testing all 6 evaluation criteria against an ephemeral server instance:

```bash
npm run simulate
```

---

## 🎓 Instructor Evaluation Guide & cURL Commands

You can evaluate the server directly from your terminal using `curl`.

### Configuration Defaults:
- **Port:** `3000`
- **Secret:** `whsec_evaluation_test_secret_2026`
- **Tolerance:** `300` seconds (5 minutes)

---

### Test 1: Send a Valid Signed Webhook

Use the built-in helper to calculate the signature, or use `POST /api/tools/sign` to generate the header:

```bash
# 1. Generate signature header
SIG_HEADER=$(curl -s -X POST http://localhost:3000/api/tools/sign \
  -H "Content-Type: application/json" \
  -d '{"payload": {"orderId": "ord_eval_1", "total": 99.50}}' | grep -o '"header":"[^"]*' | cut -d'"' -f4)

# 2. Send webhook to /webhook
curl -i -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: $SIG_HEADER" \
  -H "x-webhook-id: eval_unique_001" \
  -H "x-webhook-event: order.placed" \
  -d '{"orderId": "ord_eval_1", "total": 99.50}'
```

**Expected Response:** `HTTP/1.1 200 OK`
```json
{
  "success": true,
  "result": {
    "processed": true,
    "action": "event_recorded",
    "eventId": "eval_unique_001",
    "event": "order.placed"
  }
}
```

---

### Test 2: Test Replay Attack Prevention

Re-send the exact same command above with the same `x-webhook-id: eval_unique_001`:

```bash
curl -i -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: $SIG_HEADER" \
  -H "x-webhook-id: eval_unique_001" \
  -H "x-webhook-event: order.placed" \
  -d '{"orderId": "ord_eval_1", "total": 99.50}'
```

**Expected Response:** `HTTP/1.1 401 Unauthorized`
```json
{
  "error": "Duplicate webhook detected (replay attack): eval_unique_001",
  "code": "ERR_REPLAY_ATTACK"
}
```

---

### Test 3: Test Tampered Signature Rejection

Send a payload with a forged or invalid signature:

```bash
curl -i -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: t=1700000000,v1=deadbeef00000000000000000000000000000000000000000000000000000000" \
  -H "x-webhook-id: eval_fake_sig" \
  -H "x-webhook-event: order.placed" \
  -d '{"orderId": "ord_eval_1", "total": 99.50}'
```

**Expected Response:** `HTTP/1.1 401 Unauthorized`
```json
{
  "error": "Signature mismatch",
  "code": "ERR_SIGNATURE_MISMATCH"
}
```

---

### Test 4: Test Expired Timestamp (Replay Tolerance Window)

Send a webhook whose timestamp header `t=` is 10 minutes (600s) in the past:

```bash
OLD_TIME=$(( $(date +%s) - 600 ))
curl -i -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: t=$OLD_TIME,v1=0000000000000000000000000000000000000000000000000000000000000000" \
  -H "x-webhook-id: eval_expired" \
  -H "x-webhook-event: order.placed" \
  -d '{"orderId": "ord_eval_1"}'
```

**Expected Response:** `HTTP/1.1 401 Unauthorized`
```json
{
  "error": "Webhook timestamp is outside tolerance window",
  "code": "ERR_TIMESTAMP_OUT_OF_TOLERANCE"
}
```

---

### Test 5: Outbound Dispatch with Retries on Flaky Endpoint

Dispatch a webhook to the built-in `/mock/flaky` route, which fails with 500 twice before succeeding:

```bash
curl -i -X POST http://localhost:3000/api/webhooks/send \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:3000/mock/flaky",
    "eventName": "order.retry_test",
    "payload": {"item": "notebook"},
    "retry": {"maxRetries": 3, "initialDelayMs": 100, "strategy": "fixed"}
  }'
```

**Expected Response:** `HTTP/1.1 200 OK` with 3 attempts recorded:
```json
{
  "success": true,
  "record": {
    "status": "delivered",
    "attemptCount": 3,
    "attempts": [
      { "attemptNumber": 1, "success": false, "statusCode": 500 },
      { "attemptNumber": 2, "success": false, "statusCode": 500 },
      { "attemptNumber": 3, "success": true, "statusCode": 200 }
    ]
  }
}
```

---

## 📡 API Reference

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/` | Webhook Evaluator Interactive Dashboard |
| `GET` | `/health` | Server health check & active security configuration |
| `POST` | `/webhook` | Core Webhook Receiver (verifies HMAC, timestamp, replay ID) |
| `GET` | `/api/events` | List received inbound webhooks |
| `DELETE` | `/api/events` | Clear inbound event logs |
| `GET` | `/api/endpoints` | List registered subscriber endpoints |
| `POST` | `/api/endpoints` | Register a new subscriber endpoint |
| `DELETE` | `/api/endpoints/:id` | Unregister a subscriber endpoint |
| `POST` | `/api/events/dispatch` | Fan-out an event to all matching subscribers |
| `POST` | `/api/webhooks/send` | Send a one-off webhook with signature and automatic retry |
| `GET` | `/api/deliveries` | List outbound delivery records |
| `GET` | `/api/deliveries/:id` | Get single delivery attempt details |
| `GET` | `/api/stats` | Aggregate delivery statistics (total, success rate) |
| `POST` | `/api/tools/sign` | Sign arbitrary payloads helper for testing |
| `POST` | `/mock/flaky` | Mock route: fails twice with 500, succeeds on 3rd attempt |
| `POST` | `/mock/rate-limited` | Mock route: returns 429 with `Retry-After: 1` once, then succeeds |
| `POST` | `/mock/echo` | Mock route: echoes received payload and headers |
| `POST` | `/mock/dead` | Mock route: permanently returns 500 |

---

## ☁️ Deployment Guide

### Option 1: Deploy to Render.com (Recommended)

1. Push this repository to GitHub.
2. In [Render Dashboard](https://dashboard.render.com), click **New > Blueprint**.
3. Select your repository. Render will automatically detect `render.yaml` and deploy the service.
4. Or create a **New Web Service**:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - Set environment variable: `PORT=10000`

### Option 2: Deploy to Railway / Fly.io / Docker

This repository includes a production `Dockerfile`:

```bash
# Build Docker image
docker build -t hookpoint-server .

# Run Docker container
docker run -p 3000:3000 -e WEBHOOK_SECRET=my_production_secret hookpoint-server
```

### Option 3: Expose Local Server via HTTPS Tunnel (ngrok / Cloudflare)

When testing with external live webhook providers (e.g. Stripe, GitHub, Shopify):

```bash
# Expose port 3000
ngrok http 3000
```

Use the assigned HTTPS URL as your webhook destination: `https://your-tunnel-url.ngrok-free.app/webhook`.

---

## 📄 License

MIT
