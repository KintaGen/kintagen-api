// test/bullmq.selftest.test.js
import { describe, it, expect } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';

// Start the real worker by importing the module (it registers processors)
import '../src/queues/worker.js';
import { connection } from '../src/queues/connection.js';

const qName = 'kintagen';

describe('bullmq queue basics', () => {
  it('processes a self-test job to completion', async () => {
    const q = new Queue(qName, { connection });
    const qe = new QueueEvents(qName, { connection });
    await qe.waitUntilReady();

    const job = await q.add('self-test', { hello: 'world' }, { removeOnComplete: true });
    const result = await job.waitUntilFinished(qe, 10000);

    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
    expect(result.echo).toEqual({ hello: 'world' });

    await q.close();
    await qe.close();
  });

  it('retries and then fails a force-fail job', async () => {
    // Ensure failed jobs are retained for inspection in this test
    const q = new Queue(qName, {
      connection,
      defaultJobOptions: { removeOnFail: false },
    });
    const qe = new QueueEvents(qName, { connection });
    await qe.waitUntilReady();

    const job = await q.add('force-fail', {}, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 100 },
      removeOnFail: false, // keep the failed job so we can assert attemptsMade
    });

    let failedErr;
    try {
      await job.waitUntilFinished(qe, 15000); // allow more time under parallel load
    } catch (err) {
      failedErr = err;
    }

    expect(failedErr).toBeDefined();

    const fresh = await q.getJob(job.id);
    expect(fresh).toBeTruthy();
    expect(fresh.attemptsMade).toBe(2);

    await q.close();
    await qe.close();
  });
});
