// src/routes/api.js
import express from 'express';
import multer from 'multer';

// Import all your new controller handlers
import { chatHandler } from '../controllers/chat.controller.js';
import { processAndUploadPaperHandler } from '../controllers/paper.controller.js';
import { nmrAnalysisHandler, ld50AnalysisHandler, gcmsAnalysisHandler } from '../controllers/analysis.controller.js';

// You also had these, keep them
import { 
    uploadAndAddGenomeHandler, 
    uploadAndAddSpectrumHandler 
} from '../controllers/upload.controller.js';
import { 
    queryDataHandler, 
    getDataByIDHandler, 
    listCIDsHandler 
} from '../controllers/data.controller.js';

import { 
    listProjectsHandler,
    createProjectHandler
} from '../controllers/project.controller.js';

import { getDocumentContentHandler } from '../controllers/document.controller.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });
const memoryUpload = multer({ storage: multer.memoryStorage() }); // For handlers expecting a buffer

// --- Chat Routes ---
router.post('/chat', chatHandler);

// --- Processing & Upload Routes ---
router.post('/process-and-upload-paper', upload.single('pdfFile'), processAndUploadPaperHandler);

// These were pre-existing and use memory storage
router.post('/upload/genome', memoryUpload.single('file'), uploadAndAddGenomeHandler);
router.post('/upload/spectrum', memoryUpload.single('file'), uploadAndAddSpectrumHandler);

// --- Analysis Routes ---
router.post('/analyze-nmr', nmrAnalysisHandler);
router.post('/analyze-ld50', ld50AnalysisHandler);
router.post('/analyze-gcms', gcmsAnalysisHandler);

// --- Generic Data Query Routes ---
router.get('/data/:type', queryDataHandler);
router.get('/data/:type/:cid', getDataByIDHandler);
router.get('/cids', listCIDsHandler);


// --- Project Management Endpoints ---
router.get('/projects', listProjectsHandler);
router.post('/projects', createProjectHandler);
// ---  Document Content Endpoint ---
router.get('/document-content/:cid', getDocumentContentHandler);

export default router;