const autocannon = require('autocannon');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const withoutPrefix = token.slice(2);
    const eqIdx = withoutPrefix.indexOf('=');

    if (eqIdx >= 0) {
      const key = withoutPrefix.slice(0, eqIdx);
      const value = withoutPrefix.slice(eqIdx + 1);
      args[key] = value;
      continue;
    }

    const key = withoutPrefix;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const env = {};
  const raw = fs.readFileSync(filePath, 'utf8');

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const idx = trimmed.indexOf('=');
    if (idx <= 0) {
      continue;
    }

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }

  return env;
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function printHelp() {
  console.log(`
Usage:
  npm run loadtest:webhook -- [options]

Options:
  --url <url>                Target endpoint (default: http://localhost:3000/webhook/event)
  --secret <value>           WEBHOOK_SECRET override
  --connections <number>     Concurrent connections (default: 100)
  --duration <seconds>       Test duration in seconds (default: 15)
  --amount <number>          Total requests limit (optional; default: unlimited for duration)
  --help                     Print this message
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help === 'true') {
  printHelp();
  process.exit(0);
}

const envPath = path.resolve(__dirname, '../.env');
const envFromFile = readDotEnv(envPath);

const targetUrl =
  args.url || process.env.LOADTEST_URL || 'http://localhost:3000/webhook/event';
const webhookSecret =
  args.secret || process.env.WEBHOOK_SECRET || envFromFile.WEBHOOK_SECRET;

if (!webhookSecret) {
  console.error(
    'WEBHOOK_SECRET is missing. Set it in .env or pass --secret <value>.',
  );
  process.exit(1);
}

const connections = toInt(
  args.connections || process.env.LOADTEST_CONNECTIONS,
  100,
);
const duration = toInt(args.duration || process.env.LOADTEST_DURATION, 15);
const amount = toInt(args.amount || process.env.LOADTEST_AMOUNT, 0);
const url = new URL(targetUrl);
const baseUrl = `${url.protocol}//${url.host}`;
const requestPath = `${url.pathname}${url.search || ''}`;

let sequence = 0;
let non202Count = 0;
const statusCounts = new Map();

function createBody() {
  const now = Date.now();
  const id = `${now}-${sequence}`;
  sequence += 1;

  return JSON.stringify({
    eventId: `loadtest-${id}`,
    status: 'created',
    shipmentId: `ship-${id}`,
    orderId: `order-${id}`,
    payload: {
      source: 'autocannon',
      sequence,
      generatedAt: new Date(now).toISOString(),
    },
  });
}

console.log('Starting load test with configuration:');
console.log(
  JSON.stringify(
    {
      url: `${baseUrl}${requestPath}`,
      connections,
      duration,
      amount: amount > 0 ? amount : 'unlimited',
    },
    null,
    2,
  ),
);

const instance = autocannon({
  url: baseUrl,
  connections,
  duration,
  pipelining: 1,
  amount: amount > 0 ? amount : undefined,
  requests: [
    {
      method: 'POST',
      path: requestPath,
      headers: {
        'content-type': 'application/json',
      },
      setupRequest: (req) => {
        const body = createBody();
        const signature = crypto
          .createHmac('sha256', webhookSecret)
          .update(body)
          .digest('hex');

        req.body = body;
        req.headers['x-signature'] = `sha256=${signature}`;
        return req;
      },
    },
  ],
});

autocannon.track(instance, {
  renderProgressBar: true,
  renderResultsTable: true,
});

instance.on('response', (_client, statusCode) => {
  statusCounts.set(statusCode, (statusCounts.get(statusCode) || 0) + 1);
  if (statusCode !== 202) {
    non202Count += 1;
  }
});

instance.on('done', () => {
  const sorted = [...statusCounts.entries()].sort((a, b) => a[0] - b[0]);
  console.log('Status counts:', Object.fromEntries(sorted));
  console.log(`Non-202 responses: ${non202Count}`);
});

instance.on('error', (err) => {
  console.error(`Load test failed: ${err.message}`);
  process.exitCode = 1;
});
