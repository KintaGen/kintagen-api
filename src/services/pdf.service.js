// src/services/pdf.service.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

/**
 * Extracts text content from a PDF file path.
 * @param {string} filePath The path to the PDF file.
 * @returns {Promise<string>} The extracted text content.
 */
export async function extractTextFromFile(filePath) {
    const pdfData = await pdf(filePath);
    return pdfData.text;
}

/**
 * --- NEW FUNCTION ---
 * Extracts text content from a PDF buffer.
 * @param {Buffer} buffer The PDF file content as a buffer.
 * @returns {Promise<string>} The extracted text content.
 */
export async function extractTextFromBuffer(buffer) {
    const data = await pdf(buffer);
    return data.text;
}