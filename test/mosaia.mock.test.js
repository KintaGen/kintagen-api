import { describe, it, expect, vi } from 'vitest';

// 1) Mock the `openai` module before importing worker/ai.service
vi.mock('openai', () => {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'MOCK_MOSAIA_REPLY: hello 👋' } }],
  });
  // minimal mock of the SDK surface used by ai.service.js
  class OpenAI {
    constructor() { this.chat = { completions: { create } }; }
  }
  return { default: OpenAI };
});

import { Queue, QueueEvents } from 'bullmq';
import { connection } from '../src/queues/connection.js';

// 2) Start the real worker (it will use the mocked OpenAI)
await import('../src/queues/worker.js');

describe('mosaia prompt (mock) through BullMQ', () => {
  it('processes mosaia-prompt-direct and returns the mocked content', async () => {
    const qName = 'kintagen';
    const q  = new Queue(qName, { connection });
    const qe = new QueueEvents(qName, { connection });
    await qe.waitUntilReady();

    const payload = {
      system: 'You are concise.',
      user:   'Say hello',
      temperature: 0.1,
      model: 'mock-model',
    };

    const job = await q.add('mosaia-prompt-direct', payload, { removeOnComplete: true });
    const result = await job.waitUntilFinished(qe, 5000);

    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
    expect(result.user).toBe('Say hello');
    expect(result.output).toBe('MOCK_MOSAIA_REPLY: hello 👋');

    await q.close(); await qe.close();
  });
});
