// src/controllers/prompts.controller.js
import crypto from 'crypto';
import { Queue } from 'bullmq';
import { connection } from '../queues/connection.js';

const qName = 'kintagen';
const queue = new Queue(qName, { connection });

function computeIdempotency({ user, key, prompt }) {
  const h = crypto.createHash('sha256');
  h.update(String(user || 'anon'));
  h.update('|');
  h.update(String(key || 'default'));
  h.update('|');
  h.update(String(prompt || ''));
  return 'prompt:' + h.digest('hex');
}

/**
 * POST /prompts -> { jobId }
 * Body: { user, prompt, key?, temperature?, model?, simulateFailFor?, idempotencyKey?, useStub? }
 */
export async function createPromptHandler(req, res, next) {
  try {
    const body = req.body || {};
    const { user, prompt } = body;
    if (!user || !prompt) {
      return res.status(400).json({ error: 'user and prompt are required' });
    }

    const key = body.key ?? 'default';
    const temperature = body.temperature ?? 0.2;
    const model = body.model ?? 'mock-model';
    const simulateFailFor = Number.isFinite(body.simulateFailFor)
      ? Number(body.simulateFailFor)
      : undefined;

    // header, body, or computed idempotency
    const idem =
      body.idempotencyKey ||
      req.get?.('Idempotency-Key') ||
      computeIdempotency({ user, key, prompt });

    // let tests force stubbed LLM (no external calls)
    const useStub =
      body.useStub === true ||
      req.query?.stub === '1' ||
      process.env.TEST_FAKE_MOSAIA === '1';

    const jobData = {
      kind: 'llm',
      user,
      key,
      prompt,
      temperature,
      model,
      simulateFailFor,
      useStub,
    };

    let job;
    try {
      job = await queue.add('prompt:llm', jobData, {
        jobId: idem,           // idempotency
        attempts: 3,
        backoff: { type: 'exponential', delay: 250 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 1000 },
      });
    } catch (e) {
      if (String(e?.message || '').includes('already exists')) {
        job = await queue.getJob(idem);
      } else {
        throw e;
      }
    }

    // NOTE: return 200 to match your test expectations
    return res.status(200).json({ jobId: job.id });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /prompts/:id -> { id, status, result?, error?, ... }
 */
export async function getPromptHandler(req, res, next) {
  try {
    const { id } = req.params;
    const job = await queue.getJob(id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const status = await job.getState(); // waiting | active | completed | failed | delayed
    const payload = {
      id: job.id,
      name: job.name,
      status,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };

    if (status === 'completed') {
      payload.result = job.returnvalue ?? null;
    } else if (status === 'failed') {
      payload.error = job.failedReason ?? 'Job failed';
    }

    res.json(payload);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /prompts?user=...&limit=... -> { items: [...], total }
 * Lists recent jobs for a user (across states) and filters by job.data.user
 */
export async function listPromptsHandler(req, res, next) {
  try {
    const user = req.query.user ? String(req.query.user) : undefined;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    // Pull from multiple states, newest first
    const types = ['completed', 'failed', 'active', 'waiting', 'delayed'];
    // Fetch a window large enough, then filter to user & limit
    const jobs = await queue.getJobs(types, 0, 200, false);

    const items = jobs
      .filter(j => (user ? j.data?.user === user : true))
      .slice(0, limit)
      .map(j => ({
        id: j.id,
        name: j.name,
        user: j.data?.user,
        prompt: j.data?.prompt,
        status: j.finishedOn ? 'completed' : j.failedReason ? 'failed' : j.processedOn ? 'active' : 'waiting',
        finishedOn: j.finishedOn,
        processedOn: j.processedOn,
        attemptsMade: j.attemptsMade,
      }));

    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
}

// Optional aliases if other imports expect these names:
export { getPromptHandler as getPromptByIdHandler };
