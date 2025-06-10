// --- 1. IMPORTS ---
const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
require('dotenv').config(); // This loads the .env file

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

const openai = new OpenAI({
    baseURL: 'https://api.mosaia.ai/v1/agent',
    apiKey: process.env.MOSAIA_HTTP_API_KEY, // Securely loads the key from your .env file
});

// --- 5. API ROUTE DEFINITION ---
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

// --- 6. START THE SERVER ---
app.listen(port, () => {
    console.log(`✅ API server is running and listening at http://localhost:${port}`);
});