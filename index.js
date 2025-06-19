// --- 1. IMPORTS ---
const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
require('dotenv').config(); // This loads the .env file
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse'); 
const multer = require('multer');
const Exa = require('exa-js').Exa;

// --- 2. SETUP ---
const app = express();
const port = 3001; // The port our backend server will run on
const upload = multer({ dest: 'uploads/' }); // For handling file uploads

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
// Check if the API key is present
if (!process.env.EXA_API_KEY) {
    console.error('❌ EXA_API_KEY is not set in the .env file.');
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
const exa = new Exa(process.env.EXA_API_KEY);

const openai = new OpenAI({
    baseURL: 'https://api.mosaia.ai/v1/agent',
    apiKey: process.env.MOSAIA_HTTP_API_KEY, // Securely loads the key from your .env file
});
async function generateSearchQueries(topic, n){
    const userPrompt = `I'm writing a research report on ${topic} and need help coming up with diverse search queries.
Please generate a list of ${n} search queries that would be useful for writing a research report on ${topic}. These queries can be in various formats, from simple keywords to more complex phrases. Do not add any formatting or numbering to the queries.`;

    const completion = await getLLMResponse({
        system: 'The user will ask you to help generate some search queries. Respond with only the suggested queries in plain text with no extra formatting, each on its own line.',
        user: userPrompt,
        temperature: 1
    });
    return completion.split('\n').filter(s => s.trim().length > 0).slice(0, n);
}
async function getSearchResults(queries, linksPerQuery=10){
    let results = [];
    for (const query of queries){
        const searchResponse = await exa.searchAndContents(query, {
            numResults: linksPerQuery
        });
        results.push(...searchResponse.results);
    }
    return results;
}
async function synthesizeReport(topic, searchContents, contentSlice = 750){
    const inputData = searchContents.map(item => `--START ITEM--\nURL: ${item.url}\nCONTENT: ${item.text.slice(0, contentSlice)}\n--END ITEM--\n`).join('');
    return await getLLMResponse({
        system: 'You are a helpful research assistant. Write a report according to the user\'s instructions.',
        user: 'Input Data:\n' + inputData + `Write a two paragraph research report about ${topic} based on the provided information. Include as many sources as possible. Provide citations in the text using footnote notation ([#]). First provide the report, followed by a single "References" section that lists all the URLs used, in the format [#] <url>.`,
        //model: 'gpt-4' //want a better report? use gpt-4 (but it costs more)
    });
}
//const openai = exa.wrap(openAi)
async function getLLMResponse({system = 'You are "Project Kintagen," a highly intelligent research assistant for a biochemistry lab. Your knowledge base consists of verified scientific papers and experimental data. Your goal is to help researchers by answering questions accurately based on this provided context. Be precise, scientific, and cite the source if possible by showing its DOI and authors.', user = '', temperature = 1, model = '6845cac0d8955e09bf51f446'}){
    const completion = await openai.chat.completions.create({
        model,
        temperature,
        messages: [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ]
    });
    return completion.choices[0].message.content;
}
async function researcher(topic){
    console.log(`Starting research on topic: "${topic}"`);

    const searchQueries = await generateSearchQueries(topic, 10);
    console.log("Generated search queries:", searchQueries);

    const searchResults = await getSearchResults(searchQueries);
    console.log(`Found ${searchResults.length} search results. Here's the first one:`, searchResults[0]);

    console.log("Synthesizing report...");
    const report = await synthesizeReport(topic, searchResults);

    return report;
}
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

        //Add our custom system prompt to guide the AI's behavior
        let contentMessages = messages.filter(message => message.sender != "ai");
        contentMessages = contentMessages.map(message => {
            return({
                role: "user",
                content: message.text
            })
        });
        /*
        // Search with full text content
        const resultWithText = await exa.searchAndContents(
            contentMessages[contentMessages.length - 1].content,
            {
            text: true,
            numResults: 2
            }
        );
        const fullMessages = [
            {
                role: "system",
                content: `You are "Project Kintagen," a highly intelligent research assistant for a biochemistry lab. Your knowledge base consists of verified scientific papers and experimental data. Your goal is to help researchers by answering questions accurately based on this provided context. Be precise, scientific, and cite the source if possible by showing its DOI and authors.`
            },
            {
                role: "user",
                content: `The current context is: ${filecoinContext}`
            },
            ...contentMessages
        ];
        console.log('Sending request to Mosaia API...');

        // Call the DeepSeek API using the OpenAI SDK
        const completion = await openai.chat.completions.create({
            model: "6845cac0d8955e09bf51f446",
            messages: fullMessages,
        });
        */
        const result = await researcher(`Solve: ${contentMessages[contentMessages.length - 1].content}`);
        // Send the AI's reply back to the frontend
        res.json({ reply: result });

    } catch (error) {
        // Robust error handling
        console.error('Error calling DeepSeek API:', error.message);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});
