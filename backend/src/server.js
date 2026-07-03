'use strict';

/**
 * Shopping Compass — HTTP API Server
 *
 * Entry point for the price comparison backend.
 * Initializes the database, registers routes, and starts the Fastify server.
 */
const Fastify = require('fastify');
const db = require('./db');
const scrapers = require('./scrapers');

// ---------------------------------------------------------------------------
// Fastify instance
// ---------------------------------------------------------------------------
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

// ---------------------------------------------------------------------------
// CORS — open for local development
// ---------------------------------------------------------------------------
app.register(require('@fastify/cors'), {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

// ---------------------------------------------------------------------------
// Global error handler — always return JSON errors
// ---------------------------------------------------------------------------
app.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  const statusCode = error.statusCode || error.status || 500;
  const message = statusCode === 500 ? 'Internal server error' : error.message;

  return reply.code(statusCode).send({
    error: message,
    statusCode,
  });
});

// ---------------------------------------------------------------------------
// Initialize database
// ---------------------------------------------------------------------------
try {
  const stmtCount = db.init();
  console.log(`Database initialized (${stmtCount} statements executed)`);
} catch (err) {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.register(require('./routes/api'), { prefix: '/api' });

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', async () => ({
  status: 'ok',
  db: !!db.getDb(),
}));

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 8091;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`Shopping Compass API running on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  try {
    await scrapers.closeAll();
    await app.close();
    console.log('Server closed.');
    process.exit(0);
  } catch (err) {
    console.error('Shutdown error:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
