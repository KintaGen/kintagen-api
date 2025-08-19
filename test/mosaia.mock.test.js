// test/mosaia.mock.test.js
import { describe, it, expect, vi } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { connection } from '../src/queues/connection.js';

process.env.TEST_FAKE_R = 'true';

vi.mock('openai', () => {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'MOCK_MOSAIA_REPLY: hello 👋' } }],
  });
  class OpenAI {
    constructor() { this.chat = { completions: { create } }; }
  }
  return { default: OpenAI };
});

vi.mock('exa-js', () => {
  class Exa { async searchAndContents() { return { results: [] }; } }
  return { default: Exa };
});

await import('../src/queues/worker.js');

const qName = 'kintagen';

describe('mosaia prompt (mock) through BullMQ', () => {
  it('processes prompt:llm and returns the mocked content', async () => {
    const q = new Queue(qName, { connection });
    const qe = new QueueEvents(qName, { connection });
    await qe.waitUntilReady();

    try {
      const job = await q.add(
        'prompt:llm',
        { system: 'You are concise.', prompt: 'Say hello', temperature: 0.1, model: 'mock-model' },
        { removeOnComplete: true },
      );
      const result = await job.waitUntilFinished(qe, 5000);
      expect(result).toEqual({ ok: true, output: 'MOCK_MOSAIA_REPLY: hello 👋' });
    } finally {
      await q.close();
      await qe.close();
    }
  });
});
