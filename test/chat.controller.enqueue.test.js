// test/chat.controller.enqueue.test.js
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
});

describe('chat.controller enqueue', () => {
  it('returns 202 and a jobId', async () => {
    const { chatHandler } = await import('../src/controllers/chat.controller.js');
    const req = {
      body: {
        messages: [
          { sender: 'user', text: 'hello' },
          { sender: 'assistant', text: 'ok' },
          { sender: 'user', text: 'research quantum' },
        ],
        filecoinContext: [],
      },
    };
    const res = {
      statusCode: 200,
      payload: null,
      status(c) { this.statusCode = c; return this; },
      json(p) { this.payload = p; return this; },
    };
    await chatHandler(req, res, (e) => { throw e; });
    expect(res.statusCode).toBe(202);
    expect(typeof res.payload.jobId).toBe('string');
  });
});
