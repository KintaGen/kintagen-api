// src/server.js
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import apiRoutes from './routes/api.js';

const isTrueish = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());
const MOCK_MODE = isTrueish(process.env.MOCK_MODE);

// --- CONFIGURATION & SETUP ---
const app = express();
const port = 3001;

if (!MOCK_MODE) {
  if (!process.env.MOSAIA_HTTP_API_KEY || !process.env.EXA_API_KEY) {
    console.error('❌ MOSAIA_HTTP_API_KEY and EXA_API_KEY must be set in the .env file.');
    process.exit(1);
  }
} else {
  console.log('⚠️ MOCK_MODE is ON: skipping external API key checks and using stubbed services.');
}

// --- GLOBAL MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- ROUTES ---
app.use('/api', apiRoutes);

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
  console.error('--- UNHANDLED ERROR ---');
  console.error(err);
  console.error('-----------------------');
  const status = err.statusCode || 500;
  const message = err.message || 'An internal server error occurred.';
  res.status(status).json({
    success: false,
    error: message,
    ...(err.outputDirectory && { outputDirectory: err.outputDirectory }),
  });
});

// --- START SERVER ---
app.listen(port, () => {
  console.log(`✅ API server is running and listening at http://localhost:${port}`);
  if (MOCK_MODE) {
    console.log('🧪 MOCK_MODE active — R jobs stubbed, AI calls mocked, job logs API v5-safe.');
  }
});
