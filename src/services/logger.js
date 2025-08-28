// src/services/logger.js
import crypto from 'crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';

let baseLogger = null;

/** Singleton app logger (Pino). */
export function getLogger() {
  if (!baseLogger) {
    baseLogger = pino({
      level: process.env.LOG_LEVEL || 'debug', // dev-friendly
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
    });
  }
  return baseLogger;
}

/** HTTP logger middleware (Pino HTTP). */
export function getHttpLogger() {
  return pinoHttp({
    logger: getLogger(),
    genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}
