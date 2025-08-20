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
 * Body:
 * {
 *   user: string,
 *   prompt: string,
 *   key?: string,
 *   temperature?: number,
 *   model?: string,                 // leave undefined to use ai.service default
 *   simulateFailFor?: number,
 *   useStub?: boolean,
 *   idempotencyKey?: string,
 *   // EXA knobs
 *   useExa?: boolean,               // default: true if EXA_API_KEY exists
 *   exaQueryCount?: number,         // default: 6
 *   exaLinksPerQuery?: number       // default: 5
 * }
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
    const model = body.model ?? undefined; // let ai.service choose its default
    const simulateFailFor = Number.isFinite(body.simulateFailFor)
      ? Number(body.simulateFailFor)
      : undefined;

    const idem =
      body.idempotencyKey ||
      req.get('Idempotency-Key') ||
      computeIdempotency({ user, key, prompt });

    const useStub =
      body.useStub === true ||
      req.query.stub === '1' ||
      process.env.TEST_FAKE_MOSAIA === '1';

    // EXA toggles
    const useExa =
      body.useExa !== undefined
        ? !!body.useExa
        : !!process.env.EXA_API_KEY; // default ON when the key exists

    const exaQueryCount = Number.isFinite(body.exaQueryCount)
      ? Number(body.exaQueryCount)
      : 6;

    const exaLinksPerQuery = Number.isFinite(body.exaLinksPerQuery)
      ? Number(body.exaLinksPerQuery)
      : 5;

    const jobData = {
      kind: 'llm',
      user,
      key,
      prompt,
      temperature,
      model,
      simulateFailFor,
      useStub,
      // EXA options
      useExa,
      exaQueryCount,
      exaLinksPerQuery,
    };

    console.log('[API /prompts] enqueue', {
      user,
      key,
      model: model || '(default from ai.service)',
      temperature,
      simulateFailFor,
      useStub,
      useExa,
      exaQueryCount,
      exaLinksPerQuery,
      idem,
      promptPreview: String(prompt).slice(0, 120),
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

    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /prompts/:id
 * Normalizes to:
 *  {
 *    id, name, status,
 *    result: { reply }    // when completed
 *    error                 // when failed
 *  }
 */
export async function getPromptHandler(req, res, next) {
  try {
    const { id } = req.params;
    const job = await queue.getJob(id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const state = await job.getState(); // waiting | active | completed | failed | delayed
    const payload = {
      id: job.id,
      name: job.name,
      status: state,
      state,
    };

    if (state === 'completed') {
      const out = job.returnvalue;
      // normalize shape for the UI
      payload.result = out?.output
        ? { reply: out.output }
        : out?.result
        ? out.result
        : { reply: '' };
    } else if (state === 'failed') {
      payload.error = job.failedReason || 'Job failed';
    }

    console.log('[API /prompts/:id]', state, {
      id: job.id,
      outputLen: job.returnvalue?.output?.length || 0,
      outputPreview: String(job.returnvalue?.output || '').slice(0, 120),
    });

    res.json(payload);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /prompts?user=u1&limit=50
 * Returns:
 *  { items: [{ id, prompt, status }] }
 */
export async function listPromptsHandler(req, res, next) {
  try {
    const user = req.query.user || undefined;
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);

    // Pull a batch then filter in-memory (cheap and simple)
    const types = ['completed', 'failed', 'delayed', 'waiting', 'active'];
    const jobs = await queue.getJobs(types, 0, 300, true); // max 300 recent

    const filtered = user
      ? jobs.filter((j) => j?.data?.user === user)
      : jobs;

    // newest first
    filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const head = filtered.slice(0, limit);

    const states = await Promise.all(head.map((j) => j.getState()));
    const items = head.map((j, i) => ({
      id: String(j.id),
      prompt: String(j.data?.prompt || ''),
      status: states[i],
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
}
