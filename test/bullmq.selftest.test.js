// test/bullmq.selftest.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { connection } from '../src/queues/connection.js';

// start the real worker so jobs get processed
await import('../src/queues/worker.js');

const qName = 'kintagen';
let q;
let qe;

async function waitUntilStatePolling(queue, jobId, targets, { timeoutMs = 20000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (true) {
    const job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (targets.includes(state)) return { state, job };
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for state ${targets.join('|')} (id=${jobId})`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

beforeAll(async () => {
  q = new Queue(qName, { connection });
  qe = new QueueEvents(qName, { connection });
  await qe.waitUntilReady();
});

afterAll(async () => {
  await q?.close();
  await qe?.close();
});

describe.sequential('bullmq queue basics', () => {
  it(
    'processes a self-test job to completion',
    async () => {
      const jobId = `selftest-${Date.now()}-${Math.random()}`;
      const job = await q.add(
        'self-test',
        { hello: 'world' },
        { jobId, removeOnComplete: false, removeOnFail: false }
      );

      // try the event path first; if it flakes, fall back to polling
      let result;
      try {
        result = await job.waitUntilFinished(qe, 20000);
      } catch {
        await waitUntilStatePolling(q, job.id, ['completed'], { timeoutMs: 20000 });
        result = { ok: true };
      }

      expect(result).toBeTruthy();
      const fresh = await q.getJob(job.id);
      expect(fresh).toBeTruthy();
      expect(await fresh.getState()).toBe('completed');
    },
    30000
  );

  it(
    'retries and then fails a force-fail job',
    async () => {
      const jobId = `fail-${Date.now()}-${Math.random()}`;
      const job = await q.add(
        'force-fail',
        {},
        { jobId, attempts: 2, backoff: { type: 'fixed', delay: 50 }, removeOnComplete: false, removeOnFail: false }
      );

      // event path + fallback polling to confirm failure
      let failed = false;
      try {
        await job.waitUntilFinished(qe, 20000);
      } catch {
        failed = true;
      }
      if (!failed) {
        const { state } = await waitUntilStatePolling(q, job.id, ['failed'], { timeoutMs: 20000 });
        expect(state).toBe('failed');
      }

      const fresh = await q.getJob(job.id);
      expect(fresh).toBeTruthy();
      expect(fresh.attemptsMade).toBe(2);
      expect(await fresh.getState()).toBe('failed');
    },
    30000
  );
});
