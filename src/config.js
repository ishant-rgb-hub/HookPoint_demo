'use strict';

/**
 * Server Configuration
 * Loads environment variables with robust production defaults.
 */
module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  webhookSecret: process.env.WEBHOOK_SECRET || 'whsec_evaluation_test_secret_2026',
  tolerance: process.env.REPLAY_TOLERANCE_SECONDS !== undefined
    ? parseInt(process.env.REPLAY_TOLERANCE_SECONDS, 10)
    : 300,
  replayProtection: process.env.REPLAY_PROTECTION !== 'false',
  replayTtlMs: parseInt(process.env.REPLAY_TTL_MS, 10) || 600000,
  signatureHeaderName: (process.env.SIGNATURE_HEADER_NAME || 'x-webhook-signature').toLowerCase()
};
