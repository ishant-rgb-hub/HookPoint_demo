'use strict';

const http = require('node:http');
const { createApp } = require('./src/app');
const { sign } = require('@ishant3907/hookpoint');

// ANSI Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const SECRET = 'whsec_simulation_instructor_secret_123';
const TOLERANCE = 60; // 60s window

async function runSimulation() {
  console.log(`\n${colors.bright}${colors.cyan}==============================================================${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  🎯 Hookpoint Webhook Evaluation - End-to-End Test Suite      ${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}==============================================================${colors.reset}\n`);

  // Start internal test server on random port
  const { app, tracker, store } = createApp({
    webhookSecret: SECRET,
    tolerance: TOLERANCE,
    replayProtection: true,
    replayTtlMs: 5000
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`${colors.dim}  Test server listening on: ${baseUrl}${colors.reset}`);
  console.log(`${colors.dim}  Secret: ${SECRET}${colors.reset}`);
  console.log(`${colors.dim}  Replay Tolerance: ${TOLERANCE}s | Replay Protection: Enabled${colors.reset}\n`);

  let passed = 0;
  let total = 6;

  try {
    // -----------------------------------------------------------------
    // Scenario 1: Valid Inbound Webhook
    // -----------------------------------------------------------------
    process.stdout.write(`  [1/6] 🟢 Testing Valid Webhook with HMAC Signature... `);
    const payload1 = JSON.stringify({
      orderId: 'ord_sim_9001',
      customer: 'Dr. John Watson',
      total: 350.00,
      currency: 'GBP'
    });
    const sig1 = sign(payload1, SECRET);
    const eventId1 = 'evt_valid_sim_01';

    const res1 = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': sig1.header,
        'x-webhook-id': eventId1,
        'x-webhook-event': 'order.placed'
      },
      body: payload1
    });

    const data1 = await res1.json();
    if (res1.status === 200 && data1.success === true && data1.result?.eventId === eventId1) {
      console.log(`${colors.green}${colors.bright}PASSED (HTTP 200 OK)${colors.reset}`);
      console.log(`        ${colors.dim}Event '${data1.result.event}' verified and processed.${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}${colors.bright}FAILED (Status: ${res1.status})${colors.reset}`);
    }

    // -----------------------------------------------------------------
    // Scenario 2: Replay Attack (Duplicate Event ID)
    // -----------------------------------------------------------------
    process.stdout.write(`  [2/6] 🛡️  Testing Replay Attack Defense (Duplicate ID)... `);
    const res2 = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': sig1.header,
        'x-webhook-id': eventId1, // Same ID as above!
        'x-webhook-event': 'order.placed'
      },
      body: payload1
    });

    const data2 = await res2.json();
    if (res2.status === 401 && data2.code === 'ERR_REPLAY_ATTACK') {
      console.log(`${colors.green}${colors.bright}PASSED (Blocked 401 ERR_REPLAY_ATTACK)${colors.reset}`);
      console.log(`        ${colors.dim}Duplicate event ID '${eventId1}' correctly rejected.${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}${colors.bright}FAILED (Status: ${res2.status})${colors.reset}`);
    }

    // -----------------------------------------------------------------
    // Scenario 3: Tampered Signature
    // -----------------------------------------------------------------
    process.stdout.write(`  [3/6] 🔒 Testing Tampered Signature Rejection... `);
    const tamperedPayload = JSON.stringify({ orderId: 'ord_tampered', amount: 999999 });
    const res3 = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': 't=' + Math.floor(Date.now() / 1000) + ',v1=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'x-webhook-id': 'evt_tampered_01',
        'x-webhook-event': 'account.modified'
      },
      body: tamperedPayload
    });

    const data3 = await res3.json();
    if (res3.status === 401 && data3.code === 'ERR_SIGNATURE_MISMATCH') {
      console.log(`${colors.green}${colors.bright}PASSED (Blocked 401 ERR_SIGNATURE_MISMATCH)${colors.reset}`);
      console.log(`        ${colors.dim}Timing-safe check prevented forged signature.${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}${colors.bright}FAILED (Status: ${res3.status})${colors.reset}`);
    }

    // -----------------------------------------------------------------
    // Scenario 4: Expired Timestamp (Tolerance Window)
    // -----------------------------------------------------------------
    process.stdout.write(`  [4/6] ⏱️  Testing Expired Timestamp Rejection... `);
    const oldTimestamp = Math.floor(Date.now() / 1000) - 300; // 5 mins ago (> 60s tolerance)
    const sigOld = sign(payload1, SECRET, { timestamp: oldTimestamp });

    const res4 = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': sigOld.header,
        'x-webhook-id': 'evt_old_01',
        'x-webhook-event': 'order.placed'
      },
      body: payload1
    });

    const data4 = await res4.json();
    if (res4.status === 401 && data4.code === 'ERR_TIMESTAMP_OUT_OF_TOLERANCE') {
      console.log(`${colors.green}${colors.bright}PASSED (Blocked 401 ERR_TIMESTAMP_OUT_OF_TOLERANCE)${colors.reset}`);
      console.log(`        ${colors.dim}Timestamp outside 60s window was dropped.${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}${colors.bright}FAILED (Status: ${res4.status})${colors.reset}`);
    }

    // -----------------------------------------------------------------
    // Scenario 5: WebhookDispatcher Topic Fan-Out
    // -----------------------------------------------------------------
    process.stdout.write(`  [5/6] 📡 Testing WebhookDispatcher Topic Matching & Fan-Out... `);
    await fetch(`${baseUrl}/api/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'ep-audit', url: `${baseUrl}/mock/echo`, events: ['audit.*'] })
    });
    await fetch(`${baseUrl}/api/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'ep-global', url: `${baseUrl}/mock/echo`, events: ['*'] })
    });

    const fanoutRes = await fetch(`${baseUrl}/api/events/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName: 'audit.security_check',
        payload: { triggeredBy: 'admin', ip: '10.0.0.1' }
      })
    });
    const fanoutData = await fanoutRes.json();

    if (fanoutRes.status === 200 && fanoutData.summary?.delivered === 2) {
      console.log(`${colors.green}${colors.bright}PASSED (Delivered to 2 matching endpoints)${colors.reset}`);
      console.log(`        ${colors.dim}Both 'ep-audit' and 'ep-global' received the event.${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}${colors.bright}FAILED (Delivered: ${fanoutData.summary?.delivered})${colors.reset}`);
    }

    // -----------------------------------------------------------------
    // Scenario 6: Automatic Retry on Transient 500 Error
    // -----------------------------------------------------------------
    process.stdout.write(`  [6/6] 🔄 Testing Automatic Retries with Exponential Backoff... `);
    const retryRes = await fetch(`${baseUrl}/api/webhooks/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${baseUrl}/mock/flaky`,
        eventName: 'system.retry_test',
        payload: { attemptDemo: true },
        retry: { maxRetries: 3, strategy: 'fixed', initialDelayMs: 100, jitter: false }
      })
    });
    const retryData = await retryRes.json();

    if (retryRes.status === 200 && retryData.record?.status === 'delivered' && retryData.record?.attemptCount === 3) {
      console.log(`${colors.green}${colors.bright}PASSED (Delivered after 3 attempts)${colors.reset}`);
      console.log(`        ${colors.dim}Attempts 1 and 2 failed with 500; attempt 3 succeeded with 200.${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}${colors.bright}FAILED (Status: ${retryData.record?.status}, Attempts: ${retryData.record?.attemptCount})${colors.reset}`);
    }

  } finally {
    server.close();
  }

  // -----------------------------------------------------------------
  // Final Evaluation Scorecard
  // -----------------------------------------------------------------
  console.log(`\n${colors.bright}${colors.cyan}--------------------------------------------------------------${colors.reset}`);
  if (passed === total) {
    console.log(`  ${colors.bright}${colors.green}🎉 ALL ${passed}/${total} SCENARIOS PASSED SUCCESSFULLY!${colors.reset}`);
    console.log(`  ${colors.dim}The server satisfies all webhook receiving, security, and dispatch criteria.${colors.reset}`);
  } else {
    console.log(`  ${colors.bright}${colors.yellow}⚠️  Completed with ${passed}/${total} scenarios passing.${colors.reset}`);
  }
  console.log(`${colors.bright}${colors.cyan}==============================================================${colors.reset}\n`);

  process.exit(passed === total ? 0 : 1);
}

runSimulation().catch((err) => {
  console.error('\nSimulation encountered an unexpected error:\n', err);
  process.exit(1);
});
