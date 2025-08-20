// src/queues/worker.js
import 'dotenv/config';
import { Worker } from 'bullmq';
import { connection } from './connection.js';
import { runScript } from '../services/analysis.service.js';
import { RSCRIPT } from '../services/r-binary.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isTrueish = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());
const isFakeR = () => isTrueish(process.env.TEST_FAKE_R) || isTrueish(process.env.MOCK_MODE);

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
  'kintagen',
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
            results: isDifferential
              ? {
                  stats_table: [{ feature: 'm/z 123.45@5.6min', log2FC: 1.2, pvalue: 0.03 }],
                  volcano_plot_b64: null,
                  pca_plot_b64: null,
                  metabolite_map_b64: null,
                }
              : {
                  feature_table: [{ feature_id: 'F1', mz: 123.4567, rt: 345.67 }],
                  bpc_plot_b64: null,
                  top_spectra_plot_b64: null,
                  metabolite_map_b64: null,
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
              feature_table: [{ bin: '1.23ppm', intensity: 42 }],
            },
          }),
        );
      }

      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  },
  { connection }
);

worker.on('completed', (job) => log('completed', job.id));
worker.on('failed', (job, err) => log('failed', job?.id, err?.message));
