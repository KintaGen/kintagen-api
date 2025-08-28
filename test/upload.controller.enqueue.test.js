// test/upload.controller.enqueue.test.js
import { describe, it, expect } from 'vitest';

describe('upload.controller enqueue (async)', () => {
  it('returns 202 and jobId when async flag set', async () => {
    const { processAndUploadHandler } = await import('../src/controllers/upload.controller.js');
    const req = {
      body: { async: true, dataType: 'paper', projectId: 1 },
      query: { async: '1' },
      file: {
        path: '/tmp/fake.txt',
        originalname: 'fake.txt',
        mimetype: 'text/plain',
        size: 12,
      },
    };
    const res = {
      code: 200,
      payload: null,
      status(c) { this.code = c; return this; },
      json(p) { this.payload = p; return this; },
    };
    await processAndUploadHandler(req, res, (e) => { throw e; });
    expect(res.code).toBe(202);
    expect(typeof res.payload.jobId).toBe('string');
  });
});
