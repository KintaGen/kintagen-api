// src/server.js
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import apiRoutes from './routes/api.js';
import { getHttpLogger, getLogger } from './services/logger.js';
import { getQueue, getQueueEvents } from './queues/queue.js';
import { pool } from './services/db.js';

// --- FLAGS ---
const isTrueish = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());
const MOCK_MODE = isTrueish(process.env.MOCK_MODE);

// --- HELPERS (dev-safe & prod-ready) ---
function applySecurity(app) {
  app.use(helmet());
  const max = Number(process.env.RATE_LIMIT_MAX ?? 120); // set 0 to disable in dev
  if (max > 0) {
    app.use(
      rateLimit({
        windowMs: 60_000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
      })
    );
  }
}

function attachRequestId(app) {
  app.use((req, res, next) => {
    const id = req.headers['x-request-id'] || crypto.randomUUID();
    req.id = id;
    res.setHeader('x-request-id', id);
    next();
  });
}

function healthz(_req, res) {
  res.status(200).json({ ok: true });
}

function readyz(_req, res) {
  res.status(200).json({ ready: true });
}

function apiErrorHandler(err, req, res, _next) {
  const log = getLogger();
  const status = err.statusCode || 500;
  const payload = {
    success: false,
    error: status >= 500 ? 'An internal server error occurred.' : err.message || 'Bad Request',
    ...(err.outputDirectory && { outputDirectory: err.outputDirectory }),
    ...(err.details && { details: err.details }),
  };
  if (status >= 500) log.error({ err, reqId: req.id }, 'unhandled');
  res.status(status).json(payload);
}

function handleShutdown(server) {
  const log = getLogger();
  const q = getQueue();
  const qe = getQueueEvents();

  const stop = async (signal) => {
    log.warn({ signal }, 'shutting down');
    try {
      await Promise.allSettled([
        q.close(),
        qe.close(),
        pool?.end?.(),
        new Promise((resolve) => server.close(resolve)),
      ]);
    } finally {
      log.warn('shutdown complete');
      process.exit(0);
    }
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// --- APP SETUP ---
const app = express();
const port = Number(process.env.PORT || 3001);
const log = getLogger();

// Pre-flight env checks
if (!MOCK_MODE) {
  if (!process.env.MOSAIA_HTTP_API_KEY || !process.env.EXA_API_KEY) {
    log.error('❌ MOSAIA_HTTP_API_KEY and EXA_API_KEY must be set in the .env file.');
    process.exit(1);
  }
} else {
  log.warn('⚠️ MOCK_MODE is ON: skipping external API key checks and using stubbed services.');
}

// Global middleware
app.use(getHttpLogger());
applySecurity(app);
attachRequestId(app);
app.use(cors());
app.use(express.json());

// Health endpoints
app.get('/healthz', healthz);
app.get('/readyz', readyz);

// Routes
app.use('/api', apiRoutes);

// Error handler (last)
app.use(apiErrorHandler);

// Start server
const server = app.listen(port, () => {
  log.info(`✅ API server is running and listening at http://localhost:${port}`);
  if (MOCK_MODE) {
    log.warn('🧪 MOCK_MODE active — R jobs stubbed, AI calls mocked, job logs API v5-safe.');
  }
});

// Graceful shutdown
handleShutdown(server);
