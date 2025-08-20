// src/controllers/upload.controller.js
import { query } from '../services/db.js';
import { uploadData } from '../services/synapse.js';
import * as aiService from '../services/ai.service.js';
import * as pdfService from '../services/pdf.service.js';
import fs from 'fs';

/**
 * The main, flexible handler for processing and uploading files.
 * It categorizes data based on the 'dataType' parameter from the request.
 */
export async function processAndUploadHandler(req, res, next) {
    const { 
        projectId, 
        dataType, 
        title: manualTitle, 
        isEncrypted,
        litTokenId, // Capture the Lit Token ID from the request
    } = req.body;
    
    const isEncryptedBool = isEncrypted === 'true';

    if (!req.file || !dataType) {
        return res.status(400).json({ error: 'A file and data type are required.' });
    }

    const tempFilePath = req.file.path;

    try {
        console.log(`[API] Processing ${dataType} for project ${projectId || 'General'}. Encrypted: ${isEncryptedBool}`);
        
        const fileBuffer = fs.readFileSync(tempFilePath);
        const uploadResult = await uploadData(fileBuffer);
        const commP = uploadResult.commp;

        // This object now holds all metadata that will be returned
        let responseMetadata = {
            cid: commP,
            projectId: projectId ? Number(projectId) : null,
            title: '',
            isEncrypted: isEncryptedBool,
            litTokenId: litTokenId || null,
        };

        if (dataType === 'paper') {
            if (isEncryptedBool) {
                console.log('[API] File is encrypted. Saving with filename as title.');
                responseMetadata.title = req.file.originalname;

                // --- MODIFIED: Insert encryption metadata ---
                await query(
                    `INSERT INTO paper (cid, title, project_id, is_encrypted, lit_token_id) 
                     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid) DO NOTHING`,
                    [commP, responseMetadata.title, responseMetadata.projectId, isEncryptedBool, responseMetadata.litTokenId]
                );

            } else { // Handle unencrypted papers (PDF or text)
                let text = '';
                if (req.file.mimetype === 'application/pdf') {
                    console.log('[API] File is a PDF. Parsing text...');
                    text = await pdfService.extractTextFromBuffer(fileBuffer);
                } else if (req.file.mimetype.startsWith('text/')) {
                    console.log('[API] File is a plain text file.');
                    text = fileBuffer.toString('utf-8');
                }

                if (text) {
                    console.log('[API] Running AI metadata extraction...');
                    const aiMeta = await aiService.extractMetadataFromText(text);
                    responseMetadata = { ...responseMetadata, ...aiMeta, title: aiMeta.title };
                    
                    await query(
                        `INSERT INTO paper (cid, title, journal, year, keywords, authors, project_id, is_encrypted, lit_token_id) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (cid) DO NOTHING`,
                        [commP, aiMeta.title, aiMeta.journal, aiMeta.year, aiMeta.keywords, aiMeta.authors, responseMetadata.projectId, isEncryptedBool, responseMetadata.litTokenId]
                    );
                } else {
                    console.log(`[API] Unencrypted file type '${req.file.mimetype}' not parsable. Saving with filename as title.`);
                    responseMetadata.title = req.file.originalname;
                    await query(
                        `INSERT INTO paper (cid, title, project_id, is_encrypted, lit_token_id) 
                         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid) DO NOTHING`,
                        [commP, responseMetadata.title, responseMetadata.projectId, isEncryptedBool, responseMetadata.litTokenId]
                    );
                }
            }
            console.log(`[DB] Saved paper metadata for CommP: ${commP}`);

        } else if (dataType === 'experiment' || dataType === 'analysis') {
            if (!manualTitle) throw new Error(`A title is required for ${dataType} data.`);
            responseMetadata.title = manualTitle;
            const targetTable = dataType;

            // --- MODIFIED: Insert encryption metadata for experiments and analyses ---
            await query(
                `INSERT INTO ${targetTable} (cid, title, project_id, is_encrypted, lit_token_id) 
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid) DO NOTHING`,
                [commP, responseMetadata.title, responseMetadata.projectId, isEncryptedBool, responseMetadata.litTokenId]
            );
            console.log(`[DB] Saved ${dataType} data for CommP: ${commP}`);

        } else {
            return res.status(200).json({
                rootCID: commP
            });
        }
        
        // Return a unified response containing the new metadata
        return res.status(200).json({
            message: `${dataType.charAt(0).toUpperCase() + dataType.slice(1)} uploaded successfully!`,
            rootCID: commP,
            title: responseMetadata.title,
            projectId: responseMetadata.projectId,
            isEncrypted: isEncryptedBool,
            litTokenId: responseMetadata.litTokenId,
        });

    } catch (error) {
        console.error(`[API ERROR] in processAndUploadHandler:`, error);
        next(error);
    } finally {
        fs.unlink(tempFilePath, (err) => {
            if (err) console.error("Error deleting temp file:", err);
        });
    }
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