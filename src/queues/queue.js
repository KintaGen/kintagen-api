// src/queues/queue.js
import { Queue } from 'bullmq';
import { connection } from './connection.js';

export const jobs = new Queue('kintagen', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 }, // keep for 1h, up to 1k
    removeOnFail:     { age: 24 * 3600 },         // keep failures for 1 day
  },
});
