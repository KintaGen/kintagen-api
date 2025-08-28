// test/jobs.controller.status.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { connection } from '../src/queues/connection.js';

// IMPORTANT: Do NOT import the app worker here.
// We run our own isolated worker so this test never depends on app state.

const qName = process.env.KINTAGEN_QUEUE_NAME || 'kintagen';

let q;
let qe;
let w;

beforeAll(async () => {
  // Queue + events for this test
  q = new Queue(qName, { connection });
  qe = new QueueEvents(qName, { connection });
  await qe.waitUntilReady();

  // Local, isolated worker: processes ONLY the 'self-test' job.
  // Anything else throws so we notice unexpected cross-test interference.
  w = new Worker(
    qName,
    async (job) => {
      if (job.name !== 'self-test') {
        throw new Error(`Unexpected job picked up by test worker: ${job.name}`);
      }
      // quick success result
      return { ok: true, at: Date.now() };
    },
    { connection, concurrency: 1 }
  );
  await w.waitUntilReady();
});

afterAll(async () => {
  await w?.close();
  await qe?.close();
  await q?.close();
});

async function callGetAnalysisJob(jobId) {
  const { getAnalysisJobHandler } = await import('../src/controllers/analysis.controller.js');
  const req = { params: { jobId } };
  const res = {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(obj) { this._json = obj; return this; },
  };
  await getAnalysisJobHandler(req, res, (e) => { if (e) throw e; });
  return { status: res._status, body: res._json };
}

async function waitUntilQueueStates(queue, jobId, targetStates, { timeoutMs = 20000, pollMs = 100 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (targetStates.includes(state)) return state;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for state ${targetStates.join('|')} (id=${jobId})`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function waitUntilControllerStates(jobId, targetStates, { timeoutMs = 20000, pollMs = 100 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { body } = await callGetAnalysisJob(jobId);
    const state = body?.state;
    if (targetStates.includes(state)) return body;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for state ${targetStates.join('|')} (id=${jobId})`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

describe.sequential('jobs.controller getJobStatus', () => {
  it(
    'returns status payload for an enqueued job',
    async () => {
      const jobId = `ctl-selftest-${Date.now()}-${Math.random()}`;

      // keep job around so controller polling can see it
      const job = await q.add(
        'self-test',
        { hello: 'world' },
        { jobId, removeOnComplete: false, removeOnFail: false }
      );

      // wait for completion (first try events, fall back to queue polling)
      try {
        await job.waitUntilFinished(qe, 20000);
      } catch {
        await waitUntilQueueStates(q, job.id, ['completed', 'failed'], { timeoutMs: 20000 });
      }

      // validate via controller
      const payload = await waitUntilControllerStates(job.id, ['completed', 'failed'], { timeoutMs: 20000 });

      expect(payload).toBeTruthy();
      expect(['completed', 'failed']).toContain(payload.state);
      expect(payload.state).toBe('completed');

      // Controller may return job id under different keys
      const returnedId = payload.jobId ?? payload.id ?? payload.job?.id;
      if (returnedId) expect(returnedId).toBe(job.id);
    },
    40000 // vitest timeout for this test
  );
});
