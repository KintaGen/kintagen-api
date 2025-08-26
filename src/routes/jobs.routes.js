// src/routes/jobs.routes.js
import express from 'express';
import {
  enqueueLd50, enqueueGcms, enqueueNmr,
  enqueueFlowLog, enqueuePdfExtract,
  getJobStatus, schedulePublisher
} from '../controllers/jobs.controller.js';

const router = express.Router();

router.post('/ld50',        enqueueLd50);
router.post('/gcms',        enqueueGcms);
router.post('/nmr',         enqueueNmr);
router.post('/flow-log',    enqueueFlowLog);
router.post('/pdf-extract', enqueuePdfExtract);

router.post('/publisher/schedule', schedulePublisher); 
router.get('/:id', getJobStatus);

export default router;
