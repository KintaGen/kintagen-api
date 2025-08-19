// src/queues/worker.js
import { Worker, QueueEvents } from 'bullmq';
import { connection } from './connection.js';
import { getLLMResponse as runMosaiaPrompt } from '../services/ai.service.js';
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
  await new Promise(r => setTimeout(r, 20));
  await job.updateProgress(100);
  return { ok: true, echo: data ?? null, at: Date.now() };
}

async function handlePromptLLM(job) {
  const { system, prompt, temperature, model, simulateFailFor } = job.data || {};
  if (simulateFailFor && job.attemptsMade < simulateFailFor) {
    throw new Error(`simulated failure attempt ${job.attemptsMade + 1}/${simulateFailFor}`);
  }
  const output = await runMosaiaPrompt({
    system: system || 'You are helpful.',
    user: prompt || '',
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    model: model || 'mock-or-real',
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
    return {
      ok: true,
      peak_table: [{ ppm: 7.26, area: 1234 }],
      log: 'FAKE_R: nmr stub',
    };
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
    case 'mosaia-prompt-direct': // alias for older tests
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

events.on('progress', ({ jobId, data }) => log(`${jobId} progress: ${data}`));
events.on('completed', ({ jobId }, result) => {
  try {
    log(`Job ${jobId} completed. Summary:`, result ? JSON.parse(result) : result);
  } catch {
    log(`Job ${jobId} completed.`);
  }
});
events.on('failed', ({ jobId, failedReason }) => log(`${jobId} failed: ${failedReason}`));

log('Worker online for queue:', QUEUE_NAME);

export default worker;
