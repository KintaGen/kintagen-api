// src/controllers/jobs.controller.js
import { jobs } from '../queues/queue.js';
import { Queue } from 'bullmq';
import { connection } from '../queues/connection.js';

const kq = jobs; // alias

export async function enqueueLd50(req, res, next) {
  try {
    const { dataUrl } = req.body || {};
    const job = await kq.add('ld50-analyze', { dataUrl });
    res.status(202).json({ jobId: job.id, name: job.name });
  } catch (e) { next(e); }
}

export async function enqueueGcms(req, res, next) {
  try {
    const { dataPath, phenoFile } = req.body || {};
    const job = await kq.add('gcms-analyze', { dataPath, phenoFile });
    res.status(202).json({ jobId: job.id, name: job.name });
  } catch (e) { next(e); }
}

export async function enqueueNmr(req, res, next) {
  try {
    const { dataPath } = req.body || {};
    const job = await kq.add('nmr-analyze', { dataPath });
    res.status(202).json({ jobId: job.id, name: job.name });
  } catch (e) { next(e); }
}

export async function enqueueFlowLog(req, res, next) {
  try {
    const { nftId, agent, action, outputCID } = req.body || {};
    if (!nftId || !action || !outputCID)
      return res.status(400).json({ error: 'nftId, action, outputCID are required' });
    const job = await kq.add('flow-add-log', { nftId, agent, action, outputCID });
    res.status(202).json({ jobId: job.id, name: job.name });
  } catch (e) { next(e); }
}

export async function enqueuePdfExtract(req, res, next) {
  try {
    const { cid } = req.body || {};
    if (!cid) return res.status(400).json({ error: 'cid is required' });
    const job = await kq.add('pdf-extract', { cid });
    res.status(202).json({ jobId: job.id, name: job.name });
  } catch (e) { next(e); }
}

// Optional: repeatable daily job (publisher)
export async function schedulePublisher(req, res, next) {
  try {
    const job = await kq.add('data-publisher', {}, {
      repeat: { pattern: '0 3 * * *' }, // every day 03:00
      jobId: 'publisher:daily',
    });
    res.status(201).json({ scheduled: true, jobId: job.id });
  } catch (e) { next(e); }
}

export async function getJobStatus(req, res, next) {
  try {
    const { id } = req.params;
    const q = new Queue('kintagen', { connection });
    const job = await q.getJob(id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const [state, logs] = await Promise.all([
      job.getState(),
      job.getLogs(0, 200),
    ]);

    res.json({
      id: job.id,
      name: job.name,
      state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason || null,
      returnvalue: job.returnvalue || null,
      logs: logs?.logs || [],
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    });
  } catch (e) { next(e); }
}
