# Event Orchestration Gateway

NestJS webhook gateway that validates signed events, enqueues them in BullMQ, and processes them asynchronously with a worker.

## Architecture Overview

### Components

- API endpoint: `POST /webhook/event`
- Signature validation: `SignatureGuard` + `SignatureService` (HMAC-SHA256 over raw body bytes)
- Queue: BullMQ queue `webhook-event-queuee` (Redis-backed)
- DLQ: BullMQ queue `webhook-event-dlq` (Redis-backed)
- Workers:
  - `EventProcessor` for main queue processing
  - `EventDlqProcessor` for DLQ auto-replay processing
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
- Ingestion path only enqueues to Redis and does not query MongoDB.
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

- Queue job key: `jobId = event-${eventId}`
- Mongo unique index: `EventLog.eventId`
- Mongo unique index: `Shipment.shipmentId`

### Current Behavior

- Duplicate deliveries with the same `eventId` resolve to the same BullMQ `jobId`.
- Worker checks `EventLog` before processing; already-processed events are skipped.
- Mongo event/shipment state reads and writes happen in worker flow, not ingestion flow.

### Known Limitations

- No timestamp/nonce replay window is implemented at signature layer.

## DLQ Strategy

### Current Status

Implemented with a dedicated BullMQ queue: `webhook-event-dlq`.

### Handoff Rules

- Worker retries still run on the main queue (`attempts: 3`, exponential backoff).
- DLQ handoff happens only on terminal failure (`job.attemptsMade >= job.opts.attempts`).
- DLQ dedup key format: `dlq-event-${eventId}`.
- If a DLQ job with the same key already exists, it is replaced with the latest failure payload.
- Auto replay delay: `300000ms` (`5 minutes`) when replay budget is available.
- Max auto replay cycles: `1` (`replayCount < maxReplayCount`).
- When replay budget is exhausted, DLQ job is parked in failed state for investigation.

### DLQ Payload

Each DLQ message stores:

- `event` (original event payload)
- `sourceQueue`
- `sourceJobId`
- `attemptsMade`
- `maxAttempts`
- `failedReason`
- `failedAt`
- `replayCount`
- `maxReplayCount`
- optional `replayedAt`

## Eventual Consistency

Implemented by design:

- `POST /webhook/event` returns `202 Accepted` after enqueue, not after business completion.
- Worker processes asynchronously and updates persistence later.
- `EventLog` and `Shipment` are eventually updated after queue processing/retries.

Implication: callers should treat `202` as accepted-for-processing, not completed.
