// test/analysis.controller.enqueue.test.js
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
});

describe('analysis.controller enqueue (async)', () => {
  it.each([
    ['ld50', 'ld50AnalysisHandler'],
    ['nmr', 'nmrAnalysisHandler'],
    ['gcms-differential', 'gcmsDifferentialHandler'],
    ['gcms-profiling', 'gcmsProfilingHandler'],
  ])('enqueues %s job and returns jobId', async (_name, handlerName) => {
    const mod = await import('../src/controllers/analysis.controller.js');
    const handler = mod[handlerName];
    const req = { body: { async: true } };
    const res = { v: null, json(x){ this.v = x; return this; }, status(){ return this; } };
    await handler(req, res, (e) => { throw e; });
    expect(typeof res.v.jobId).toBe('string');
  });
});
