// src/controllers/upload.controller.js

import { jobs as queue, queueEvents as qe } from '../queues/queue.js';
import { getLogger } from '../services/logger.js';


import { query } from '../services/db.js';
import { uploadData } from '../services/synapse.js';


/**
 * The main, flexible handler for processing and uploading files.
 * It categorizes data based on the 'dataType' parameter from the request.
 */
export async function processAndUploadHandler(req, res, next) {
    const log = getLogger();
    try {
        const { projectId, dataType, title: manualTitle, isEncrypted, litTokenId } = req.body ?? {};
        if (!req.file || !dataType) return res.status(400).json({ error: 'A file and data type are required.' });

        const doAsync = ['1', 'true', 'yes', 'on'].includes(String(req.query.async ?? req.body?.async ?? '').toLowerCase());

        const payload = {
            filePath: req.file.path,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            dataType,
            projectId: projectId != null && projectId !== '' ? Number(projectId) : null,
            manualTitle: manualTitle || '',
            isEncrypted: ['1', 'true', 'yes', 'on'].includes(String(isEncrypted ?? '').toLowerCase()),
            litTokenId: litTokenId || null,
        };

        const job = await queue.add('upload-file', payload, {
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 24 * 3600 },
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
        });

        if (doAsync) return res.status(202).json({ jobId: job.id });

        const wait = Number(req.body?.timeoutMs) || 180_000;
        try {
            await qe.waitUntilReady();
            const result = await job.waitUntilFinished(qe, wait);
            return res.status(200).json(result);
        } catch {
            log.warn({ jobId: job.id }, '[upload] still processing');
            return res.status(202).json({ jobId: job.id, status: 'processing' });
        }
    } catch (err) { next(err); }
}

/**
 * A more generic handler that just uploads a file and adds its CID to the database.
 */
export async function uploadAndAddRootHandler(req, res, next) {
    try {
        const { proofSetID } = req.body;
        if (!req.file) {
            return res.status(400).json({ error: 'file is required' });
        }

        console.log(`[API] Received file ${req.file.originalname} (${req.file.size} bytes) for proof set ${proofSetID || 'any'}`);
        const uploadResult = await uploadData(req.file.buffer, { proofSetId: proofSetID ? Number(proofSetID) : undefined });

        await query(
            'INSERT INTO file_cids (filename, cid) VALUES ($1, $2) ON CONFLICT (cid) DO NOTHING',
            [req.file.originalname, uploadResult.commp]
        );
        console.log(`[DB] Saved generic mapping: ${req.file.originalname} -> ${uploadResult.commp}`);

        return res.status(200).json({
            proofSetID: uploadResult.proofSetId,
            rootCID: uploadResult.commp,
            message: "File uploaded and root added successfully",
        });
    } catch (error) {
        console.error('[API ERROR] in uploadAndAddRootHandler:', error);
        next(error);
    }
}

/**
 * Handler for uploading GENOME data. Updated to accept projectId.
 */
export async function uploadAndAddGenomeHandler(req, res, next) {
    try {
        const { organism, assemblyVersion, notes, projectId } = req.body;
        if (!req.file || !organism) {
            return res.status(400).json({ error: 'file and organism are required' });
        }
        console.log(`[API] Uploading genome for: "${organism}", Project: ${projectId || 'General'}`);

        const uploadResult = await uploadData(req.file.buffer);
        const commP = uploadResult.commp;

        await query(
            'INSERT INTO genome (cid, organism, assembly_version, notes, project_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid) DO NOTHING',
            [commP, organism, assemblyVersion || null, notes || null, projectId || null]
        );
        console.log(`[DB] Saved genome metadata for CommP: ${commP}`);

        return res.status(200).json({
            proofSetID: uploadResult.proofSetId,
            rootCID: commP,
            organism,
            assemblyVersion,
            notes,
        });
    } catch (error) {
        console.error('[API ERROR] in uploadAndAddGenomeHandler:', error);
        next(error);
    }
}

/**
 * Handler for uploading SPECTRUM data. Updated to accept projectId.
 */
export async function uploadAndAddSpectrumHandler(req, res, next) {
    try {
        const { compound, technique, metadata, projectId } = req.body;
        if (!req.file || !compound) {
            return res.status(400).json({ error: 'file and compound are required' });
        }
        console.log(`[API] Uploading spectrum for: "${compound}", Project: ${projectId || 'General'}`);

        let metadataJsonb = null;
        if (metadata) {
            try {
                metadataJsonb = JSON.parse(metadata);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid JSON metadata' });
            }
        }

        const uploadResult = await uploadData(req.file.buffer);
        const commP = uploadResult.commp;

        await query(
            'INSERT INTO spectrum (cid, compound, technique_nmr_ir_ms, metadata_json, project_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid) DO NOTHING',
            [commP, compound, technique || null, metadataJsonb, projectId || null]
        );
        console.log(`[DB] Saved spectrum metadata for CommP: ${commP}`);

        res.status(200).json({
            proofSetID: uploadResult.proofSetId,
            rootCID: commP,
            compound,
            technique,
            metadata: metadataJsonb,
        });
    } catch (error) {
        console.error('[API ERROR] in uploadAndAddSpectrumHandler:', error);
        next(error);
    }
}