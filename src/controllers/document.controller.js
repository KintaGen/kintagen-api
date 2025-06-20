// src/controllers/document.controller.js
import { extractTextFromBuffer } from '../services/pdf.service.js';
import fetch from 'node-fetch'; // You might need to install this: pnpm add node-fetch

const buildFilcdnUrl = (cid) => `https://0xcdb8cc9323852ab3bed33f6c54a7e0c15d555353.calibration.filcdn.io/${cid}`;

export async function getDocumentContentHandler(req, res, next) {
    try {
        const { cid } = req.params;
        if (!cid) {
            return res.status(400).json({ error: 'A CID parameter is required.' });
        }

        console.log(`[Content Fetch] Received request for CID: ${cid}`);
        const url = buildFilcdnUrl(cid);
        
        // 1. Fetch the raw PDF from FilCDN
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch file from FilCDN. Status: ${response.status}`);
        }
        
        // 2. Get the content as an ArrayBuffer, then convert to a Node.js Buffer
        const arrayBuffer = await response.arrayBuffer();
        const pdfBuffer = Buffer.from(arrayBuffer);

        // 3. Use our service to parse the text from the buffer
        console.log(`[Content Fetch] Parsing PDF buffer of size ${pdfBuffer.length}...`);
        const textContent = await extractTextFromBuffer(pdfBuffer);
        console.log(`[Content Fetch] Extracted ${textContent.length} characters.`);

        // 4. Send the extracted text back to the client
        res.status(200).json({ text: textContent });

    } catch (error) {
        console.error(`[API ERROR] in getDocumentContentHandler for CID ${req.params.cid}:`, error);
        next(error);
    }
}