'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  WebhookReceiver,
  WebhookDispatcher,
  DeliveryTracker,
  sendWebhook,
  sign,
  verify,
  WebhookSignatureError
} = require('hookpoint');

const defaultConfig = require('./config');
const { defaultStore } = require('./store');

/**
 * Helper to read JSON request body stream for non-receiver endpoints.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (!body.trim()) {
        return resolve({});
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response helper.
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-webhook-signature, x-webhook-id, x-webhook-event, x-webhook-timestamp'
  });
  res.end(JSON.stringify(data));
}

/**
 * Creates the request handler application instance.
 *
 * @param {object} [customConfig]
 * @param {import('./store').AppStore} [customStore]
 */
function createApp(customConfig = {}, customStore = null) {
  const config = { ...defaultConfig, ...customConfig };
  const store = customStore || defaultStore;

  // 1. Webhook Receiver instance initialized with config
  const receiver = new WebhookReceiver({
    secret: config.webhookSecret,
    tolerance: config.tolerance,
    signatureHeaderName: config.signatureHeaderName,
    replayProtection: config.replayProtection,
    replayTtlMs: config.replayTtlMs
  });

  // 2. Shared Delivery Tracker for delivery history & metrics
  const tracker = new DeliveryTracker({ maxRecords: 5000 });

  // 3. Webhook Dispatcher for subscriber management and fan-out
  const dispatcher = new WebhookDispatcher({
    tracker,
    defaultSecret: config.webhookSecret,
    defaultTimeoutMs: 10000,
    defaultRetry: {
      maxRetries: 3,
      strategy: 'exponential',
      initialDelayMs: 500,
      jitter: true
    }
  });

  const indexPath = path.join(__dirname, '..', 'public', 'index.html');

  /**
   * Main HTTP request listener
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  const app = async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-webhook-signature, x-webhook-id, x-webhook-event, x-webhook-timestamp'
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // -------------------------------------------------------------
    // Route 1: GET / -> Interactive Dashboard
    // -------------------------------------------------------------
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/dashboard')) {
      fs.readFile(indexPath, 'utf8', (err, html) => {
        if (err) {
          sendJson(res, 500, { error: 'Failed to load dashboard interface' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(html);
      });
      return;
    }

    // -------------------------------------------------------------
    // Route 2: GET /health -> Health check & metadata
    // -------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'hookpoint-server',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: Date.now(),
        config: {
          toleranceSeconds: config.tolerance,
          replayProtection: config.replayProtection,
          secretConfigured: Boolean(config.webhookSecret)
        }
      });
    }

    // -------------------------------------------------------------
    // Route 3: GET /api/config -> Safe config preview
    // -------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/config') {
      return sendJson(res, 200, {
        port: config.port,
        host: config.host,
        tolerance: config.tolerance,
        replayProtection: config.replayProtection,
        replayTtlMs: config.replayTtlMs,
        signatureHeaderName: config.signatureHeaderName,
        secretPreview: config.webhookSecret
          ? `${config.webhookSecret.slice(0, 6)}...${config.webhookSecret.slice(-4)}`
          : 'none'
      });
    }

    // -------------------------------------------------------------
    // Route 4: POST /webhook -> Native WebhookReceiver Handler
    // -------------------------------------------------------------
    if (pathname === '/webhook') {
      return receiver.handle(req, res, async ({ event, payload, eventId, timestamp, headers }) => {
        // Record verified event in application store
        const record = store.addInboundEvent({
          event,
          payload,
          eventId,
          timestamp,
          headers
        });

        // Business logic execution placeholder
        return {
          processed: true,
          action: 'event_recorded',
          eventId: record.eventId,
          event: record.event,
          receivedAt: record.receivedAt
        };
      });
    }

    // -------------------------------------------------------------
    // Route 5: GET /api/events -> List received inbound events
    // -------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/events') {
      const eventFilter = parsedUrl.searchParams.get('event');
      const limit = parsedUrl.searchParams.get('limit');
      const offset = parsedUrl.searchParams.get('offset');
      const data = store.getInboundEvents({ event: eventFilter, limit, offset });
      return sendJson(res, 200, data);
    }

    // Route 5b: DELETE /api/events -> Clear inbound events
    if (req.method === 'DELETE' && pathname === '/api/events') {
      store.clearInboundEvents();
      return sendJson(res, 200, { success: true, message: 'Inbound events cleared' });
    }

    // -------------------------------------------------------------
    // Route 6: Endpoints Management for Dispatcher
    // -------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/endpoints') {
      const endpoints = dispatcher.listEndpoints();
      return sendJson(res, 200, { total: endpoints.length, endpoints });
    }

    if (req.method === 'POST' && pathname === '/api/endpoints') {
      try {
        const body = await readJsonBody(req);
        if (!body.url) {
          return sendJson(res, 400, { error: 'Endpoint url is required' });
        }
        const endpoint = dispatcher.registerEndpoint({
          id: body.id,
          url: body.url,
          secret: body.secret,
          events: body.events,
          headers: body.headers,
          metadata: body.metadata
        });
        return sendJson(res, 201, { success: true, endpoint });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/endpoints/')) {
      const endpointId = pathname.replace('/api/endpoints/', '').trim();
      const removed = dispatcher.unregisterEndpoint(endpointId);
      if (removed) {
        return sendJson(res, 200, { success: true, removed: endpointId });
      } else {
        return sendJson(res, 404, { error: `Endpoint "${endpointId}" not found` });
      }
    }

    // -------------------------------------------------------------
    // Route 7: POST /api/events/dispatch -> Fan-out via WebhookDispatcher
    // -------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/events/dispatch') {
      try {
        const body = await readJsonBody(req);
        if (!body.eventName) {
          return sendJson(res, 400, { error: 'eventName is required' });
        }
        const payload = body.payload !== undefined ? body.payload : {};
        const summary = await dispatcher.dispatch(body.eventName, payload, {
          eventId: body.eventId,
          headers: body.headers
        });
        return sendJson(res, 200, { success: true, summary });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // Route 8: POST /api/webhooks/send -> Direct one-off sendWebhook
    // -------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/webhooks/send') {
      try {
        const body = await readJsonBody(req);
        if (!body.url) {
          return sendJson(res, 400, { error: 'Destination url is required' });
        }
        const payload = body.payload !== undefined ? body.payload : {};
        const secret = body.secret || config.webhookSecret;

        const record = await sendWebhook(body.url, payload, {
          secret,
          eventName: body.eventName || 'manual.trigger',
          eventId: body.eventId,
          tracker,
          timeoutMs: body.timeoutMs || 10000,
          retry: body.retry || {
            maxRetries: 3,
            strategy: 'exponential',
            initialDelayMs: 500,
            jitter: true
          }
        });

        return sendJson(res, 200, { success: true, record });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // Route 9: GET /api/deliveries -> Outbound delivery history
    // -------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/deliveries') {
      const status = parsedUrl.searchParams.get('status') || undefined;
      const eventName = parsedUrl.searchParams.get('eventName') || undefined;
      const limit = parsedUrl.searchParams.get('limit') ? parseInt(parsedUrl.searchParams.get('limit'), 10) : 50;
      const offset = parsedUrl.searchParams.get('offset') ? parseInt(parsedUrl.searchParams.get('offset'), 10) : 0;

      const result = tracker.list({ status, eventName, limit, offset });
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/deliveries/')) {
      const deliveryId = pathname.replace('/api/deliveries/', '').trim();
      const record = tracker.get(deliveryId);
      if (record) {
        return sendJson(res, 200, record);
      }
      return sendJson(res, 404, { error: `Delivery record "${deliveryId}" not found` });
    }

    // -------------------------------------------------------------
    // Route 10: GET /api/stats -> Aggregate metrics
    // -------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/stats') {
      const trackerStats = tracker.getStats();
      const inboundStats = store.getInboundEvents({ limit: 1 });
      return sendJson(res, 200, {
        inbound: {
          total: inboundStats.total
        },
        outbound: trackerStats,
        endpoints: {
          total: dispatcher.listEndpoints().length
        }
      });
    }

    // -------------------------------------------------------------
    // Route 11: POST /api/tools/sign -> Sign payload helper for testing
    // -------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/tools/sign') {
      try {
        const body = await readJsonBody(req);
        const secret = body.secret || config.webhookSecret;
        const payload = body.payload !== undefined ? body.payload : { test: true };
        const timestamp = body.timestamp !== undefined ? Number(body.timestamp) : undefined;
        const format = body.format || 'standard';

        const sigResult = sign(payload, secret, { timestamp, format });
        const rawPayloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

        return sendJson(res, 200, {
          success: true,
          header: sigResult.header,
          signature: sigResult.signature,
          timestamp: sigResult.timestamp,
          curlExample: `curl -X POST http://localhost:${config.port}/webhook \\\n  -H "Content-Type: application/json" \\\n  -H "x-webhook-signature: ${sigResult.header}" \\\n  -H "x-webhook-id: evt_${Date.now()}" \\\n  -H "x-webhook-event: sample.event" \\\n  -d '${rawPayloadStr}'`
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // Route 12: Mock Routes for Simulating Real-World Scenarios
    // -------------------------------------------------------------
    // Mock 1: Flaky endpoint (fails 2 times with 500, succeeds on attempt 3)
    if (pathname === '/mock/flaky') {
      const count = store.incrementMockCounter('flaky');
      if (count < 3) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Mock failure (attempt ${count}/3)` }));
      }
      store.resetMockCounter('flaky');
      return sendJson(res, 200, { success: true, message: 'Recovered after retries!', attempt: count });
    }

    // Mock 2: Rate limited endpoint (returns 429 once with Retry-After, then 200)
    if (pathname === '/mock/rate-limited') {
      const count = store.incrementMockCounter('rate-limited');
      if (count === 1) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '1'
        });
        return res.end(JSON.stringify({ error: 'Too Many Requests, please back off' }));
      }
      store.resetMockCounter('rate-limited');
      return sendJson(res, 200, { success: true, message: 'Succeeded after rate-limit backoff' });
    }

    // Mock 3: Echo endpoint (always 200)
    if (pathname === '/mock/echo') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, {
        success: true,
        echo: body,
        receivedHeaders: req.headers
      });
    }

    // Mock 4: Dead endpoint (always 500)
    if (pathname === '/mock/dead') {
      return sendJson(res, 500, { error: 'Internal Server Error (permanent mock)' });
    }

    // Default 404
    sendJson(res, 404, { error: 'Not Found', path: pathname });
  };

  return {
    app,
    receiver,
    dispatcher,
    tracker,
    store,
    config
  };
}

module.exports = {
  createApp
};
