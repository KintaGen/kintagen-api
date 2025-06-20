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
    const { dataPath, phenoFile } = req.body;
    const r_script_path = path.join(path.dirname(__dirname), 'scripts', 'xcms_analysis.R');
    const args = [r_script_path, dataPath, phenoFile];

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