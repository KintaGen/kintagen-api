// src/controllers/document.controller.js
import { extractTextFromBuffer } from '../services/pdf.service.js';
import { query } from '../services/db.js';
import fetch from 'node-fetch';

const buildFilcdnUrl = (cid) =>
  `https://0xcdb8cc9323852ab3bed33f6c54a7e0c15d555353.calibration.filcdn.io/${cid}`;

const MOCK_DOCS = process.env.MOCK_MODE === 'true';

export async function getDocumentContentHandler(req, res, next) {
  try {
    const { cid } = req.params;
    if (!cid) return res.status(400).json({ error: 'A CID is required.' });

    if (MOCK_DOCS) {
      return res.status(200).json({
        isRaw: false,
        content: `Mock content for CID ${cid}.`,
        mimetype: 'text/plain',
      });
    }

    console.log(`[Content Fetch] Request for CID: ${cid}`);

    // 1. Check our database for the file's metadata first
    const metaResult = await query(
      `
      SELECT 'paper' as type, is_encrypted, lit_token_id FROM paper WHERE cid = $1
      UNION ALL
      SELECT 'experiment' as type, is_encrypted, lit_token_id FROM experiment WHERE cid = $1
      UNION ALL
      SELECT 'analysis' as type, is_encrypted, lit_token_id FROM analysis WHERE cid = $1
      UNION ALL
      SELECT 'genome' as type, is_encrypted, lit_token_id FROM genome WHERE cid = $1
      UNION ALL
      SELECT 'spectrum' as type, is_encrypted, lit_token_id FROM spectrum WHERE cid = $1
      `,
      [cid]
    );

    if (metaResult.rows.length === 0) {
      return res.status(404).json({ error: 'File metadata not found in database.' });
    }
    const metadata = metaResult.rows[0];

    // 2. Fetch the raw file content from the gateway
    const url = buildFilcdnUrl(cid);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch CID ${cid} from gateway.`);
    const fileBuffer = Buffer.from(await response.arrayBuffer());

    // 3. If encrypted, return raw (Base64) for client-side decryption
    if (metadata.is_encrypted) {
      console.log(`[Content Fetch] CID ${cid} is encrypted. Returning raw content for client-side decryption.`);
      const base64Content = fileBuffer.toString('base64');
      const mimetype = response.headers.get('content-type') || 'application/octet-stream';
      return res.status(200).json({
        isRaw: true,
        content: base64Content,
        mimetype,
      });
    }

    // 4. If not encrypted, parse as PDF or text
    let textContent = '';
    const magic = fileBuffer.toString('utf8', 0, 4);
    if (magic === '%PDF') {
      console.log('[Content Fetch] Unencrypted content is a PDF. Parsing...');
      textContent = await extractTextFromBuffer(fileBuffer);
    } else {
      console.log('[Content Fetch] Unencrypted content is a text-based file.');
      textContent = fileBuffer.toString('utf-8');
    }

    return res.status(200).json({
      isRaw: false,
      content: textContent,
      mimetype: 'text/plain',
    });
  } catch (error) {
    console.error(`[API ERROR] in getDocumentContentHandler for CID ${req.params.cid}:`, error);
    next(error);
  }
}
