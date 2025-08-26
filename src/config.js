// src/config.js
import 'dotenv/config';
import { RPC_URLS } from '@filoz/synapse-sdk';

// export a single helper we can reuse everywhere
export const trueish = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

const MOCK_MODE = trueish(process.env.MOCK_MODE);

const config = {
  port: Number(process.env.PORT || 3001),
  mockMode: MOCK_MODE,
  db: {
    connectionString: process.env.POSTGRES_DSN || '',
  },
  synapse: {
    privateKey: process.env.SYNAPSE_PRIVATE_KEY || '',
    network: process.env.SYNAPSE_NETWORK || 'calibration',
    rpcUrl: process.env.SYNAPSE_RPC_URL || '',
  },
  // per-service mock flags (fallback to global MOCK_MODE)
  mocks: {
    ai: trueish(process.env.AI_MOCK) || MOCK_MODE,
    search: trueish(process.env.SEARCH_MOCK) || MOCK_MODE,
    synapseDryRun: trueish(process.env.SYNAPSE_DRY_RUN) || MOCK_MODE,
    flow: trueish(process.env.FLOW_MOCK) || MOCK_MODE,
  },
};

if (!MOCK_MODE) {
  if (!config.db.connectionString) {
    throw new Error('Missing required environment variable: POSTGRES_DSN');
  }
  if (!config.synapse.privateKey) {
    throw new Error('Missing required environment variable: SYNAPSE_PRIVATE_KEY');
  }
  if (config.synapse.privateKey.length !== 66) {
    throw new Error('Invalid SYNAPSE_PRIVATE_KEY format. Must be 66-char hex (0x...)');
  }
  if (!config.synapse.rpcUrl) {
    config.synapse.rpcUrl = RPC_URLS[config.synapse.network]?.http;
    if (!config.synapse.rpcUrl) throw new Error(`Invalid SYNAPSE_NETWORK: ${config.synapse.network}.`);
  }
}

export default config;
