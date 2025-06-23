// src/services/project.service.js
import { pool, query } from './db.js'; // Ensure both are exported from db.js
import { mintProjectNFT } from './flow.service.js';
import crypto from 'crypto';

export async function getAllProjects() {
  const result = await query('SELECT id, name, description, nft_id, created_at FROM projects ORDER BY name ASC');
  return result.rows;
}

/**
 * --- MODIFIED ---
 * Creates a project in the database ONLY. Does not interact with Flow.
 * @returns {Promise<object>} The newly created project object.
 */
export async function createProject(name, description) {
  const result = await query(
    'INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING *',
    [name, description]
  );
  console.log(`[DB] Created project "${name}" with ID: ${result.rows[0].id}`);
  return result.rows[0];
}

/**
 * --- NEW FUNCTION ---
 * Mints an NFT for an existing project and updates the database record.
 * @param {number} projectId - The ID of the project in our database.
 * @returns {Promise<object>} The updated project object with the new nft_id.
 */
export async function mintNftForProject(projectId) {
  const client = await pool.connect();
  try {
    // Check if the project already has an NFT
    const projectCheck = await client.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (projectCheck.rows.length === 0) {
      throw new Error(`Project with ID ${projectId} not found.`);
    }
    if (projectCheck.rows[0].nft_id) {
      throw new Error(`Project ${projectId} has already been minted with NFT ID ${projectCheck.rows[0].nft_id}.`);
    }

    // Use a transaction for the mint and update operation
    await client.query('BEGIN');

    // 1. Mint the NFT on Flow
    const runHash = crypto.randomBytes(16).toString('hex');
    const flowResult = await mintProjectNFT({
      agent: "KintaGenBackend",
      outputCID: `project_init_${projectId}`,
      runHash: runHash,
    });
    const nftId = flowResult.nftId;
    console.log(`[FLOW] Successfully minted NFT ID: ${nftId} for project ${projectId}`);

    // 2. Update our database record with the new nft_id
    const updateResult = await client.query(
      'UPDATE projects SET nft_id = $1 WHERE id = $2 RETURNING *',
      [nftId, projectId]
    );

    // 3. Commit the transaction
    await client.query('COMMIT');

    return updateResult.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[DB/FLOW] Error minting NFT for project ${projectId}, transaction rolled back.`, error);
    throw error; // Re-throw for the controller to handle
  } finally {
    client.release();
  }
}