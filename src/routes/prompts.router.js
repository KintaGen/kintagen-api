// src/routes/prompts.router.js
import { Router } from 'express';
import {
  createPromptHandler,
  getPromptHandler,
  listPromptsHandler,
} from '../controllers/prompts.controller.js';

const router = Router();

router.post('/prompts', createPromptHandler);
router.get('/prompts/:id', getPromptHandler);
router.get('/prompts', listPromptsHandler);

export default router;
