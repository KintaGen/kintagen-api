// src/services/ai.service.js
import OpenAI from 'openai';
import Exa from 'exa-js';
import config from '../config.js';

// instantiate clients (safe: we guard actual usage by config.mocks)
const openai = new OpenAI({
  baseURL: 'https://api.mosaia.ai/v1/agent',
  apiKey: process.env.MOSAIA_HTTP_API_KEY,
});

const exa = new Exa(process.env.EXA_API_KEY);

/**
 * Low-level LLM call (OpenAI-compatible endpoint).
 */
async function getLLMResponse({
  system,
  user,
  temperature = 1,
  model = '6845cac0d8955e09bf51f446',
}) {
  if (config.mocks.ai) return 'MOCK_LLM_RESPONSE';
  const completion = await openai.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return completion.choices?.[0]?.message?.content ?? '';
}

/**
 * Generate search queries from a topic or prompt (string).
 */
export async function generateSearchQueries(topicOrPrompt, n = 10) {
  if (config.mocks.ai) {
    return Array.from({ length: n }, (_, i) => `mock query ${i + 1} for ${topicOrPrompt}`);
  }
  const userPrompt = `I'm writing a research report on "${topicOrPrompt}" and need diverse search queries. Generate ${n} queries. No numbering, one per line.`;
  const text = await getLLMResponse({
    system: 'Return only the queries, each on its own line. No extra text.',
    user: userPrompt,
    temperature: 1,
  });
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, n);
}

/**
 * Fetch search results for a list of queries using Exa.
 */
export async function getSearchResults(queries, linksPerQuery = 10) {
  if (config.mocks.search) {
    return queries.flatMap((q, idx) =>
      Array.from({ length: Math.min(linksPerQuery, 2) }, (_, j) => ({
        url: `https://example.com/mock/${encodeURIComponent(q)}/${j + 1}`,
        text: `Mock content for ${q} (#${idx + 1}.${j + 1})`,
        title: `Mock result ${j + 1} for ${q}`,
      })),
    );
  }
  const results = [];
  for (const query of queries) {
    const searchResponse = await exa.searchAndContents(query, { numResults: linksPerQuery });
    results.push(...(searchResponse?.results ?? []));
  }
  return results;
}

/**
 * Synthesize a report from search contents via LLM.
 */
export async function synthesizeReport(topicOrPrompt, searchContents, contentSlice = 750) {
  if (config.mocks.ai) {
    const refs = searchContents.map((r, i) => `[${i + 1}] ${r.url}`).join('\n');
    return `MOCK REPORT about ${topicOrPrompt}\n\nReferences:\n${refs}`;
  }

  const inputData = (searchContents ?? [])
    .map(
      (item) =>
        `--START ITEM--
URL: ${item.url}
CONTENT: ${(item.text || '').slice(0, contentSlice)}
--END ITEM--
`,
    )
    .join('');

  return await getLLMResponse({
    system:
      'You are a helpful research assistant. Write a concise, well-structured two-paragraph report using the provided sources. Include a short reference list with URLs.',
    user: `Input Data:\n${inputData}\n\nWrite the report about: ${topicOrPrompt}`,
  });
}

/**
 * Extract structured metadata from raw paper text.
 */
export async function extractMetadataFromText(text) {
  if (config.mocks.ai) {
    return {
      title: 'Mock Paper Title',
      journal: 'Mock Journal',
      year: '2025',
      keywords: ['mock', 'paper', 'metadata'],
      doi: '',
      authors: ['Mock Author'],
    };
  }

  const schema = `Return a strict JSON object with:
{
  "title": string,
  "journal": string,
  "year": string,
  "keywords": string[],
  "doi": string,
  "authors": string[]
}`;
  const content = await getLLMResponse({
    system: `Extract bibliographic metadata from the user's text. ${schema}`,
    user: text?.slice(0, 8000) ?? '', // guard length
    temperature: 0,
  });

  try {
    return JSON.parse(content);
  } catch {
    return {
      title: '',
      journal: '',
      year: '',
      keywords: [],
      doi: '',
      authors: [],
    };
  }
}
