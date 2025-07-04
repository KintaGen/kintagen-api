// src/controllers/analysis.controller.js
import path from 'path';
import fs from 'fs';
import { runScript } from '../services/analysis.service.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function nmrAnalysisHandler(req, res, next) {
    const { dataPath } = req.body;
    if (!dataPath) return res.status(400).json({ success: false, error: 'Request body must include "dataPath".' });

    const r_script_path = path.join(path.dirname(__dirname), 'scripts', 'run_batman.R');
    const outputDir = path.join(path.dirname(__dirname), 'results', `run_${Date.now()}`);

    try {
        fs.mkdirSync(outputDir, { recursive: true });
        const scriptOutputLog = await runScript('Rscript', [r_script_path, dataPath], { cwd: outputDir });
        res.json({
            success: true,
            message: 'BATMAN analysis completed successfully.',
            outputDirectory: outputDir,
            log: scriptOutputLog,
        });
    } catch (error) {
        error.outputDirectory = outputDir; // Add context for debugging
        next(error);
    }
}

export async function ld50AnalysisHandler(req, res, next) {
    const { dataUrl } = req.body;

    const r_script_path = path.join(path.dirname(__dirname), 'scripts', 'ld50_analysis.R');
    
    try {
        const scriptOutputJson = await runScript('Rscript', [r_script_path, dataUrl], {});
        const results = JSON.parse(scriptOutputJson);
        if (results.status === 'success') {
            res.json(results);
        } else {
            console.error('LD50 R script reported an internal error:', results.error);
            res.status(500).json(results);
        }
    } catch (error) {
        next(error);
    }
}

export async function gcmsAnalysisHandler(req, res, next) {
    const { dataPath } = req.body;
    const r_script_path = path.join(path.dirname(__dirname), 'scripts', 'xcms_analysis.R');
    const args = [r_script_path, dataPath];

    try {
        const scriptOutputJson = await runScript('Rscript', args);
        const results = JSON.parse(scriptOutputJson);
        if (results.status === 'success') {
            res.json(results);
        } else {
            console.error('R script reported an internal error:', results.error);
            res.status(500).json(results);
        }
    } catch (error) {
        next(error);
    }
}
export async function gcmsDifferentialHandler(req, res, next) {
    const { dataPath } = req.body;
    const r_script_path = path.join(path.dirname(__dirname), 'scripts', 'xcms_analysis.R');
    const args = [r_script_path, dataPath];
    try {
        console.log('[API] Running GC-MS Differential Analysis...');
        const scriptOutputJson = await runScript('Rscript', args);
        const results = JSON.parse(scriptOutputJson);
        if (results.status === 'error') throw new Error(results.error);
        res.json(results);
    } catch (error) {
        console.error('[API ERROR] in gcmsDifferentialHandler:', error);
        next(error);
    }
}

// --- NEW HANDLER for profiling analysis ---
export async function gcmsProfilingHandler(req, res, next) {
    const { dataPath } = req.body;
    const r_script_path = path.join(path.dirname(__dirname), 'scripts', 'xcms_profiling.R');
    const args = [r_script_path, dataPath];
    
    // Note: The robust solution involves downloading and unzipping the dataCid first.
    // For now, we are assuming the R script can handle a URL to a directory if needed,
    // or that you will implement the unzip logic here later.

    try {
        console.log('[API] Running GC-MS Profiling Analysis...');
        const scriptOutputJson = await runScript('Rscript', args);
        console.log(scriptOutputJson)
        const results = JSON.parse(scriptOutputJson);
        if (results.status === 'error') throw new Error(results.error);
        res.json(results);
    } catch (error) {
        console.error('[API ERROR] in gcmsProfilingHandler:', error);
        next(error);
    }
}