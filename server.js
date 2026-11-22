'use strict';

const http = require('node:http');
const { createApp } = require('./src/app');
const config = require('./src/config');

const { app } = createApp();
const server = http.createServer(app);

const PORT = config.port;
const HOST = config.host;

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  const baseUrl = `http://${displayHost}:${PORT}`;

  console.log('\n======================================================');
  console.log('  🚀 Hookpoint Webhook Evaluation & Delivery Server');
  console.log('======================================================');
  console.log(`  🌐 Dashboard UI:      ${baseUrl}/`);
  console.log(`  📥 Webhook Receiver:  ${baseUrl}/webhook`);
  console.log(`  📊 Metrics & Stats:   ${baseUrl}/api/stats`);
  console.log(`  ❤️  Health Check:      ${baseUrl}/health`);
  console.log('------------------------------------------------------');
  console.log(`  🔑 Shared Secret:     ${config.webhookSecret}`);
  console.log(`  ⏱️  Replay Tolerance:  ${config.tolerance}s`);
  console.log(`  🛡️  Replay Attack:     ${config.replayProtection ? 'Enabled' : 'Disabled'}`);
  console.log('======================================================\n');
});

// Handle graceful shutdown
const shutdown = () => {
  console.log('\nGracefully shutting down server...');
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = server;
