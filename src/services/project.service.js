// src/services/project.service.js
import config from '../config.js';
import { mockdb } from './mockdb.js';
import { pool, query } from './db.js';
import { mintProjectNFT } from './flow.service.js';
import crypto from 'crypto';

export async function getAllProjects() {
  if (config.mockMode) return mockdb.listProjects();
  const result = await query('SELECT id, name, description, nft_id, created_at FROM projects ORDER BY name ASC');
  return result.rows;
}

export async function createProject(name, description) {
  if (config.mockMode) return mockdb.createProject(name, description);
  const result = await query('INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING *', [name, description]);
  return result.rows[0];
}

export async function mintNftForProject(projectId) {
  if (config.mockMode) {
    const fake = { txId: 'MOCK_TX', nftId: Math.floor(Math.random()*100000) };
    const updated = mockdb.setProjectNft(projectId, fake.nftId);
    return updated ?? { id: projectId, nft_id: fake.nftId };
  }

  const client = await pool.connect();
  try {
    const projectCheck = await client.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (projectCheck.rows.length === 0) throw new Error(`Project with ID ${projectId} not found.`);
    if (projectCheck.rows[0].nft_id) throw new Error(`Project ${projectId} has already been minted with NFT ID ${projectCheck.rows[0].nft_id}.`);

    await client.query('BEGIN');
    const runHash = crypto.randomBytes(16).toString('hex');
    const flowResult = await mintProjectNFT({ agent: 'KintaGenBackend', outputCID: `project_init_${projectId}`, runHash });
    const nftId = flowResult.nftId;
    const updateResult = await client.query('UPDATE projects SET nft_id = $1 WHERE id = $2 RETURNING *', [nftId, projectId]);
    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally {
    client.release();
  }
}
