'use strict';

/**
 * Standalone Client Sender Example
 *
 * Demonstrates sending signed, retryable webhooks from an external
 * microservice or worker using the `hookpoint` package.
 */

const { sendWebhook, sign } = require('@ishant3907/hookpoint');

const TARGET_URL = process.env.WEBHOOK_TARGET || 'http://localhost:3000/webhook';
const SECRET = process.env.WEBHOOK_SECRET || 'whsec_evaluation_test_secret_2026';

async function main() {
  console.log(`\nSending signed webhook to: ${TARGET_URL}`);

  const payload = {
    event: 'subscription.renewed',
    customer: {
      id: 'cust_777',
      name: 'Sherlock Holmes',
      email: 'sherlock@221b.co.uk'
    },
    plan: {
      name: 'Pro Annual',
      amount: 199.00,
      currency: 'GBP'
    },
    timestamp: new Date().toISOString()
  };

  try {
    const record = await sendWebhook(TARGET_URL, payload, {
      secret: SECRET,
      eventName: 'subscription.renewed',
      retry: {
        maxRetries: 3,
        strategy: 'exponential',
        initialDelayMs: 500,
        jitter: true
      },
      onAttempt: ({ attempt }) => {
        console.log(`-> Attempt ${attempt.attemptNumber}: Status ${attempt.statusCode || 'ERROR'} (${attempt.durationMs}ms)`);
      }
    });

    console.log(`\nDelivery Record Summary:`);
    console.log(`- Status:      ${record.status.toUpperCase()}`);
    console.log(`- Event ID:    ${record.eventId}`);
    console.log(`- Attempts:    ${record.attemptCount}`);
    console.log(`- Target:      ${record.endpointUrl}`);
    console.log(`- CompletedAt: ${new Date(record.completedAt).toLocaleTimeString()}`);
  } catch (err) {
    console.error('Delivery failed:', err.message);
  }
}

main();
