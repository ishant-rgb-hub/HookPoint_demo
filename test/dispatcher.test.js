'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

describe('WebhookDispatcher & Retry Integration Suite', () => {
  let server;
  let port;
  let baseUrl;
  const testSecret = 'whsec_dispatcher_secret_999';

  before((_, done) => {
    const { app } = createApp({
      webhookSecret: testSecret,
      tolerance: 300
    });

    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((_, done) => {
    server.close(done);
  });

  test('Registers subscriber endpoints and dispatches fan-out events', async () => {
    // 1. Register subscriber 1 (wildcard *)
    const regRes1 = await fetch(`${baseUrl}/api/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'sub-wildcard',
        url: `${baseUrl}/mock/echo`,
        events: ['*']
      })
    });
    assert.equal(regRes1.status, 201);

    // 2. Register subscriber 2 (prefix order.*)
    const regRes2 = await fetch(`${baseUrl}/api/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'sub-order-only',
        url: `${baseUrl}/mock/echo`,
        events: ['order.*']
      })
    });
    assert.equal(regRes2.status, 201);

    // 3. Register subscriber 3 (unrelated billing.*)
    const regRes3 = await fetch(`${baseUrl}/api/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'sub-billing-only',
        url: `${baseUrl}/mock/echo`,
        events: ['billing.*']
      })
    });
    assert.equal(regRes3.status, 201);

    // 4. Dispatch 'order.created'
    // Matches sub-wildcard and sub-order-only, skips sub-billing-only
    const dispatchRes = await fetch(`${baseUrl}/api/events/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName: 'order.created',
        payload: { orderId: 'ord_fanout_1', total: 150 }
      })
    });

    const dispatchData = await dispatchRes.json();
    assert.equal(dispatchRes.status, 200);
    assert.equal(dispatchData.success, true);
    assert.equal(dispatchData.summary.total, 2);
    assert.equal(dispatchData.summary.delivered, 2);
    assert.equal(dispatchData.summary.failed, 0);
  });

  test('Retries transient 500 failure and succeeds on retry', async () => {
    // Dispatch to /mock/flaky which fails twice with 500 then succeeds
    const res = await fetch(`${baseUrl}/api/webhooks/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${baseUrl}/mock/flaky`,
        eventName: 'retry.demo',
        payload: { itemId: 'item_101' },
        retry: {
          maxRetries: 3,
          strategy: 'fixed',
          initialDelayMs: 50,
          jitter: false
        }
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.record.status, 'delivered');
    assert.equal(data.record.attemptCount, 3);
    assert.equal(data.record.attempts[0].success, false);
    assert.equal(data.record.attempts[1].success, false);
    assert.equal(data.record.attempts[2].success, true);
  });

  test('GET /api/stats returns delivery tracking metrics', async () => {
    const res = await fetch(`${baseUrl}/api/stats`);
    const stats = await res.json();

    assert.equal(res.status, 200);
    assert.ok(stats.outbound.total >= 3);
    assert.ok(stats.outbound.delivered >= 3);
    assert.equal(stats.outbound.successRate, 100);
  });
});
