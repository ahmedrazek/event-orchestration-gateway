# Event Orchestration Gateway

NestJS webhook gateway that validates signed events, enqueues them in BullMQ, and processes them asynchronously with a worker.

## Coverage Summary

| Area | Status in this project |
| --- | --- |
| Architecture overview | Implemented |
| How to run (`docker compose up`) | Implemented |
| Webhook signature format | Implemented |
| Queue + worker concurrency strategy | Implemented |
| Retry + exponential backoff | Implemented |
| Idempotency design | Partially implemented |
| DLQ strategy | Not implemented |
| Eventual consistency | Implemented (required) |
| Load test steps + evidence | Implemented (required) |

## Architecture Overview

### Components

- API endpoint: `POST /webhook/event`
- Signature validation: `SignatureGuard` + `SignatureService` (HMAC-SHA256 over raw body bytes)
- Queue: BullMQ queue `webhook-event-queuee` (Redis-backed)
- Worker: `EventProcessor` (BullMQ processor)
- MongoDB collections:
  - `EventLog` for event processing state
  - `Shipment` for shipment projection state
- Redis: queue broker and job state store

### Request Flow

```text
Client
  -> POST /webhook/event
  -> SignatureGuard verifies x-signature
  -> EventQueue.addEventToQueue()
  -> BullMQ queue (Redis)
  -> EventProcessor worker
  -> WebhookService.routingEvent() (simulated async downstream call)
  -> EventLog updated to processed/failed
```

## How To Run (`docker compose up`)

### Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)

### Start

1. From project root, optionally set a custom secret:

```powershell
$env:WEBHOOK_SECRET = "change-me-to-a-strong-secret"
```

2. Start services:

```bash
docker compose up -d --build
```

3. Check status:

```bash
docker compose ps
```

4. API base URL:

```text
http://localhost:3000
```

### Stop

```bash
docker compose down
```

### Common Local Issue

If Redis port `6379` is already in use:

```text
Bind for 0.0.0.0:6379 failed: port is already allocated
```

Change Redis mapping in `docker-compose.yml` from `6379:6379` to a free host port such as `6380:6379`.

## Webhook Signature Format

### Header

```text
x-signature: sha256=<hex_digest>
```

### Digest Formula

```text
hex_digest = HMAC_SHA256(raw_request_body_bytes, WEBHOOK_SECRET)
```

Important: verification is performed on the exact raw request body bytes captured by Express body parser `verify` hooks.

### Example (Node.js)

```js
const crypto = require('node:crypto');

const body = JSON.stringify({
  eventId: 'evt-1',
  status: 'created',
  shipmentId: 'ship-1',
  orderId: 'order-1',
});

const sig = crypto
  .createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(body)
  .digest('hex');

// send: x-signature: sha256=<sig>
```

## Queue + Worker Concurrency Strategy

### Queue Configuration

- Queue name: `webhook-event-queuee`
- `removeOnComplete: true`
- `attempts: 3`
- Backoff: exponential, base delay `3000ms`

### Worker Configuration

- `concurrency: 5`
- `stalledInterval: 120000`
- `maxStalledCount: 30`

### Practical Strategy

- API returns `202` quickly and offloads processing to background worker.
- Worker concurrency is fixed at 5 to bound parallel downstream calls.
- BullMQ retries handle transient failures from routing logic.

## Retry + Exponential Backoff

Configured through BullMQ default job options:

- Total attempts: `3`
- Backoff: `exponential` with base delay `3000ms`

Approximate retry timing:

- Attempt 1: immediate
- Retry 1: around `+3s`
- Retry 2: around `+6s`

After retries are exhausted, jobs stay in failed state unless cleaned manually (`removeOnFail` is not set to auto-remove).

## Idempotency Design

### Current Design

- Queue job key: `jobId = event-${eventId}-${status}`
- Mongo unique index: `EventLog.eventId`
- Mongo unique index: `Shipment.shipmentId`

### Current Behavior

- If same job exists in `active`, API returns `Already processing`.
- If same job exists in `delayed` or `failed`, existing job is removed and re-enqueued.
- For `created` events, shipment creation checks for existing `(shipmentId, orderId)` record before insert.

### Known Limitations

- Completed jobs are removed (`removeOnComplete: true`), so queue state alone cannot block replay of already-completed events.
- No separate long-lived deduplication store or replay window is implemented.

## DLQ Strategy

### Current Status

Not implemented in this codebase.

### Current Failure Handling

- Failed processing updates `EventLog.status` to `failed` with `lastError`.
- Failed jobs remain in BullMQ failed state (not routed to a dedicated dead-letter queue).

### Gap To Close

- Add dedicated DLQ queue (for example `webhook-event-dlq`) and replay workflow for operational recovery.

## Eventual Consistency (Required)

Implemented by design:

- `POST /webhook/event` returns `202 Accepted` after enqueue, not after business completion.
- Worker processes asynchronously and updates persistence later.
- `EventLog` and `Shipment` are eventually updated after queue processing/retries.

Implication: callers should treat `202` as accepted-for-processing, not completed.

## Load Test Steps + Evidence (Required)

### Steps

1. Start stack:

```bash
docker compose up -d --build
```

2. Run load test:

```bash
node scripts/loadtest-webhook.js --connections=80 --duration=20
```

3. Optional custom run:

```bash
node scripts/loadtest-webhook.js --url=http://localhost:3000/webhook/event --secret=<WEBHOOK_SECRET> --connections=100 --duration=15
```

### Evidence (Captured Locally)

- Run date: `2026-02-24`
- Command: `node scripts/loadtest-webhook.js --connections=80 --duration=20`
- Status counts: `{ '202': 4757 }`
- Non-202 responses: `0`
- Average latency: `332.66 ms`
- P99 latency: `479 ms`
- Average throughput: `237.85 req/sec`
- Total requests: about `5k` in `20.18s`

Interpretation: ingress remained stable for this run (all `202`). This validates intake performance only; it is not full end-to-end business correctness evidence.
