// test/research.worker.mocked.test.js
import { describe, it, expect, beforeAll } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { connection } from '../src/queues/connection.js';

// Mock AI & search only; no need for MOCK_MODE globally here
process.env.AI_MOCK = '1';
process.env.SEARCH_MOCK = '1';

// Start the worker
await import('../src/queues/worker.js');

const qName = 'kintagen';
let q, qe;

beforeAll(async () => {
  q = new Queue(qName, { connection });
  qe = new QueueEvents(qName, { connection });
  await qe.waitUntilReady();
});

describe('research-chat job (mocked AI/search)', () => {
  it('returns a mock report and meta', async () => {
    const job = await q.add('research-chat', {
      topic: 'test topic',
      knowledgeBase: [{ cid: 'bafy-mock', note: 'kb' }],
    }, { removeOnComplete: true });

    const result = await job.waitUntilFinished(qe, 15000);

    expect(result).toBeDefined();
    expect(result.reply).toContain('MOCK REPORT');
    expect(result.meta).toBeDefined();
  });
});
