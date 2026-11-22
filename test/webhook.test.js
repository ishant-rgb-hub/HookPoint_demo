'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { sign } = require('hookpoint');

describe('WebhookReceiver & Server Security Test Suite', () => {
  let server;
  let port;
  let baseUrl;
  const testSecret = 'whsec_test_secret_key_abc123';

  before((_, done) => {
    const { app } = createApp({
      webhookSecret: testSecret,
      tolerance: 60, // 60 seconds tolerance for tests
      replayProtection: true,
      replayTtlMs: 5000 // 5 seconds replay window
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

  test('GET /health returns 200 with online status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'ok');
    assert.equal(data.service, 'hookpoint-server');
  });

  test('POST /webhook rejects request when signature header is missing', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-id': 'evt_no_sig',
        'x-webhook-event': 'order.placed'
      },
      body: JSON.stringify({ orderId: '123' })
    });

    const data = await res.json();
    assert.equal(res.status, 401);
    assert.equal(data.code, 'ERR_MISSING_SIGNATURE');
    assert.match(data.error, /Missing signature header/i);
  });

  test('POST /webhook rejects request when HMAC signature is invalid', async () => {
    const payload = JSON.stringify({ orderId: '123' });
    const fakeSignature = 't=' + Math.floor(Date.now() / 1000) + ',v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': fakeSignature,
        'x-webhook-id': 'evt_invalid_sig',
        'x-webhook-event': 'order.placed'
      },
      body: payload
    });

    const data = await res.json();
    assert.equal(res.status, 401);
    assert.equal(data.code, 'ERR_SIGNATURE_MISMATCH');
  });

  test('POST /webhook rejects request with expired timestamp outside tolerance window', async () => {
    const payload = JSON.stringify({ orderId: '456' });
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 500; // 500 seconds ago (> 60s tolerance)
    const { header } = sign(payload, testSecret, { timestamp: expiredTimestamp });

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': header,
        'x-webhook-id': 'evt_expired',
        'x-webhook-event': 'order.placed'
      },
      body: payload
    });

    const data = await res.json();
    assert.equal(res.status, 401);
    assert.equal(data.code, 'ERR_TIMESTAMP_OUT_OF_TOLERANCE');
  });

  test('POST /webhook accepts valid signed payload and returns 200', async () => {
    const payload = JSON.stringify({ orderId: '789', customer: 'Alice', amount: 99.5 });
    const { header, timestamp } = sign(payload, testSecret);
    const eventId = `evt_valid_${Date.now()}`;

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': header,
        'x-webhook-id': eventId,
        'x-webhook-event': 'order.placed'
      },
      body: payload
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.result.processed, true);
    assert.equal(data.result.eventId, eventId);
    assert.equal(data.result.event, 'order.placed');
  });

  test('POST /webhook blocks replay attack when identical x-webhook-id is submitted', async () => {
    const payload = JSON.stringify({ transactionId: 'tx_replay_test' });
    const { header } = sign(payload, testSecret);
    const duplicateId = 'evt_duplicate_token_999';

    // 1st request -> Must succeed
    const res1 = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': header,
        'x-webhook-id': duplicateId,
        'x-webhook-event': 'payment.captured'
      },
      body: payload
    });
    assert.equal(res1.status, 200);

    // 2nd request with SAME event ID -> Must be blocked as replay attack
    const res2 = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': header,
        'x-webhook-id': duplicateId,
        'x-webhook-event': 'payment.captured'
      },
      body: payload
    });

    const data2 = await res2.json();
    assert.equal(res2.status, 401);
    assert.equal(data2.code, 'ERR_REPLAY_ATTACK');
    assert.match(data2.error, /replay attack/i);
  });

  test('GET /webhook returns 405 Method Not Allowed', async () => {
    const res = await fetch(`${baseUrl}/webhook`);
    const data = await res.json();
    assert.equal(res.status, 405);
    assert.equal(data.error, 'Method Not Allowed');
  });

  test('GET /api/events lists verified inbound events', async () => {
    const res = await fetch(`${baseUrl}/api/events`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(data.events));
    assert.ok(data.total >= 2);
  });
});
