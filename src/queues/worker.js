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
      // inside the switch(job.name) in src/queues/worker.js
      case 'research-chat': {
        // Verbose, mock-friendly processor that always returns { reply }
        try {
          log('[research-chat] START', { id: job.id });
          const topic = job.data?.topic || '';
          log('[research-chat] topic:', topic);

          await job.updateProgress(5);

          // Import AI service lazily (MOCK_MODE makes these safe & fast)
          const ai = await import('../services/ai.service.js');

          await job.updateProgress(10);
          log('[research-chat] generating queries…');
          const queries = await ai.generateSearchQueries(topic);
          log('[research-chat] queries generated:', queries?.length ?? 0);
          if (Array.isArray(queries)) {
            for (let i = 0; i < Math.min(3, queries.length); i++) {
              log(`[research-chat] q${i + 1}:`, queries[i]);
            }
          }

          await job.updateProgress(40);
          log('[research-chat] fetching search results…');
          const results = await ai.getSearchResults(queries);
          log('[research-chat] results received:', results?.length ?? 0);

          await job.updateProgress(70);
          log('[research-chat] synthesizing report…');
          const reply = await ai.synthesizeReport(topic, results);

          const replyPreview = String(reply || '').slice(0, 200).replace(/\s+/g, ' ');
          log('[research-chat] reply preview:', replyPreview || '(empty)');

          await job.updateProgress(100);
          log('[research-chat] DONE', { id: job.id });

          // ⬇️ ALWAYS return a reply so the UI can render something
          return {
            reply: reply || 'No content generated (empty mock reply).',
            meta: {
              queryCount: queries?.length ?? 0,
              resultCount: results?.length ?? 0,
              at: Date.now(),
            },
          };
        } catch (err) {
          log('[research-chat] ERROR:', err?.stack || err?.message || String(err));
          // Let BullMQ mark the job as failed
          throw err;
        }
      }


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
