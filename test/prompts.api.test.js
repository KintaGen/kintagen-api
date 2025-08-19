// test/prompts.api.test.js
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Keep the worker from spawning R-backed tasks
process.env.TEST_FAKE_R = 'true';

// ---- Mock external APIs BEFORE imports that reference them ----
vi.mock('exa-js', () => {
  class Exa {
    async searchAndContents() {
      return { results: [] };
    }
  }
  return { default: Exa };
});

vi.mock('openai', () => {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'MOCKED-LLM-REPLY' } }],
  });
  class OpenAI {
    constructor() { this.chat = { completions: { create } }; }
  }
  return { default: OpenAI };
});

// App + worker
import { makeTestApp } from './utils/testApp.js';
await import('../src/queues/worker.js');

describe('/prompts API', () => {
  const app = makeTestApp();

  it('POST /prompts -> jobId and completes via GET /prompts/:id', async () => {
    const body = {
      user: 'u1',
      prompt: 'Say hello',
      system: 'Be concise',
      temperature: 0.1,
      // ensure uniqueness across parallel/previous runs
      idempotencyKey: `first-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };

    const postRes = await request(app).post('/api/prompts').send(body).expect(200);
    expect(postRes.body.jobId).toBeTruthy();
    const id = String(postRes.body.jobId);

    // Poll for completion (8s safety window)
    let status = 'waiting';
    let result = null;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const getRes = await request(app).get(`/api/prompts/${id}`).expect(200);
      status = getRes.body.status;
      result = getRes.body.result;
      if (status === 'completed') break;
      await new Promise((r) => setTimeout(r, 120));
    }

    expect(status).toBe('completed');
    expect(result).toEqual({ ok: true, output: 'MOCKED-LLM-REPLY' });

    // Appears in user history
    const listRes = await request(app).get('/api/prompts?user=u1&limit=10').expect(200);
    expect(listRes.body.items.some((i) => String(i.id) === id)).toBe(true);
  });

  it('idempotency returns same jobId for same (user, key, prompt)', async () => {
    const body = { user: 'u1', prompt: 'Say hello', idempotencyKey: 'abc123' };
    const r1 = await request(app).post('/api/prompts').send(body).expect(200);
    const r2 = await request(app).post('/api/prompts').send(body).expect(200);
    expect(String(r2.body.jobId)).toBe(String(r1.body.jobId));
  });

  it('surfaces failure with retries/backoff when simulateFailFor >= attempts', async () => {
    const body = { user: 'u2', prompt: 'This will fail', simulateFailFor: 3 };
    const post = await request(app).post('/api/prompts').send(body).expect(200);
    const id = String(post.body.jobId);

    let status = 'waiting';
    let error = null;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const res = await request(app).get(`/api/prompts/${id}`).expect(200);
      status = res.body.status;
      error = res.body.error;
      if (status === 'failed') break;
      await new Promise((r) => setTimeout(r, 150));
    }

    expect(status).toBe('failed');
    expect(String(error || '')).toContain('simulated failure');
  });

  it('retries transient failures and then completes when simulateFailFor < attempts', async () => {
    const body = { user: 'u3', prompt: 'Eventually succeed', simulateFailFor: 2 };
    const post = await request(app).post('/api/prompts').send(body).expect(200);
    const id = String(post.body.jobId);

    let status = 'waiting';
    let result = null;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const res = await request(app).get(`/api/prompts/${id}`).expect(200);
      status = res.body.status;
      result = res.body.result;
      if (status === 'completed') break;
      await new Promise((r) => setTimeout(r, 150));
    }

    expect(status).toBe('completed');
    expect(result?.ok).toBe(true);
  });
});
