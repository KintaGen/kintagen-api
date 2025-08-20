// src/queues/worker.js
import { Worker, QueueEvents } from 'bullmq';
import { connection } from './connection.js';
import { getLLMResponse as runMosaiaPrompt } from '../services/ai.service.js';
import { runScript } from '../services/analysis.service.js';
import { RSCRIPT } from '../services/r-binary.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSearchQueries, getSearchResults, synthesizeReport } from '../services/ai.service.js';

async function researcher(topic,context) {
    console.log(`Starting research on topic: "${topic}"`);
    const searchQueries = await generateSearchQueries(topic);
    console.log("Generated search queries:", searchQueries);
    const searchResults = await getSearchResults(searchQueries);
    console.log(`Found ${searchResults.length} search results.`);
    console.log("Synthesizing report...");
    const report = await synthesizeReport(topic, searchResults);
    return report;
}
const QUEUE_NAME = 'kintagen';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isFakeR = () => process.env.TEST_FAKE_R === 'true';
const isFakeMosaia = () => process.env.TEST_FAKE_MOSAIA === '1';

function log(...args) { console.log('[QUEUE]', ...args); }
function warn(...args) { console.warn('[QUEUE]', ...args); }
function errlog(...args) { console.error('[QUEUE]', ...args); }

const preview = (s, n = 160) => String(s ?? '')
  .replace(/\s+/g, ' ')
  .slice(0, n);

async function handleSelfTest(job, data) {
  log('SELF-TEST start', { id: job.id, attemptsMade: job.attemptsMade });
  await job.updateProgress(50);
  await new Promise(r => setTimeout(r, 20));
  await job.updateProgress(100);
  const out = { ok: true, echo: data ?? null, at: Date.now() };
  log('SELF-TEST done', { id: job.id, ok: out.ok });
  return out;
}

async function handlePromptLLM(job) {
  const { system, prompt, temperature, model, simulateFailFor, useStub, user, key } = job.data || {};

  log('PROMPT start', {
    id: job.id,
    name: job.name,
    attemptsMade: job.attemptsMade,
    simulateFailFor,
    useStub: !!useStub || isFakeMosaia(),
    user,
    key,
    model: model || '(default from ai.service)',
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    systemPreview: preview(system, 120),
    userPreview: preview(prompt, 120),
  });

  if (simulateFailFor && job.attemptsMade < simulateFailFor) {
    const msg = `simulated failure attempt ${job.attemptsMade + 1}/${simulateFailFor}`;
    warn('PROMPT simulated fail', { id: job.id, msg });
    throw new Error(msg);
  }

  // Stubbed response for local/dev demo
  if (useStub || isFakeMosaia()) {
    const out = { ok: true, output: 'MOCKED-LLM-REPLY' };
    log('PROMPT stubbed completion', { id: job.id, outputPreview: preview(out.output, 120) });
    return out;
  }

  // Real call (no forced model default here; let ai.service decide if not provided)
  const payload = {
    system: system || 'You are helpful.',
    user: prompt || '',
    temperature: typeof temperature === 'number' ? temperature : 0.2,
  };
  if (model) payload.model = model;

  try {
    const output = await researcher(prompt);
    const trimmed = (output ?? '').trim();
    if (!trimmed) {
      warn('PROMPT empty LLM response', {
        id: job.id,
        model: model || '(default from ai.service)',
        temperature: payload.temperature,
      });
    }
    const out = { ok: true, output };
    log('PROMPT done', {
      id: job.id,
      ok: out.ok,
      outputLen: output ? output.length : 0,
      outputPreview: preview(output, 160),
    });
    return out;
  } catch (e) {
    errlog('PROMPT error from LLM call', {
      id: job.id,
      message: e?.message,
    });
    throw e;
  }
}

async function handleLd50(data) {
  log('LD50 start', { dataUrl: data?.dataUrl });
  if (isFakeR()) {
    const out = {
      status: 'success',
      results: {
        ld50_estimate: 3.14,
        standard_error: 0.12,
        confidence_interval_lower: 2.9,
        confidence_interval_upper: 3.4,
      },
      log: ['FAKE_R: ld50 stub'],
    };
    log('LD50 stubbed done');
    return out;
  }
  const script = path.join(__dirname, '..', 'scripts', 'ld50_analysis.R');
  const out = await runScript(RSCRIPT, [script, data?.dataUrl || ''], {});
  log('LD50 real done');
  return JSON.parse(out);
}

async function handleGcms(data) {
  log('GCMS start', { dataPath: data?.dataPath, phenoFile: data?.phenoFile });
  if (isFakeR()) {
    const out = {
      status: 'success',
      results: {
        stats_table: [{ feature: 'm/z 123.45@5.6min', log2FC: 1.2, p: 0.03 }],
        pca_plot_b64: 'data:image/png;base64,FAKE',
        volcano_plot_b64: 'data:image/png;base64,FAKE',
      },
      log: ['FAKE_R: gcms stub'],
    };
    log('GCMS stubbed done');
    return out;
  }
  const script = path.join(__dirname, '..', 'scripts', 'xcms_analysis.R');
  const out = await runScript(RSCRIPT, [script, data?.dataPath || '', data?.phenoFile || ''], {});
  log('GCMS real done');
  return JSON.parse(out);
}

async function handleNmr(data) {
  log('NMR start', { dataPath: data?.dataPath });
  if (isFakeR()) {
    const out = {
      ok: true,
      peak_table: [{ ppm: 7.26, area: 1234 }],
      log: 'FAKE_R: nmr stub',
    };
    log('NMR stubbed done');
    return out;
  }
  const script = path.join(__dirname, '..', 'scripts', 'run_batman.R');
  const outLog = await runScript(RSCRIPT, [script, data?.dataPath || ''], {});
  log('NMR real done');
  return { ok: true, log: outLog };
}

const processor = async (job) => {
  log('JOB received', { id: job.id, name: job.name });
  switch (job.name) {
    case 'self-test':        return await handleSelfTest(job, job.data);
    case 'force-fail':       throw new Error('boom');
    case 'prompt:llm':
    case 'mosaia-prompt-direct':
                             return await handlePromptLLM(job);
    case 'ld50-analyze':     return await handleLd50(job.data);
    case 'gcms-analyze':     return await handleGcms(job.data);
    case 'nmr-analyze':      return await handleNmr(job.data);
    default:                 throw new Error(`Unknown job name: ${job.name}`);
  }
};

// Boot worker + event listeners with detailed logs
const worker = new Worker(QUEUE_NAME, processor, { connection });
const events = new QueueEvents(QUEUE_NAME, { connection });

worker.on('ready', () => log(`Worker online for queue: ${QUEUE_NAME}`));
worker.on('active', (job) => log('JOB active', { id: job.id, name: job.name, attemptsMade: job.attemptsMade }));
worker.on('completed', (job, result) => {
  const rv = result ?? {};
  const size = typeof rv === 'string' ? rv.length : JSON.stringify(rv).length;
  log('JOB completed', { id: job.id, name: job.name, returnSize: size });
});
worker.on('failed', (job, e) => errlog('JOB failed', { id: job?.id, name: job?.name, message: e?.message }));

events.on('failed', ({ jobId, failedReason }) => errlog('EVENT failed', { jobId, failedReason }));
events.on('completed', ({ jobId }) => log('EVENT completed', { jobId }));
events.on('progress', ({ jobId, data }) => log('EVENT progress', { jobId, data }));
