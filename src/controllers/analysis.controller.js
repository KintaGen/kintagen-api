// src/controllers/analysis.controller.js
import { Queue, QueueEvents } from 'bullmq';
import { connection } from '../queues/connection.js';

const QUEUE_NAME = 'kintagen';
const queue = new Queue(QUEUE_NAME, { connection });
const events = new QueueEvents(QUEUE_NAME, { connection });



export async function ld50AnalysisHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `ld50-analyze:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const doAsync = isAsyncFlag === true || req.query.async === '1';

  const out = await enqueueAndMaybeWait('ld50-analyze', payload, {
    jobId,
    waitMs: doAsync ? 0 : Number(timeoutMs) || 120_000,
  });

  if (doAsync) return res.json({ jobId: out.jobId });
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });
  return res.json(out.result);
}

export async function gcmsDifferentialHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `gcms-analyze:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const doAsync = isAsyncFlag === true || req.query.async === '1';

  const out = await enqueueAndMaybeWait('gcms-analyze', payload, {
    jobId,
    waitMs: doAsync ? 0 : Number(timeoutMs) || 180_000,
  });

  if (doAsync) return res.json({ jobId: out.jobId });
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });
  return res.json(out.result);
}

export async function gcmsProfilingHandler(req, res) {
  const { async: isAsyncFlag, timeoutMs, ...payload } = req.body ?? {};
  const jobId = `gcms-analyze:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const doAsync = isAsyncFlag === true || req.query.async === '1';

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
    waitMs: doAsync ? 0 : Number(timeoutMs) || 180_000,
  });

  if (doAsync) return res.json({ jobId: out.jobId });
  if (!out.completed) return res.status(202).json({ jobId: out.jobId, status: 'processing' });
  return res.json(out.result);
}

// Small helper: enqueue and optionally wait for completion
async function enqueueAndMaybeWait(name, payload, { waitMs, jobId }) {
    const job = await queue.add(name, payload, {
      jobId,
      // ⬇️ keep completed jobs around so clients can fetch status for a while
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
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
  

  export async function getAnalysisJobHandler(req, res, next) {
    try {
      const { id } = req.params;
      const q = new Queue(QUEUE_NAME, { connection });
      const job = await q.getJob(id);
  
      // If a job is not found (e.g., removed very fast), return a soft terminal snapshot
      if (!job) {
        return res.json({
          id,
          state: 'completed',
          progress: 100,
          failedReason: null,
          returnvalue: null,
          logs: [],
          finishedOn: Date.now(),
        });
      }
  
      const state = await job.getState(); // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
      res.json({
        id: job.id,
        name: job.name,
        state,
        progress: typeof job.progress === 'number'
          ? job.progress
          : (state === 'completed' ? 100 : undefined),
        failedReason: job.failedReason || null,
        returnvalue: job.returnvalue || null,
        // BullMQ v5 removed per-job logs API; return empty list for compatibility
        logs: [],
        timestamp: job.timestamp,
        finishedOn: job.finishedOn,
        processedOn: job.processedOn,
      });
    } catch (e) {
      next(e);
    }
  }
  