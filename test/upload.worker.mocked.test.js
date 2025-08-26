// test/upload.worker.mocked.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { connection } from '../src/queues/connection.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Ensure mocked execution (no Synapse, no AI costs, no DB writes in worker)
process.env.MOCK_MODE = 'true';
process.env.AI_MOCK = '1';
process.env.SEARCH_MOCK = '1';
process.env.SYNAPSE_DRY_RUN = '1';

// Start the real worker (registers processors)
await import('../src/queues/worker.js');

const qName = 'kintagen';
let q, qe;

beforeAll(async () => {
  q = new Queue(qName, { connection });
  qe = new QueueEvents(qName, { connection });
  await qe.waitUntilReady();
});

afterAll(async () => {
  await q.close();
  await qe.close();
});

describe('upload-file job (mocked)', () => {
  it('uploads a text file (dry-run) and returns a stub CID', async () => {
    const tmp = path.join(os.tmpdir(), `kg-upload-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'Hello KintaGen!');

    const job = await q.add('upload-file', {
      filePath: tmp,
      originalname: 'hello.txt',
      mimetype: 'text/plain',
      size: fs.statSync(tmp).size,
      dataType: 'paper',
      projectId: 1,
      manualTitle: '',
      isEncrypted: false,
      litTokenId: null,
    }, { removeOnComplete: true });

    const result = await job.waitUntilFinished(qe, 5000);

    expect(result).toBeDefined();
    expect(result.status).toBe('success');
    expect(result.cid).toMatch(/^bafy-/); // dry-run CID shape
    expect(result.dataType).toBe('paper');
    expect(result.isEncrypted).toBe(false);
  });
});
