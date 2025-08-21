// src/services/ai.service.js
import OpenAI from 'openai';
import Exa from 'exa-js';

// Initialize clients once
const openai = new OpenAI({
    baseURL: 'https://api.mosaia.ai/v1/agent',
    apiKey: process.env.MOSAIA_HTTP_API_KEY,
});

const exa = new Exa(process.env.EXA_API_KEY);

/**
 * A generic function to get a response from the configured LLM.
 */
async function getLLMResponse({system, user, temperature = 1, model = '6845cac0d8955e09bf51f446'}) {
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

/**
 * Generates search queries for a given topic using an LLM.
 */
export async function generateSearchQueries(topic, n = 10) {
    const userPrompt = `I'm writing a research report on ${topic} and need help coming up with diverse search queries. Please generate a list of ${n} search queries. Do not add any formatting or numbering.`;
    const completion = await getLLMResponse({
        system: 'Respond with only the suggested search queries in plain text, each on its own line.',
        user: userPrompt,
        temperature: 1
    });
    return completion.split('\n').filter(s => s.trim().length > 0).slice(0, n);
}

/**
 * Uses Exa to get search results for a list of queries.
 */
export async function getSearchResults(queries, linksPerQuery = 10) {
    let results = [];
    for (const query of queries) {
        const searchResponse = await exa.searchAndContents(query, {
            numResults: linksPerQuery
        });
        results.push(...searchResponse.results);
    }
    return results;
}

/**
 * Synthesizes a research report from search results using an LLM.
 */
export async function synthesizeReport(topic, searchContents, contentSlice = 750) {
    const inputData = searchContents.map(item => `--START ITEM--\nURL: ${item.url}\nCONTENT: ${item.text.slice(0, contentSlice)}\n--END ITEM--\n`).join('');
    return await getLLMResponse({
        system: 'You are a helpful research assistant. Write a report according to the user\'s instructions.',
        user: `Input Data:\n${inputData}\n\nWrite a two paragraph research report about ${topic} based on the provided information. Include as many sources as possible. Provide citations in the text using footnote notation ([#]). First provide the report, followed by a single "References" section that lists all the URLs used, in the format [#] <url>.`,
    });
}

/**
 * Extracts structured metadata from a paper's text using an LLM.
 */
export async function extractMetadataFromText(text) {
    const prompt = `
        Analyze the text from a scientific paper. Your task is to extract the specified fields.
        Respond ONLY with a single, valid JSON object. Do not include any explanations or markdown.
        
        The fields to extract are:
        - "title": The main title of the paper.
        - "journal": The name of the journal.
        - "year": The 4-digit publication year as a string.
        - "keywords": An array of 3-5 relevant keywords as strings.
        - "doi": the doi of the article
        - "authors": An array of authors of the article.
        If a field cannot be found, use an empty string "" or an empty array [].

        --- TEXT ---
        ${text.substring(0, 15000)}
    `;
    const aiResponseText = await getLLMResponse({
        system: 'You are a JSON extraction machine.',
        user: prompt,
        temperature: 0.1
    });

    console.log('Raw AI response received:', aiResponseText);
    const jsonStartIndex = aiResponseText.indexOf('{');
    const jsonEndIndex = aiResponseText.lastIndexOf('}');
    if (jsonStartIndex === -1 || jsonEndIndex === -1) {
        throw new Error("AI response did not contain a valid JSON object.");
    }
    const jsonString = aiResponseText.substring(jsonStartIndex, jsonEndIndex + 1);
    return JSON.parse(jsonString);
}