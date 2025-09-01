

import { getLogger } from '../services/logger.js';        // ✅ you were missing this



import { jobs as queue, queueEvents as events } from '../queues/queue.js';

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
  const log = getLogger();
  try {
    // prevent 304s for polling
    res.setHeader('Cache-Control', 'no-store');

    const raw =
      req.params?.id ??
      req.params?.jobId ??
      req.query?.id ??
      req.query?.jobId ?? '';

    const jobId = decodeURIComponent(String(raw)).trim();
    if (!jobId) {
      return res.status(400).json({ jobId: null, state: 'not_found', error: 'Missing jobId' });
    }

    const job = await queue.getJob(jobId);
    if (!job) return res.status(404).json({ id: jobId, jobId, state: 'not_found' });

    const state = await job.getState();

    // logs (BullMQ v5-safe)
    let logs = [];
    try {
      const qLogs = await queue.getJobLogs(job.id);
      logs = qLogs?.logs || [];
    } catch {}

    const base = {
      id: job.id,                 // <-- include both
      jobId: job.id,
      name: job.name,
      state,
      progress: job.progress ?? null,
      attemptsMade: job.attemptsMade ?? 0,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      logs,
    };

    const rv = job.returnvalue ?? null;
    const reply =
      typeof rv === 'string'
        ? rv
        : (rv && typeof rv === 'object' && (rv.reply || rv.message || rv.text)) || null;

    if (state === 'completed') {
      return res.json({
        ...base,
        returnvalue: rv,  // <-- legacy key most UIs use
        result: rv,       // <-- your newer key
        reply,            // <-- convenient flat field
      });
    }

    if (state === 'failed') {
      return res.json({
        ...base,
        failedReason: job.failedReason ?? null,
        returnvalue: rv,
        result: rv,
        reply,
      });
    }

    // waiting | active | delayed | paused
    return res.json(base);
  } catch (err) {
    next(err);
  }
}