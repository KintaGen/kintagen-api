// src/queues/worker.js
import 'dotenv/config';
import { Worker } from 'bullmq';
import { connection } from './connection.js';
import { runScript } from '../services/analysis.service.js';
import { RSCRIPT } from '../services/r-binary.js';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';
import { query } from '../services/db.js';
import { uploadData } from '../services/synapse.js';
import * as aiService from '../services/ai.service.js';
import * as pdfService from '../services/pdf.service.js';

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

async function handleUploadFile(job) {
  const {
    filePath,
    originalname,
    mimetype,
    size,
    dataType,
    projectId,
    manualTitle,
    isEncrypted,
    litTokenId,
  } = job.data || {};

  const cleanupTemp = () => {
    try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* noop */ }
  };

  // reuse top-level isTrueish
  const MOCK_MODE = isTrueish(process.env.MOCK_MODE);
  if (MOCK_MODE) {
    cleanupTemp();
    return {
      status: 'success',
      cid: `bafy-mock-${Date.now()}`,
      projectId,
      title: manualTitle || originalname || 'Mock Upload',
      isEncrypted,
      litTokenId,
      size,
      dataType,
      note: 'MOCK_MODE: upload not performed.',
    };
  }

  if (!filePath || !dataType) throw new Error('Missing filePath or dataType.');

  try {
    await job.updateProgress(5);
    const fileBuffer = fs.readFileSync(filePath);

    await job.updateProgress(15);
    const uploaded = await uploadData(fileBuffer);
    const commp = uploaded.commp;

    let response = {
      status: 'success',
      cid: commp,
      projectId,
      title: '',
      isEncrypted,
      litTokenId,
      size,
      dataType,
    };

    if (dataType === 'paper') {
      if (isEncrypted) {
        response.title = originalname || 'Encrypted Document';
        await query(
          `INSERT INTO paper (cid, title, project_id, is_encrypted, lit_token_id)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cid) DO NOTHING`,
          [commp, response.title, projectId, true, litTokenId]
        );
      } else {
        let text = '';
        if (mimetype === 'application/pdf') {
          text = await pdfService.extractTextFromBuffer(fileBuffer);
        } else if (String(mimetype || '').startsWith('text/')) {
          text = fileBuffer.toString('utf-8');
        }

        if (text) {
          await job.updateProgress(35);
          const aiMeta = await aiService.extractMetadataFromText(text);
          response = {
            ...response,
            title: aiMeta.title || (originalname || 'Untitled'),
            journal: aiMeta.journal || '',
            year: aiMeta.year ? Number(aiMeta.year) : null,
            keywords: aiMeta.keywords || [],
            authors: aiMeta.authors || [],
            doi: aiMeta.doi || '',
          };
          await query(
            `INSERT INTO paper (cid, title, journal, year, keywords, authors, project_id, is_encrypted, lit_token_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (cid) DO NOTHING`,
            [
              commp,
              response.title,
              response.journal || null,
              response.year || null,
              response.keywords,
              response.authors,
              projectId,
              false,
              litTokenId,
            ]
          );
        } else {
          response.title = originalname || 'Document';
          await query(
            `INSERT INTO paper (cid, title, project_id, is_encrypted, lit_token_id)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cid) DO NOTHING`,
            [commp, response.title, projectId, false, litTokenId]
          );
        }
      }
    } else if (dataType === 'experiment' || dataType === 'analysis') {
      if (!manualTitle) throw new Error(`A title is required for ${dataType} data.`);
      response.title = manualTitle;
      const table = dataType === 'experiment' ? 'experiment' : 'analysis';
      await query(
        `INSERT INTO ${table} (cid, title, project_id, is_encrypted, lit_token_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cid) DO NOTHING`,
        [commp, response.title, projectId, !!isEncrypted, litTokenId]
      );
    } else {
      throw new Error(`Unsupported dataType: ${dataType}`);
    }

    await job.updateProgress(100);
    return response;
  } catch (err) {
    throw err;
  } finally {
    cleanupTemp();
  }
}

export const worker = new Worker(
  'kintagen',
  async (job) => {
    log('received', job.name, job.id);

    switch (job.name) {
      case 'research-chat': {
        try {
          log('[research-chat] START', { id: job.id });
          const topic = job.data?.topic || '';
          const knowledgeBase = job.data?.knowledgeBase;
          const prompt = `Solve: ${topic}; Context: ${knowledgeBase}`;
          log('[research-chat] topic:', topic);
          await job.updateProgress(5);

          await job.updateProgress(10);
          log('[research-chat] generating queries…');
          const queries = await aiService.generateSearchQueries(prompt);
          log('[research-chat] queries generated:', queries?.length ?? 0);
          if (Array.isArray(queries)) {
            for (let i = 0; i < Math.min(3, queries.length); i++) {
              log(`[research-chat] q${i + 1}:`, queries[i]);
            }
          }

          await job.updateProgress(40);
          log('[research-chat] fetching search results…');
          const results = await aiService.getSearchResults(queries);
          log('[research-chat] results received:', results?.length ?? 0);

          await job.updateProgress(70);
          log('[research-chat] synthesizing report…');
          const reply = await aiService.synthesizeReport(prompt, results);
          const replyPreview = String(reply || '').slice(0, 200).replace(/\s+/g, ' ');
          log('[research-chat] reply preview:', replyPreview || '(empty)');

          await job.updateProgress(100);
          log('[research-chat] DONE', { id: job.id });
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
          throw err;
        }
      }

      case 'self-test': {
        return handleSelfTest(job, job.data);
      }

      case 'force-fail': {
        throw new Error('forced failure for test');
      }

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

      case 'gcms-profiling-analyze': {
        const { dataCid, sample } = job.data || {};
        const dataPath = sample ? '' : dataCid;
        log(`[gcms-profiling-analyze] Running with dataPath: "${dataPath}"`);

        return runRScriptOrStub(
          'xcms_profiling.R',
          [dataPath ?? ''],
          () => ({
            status: 'success',
            results: {
              feature_table: [{ feature_id: 'F1', mz: 123.4567, rt: 345.67 }],
              bpc_plot_b64: null,
              top_spectra_plot_b64: null,
              metabolite_map_b64: null,
            },
            log: ['FAKE_R: gcms PROFILING stub'],
          }),
        );
      }

      case 'gcms-differential-analyze': {
        const { dataCid, phenoCid, sample } = job.data || {};
        const dataPath = sample ? '' : dataCid;
        const phenoPath = sample ? '' : phenoCid;
        log(`[gcms-differential-analyze] Running with dataPath: "${dataPath}", phenoPath: "${phenoPath}"`);

        return runRScriptOrStub(
          'xcms_analysis.R',
          [dataPath ?? '', phenoPath ?? ''],
          () => ({
            status: 'success',
            results: {
              stats_table: [{ feature: 'm/z 123.45@5.6min', log2FC: 1.2, pvalue: 0.03 }],
              volcano_plot_b64: null,
              pca_plot_b64: null,
              metabolite_map_b64: null,
            },
            log: ['FAKE_R: gcms DIFFERENTIAL stub'],
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

      case 'upload-file': {
        return await handleUploadFile(job);
      }

      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  },
  { connection }
);

worker.on('completed', (job) => log('completed', job.id));
worker.on('failed', (job, err) => log('failed', job?.id, err?.message));
