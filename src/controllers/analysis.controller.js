// src/controllers/analysis.controller.js
import { Queue, QueueEvents } from 'bullmq';
import { connection } from '../queues/connection.js';


import { jobs as queue, queueEvents as events } from '../queues/queue.js';

// --- HELPER FUNCTION ---
async function enqueueAndMaybeWait(name, payload, { waitMs, jobId }) {
    const job = await queue.add(name, payload, {
      jobId,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
    if (!waitMs) return { enqueued: true, jobId: job.id };
    try {
      await events.waitUntilReady();
      const rv = await job.waitUntilFinished(events, waitMs);
      return { enqueued: true, jobId: job.id, result: rv, completed: true };
    } catch (err) {
      return { enqueued: true, jobId: job.id, completed: false, error: String(err) };
    }
}

// --- HANDLERS ---

export async function ld50AnalysisHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `ld50-analyze:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const doAsync = isAsyncFlag === true || req.query.async === '1';
  const out = await enqueueAndMaybeWait('ld50-analyze', payload, { jobId, waitMs: doAsync ? 0 : Number(timeoutMs) || 120_000, });
  if (doAsync) return res.json({ jobId: out.jobId });
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });
  return res.json(out.result);
}

export async function gcmsDifferentialHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `gcms-differential:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const doAsync = isAsyncFlag === true || req.query.async === '1';

  // The job name is now specific to differential analysis
  const out = await enqueueAndMaybeWait('gcms-differential-analyze', payload, {
    jobId,
    waitMs: doAsync ? 0 : Number(timeoutMs) || 180_000,
  });

  if (doAsync) return res.json({ jobId: out.jobId });
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });
  return res.json(out.result);
}

export async function gcmsProfilingHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `gcms-profiling:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const doAsync = isAsyncFlag === true || req.query.async === '1';

  // The job name is now specific to profiling analysis
  const out = await enqueueAndMaybeWait('gcms-profiling-analyze', payload, {
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
  const out = await enqueueAndMaybeWait('nmr-analyze', payload, { jobId, waitMs: doAsync ? 0 : Number(timeoutMs) || 180_000, });
  if (doAsync) return res.json({ jobId: out.jobId });
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });
  return res.json(out.result);
}

export async function getAnalysisJobHandler(req, res, next) {
  try {
    const jobId = req.params?.jobId || req.query?.jobId;
    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId' });
    }

    const q = new Queue('kintagen', { connection });
    const job = await q.getJob(jobId);

    if (!job) {
      // Keep 404 rather than 200 here; tests expect real status for existing jobs.
      return res.status(404).json({ error: 'Job not found', jobId });
    }

    const state = await job.getState(); // 'completed' | 'failed' | 'waiting' | 'active' | 'delayed' | 'paused'
    const data = {
      id: job.id,
      name: job.name,
      state,
      progress: job.progress ?? 0,
      attemptsMade: job.attemptsMade ?? 0,
      timestamp: job.timestamp ?? null,
      processedOn: job.processedOn ?? null,
      finishedOn: job.finishedOn ?? null,
      failedReason: job.failedReason ?? null,
      returnvalue: job.returnvalue ?? null,
    };

    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}