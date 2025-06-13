// --- 1. IMPORTS ---
const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
require('dotenv').config(); // This loads the .env file
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
// --- 2. SETUP ---
const app = express();
const port = 3001; // The port our backend server will run on

// --- 3. MIDDLEWARE ---
// This allows your React app (on port 3000) to communicate with this server (on port 3001)
app.use(cors());
// This allows the server to parse incoming JSON data from the request body
app.use(express.json());

// --- 4. OPENAI CLIENT CONFIGURATION ---
// Check if the API key is present
if (!process.env.MOSAIA_HTTP_API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY is not set in the .env file.');
    process.exit(1); // Stop the server if the key is missing
}
// Helper function to run external scripts as a promise
function runScript(command, args, options = {}) {
    // The 'options' object can now include 'cwd' to set the working directory
    return new Promise((resolve, reject) => {
      console.log(`Spawning: ${command} ${args.join(' ')}`);
      const process = spawn(command, args, options);
  
      let stdout = '';
      let stderr = '';
  
      process.stdout.on('data', (data) => {
        console.log(`[${command} stdout]: ${data}`);
        stdout += data.toString();
      });
  
      process.stderr.on('data', (data) => {
        console.error(`[${command} stderr]: ${data}`);
        stderr += data.toString();
      });
  
      process.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`Process ${command} exited with code ${code}\n${stderr}`));
        }
        resolve(stdout);
      });
  
      process.on('error', (err) => {
        reject(err);
      });
    });
  }
const openai = new OpenAI({
    baseURL: 'https://api.mosaia.ai/v1/agent',
    apiKey: process.env.MOSAIA_HTTP_API_KEY, // Securely loads the key from your .env file
});

app.post('/api/chat', async (req, res) => {
    try {
        // Get the conversation history from the frontend's request
        const { messages,filecoinContext } = req.body;
        console.log(messages)
        // Basic validation: ensure messages exist and is an array
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Invalid request: "messages" array is required.' });
        }

        // --- CONTEXT INJECTION (Future Enhancement) ---
        // This is where you would implement the logic to fetch content from Filecoin (FilCDN).
        // For now, we are just passing the conversation history, but later you would:
        // 1. Get the latest user prompt from `messages`.
        // 2. Use it to search your verified documents (e.g., from a vector database).
        // 3. Fetch the relevant document content from its CID on Filecoin.
        // 4. Inject that content into the system prompt below to give the AI a knowledge base.

        // Add our custom system prompt to guide the AI's behavior
        let contentMessages = messages.filter(message => message.sender != "ai");
        contentMessages = contentMessages.map(message => {
            return({
                role: "user",
                content: message.text
            })
        });
        const fullMessages = [
            {
                role: "user",
                content: `You are "Project Kintagen," a highly intelligent research assistant for a biochemistry lab. Your knowledge base consists of verified scientific papers and experimental data. Your goal is to help researchers by answering questions accurately based on this provided context. Be precise, scientific, and cite the source if possible by showing its DOI and authors. The current context is: ${filecoinContext}`
            },
            ...contentMessages
        ];
        console.log(fullMessages)
        console.log('Sending request to Mosaia API...');

        // Call the DeepSeek API using the OpenAI SDK
        const completion = await openai.chat.completions.create({
            model: "6845cac0d8955e09bf51f446",
            messages: fullMessages,
        });

        // Send the AI's reply back to the frontend
        res.json({ reply: completion.choices[0].message.content });

    } catch (error) {
        // Robust error handling
        console.error('Error calling DeepSeek API:', error.message);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});


