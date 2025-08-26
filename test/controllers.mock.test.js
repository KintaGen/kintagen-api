// test/controllers.mock.test.js
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.MOCK_MODE = 'true'; // document.controller checks string 'true'
});

const makeRes = () => {
  const res = {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(obj) { this._json = obj; return this; },
  };
  return res;
};

describe('controllers in mock mode', () => {
  it('queryDataHandler returns mock papers', async () => {
    const { queryDataHandler } = await import('../src/controllers/data.controller.js');
    const req = { params: { type: 'paper' }, query: {} };
    const res = makeRes();
    await queryDataHandler(req, res, (e) => { throw e; });
    expect(res._status).toBe(200);
    expect(Array.isArray(res._json.data)).toBe(true);
  });

  it('getDocumentContentHandler returns mock content', async () => {
    const { getDocumentContentHandler } = await import('../src/controllers/document.controller.js');
    const req = { params: { cid: 'bafy-mock' } };
    const res = makeRes();
    await getDocumentContentHandler(req, res, (e) => { throw e; });
    expect(res._status).toBe(200);
    expect(res._json.isRaw).toBe(false);
    expect(res._json.content).toContain('Mock content for CID bafy-mock');
  });
});
