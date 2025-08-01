// src/init-db.js
import { pool } from './services/db.js';

// The SQL commands to create all tables.
// The order is important: create 'projects' first.
const createTables = [
  // 1. Projects table - The central hub
  `
  CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      nft_id BIGINT UNIQUE, 
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  // 2. Papers table - with encryption flags
  `
  CREATE TABLE IF NOT EXISTS paper (
      cid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      journal TEXT,
      year INTEGER,
      keywords TEXT[],
      authors TEXT[],
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
      lit_token_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  // 3. Experiments table - with encryption flags
  `
  CREATE TABLE IF NOT EXISTS experiment (
      cid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      instrument TEXT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
      lit_token_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  // 4. Analyses table - with encryption flags
  `
  CREATE TABLE IF NOT EXISTS analysis (
      cid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      source_cids TEXT[],
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
      lit_token_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  // 5. Genomes table - with encryption flags
  `
  CREATE TABLE IF NOT EXISTS genome (
      cid TEXT PRIMARY KEY,
      organism TEXT,
      assembly_version TEXT,
      notes TEXT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
      lit_token_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  // 6. Spectra table - with encryption flags
  `
  CREATE TABLE IF NOT EXISTS spectrum (
      cid TEXT PRIMARY KEY,
      compound TEXT,
      technique_nmr_ir_ms TEXT,
      metadata_json JSONB,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
      lit_token_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  // 7. Generic file_cids table (can be deprecated if no longer used, but kept for compatibility)
  `
  CREATE TABLE IF NOT EXISTS file_cids (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      cid TEXT NOT NULL UNIQUE,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
];

async function initializeDatabase() {
  console.log('[DB] Initializing database tables...');
  const client = await pool.connect();
  try {
    for (const sql of createTables) {
      // Clean up SQL for better logging
      const logSql = sql.trim().replace(/\s+/g, ' ').substring(0, 80);
      console.log(`[DB] Executing: ${logSql}...`);
      await client.query(sql);
    }
    console.log('[DB] ✅ All tables created or already exist.');
  } catch (err) {
    console.error('[DB] ❌ Error creating tables:', err);
    process.exit(1); 
  } finally {
    client.release();
    await pool.end(); 
    console.log('[DB] Database connection pool closed.');
  }
}

// Run the initialization
initializeDatabase();