app.post('/api/analyze-nmr', async (req, res) => {
    console.log('Received request to /api/analyze-nmr');
    
    // 1. Get the path to the NMR data from the request body
    const { dataPath } = req.body;
    if (!dataPath) {
        return res.status(400).json({ success: false, error: 'Request body must include "dataPath".' });
    }

    // 2. Define paths and create a unique output directory for this run
    // This prevents multiple analyses from overwriting each other's results.
    const r_script_path = path.join(__dirname, 'scripts', 'run_batman.R');
    const outputDir = path.join(__dirname, 'results', `run_${Date.now()}`);

    try {
        // Create the directory. The { recursive: true } option ensures it doesn't
        // error if parent directories don't exist.
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`Created output directory: ${outputDir}`);

        // 3. Define the command, arguments, and options for the script
        const command = 'Rscript';
        const args = [
            r_script_path,
            dataPath // This is the argument your R script expects
        ];
        // The `cwd` option sets the working directory for the script.
        // Your R script uses getwd(), so this is how we tell it where to save files.
        const options = { cwd: outputDir };

        // 4. Execute the script using your helper function
        console.log('Starting R script execution...');
        const scriptOutputLog = await runScript(command, args, options);

        // 5. If the script succeeds, send a success response
        res.json({
            success: true,
            message: 'BATMAN analysis completed successfully.',
            outputDirectory: outputDir, // Let the client know where the results are
            log: scriptOutputLog,     // Include the stdout from the R script
        });

    } catch (error) {
        // 6. If the script fails, send a detailed error response
        console.error('--- R SCRIPT EXECUTION FAILED ---');
        console.error(error);
        console.error('---------------------------------');
        res.status(500).json({
            success: false,
            message: 'An error occurred during R script execution.',
            error: error.message, // Provide the specific error message
            outputDirectory: outputDir, // Still useful for debugging
        });
    }
});
app.post('/api/analyze-ld50', async (req, res) => {
    console.log('Received request to /api/analyze-ld50');
    
    const { dataUrl } = req.body;
    if (!dataUrl) {
        return res.status(400).json({ success: false, error: 'Request body must include "dataUrl".' });
    }

    const r_script_path = path.join(__dirname, 'scripts', 'ld50_analysis.R');
    // We still create a temp output directory for the R script to work in
    const outputDir = path.join(__dirname, 'results', `ld50_run_${Date.now()}`);

    try {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`LD50 Analysis: Created temp output directory: ${outputDir}`);

        const command = 'Rscript';
        const args = [r_script_path, dataUrl];
        const options = { cwd: outputDir }; // Run R script inside the new unique directory

        console.log(`Starting LD50 R script with URL: ${dataUrl}`);
        const scriptOutputJson = await runScript(command, args, options);

        const results = JSON.parse(scriptOutputJson);

        // --- MODIFICATION START ---

        // Check if the upload was successful by looking for the CID
        if (results.plotUploadError || !results.plotCid) {
             // You can decide how to handle this. For now, we'll log it and continue,
             // but you could also return an error if the upload is critical.
            console.warn('R script warning: Plot upload failed.', results.plotUploadError);
            // Fallback or error out. Let's send an error for clarity.
            throw new Error(`Analysis complete, but plot upload failed: ${results.plotUploadError}`);
        }

        // Construct the public gateway URL for the plot
        const publicPlotUrl = `https://0xcb9e86945ca31e6c3120725bf0385cbad684040c.calibration.filcdn.io/${results.plotCid}`;

        // Send success response with results and the new public plot URL
        res.json({
            success: true,
            message: 'LD50 analysis and plot upload completed successfully.',
            analysis: results,
            plotUrl: publicPlotUrl // Send the new public URL to the frontend
        });

        // --- MODIFICATION END ---

    } catch (error) {
        // ... (error handling remains the same) ...
    } finally {
        // Cleanup the temporary directory
        if (fs.existsSync(outputDir)) {
            fs.rm(outputDir, { recursive: true, force: true }, (err) => {
                if (err) console.error("Error deleting temp directory:", outputDir, err);
            });
        }
    }
});
app.listen(port, () => {
    console.log(`✅ API server is running and listening at http://localhost:${port}`);
});