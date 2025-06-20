// src/controllers/paper.controller.js
import fs from 'fs';
import { extractTextFromFile } from '../services/pdf.service.js';
import { extractMetadataFromText } from '../services/ai.service.js';

// IMPORTANT: This assumes 'uploadAndAddPaperHandler' is imported from your other controller.
// It might be cleaner to move the database/synapse logic into a service as well,
// but for now, we will call the other handler as requested.
import { uploadAndAddPaperHandler } from './upload.controller.js';

export async function processAndUploadPaperHandler(req, res, next) {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No PDF file provided.' });
    }

    const pdfFilePath = req.file.path;

    try {
        console.log(`Processing file: ${req.file.originalname}`);

        const contextText = await extractTextFromFile(pdfFilePath);
        const structuredData = await extractMetadataFromText(contextText);
        
        console.log('Successfully parsed AI-generated metadata:', structuredData);
        
        // Prepare the request for the final handler
        req.body.title = structuredData.title || '';
        req.body.journal = structuredData.journal || '';
        req.body.year = structuredData.year || '';
        req.body.keywords = (structuredData.keywords || []).join(', ');
        req.body.authors = (structuredData.authors || []).join(', ');
        req.file.buffer = fs.readFileSync(pdfFilePath);

        // Pass control to the handler that talks to the DB and Synapse
        return uploadAndAddPaperHandler(req, res, next);

    } catch (error) {
        console.error('Error in paper processing orchestration:', error);
        next(error);
    } finally {
        // IMPORTANT: Clean up the temporary file created by multer
        fs.unlink(pdfFilePath, (err) => {
            if (err) console.error("Error deleting temp file:", err);
        });
    }
}