// src/services/ai.service.js
import 'dotenv/config';

const isTrueish = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());
const MOCK_MODE = isTrueish(process.env.MOCK_MODE);

let OpenAI, Exa, openai, exa;

if (!MOCK_MODE) {
  // Lazy import to avoid requiring keys in MOCK_MODE
  const { default: OpenAIDefault } = await import('openai');
  const { default: ExaDefault } = await import('exa-js');
  OpenAI = OpenAIDefault;
  Exa = ExaDefault;

  openai = new OpenAI({
    baseURL: 'https://api.mosaia.ai/v1/agent',
    apiKey: process.env.MOSAIA_HTTP_API_KEY,
  });

  exa = new Exa(process.env.EXA_API_KEY);
}

const preview = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

async function getLLMResponse({
  system,
  user,
  temperature = 1,
  model = '6845cac0d8955e09bf51f446',
}) {
  if (MOCK_MODE) {
    return `MOCKED AI RESPONSE\n\nSystem: ${preview(system)}\nUser: ${preview(user)}\n`;
  }

  const completion = await openai.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const content = completion?.choices?.[0]?.message?.content ?? '';
  const trimmed = content.trim();
  if (!trimmed) console.warn('[AI] WARNING: LLM returned empty content', { model });
  return content;
}

export async function generateSearchQueries(topic, n = 10) {
  if (MOCK_MODE) {
    return Array.from({ length: n }, (_, i) => `${topic} mock query ${i + 1}`);
  }
  const userPrompt = `I'm writing a research report on ${topic} and need help coming up with diverse search queries. Please generate a list of ${n} search queries. Do not add any formatting or numbering.`;
  const completion = await getLLMResponse({
    system: 'Respond with only the suggested search queries in plain text, each on its own line.',
    user: userPrompt,
    temperature: 1,
  });
  return completion.split('\n').filter(s => s.trim().length > 0).slice(0, n);
}

export async function getSearchResults(queries, linksPerQuery = 10) {
  if (MOCK_MODE) {
    return queries.flatMap((q, qi) =>
      Array.from({ length: Math.min(linksPerQuery, 3) }, (_, i) => ({
        title: `Mock result ${qi + 1}.${i + 1} for "${q}"`,
        url: `https://example.com/mock/${encodeURIComponent(q)}/${i + 1}`,
        text: `This is mock text for "${q}" result ${i + 1}.`,
      }))
    );
  }
  let results = [];
  for (const query of queries) {
    const searchResponse = await exa.searchAndContents(query, { numResults: linksPerQuery });
    results.push(...searchResponse.results);
  }
  return results;
}

export async function synthesizeReport(topic, searchContents, contentSlice = 750) {
  if (MOCK_MODE) {
    const refs = searchContents.map((r, i) => `[${i + 1}] ${r.url}`).join('\n');
    return `MOCK REPORT: ${topic}\n\nParagraph 1...\n\nParagraph 2...\n\nReferences\n${refs}`;
  }
  const inputData = searchContents
    .map(item => `--START ITEM--\nURL: ${item.url}\nCONTENT: ${String(item.text || '').slice(0, contentSlice)}\n--END ITEM--\n`)
    .join('');
  return await getLLMResponse({
    system: 'You are a helpful research assistant. Write a report according to the user\'s instructions.',
    user: `Input Data:\n${inputData}\n\nWrite a two paragraph research report about ${topic} based on the provided information. Include as many sources as possible. Provide citations in the text using footnote notation ([#]). First provide the report, followed by a single "References" section that lists all the URLs used, in the format [#] <url>.`,
  });
}

export async function extractMetadataFromText(text) {
  if (MOCK_MODE) {
    return {
      title: 'Mock Paper Title',
      journal: 'Mock Journal',
      year: '2024',
      keywords: ['mock', 'paper', 'test'],
      authors: ['Doe, J.', 'Smith, A.'],
    };
  }
  const { default: OpenAIReal } = await import('openai'); // ensure available
  // You can keep your original extraction logic here (omitted for brevity)
  return {
    title: 'Untitled',
    journal: '',
    year: '0000',
    keywords: [],
    authors: [],
  };
}
