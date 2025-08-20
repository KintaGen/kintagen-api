// src/queues/worker.js
import { Worker, QueueEvents } from 'bullmq';
import { connection } from './connection.js';
import {
  getLLMResponse as runMosaiaPrompt,
  generateSearchQueries,
  getSearchResults,
} from '../services/ai.service.js';
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

function extractQuestionFromPrompt(p) {
  if (!p) return '';
  const m = String(p).match(/Question:\s*([\s\S]*)$/i);
  return (m ? m[1] : p).trim();
}

async function handleSelfTest(job, data) {
  await job.updateProgress(50);
  await new Promise((r) => setTimeout(r, 20));
  await job.updateProgress(100);
  return { ok: true, echo: data ?? null, at: Date.now() };
}

async function handlePromptLLM(job) {
  const {
    system,
    prompt,
    temperature,
    model,
    simulateFailFor,
    useExa,
    exaQueryCount = 6,
    exaLinksPerQuery = 5,
  } = job.data || {};

  if (simulateFailFor && job.attemptsMade < simulateFailFor) {
    throw new Error(`simulated failure attempt ${job.attemptsMade + 1}/${simulateFailFor}`);
  }

  const question = extractQuestionFromPrompt(prompt);
  const useRetrieval = !!useExa;

  log('JOB received', { id: job.id, name: job.name });
  log('PROMPT start', {
    id: job.id,
    name: job.name,
    attemptsMade: job.attemptsMade,
    simulateFailFor,
    useExa: useRetrieval,
    exaQueryCount,
    exaLinksPerQuery,
    user: job.data?.user,
    key: job.data?.key,
    model: model || '(default from ai.service)',
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    systemPreview: String(system || 'You are helpful.').slice(0, 80),
    userPreview: String(prompt || '').slice(0, 160),
  });

  let finalUserMessage = prompt || '';
  let retrievalSummary = null;

  if (useRetrieval && question) {
    try {
      const qCount = Math.max(1, Math.min(20, exaQueryCount));
      const links = Math.max(1, Math.min(25, exaLinksPerQuery));

      log('EXA step: generate queries', { question, qCount });
      const queries = await generateSearchQueries(question, qCount);

      log('EXA step: fetch results', { numQueries: queries.length, linksPerQuery: links });
      const results = await getSearchResults(queries, links);

      const top = results.slice(0, Math.min(results.length, qCount * links));
      const ctx = top
        .map((r, i) => `[#${i + 1}] ${r.url}\n${String(r.text || '').slice(0, 600)}`)
        .join('\n\n');

      retrievalSummary = { queries, usedResults: top.length };

      finalUserMessage =
        `Use the retrieved sources to answer the question. Add inline citations as [#] and a "References" list of URLs.\n\n` +
        `Question:\n${question}\n\n` +
        `Sources:\n${ctx}\n\n` +
        `---\nIf the sources are insufficient, answer best-effort but say so.`;
    } catch (e) {
      log('EXA step FAILED (continuing without retrieval)', { err: String(e?.message || e) });
      finalUserMessage = prompt || question || '';
    }
  }

  log('AI request', {
    baseURL: 'https://api.mosaia.ai/v1/agent',
    model: model || '6845cac0d8955e09bf51f446',
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    systemPreview: String(system || 'You are helpful.').slice(0, 80),
    userPreview: String(finalUserMessage).slice(0, 160),
    retrieval: retrievalSummary || null,
  });

  const output = await runMosaiaPrompt({
    system: system || 'You are helpful.',
    user: finalUserMessage,
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    model: model, // allow ai.service default when undefined
  });

  log('AI response', {
    model: model || '6845cac0d8955e09bf51f446',
    contentLen: (output || '').length,
    contentPreview: String(output || '').slice(0, 160),
  });

  return { ok: true, output };
}

async function handleLd50(data) {
  if (isFakeR()) {
    return {
      status: 'success',
      results: {
        ld50_estimate: 3.14,
        standard_error: 0.12,
        confidence_interval_lower: 2.9,
        confidence_interval_upper: 3.4,
      },
      log: ['FAKE_R: ld50 stub'],
    };
  }
  const script = path.join(__dirname, '..', 'scripts', 'ld50_analysis.R');
  const out = await runScript(RSCRIPT, [script, data?.dataUrl || ''], {});
  return JSON.parse(out);
}

async function handleGcms(data) {
  if (isFakeR()) {
    return {
      status: 'success',
      results: {
        stats_table: [{ feature: 'm/z 123.45@5.6min', log2FC: 1.2, p: 0.03 }],
        pca_plot_b64: 'data:image/png;base64,FAKE',
        volcano_plot_b64: 'data:image/png;base64,FAKE',
      },
      log: ['FAKE_R: gcms stub'],
    };
  }
  const script = path.join(__dirname, '..', 'scripts', 'xcms_analysis.R');
  const out = await runScript(RSCRIPT, [script, data?.dataPath || '', data?.phenoFile || ''], {});
  return JSON.parse(out);
}

async function handleNmr(data) {
  if (isFakeR()) {
    return { ok: true, peak_table: [{ ppm: 7.26, area: 1234 }], log: 'FAKE_R: nmr stub' };
  }
  const script = path.join(__dirname, '..', 'scripts', 'run_batman.R');
  const outLog = await runScript(RSCRIPT, [script, data?.dataPath || ''], {});
  return { ok: true, log: outLog };
}

const processor = async (job) => {
  switch (job.name) {
    case 'self-test':
      return await handleSelfTest(job, job.data);
    case 'force-fail':
      throw new Error('boom');
    case 'prompt:llm':
    case 'mosaia-prompt-direct': // legacy alias
      return await handlePromptLLM(job);
    case 'ld50-analyze':
      return await handleLd50(job.data);
    case 'gcms-analyze':
      return await handleGcms(job.data);
    case 'nmr-analyze':
      return await handleNmr(job.data);
    default:
      throw new Error(`Unknown job name: ${job.name}`);
  }
};

const worker = new Worker(QUEUE_NAME, processor, { connection });
const events = new QueueEvents(QUEUE_NAME, { connection });

worker.on('ready', () => log(`Worker online for queue: ${QUEUE_NAME}`));
worker.on('active', (job) =>
  log('JOB active', { id: job.id, name: job.name, attemptsMade: job.attemptsMade })
);
worker.on('completed', (job, rv) =>
  log('JOB completed', {
    id: job.id,
    name: job.name,
    returnSize: JSON.stringify(rv || {}).length,
  })
);
worker.on('failed', (job, err) =>
  log(`${job?.name || 'job'}#${job?.id} failed: ${err?.message || err}`)
);

events.on('completed', ({ jobId }) => log('EVENT completed', { jobId }));
events.on('failed', ({ jobId, failedReason }) => log('EVENT failed', { jobId, failedReason }));
