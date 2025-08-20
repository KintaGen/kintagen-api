// src/controllers/upload.controller.js
import 'dotenv/config';
import fs from 'fs';
import { mockdb } from '../services/mockdb.js';

const isTrueish = (v) => ['1','true','yes','on'].includes(String(v ?? '').toLowerCase());
const MOCK_MODE = isTrueish(process.env.MOCK_MODE);

// NOTE: we keep imports but guard usage when not mock
let uploadDataFn = null;
if (!MOCK_MODE) {
  const mod = await import('../services/synapse.js');
  uploadDataFn = mod.uploadData;
}

export async function processAndUploadHandler(req, res, next) {
  const { projectId, dataType, title: manualTitle, isEncrypted, litTokenId } = req.body;
  const isEncryptedBool = isEncrypted === 'true';

  if (!req.file || !dataType) {
    return res.status(400).json({ error: 'A file and data type are required.' });
  }

  const tempFilePath = req.file.path;

  try {
    let commP = '';
    let size = 0;

    if (MOCK_MODE) {
      const buf = fs.readFileSync(tempFilePath);
      size = buf.length;
      commP = mockdb.genCid();
    } else {
      const fileBuffer = fs.readFileSync(tempFilePath);
      const uploadResult = await uploadDataFn(fileBuffer);
      commP = uploadResult.commp;
      size = uploadResult.size;
    }

    const responseMetadata = {
      cid: commP,
      projectId: projectId ? Number(projectId) : null,
      title: '',
      isEncrypted: isEncryptedBool,
      litTokenId: litTokenId || null,
      size,
    };

    if (dataType === 'paper') {
      responseMetadata.title = req.file.originalname || 'Uploaded Paper';
      if (MOCK_MODE) {
        mockdb.insert('paper', {
          cid: commP,
          title: responseMetadata.title,
          journal: 'Mock Journal',
          year: 2025,
          keywords: ['mock'],
          authors: ['Mock, A.'],
          project_id: responseMetadata.projectId,
          is_encrypted: isEncryptedBool,
          lit_token_id: responseMetadata.litTokenId,
          created_at: new Date().toISOString(),
        });
      }
    } else if (dataType === 'experiment' || dataType === 'analysis') {
      if (!manualTitle) throw new Error(`A title is required for ${dataType} data.`);
      responseMetadata.title = manualTitle;
      if (MOCK_MODE) {
        mockdb.insert(dataType, {
          cid: commP,
          title: responseMetadata.title,
          description: '',
          instrument: dataType === 'experiment' ? 'GCMS' : null,
          source_cids: dataType === 'analysis' ? [] : null,
          project_id: responseMetadata.projectId,
          is_encrypted: isEncryptedBool,
          lit_token_id: responseMetadata.litTokenId,
          created_at: new Date().toISOString(),
        });
      }
    }

    if (MOCK_MODE) {
      mockdb.upsertFileCid(req.file.originalname || 'uploaded.bin', commP);
    }

    return res.status(200).json(responseMetadata);
  } catch (err) {
    next(err);
  } finally {
    try { fs.unlinkSync(tempFilePath); } catch {}
  }
}

// The other handlers (uploadAndAddGenomeHandler, uploadAndAddSpectrumHandler) — keep your originals or mock similarly if needed.
export async function uploadAndAddGenomeHandler(req, res) {
  if (MOCK_MODE) return res.status(200).json({ ok: true, cid: mockdb.genCid() });
  return res.status(501).json({ error: 'Not implemented in non-mock example' });
}
export async function uploadAndAddSpectrumHandler(req, res) {
  if (MOCK_MODE) return res.status(200).json({ ok: true, cid: mockdb.genCid() });
  return res.status(501).json({ error: 'Not implemented in non-mock example' });
}
