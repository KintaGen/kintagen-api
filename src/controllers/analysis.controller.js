// src/controllers/analysis.controller.js
import { Queue, QueueEvents, Job } from 'bullmq';
import { connection } from '../queues/connection.js';

const QUEUE_NAME = 'kintagen';
const queue = new Queue(QUEUE_NAME, { connection });
const events = new QueueEvents(QUEUE_NAME, { connection });

// Small helper: enqueue and optionally wait for completion
async function enqueueAndMaybeWait(name, payload, { waitMs, jobId }) {
  const job = await queue.add(name, payload, {
    jobId,
    removeOnComplete: true,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  if (!waitMs) return { enqueued: true, jobId: job.id };

  // Wait for worker result (uses QueueEvents)
  try {
    await events.waitUntilReady();
    const rv = await job.waitUntilFinished(events, waitMs);
    return { enqueued: true, jobId: job.id, result: rv, completed: true };
  } catch (err) {
    // If it times out, return 202 + jobId so the client can poll
    return { enqueued: true, jobId: job.id, completed: false, error: String(err) };
  }
}

/**
 * IMPORTANT: Your worker already expects the following:
 * - LD50: payload { dataUrl?: string, ... } (R script consumes a URL)  -> job: 'ld50-analyze'
 * - GCMS: payload { dataPath?: string, phenoFile?: string, ... }      -> job: 'gcms-analyze'
 * - NMR : payload { dataPath?: string, ... }                           -> job: 'nmr-analyze'
 * If your UI sends CIDs instead of paths, either pre-resolve to local paths here
 * or use the worker tweak below to accept {dataCid, phenoCid}.
 */

export async function ld50AnalysisHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `ld50-analyze:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  // If async flag true (or query ?async=1), return immediately with jobId.
  const doAsync = isAsyncFlag === true || req.query.async === '1';

  const out = await enqueueAndMaybeWait('ld50-analyze', payload, {
    jobId,
    waitMs: doAsync ? 0 : Number(timeoutMs) || 120_000, // default 2 min server-side wait
  });

  if (doAsync) return res.json({ jobId: out.jobId });

  // sync path (UI unchanged): if we timed out waiting, return 202 to allow UI to optionally poll
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });

  // Worker already returns the synchronous shape -> pass straight through
  return res.json(out.result);
}

export async function gcmsDifferentialHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `gcms-analyze:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  const doAsync = isAsyncFlag === true || req.query.async === '1';

  // Differential typically sets phenoFile / phenoCid; we just pass through
  const out = await enqueueAndMaybeWait('gcms-analyze', payload, {
    jobId,
    waitMs: doAsync ? 0 : Number(timeoutMs) || 180_000, // GCMS can take longer
  });

  if (doAsync) return res.json({ jobId: out.jobId });
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });
  return res.json(out.result);
}

export async function gcmsProfilingHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `gcms-analyze:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  const doAsync = isAsyncFlag === true || req.query.async === '1';

  // Profiling usually has no pheno file → worker will handle branch
  const out = await enqueueAndMaybeWait('gcms-analyze', payload, {
    jobId,
    waitMs: doAsync ? 0 : Number(timeoutMs) || 180_000,
  });

  if (doAsync) return res.json({ jobId: out.jobId });
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });
  return res.json(out.result);
}

export async function nmrAnalysisHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `nmr-analyze:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  const doAsync = isAsyncFlag === true || req.query.async === '1';

  const out = await enqueueAndMaybeWait('nmr-analyze', payload, {
    jobId,
    waitMs: doAsync ? 0 : Number(timeoutMs) || 120_000,
  });

  if (doAsync) return res.json({ jobId: out.jobId });
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });
  return res.json(out.result);
}

/**
 * GET /api/analyze/jobs/:id
 * Lets the UI poll when you choose async mode.
 * Returns the exact worker returnvalue on completion (same as your old sync payload).
 */
export async function getAnalysisJobHandler(req, res) {
  try {
    const { id } = req.params;
    const job = await Job.fromId(queue, id);
    if (!job) return res.status(404).json({ status: 'error', error: 'Job not found' });

    const state = await job.getState();
    if (state === 'completed') return res.json(job.returnvalue);
    if (state === 'failed') {
      return res.json({
        status: 'error',
        error: job.failedReason || 'Job failed',
        log: job.stacktrace || [],
        results: null,
      });
    }
    return res.json({ status: 'processing' });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: String(err?.message || err) });
  }
}
