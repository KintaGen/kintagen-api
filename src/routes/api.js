// src/routes/api.js
import express from 'express';
import multer from 'multer';

// --- CONTROLLERS ---
import { chatHandler } from '../controllers/chat.controller.js';
import { nmrAnalysisHandler, ld50AnalysisHandler, gcmsDifferentialHandler,gcmsProfilingHandler } from '../controllers/analysis.controller.js';
import { queryDataHandler, getDataByIDHandler, listCIDsHandler } from '../controllers/data.controller.js';
import {
  processAndUploadHandler,
  uploadAndAddGenomeHandler,
  uploadAndAddSpectrumHandler,
} from '../controllers/upload.controller.js';
import {
  listProjectsHandler,
  createProjectHandler,
  mintProjectNftHandler,
} from '../controllers/project.controller.js';
import {
  getNftStoryHandler,
  addLogEntryHandler,
} from '../controllers/nft.controller.js';
import { getDocumentContentHandler } from '../controllers/document.controller.js';

// FIXED: import the actual exported names from prompts.controller
import {
  createPromptHandler,
  getPromptHandler,
  listPromptsHandler,
} from '../controllers/prompts.controller.js';

const router = express.Router();

// Multer instances
const uploadToDisk = multer({ dest: 'uploads/' });
const uploadToMemory = multer({ storage: multer.memoryStorage() });

// --- Data Ingestion & Processing ---
router.post('/upload', uploadToDisk.single('file'), processAndUploadHandler);
router.post('/upload/genome', uploadToMemory.single('file'), uploadAndAddGenomeHandler);
router.post('/upload/spectrum', uploadToMemory.single('file'), uploadAndAddSpectrumHandler);

// --- Chat & AI Endpoints ---
router.post('/chat', chatHandler);

// --- Project & NFT Management ---
router.get('/projects', listProjectsHandler);
router.post('/projects', createProjectHandler);
router.post('/projects/:id/mint', mintProjectNftHandler);
router.post('/projects/:projectId/log', addLogEntryHandler);
router.get('/nfts/:id/story', getNftStoryHandler);

// --- Data Querying ---
router.get('/data/:type', queryDataHandler);
router.get('/data/:type/:cid', getDataByIDHandler);
router.get('/cids', listCIDsHandler);

// --- Raw Content Fetching ---
router.get('/document-content/:cid', getDocumentContentHandler);

// --- Analysis Tools (R Scripts) ---
router.post('/analyze/nmr', nmrAnalysisHandler);
router.post('/analyze/ld50', ld50AnalysisHandler);
router.post('/analyze/gcms-differential', gcmsDifferentialHandler);
router.post('/analyze/gcms-profiling', gcmsProfilingHandler);   

export default router;
