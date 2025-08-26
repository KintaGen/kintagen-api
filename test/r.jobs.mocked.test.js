// test/r.jobs.mocked.test.js
import { describe, it, expect } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { connection } from '../src/queues/connection.js';

// Ensure the worker returns stubs for all R-backed tasks
process.env.TEST_FAKE_R = 'true';

// Start the worker (after env set)
await import('../src/queues/worker.js');

const qName = 'kintagen';

describe('R-backed jobs (mocked via TEST_FAKE_R)', () => {
  it('ld50-analyze returns stub JSON without calling R', async () => {
    const q = new Queue(qName, { connection });
    const qe = new QueueEvents(qName, { connection });
    await qe.waitUntilReady();

    try {
      const job = await q.add('ld50-analyze', { dataUrl: 'http://example.com/ld50.csv' }, { removeOnComplete: true });
      const result = await job.waitUntilFinished(qe, 10000);
      expect(result.status).toBe('success');
      expect(result.results.ld50_estimate).toBeDefined();
    } finally {
      await q.close();
      await qe.close();
    }
  });

  it('gcms-differential-analyze returns stub JSON without calling R', async () => {
    const q = new Queue(qName, { connection });
    const qe = new QueueEvents(qName, { connection });
    await qe.waitUntilReady();

    try {
      const job = await q.add('gcms-differential-analyze', { dataPath: '/tmp/data', phenoFile: '/tmp/pheno.csv' }, { removeOnComplete: true });
      const result = await job.waitUntilFinished(qe, 15000);
      expect(result.status).toBe('success');
      expect(result.results.stats_table?.length).toBeGreaterThan(0);
    } finally {
      await q.close();
      await qe.close();
    }
  });

  it('nmr-analyze returns stub JSON without calling R', async () => {
    const q = new Queue(qName, { connection });
    const qe = new QueueEvents(qName, { connection });
    await qe.waitUntilReady();

    try {
      const job = await q.add('nmr-analyze', { dataPath: '/tmp/fid' }, { removeOnComplete: true });
      const result = await job.waitUntilFinished(qe, 10000);
      expect(result.ok).toBe(true);
      expect(result.log).toContain('FAKE_R');
    } finally {
      await q.close();
      await qe.close();
    }
  });
});
