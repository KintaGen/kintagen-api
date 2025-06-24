// src/init-db.js
import { pool } from './services/db.js';

// The SQL commands to create all tables.
// The order is important: create 'projects' first.
const createTables = [
  `
  CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      nft_id BIGINT UNIQUE, 
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS file_cids (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      cid TEXT NOT NULL UNIQUE,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS paper (
      cid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      journal TEXT,
      year INTEGER,
      keywords TEXT[],
      authors TEXT[],
      -- ADDED: Foreign key to the projects table
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS spectrum (
      cid TEXT PRIMARY KEY,
      compound TEXT,
      technique_nmr_ir_ms TEXT,
      metadata_json JSONB,
      -- ADDED: Foreign key to the projects table
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS genome (
      cid TEXT PRIMARY KEY,
      organism TEXT,
      assembly_version TEXT,
      notes TEXT,
      -- ADDED: Foreign key to the projects table
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS experiment (
      cid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      instrument TEXT,
      -- Foreign key to the projects table
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
];

async function initializeDatabase() {
  console.log('[DB] Initializing database tables...');
  const client = await pool.connect();
  try {
    // We execute each command sequentially.
    for (const sql of createTables) {
      console.log(`[DB] Executing: ${sql.substring(0, 80).replace(/\s+/g, ' ')}...`);
      await client.query(sql);
    }
    console.log('[DB] ✅ All tables created or already exist.');
  } catch (err) {
    console.error('[DB] ❌ Error creating tables:', err);
    // Exit with an error code to signal failure, especially for CI/CD pipelines
    process.exit(1); 
  } finally {
    // Always release the client and end the pool to allow the script to terminate.
    client.release();
    await pool.end(); 
    console.log('[DB] Database connection pool closed.');
  }
}

// Run the initialization
initializeDatabase();