// src/server.js
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import apiRoutes from './routes/api.js';

// --- CONFIGURATION & SETUP ---
const app = express();
const port = 3001;

// Check for necessary API keys on startup
if (!process.env.MOSAIA_HTTP_API_KEY || !process.env.EXA_API_KEY) {
    console.error('❌ MOSAIA_HTTP_API_KEY and EXA_API_KEY must be set in the .env file.');
    process.exit(1);
}

// --- GLOBAL MIDDLEWARE ---
app.use(cors());      // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Allow the server to parse JSON request bodies

// --- ROUTES ---
// All API routes are now managed in a separate file
app.use('/api', apiRoutes);

// --- GLOBAL ERROR HANDLER ---
// This will catch any errors passed by next(error) in your controllers
app.use((err, req, res, next) => {
    console.error('--- UNHANDLED ERROR ---');
    console.error(err);
    console.error('-----------------------');
    const status = err.statusCode || 500;
    const message = err.message || 'An internal server error occurred.';
    res.status(status).json({
        success: false,
        error: message,
        // Include outputDirectory for debugging R script failures
        ...(err.outputDirectory && { outputDirectory: err.outputDirectory }),
    });
});

// --- START SERVER ---
app.listen(port, () => {
    console.log(`✅ API server is running and listening at http://localhost:${port}`);
});