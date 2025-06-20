// src/services/pdf.service.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse'); // Using the robust CJS bridge

/**
 * Extracts text content from a PDF file path.
 * @param {string} filePath The path to the PDF file.
 * @returns {Promise<string>} The extracted text content.
 */
export async function extractTextFromFile(filePath) {
    const pdfData = await pdf(filePath);
    return pdfData.text;
}