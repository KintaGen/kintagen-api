// test/chat.controller.validation.test.js
import { describe, it, expect } from 'vitest';

describe('chat.controller validation', () => {
  it('400 on missing messages array', async () => {
    const { chatHandler } = await import('../src/controllers/chat.controller.js');
    const req = { body: { filecoinContext: [] } };
    const res = {
      statusCode: 200,
      payload: null,
      status(c) { this.statusCode = c; return this; },
      json(p) { this.payload = p; return this; },
    };
    let caught = null;
    await chatHandler(req, res, (e) => { caught = e; });
    expect(caught).toBeTruthy();
    expect(caught.statusCode).toBe(400);
    expect(caught.details).toBeDefined();
  });
});
