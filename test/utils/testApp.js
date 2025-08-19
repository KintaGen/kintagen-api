// test/utils/testApp.js
import express from 'express';
import promptsRouter from '../../src/routes/prompts.router.js';

export function makeTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', promptsRouter);
  return app;
}
