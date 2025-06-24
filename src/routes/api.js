// src/routes/api.js
import express from 'express';
import multer from 'multer';

// --- CONTROLLER IMPORTS ---

// Unified handlers for chat, analysis, and data querying
import { chatHandler } from '../controllers/chat.controller.js';
import { nmrAnalysisHandler, ld50AnalysisHandler, gcmsAnalysisHandler } from '../controllers/analysis.controller.js';
import { queryDataHandler, getDataByIDHandler, listCIDsHandler } from '../controllers/data.controller.js';

// The new, flexible upload handler + legacy handlers
import { 
    processAndUploadHandler,
    uploadAndAddGenomeHandler, 
    uploadAndAddSpectrumHandler 
} from '../controllers/upload.controller.js';

// Handlers for project and NFT management
import { 
    listProjectsHandler,
    createProjectHandler,
    mintProjectNftHandler
} from '../controllers/project.controller.js';
import { 
    getNftStoryHandler,
    addLogEntryHandler
} from '../controllers/nft.controller.js';

// Handler for fetching raw document content
import { getDocumentContentHandler } from '../controllers/document.controller.js';


// --- ROUTER SETUP ---

const router = express.Router();

// Multer instance for uploads that need to be temporarily saved to disk for processing (like PDFs)
const uploadToDisk = multer({ dest: 'uploads/' });

// Multer instance for uploads that can be handled directly in memory as a buffer
const uploadToMemory = multer({ storage: multer.memoryStorage() });


// --- API ROUTES ---

// --- Data Ingestion & Processing ---
// The primary, flexible route for uploading papers and experiments.
router.post('/upload', uploadToDisk.single('file'), processAndUploadHandler);

// Legacy routes for specific data types that expect a buffer in memory.
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
// Fetches a file from FilCDN by CID and returns its parsed text content.
router.get('/document-content/:cid', getDocumentContentHandler);

// --- Analysis Tools (R Scripts) ---
router.post('/analyze-nmr', nmrAnalysisHandler);
router.post('/analyze-ld50', ld50AnalysisHandler);
router.post('/analyze-gcms', gcmsAnalysisHandler);


export default router;