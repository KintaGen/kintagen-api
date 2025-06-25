// src/reset-db.js
import { pool } from './services/db.js';

// An array of all the tables you want to drop.
// The order doesn't strictly matter when using CASCADE,
// but listing them is good for clarity.
const tablesToDrop = [
  'paper',
  'spectrum',
  'genome',
  'experiment',
  'analysis',
  'file_cids',
  'projects',
];

async function resetDatabase() {
  // --- SAFETY CHECK ---
  // This prevents the script from running unless you explicitly add the '--force' flag.
  if (!process.argv.includes('--force')) {
    console.error('---------------------------------------------------------');
    console.error('❌ DANGER: This is a destructive script.');
    console.error('This will drop all tables and delete all data.');
    console.error('To run this script, you must add the --force flag:');
    console.error('node src/reset-db.js --force');
    console.error('---------------------------------------------------------');
    process.exit(1); // Exit without doing anything
  }

  console.log('[DB] Dropping all tables...');
  const client = await pool.connect();

  try {
    // Construct the single SQL command to drop all tables at once.
    // 'IF EXISTS' prevents errors if a table is already gone.
    // 'CASCADE' removes dependent objects (like foreign keys).
    const sql = `DROP TABLE IF EXISTS ${tablesToDrop.join(', ')} CASCADE;`;
    
    console.log(`[DB] Executing: ${sql}`);
    await client.query(sql);

    console.log('[DB] ✅ All tables dropped successfully.');
  } catch (err) {
    console.error('[DB] ❌ Error dropping tables:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    console.log('[DB] Database connection pool closed.');
  }
}

resetDatabase();