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

function preview(str, n = 120) {
  if (typeof str !== 'string') return '';
  return str.length <= n ? str : str.slice(0, n) + '…';
}

/**
 * POST /prompts  -> { jobId }
 * Body: { user, prompt, key?, temperature?, model?, simulateFailFor?, idempotencyKey?, useStub?, reqId? }
 * Header alternative: Idempotency-Key: <key>
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

    // model: let ai.service decide default if not provided
    const model = body.model || '(default from ai.service)';

    const simulateFailFor = Number.isFinite(body.simulateFailFor)
      ? Number(body.simulateFailFor)
      : undefined;

    // allow header, body, or computed idempotency
    const idem =
      body.idempotencyKey ||
      req.get?.('Idempotency-Key') ||
      computeIdempotency({ user, key, prompt });

    // allow forcing the worker to stub the LLM (no external calls)
    const useStub =
      body.useStub === true ||
      req.query?.stub === '1' ||
      process.env.TEST_FAKE_MOSAIA === '1';

    const reqId =
      body.reqId ||
      req.get?.('X-Request-Id') ||
      crypto.randomUUID?.() ||
      String(Date.now());

    const jobData = {
      kind: 'llm',
      user,
      key,
      prompt,
      temperature,
      model: body.model, // pass-through; worker will default if falsy
      simulateFailFor,
      useStub,
      reqId,
    };

    // Helpful enqueue log
    console.log('[API /prompts] enqueue', {
      user,
      key,
      model,
      temperature,
      simulateFailFor,
      useStub,
      idem,
      reqId,
      promptPreview: preview(prompt),
    });

    let job;
    try {
      job = await queue.add('prompt:llm', jobData, {
        jobId: idem, // idempotency
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

    console.log('[API /prompts] enqueued', { jobId: job.id, name: job.name, reqId });
    // Tests expect 200; 202 would also be fine in real APIs
    return res.status(200).json({ jobId: job.id });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /prompts/:id  -> { status, result, error, ... }
 * Also returns a "text" alias of result.output for UI convenience.
 */
export async function getPromptHandler(req, res, next) {
  try {
    const { id } = req.params;
    const job = await queue.getJob(id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const state = await job.getState(); // waiting | active | completed | failed | delayed
    const result = job.returnvalue ?? null;
    const error = state === 'failed' ? (job.failedReason || null) : null;

    const text =
      result && typeof result.output === 'string' && result.output.trim()
        ? result.output
        : null;

    if (state === 'completed') {
      console.log('[API /prompts/:id] completed', {
        id: job.id,
        reqId: job.data?.reqId,
        outputLen: text ? text.length : 0,
        outputPreview: preview(text || ''),
      });
    } else if (state === 'failed') {
      console.log('[API /prompts/:id] failed', {
        id: job.id,
        reqId: job.data?.reqId,
        error: String(error || ''),
      });
    } else {
      console.log('[API /prompts/:id] pending', {
        id: job.id,
        reqId: job.data?.reqId,
        state,
        attemptsMade: job.attemptsMade,
        progress: job.progress,
      });
    }

    res.json({
      id: job.id,
      name: job.name,
      status: state,
      result,          // { ok: true, output: '...' } from the worker
      error,           // string if failed
      text,            // alias for UI convenience
      attemptsMade: job.attemptsMade,
      progress: job.progress ?? 0,
      createdAt: job.timestamp,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /prompts?user=...&limit=10 -> { items, total }
 */
export async function listPromptsHandler(req, res, next) {
  try {
    const user = req.query.user || null;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const start = 0;
    const end = limit - 1;

    // Grab recent jobs across states
    const jobs = await queue.getJobs(
      ['completed', 'failed', 'active', 'waiting', 'delayed'],
      start,
      end,
      true
    );

    const filtered = user
      ? jobs.filter((j) => j?.data?.user === user)
      : jobs;

    const items = await Promise.all(
      filtered.map(async (j) => {
        const st = await j.getState();
        return {
          id: j.id,
          name: j.name,
          user: j.data?.user,
          status: st,
          createdAt: j.timestamp,
          finishedOn: j.finishedOn,
          result: j.returnvalue ?? null,
          error: st === 'failed' ? (j.failedReason || null) : null,
        };
      })
    );

    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
}

/* Back-compat aliases for src/routes/prompts.router.js used in tests */
export { createPromptHandler as postPrompt };
export { getPromptHandler as getPromptById };
export { listPromptsHandler as listPrompts };
