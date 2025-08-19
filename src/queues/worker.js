// src/queues/worker.js
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker, QueueEvents } from 'bullmq';
import { connection } from './connection.js';

import { runScript } from '../services/analysis.service.js';
import * as flowService from '../services/flow.service.js';
import { extractTextFromBuffer } from '../services/pdf.service.js';
import fetch from 'node-fetch';
import { getLLMResponse } from '../services/ai.service.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Queue events (for logs/metrics)
const events = new QueueEvents('kintagen', { connection });
events.on('completed', ({ jobId, returnvalue }) => {
    console.log(`[QUEUE] Job ${jobId} completed. Summary:`, typeof returnvalue === 'string' ? returnvalue.slice(0, 120) : returnvalue);
});
events.on('failed', ({ jobId, failedReason }) => {
    console.error(`[QUEUE] Job ${jobId} failed: ${failedReason}`);
});

// Helpers to locate R scripts
const scriptsDir = path.join(path.dirname(__dirname), 'scripts');
const ld50Script = path.join(scriptsDir, 'ld50_analysis.R');
const gcmsScript = path.join(scriptsDir, 'xcms_analysis.R');
const nmrScript = path.join(scriptsDir, 'run_batman.R'); // you already reference this name

// Individual job handlers
async function handleLd50({ dataUrl }) {
    const out = await runScript('Rscript', [ld50Script, dataUrl || ''], {});
    // R script already emits JSON string
    return JSON.parse(out);
}


async function handleMosaiaPromptDirect({ system, user, temperature = 0.2, model }) {
    const output = await getLLMResponse({ system, user, temperature, model });
    return { ok: true, system, user, temperature, model: model || null, output };
}

async function handleGcms({ dataPath, phenoFile }) {
    const out = await runScript('Rscript', [gcmsScript, dataPath || '', phenoFile || ''], {});
    return JSON.parse(out);
}

async function handleNmr({ dataPath }) {
    const outLog = await runScript('Rscript', [nmrScript, dataPath || ''], {
        cwd: path.join(path.dirname(__dirname), 'results', `run_${Date.now()}`),
    });
    // If your NMR script prints JSON, parse; otherwise return its log.
    try { return JSON.parse(outLog); } catch { return { status: 'ok', log: outLog }; }
}

async function handleFlowLog({ nftId, projectId, agent = 'KintaGenApp', action, outputCID }) {
    // Prefer nftId if provided, else resolve via projectId like your controller does
    if (!nftId && projectId) {
        // mimic project lookup you already do in nft.controller.js
        // To avoid importing db here, let controller pass nftId ideally.
        throw new Error('Pass nftId directly for queue usage, or enqueue via the provided controller endpoint.');
    }
    const sealedTx = await flowService.addLogEntry({
        nftId, agent, action, outputCID,
    });
    return { transactionId: sealedTx.transactionId, nftId };
}

async function handlePdfExtract({ cid }) {
    const url = `https://0xcdb8cc9323852ab3bed33f6c54a7e0c15d555353.calibration.filcdn.io/${cid}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FilCDN fetch failed: ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = await extractTextFromBuffer(buf);
    return { cid, chars: text.length, text };
}

// The worker (single file, multiple job names)
export const worker = new Worker('kintagen', async (job) => {
    const { name, data } = job;

    switch (name) {
        case 'ld50-analyze': return await handleLd50(data);
        case 'gcms-analyze': return await handleGcms(data);
        case 'nmr-analyze': return await handleNmr(data);
        case 'flow-add-log': return await handleFlowLog(data);
        case 'pdf-extract': return await handlePdfExtract(data);
        case 'mosaia-prompt-direct': return await handleMosaiaPromptDirect(data);
        case 'self-test': {
            await job.updateProgress(50);
            await new Promise(r => setTimeout(r, 20));
            await job.updateProgress(100);
            return { ok: true, echo: data ?? null, at: Date.now() };
        }
        case 'force-fail': {
            throw new Error('boom');
        }

        // Example: repeatable daily publisher job
        case 'data-publisher': {
            // implement tar + upload later; placeholder return for now
            return { ok: true, note: 'publisher stub' };
        }

        default:
            throw new Error(`Unknown job name: ${name}`);
    }
}, {
    connection,
    // Tune to your machine
    concurrency: 3,
});

worker.on('progress', (job, progress) => {
    console.log(`[QUEUE] ${job.name}#${job.id} progress:`, progress);
});
worker.on('failed', (job, err) => {
    console.error(`[QUEUE] ${job.name}#${job?.id} failed:`, err?.message);
});
