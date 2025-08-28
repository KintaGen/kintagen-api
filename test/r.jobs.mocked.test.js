// test/r.jobs.mocked.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { connection } from '../src/queues/connection.js';

// Ensure the worker uses stubs and is started before tests
process.env.TEST_FAKE_R = 'true';
await import('../src/queues/worker.js');

const qName = 'kintagen';
let q, qe;

beforeAll(async () => {
  q = new Queue(qName, { connection });
  qe = new QueueEvents(qName, { connection });
  await qe.waitUntilReady(); // <- important: ready before adding any jobs
});

afterAll(async () => {
  await q?.close();
  await qe?.close();
});

describe('R-backed jobs (mocked via TEST_FAKE_R)', () => {
  it('ld50-analyze returns stub JSON without calling R', async () => {
    const job = await q.add(
      'ld50-analyze',
      { dataUrl: 'http://example.com/ld50.csv' },
      { removeOnComplete: false, removeOnFail: false }
    );

    const result = await job.waitUntilFinished(qe, 20000);

    expect(result).not.toBeNull();
    expect(result.status).toBe('success');
    expect(result.results.ld50_estimate).toBeDefined();
  });

  it('gcms-differential-analyze returns stub JSON without calling R', async () => {
    const job = await q.add(
      'gcms-differential-analyze',
      { dataPath: '/tmp/data', phenoFile: '/tmp/pheno.csv' },
      { removeOnComplete: false, removeOnFail: false }
    );

    const result = await job.waitUntilFinished(qe, 25000);

    expect(result).not.toBeNull();
    expect(result.status).toBe('success');
    expect(Array.isArray(result.results.stats_table)).toBe(true);
    expect(result.results.stats_table.length).toBeGreaterThan(0);
  });

  it('nmr-analyze returns stub JSON without calling R', async () => {
    const job = await q.add(
      'nmr-analyze',
      { dataPath: '/tmp/fid' },
      { removeOnComplete: false, removeOnFail: false }
    );

    const result = await job.waitUntilFinished(qe, 20000);

    expect(result).not.toBeNull();
    expect(result.ok).toBe(true);
    expect(String(result.log || '')).toContain('FAKE_R');
  });
});
