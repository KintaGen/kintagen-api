// src/services/db.js
import 'dotenv/config';
import config from '../config.js';

let pool = null;
let connected = false;

if (!config.mockMode) {
  const { Pool } = await import('pg');
  pool = new Pool({ connectionString: config.db.connectionString });
  pool.on('connect', () => { connected = true; console.log('[DB] Connected to PostgreSQL'); });
  pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client', err);
    process.exit(-1);
  });
}

export const query = async (text, params) => {
  if (config.mockMode) {
    throw new Error('[MOCK_MODE] query() called. This route should be mocked — no DB in mock mode.');
  }
  return pool.query(text, params);
};

export { pool };