/**
 * [NEW] The main paper ingestion endpoint.
 * This route orchestrates the entire process:
 * 1. Receives a PDF from the user.
 * 2. Extracts text from the PDF.
 * 3. Uses AI to generate structured metadata (title, journal, year, keywords).
 * 4. Calls the external `/api/upload/paper` endpoint with the original file and AI-generated metadata.
 * 5. Proxies the final response back to the user.
 */
app.post('/api/process-and-upload-paper', upload.single('pdfFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No PDF file provided.' });
    }

    try {
        console.log(`Processing file: ${req.file.originalname}`);

        // --- STEP 1: Extract Text from the Uploaded PDF ---
        console.log('Step 1: Extracting text from PDF...');
        const dataBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdf(dataBuffer);
        const contextText = pdfData.text; // Truncate for AI efficiency
        // --- STEP 2: Use AI to Generate Structured Metadata ---
        console.log('Step 2: Generating metadata with AI...');
        const prompt = `
            Analyze the text from a scientific paper. Your task is to extract the specified fields.
            Respond ONLY with a single, valid JSON object. Do not include any explanations or markdown.
            
            The fields to extract are:
            - "title": The main title of the paper.
            - "journal": The name of the journal.
            - "year": The 4-digit publication year as a string.
            - "keywords": An array of 3-5 relevant keywords as strings (e.g., ["spectroscopy", "nmr"]).
            - "doi": the doi of the article
            - "authors": An array of authors of the article
            If a field cannot be found, use an empty string "" or an empty array [] for keywords.

            --- TEXT ---
            ${contextText}
        `;
        const completion = await openai.chat.completions.create({
            model: "6845cac0d8955e09bf51f446",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
        });
        const aiResponseText = completion.choices[0].message.content;
        console.log('Raw AI response received:', aiResponseText);

        try {
            // Find the start of the JSON object
            const jsonStartIndex = aiResponseText.indexOf('{');
            // Find the end of the JSON object
            const jsonEndIndex = aiResponseText.lastIndexOf('}');

            if (jsonStartIndex === -1 || jsonEndIndex === -1) {
                throw new Error("AI response did not contain a valid JSON object.");
            }
            
            // Extract the JSON string from between the braces
            const jsonString = aiResponseText.substring(jsonStartIndex, jsonEndIndex + 1);

            // Now, parse the clean JSON string
            structuredData = JSON.parse(jsonString);
            
        } catch (e) {
            console.error("Failed to parse AI response as JSON. Raw response was:", aiResponseText);
            throw new Error("The AI model did not return valid JSON, even after cleaning. See server logs for details.");
        }
        // --- END: Robust JSON Parsing ---

        console.log('Successfully parsed AI-generated metadata:', structuredData);

        // --- STEP 3: Call the External `/api/upload/paper` Endpoint ---
        console.log('Step 3: Calling external API to upload paper...');
        
        // Create a new FormData object for the external API call
        const externalApiFormData = new FormData();
        
        // Append static fields
        externalApiFormData.append('serviceUrl', 'https://caliberation-pdp.infrafolio.com'); // Replace with your actual values
        externalApiFormData.append('serviceName', 'pdpricardo');
        externalApiFormData.append('proofSetID', '318');
        
        // Append AI-generated fields, ensuring they are in the correct format
        externalApiFormData.append('title', structuredData.title || '');
        externalApiFormData.append('journal', structuredData.journal || '');
        externalApiFormData.append('year', structuredData.year || new Date().getFullYear().toString());
        externalApiFormData.append('keywords', (structuredData.keywords || []).join(', '));
        
        // Append the original file
        const fileBlob = new Blob([dataBuffer], { type: req.file.mimetype });
        externalApiFormData.append('file', fileBlob, req.file.originalname);

        // Make the final request to the external API
        const finalResponse = await fetch('https://salty-eyes-visit.loca.lt/api/upload/paper', {
            method: 'POST',
            body: externalApiFormData,
        });

        // --- STEP 4: Proxy the Response Back to the Client ---
        const responseData = await finalResponse.json();
        
        if (!finalResponse.ok) {
            // If the external API returned an error, forward it
            console.error('External API returned an error:', responseData);
            return res.status(finalResponse.status).json(responseData);
        }

        console.log('Orchestration successful. Final response:', responseData);
        res.status(200).json(responseData); // Send the success response from the external API

    } catch (error) {
        console.error('Error in orchestration route:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        // IMPORTANT: Clean up the temporary file created by multer
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error("Error deleting temp file:", err);
            });
        }
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