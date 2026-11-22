'use strict';

/**
 * Express Integration Example for Hookpoint
 *
 * Demonstrates how to use WebhookReceiver with Express.js.
 * Requires preserving the raw Buffer before JSON parsing for HMAC verification.
 */

let express;
try {
  express = require('express');
} catch (e) {
  console.log('Note: "express" is not installed by default in this zero-dependency project.');
  console.log('To run this example, install express: npm install express\n');
  process.exit(0);
}

const { WebhookReceiver, WebhookSignatureError } = require('hookpoint');

const app = express();
const PORT = process.env.PORT || 3001;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'whsec_evaluation_test_secret_2026';

const receiver = new WebhookReceiver({
  secret: WEBHOOK_SECRET,
  tolerance: 300,
  replayProtection: true
});

// Capture raw body Buffer using express.json verify hook
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// Express Webhook Receiver Route
app.post('/webhook', (req, res) => {
  const rawBody = req.rawBody;
  if (!rawBody) {
    return res.status(400).json({ error: 'Missing raw request body' });
  }

  try {
    const { valid, eventName, payload, eventId, timestamp } = receiver.verify(
      rawBody,
      req.headers
    );

    console.log(`[Express] Verified webhook received: ${eventName} (ID: ${eventId})`);

    // Process event logic...
    return res.status(200).json({
      success: true,
      processed: true,
      eventId,
      event: eventName
    });
  } catch (err) {
    const isSigError = err instanceof WebhookSignatureError;
    const statusCode = isSigError ? 401 : 400;

    return res.status(statusCode).json({
      error: err.message,
      code: err.code || 'ERR_INVALID_WEBHOOK'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Express Webhook Server running on http://localhost:${PORT}/webhook`);
});
