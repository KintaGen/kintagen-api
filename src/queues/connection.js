// src/queues/connection.js
import 'dotenv/config';

export const connection = {
  // BullMQ v5 accepts a connection options object; url is the simplest.
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
};
