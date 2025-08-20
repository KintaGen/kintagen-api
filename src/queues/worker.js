// src/queues/worker.js
import { Worker, QueueEvents } from 'bullmq';
import { connection } from './connection.js';
import { runScript } from '../services/analysis.service.js';
import { RSCRIPT } from '../services/r-binary.js';
import path from 'path';
import { fileURLToPath } from 'url';

const QUEUE_NAME = 'kintagen';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isFakeR = () => process.env.TEST_FAKE_R === 'true';

function log(...args) {
  console.log('[QUEUE]', ...args);
}

async function handleSelfTest(job, data) {
  await job.updateProgress(50);
  await new Promise((r) => setTimeout(r, 20));
  await job.updateProgress(100);
  return { ok: true, echo: data ?? null, at: Date.now() };
}

async function runRScriptOrStub(scriptRelPath, args, stubFactory) {
  if (isFakeR()) {
    log('FAKE_R stub for', scriptRelPath);
    return stubFactory();
  }
  const scriptPath = path.join(__dirname, '..', 'scripts', scriptRelPath);
  const out = await runScript(RSCRIPT, [scriptPath, ...args]);

  try {
    return JSON.parse(out);
  } catch (e) {
    return { status: 'error', error: 'Failed to parse R output', raw: out };
  }
}

export const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    log('received', job.name, job.id);

    switch (job.name) {
      case 'self-test':
        return handleSelfTest(job, job.data);

      case 'force-fail':
        throw new Error('simulated failure');

      case 'ld50-analyze': {
        const { dataUrl } = job.data || {};
        return runRScriptOrStub(
          'ld50_analysis.R',
          [dataUrl ?? ''],
          () => ({
            status: 'success',
            results: {
              ld50_estimate: 3.14,
              standard_error: 0.12,
              confidence_interval_lower: 2.8,
              confidence_interval_upper: 3.5,
            },
            log: ['FAKE_R: ld50 stub'],
          }),
        );
      }

      case 'gcms-analyze': {
        const { dataPath, phenoFile } = job.data || {};
        const isDifferential = !!phenoFile;
        const rel = isDifferential ? 'xcms_analysis.R' : 'xcms_profiling.R';
        const args = isDifferential ? [dataPath ?? '', phenoFile ?? ''] : [dataPath ?? ''];

        return runRScriptOrStub(
          rel,
          args,
          () => ({
            status: 'success',
            results: {
              stats_table: [{ feature: 'm/z 123.45@5.6min', log2FC: 1.2, pvalue: 0.03 }],
              heatmap_png: null,
            },
            log: ['FAKE_R: gcms stub'],
          }),
        );
      }

      case 'nmr-analyze': {
        const { dataPath, metadataFile } = job.data || {};
        return runRScriptOrStub(
          'nmr_analysis.R',
          [dataPath ?? '', metadataFile ?? ''],
          () => ({
            ok: true,
            log: 'FAKE_R: nmr stub',
            results: {
              pca_png: null,
              volcano_png: null,
            },
          }),
        );
      }

      case 'pdf-extract': {
        const { cid } = job.data || {};
        return { ok: true, cid, status: 'skipped', reason: 'pdf-extract handled by HTTP controller' };
      }

      case 'flow-add-log': {
        return { ok: true, ...job.data };
      }

      case 'data-publisher': {
        return { ok: true, ranAt: Date.now() };
      }

      default:
        throw new Error(`No processor for job name "${job.name}"`);
    }
  },
  { connection },
);

const events = new QueueEvents(QUEUE_NAME, { connection });
events.on('failed', ({ jobId, failedReason }) => log('failed', jobId, failedReason));
events.on('completed', ({ jobId }) => log('completed', jobId));
