// src/controllers/chat.controller.js
import { generateSearchQueries, getSearchResults, synthesizeReport } from '../services/ai.service.js';

async function researcher(topic,context) {
    console.log(`Starting research on topic: "${topic}"`);
    const searchQueries = await generateSearchQueries(topic);
    console.log("Generated search queries:", searchQueries);
    const searchResults = await getSearchResults(searchQueries);
    console.log(`Found ${searchResults.length} search results.`);
    console.log("Synthesizing report...");
    const report = await synthesizeReport(topic, searchResults);
    return report;
}

export async function chatHandler(req, res, next) {
    try {
        const { messages,filecoinContext } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Invalid request: "messages" array is required.' });
        }
        
        const lastUserMessage = messages[messages.length - 1].text;
        const result = await researcher(`Solve: ${lastUserMessage}; Context: ${filecoinContext}`);
        
        res.json({ reply: result });
    } catch (error) {
        console.error('Error in chat handler:', error.message);
        next(error); // Pass error to the global error handler
    }
}