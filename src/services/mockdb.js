// src/services/mockdb.js
import crypto from 'crypto';

const genCid = () => `bafy${crypto.randomBytes(16).toString('hex')}`;
const now = () => new Date().toISOString();

const state = {
  projects: [
    { id: 1, name: 'Demo Project', description: 'Mock demo', nft_id: null, created_at: now() },
    { id: 2, name: 'Space Bears', description: 'Mock space biology', nft_id: 777, created_at: now() },
  ],
  paper: [
    { cid: genCid(), title: 'Mock Paper 1', journal: 'Mock Journal', year: 2024, keywords: ['metabolomics'], authors: ['Doe, J.'], project_id: 1, is_encrypted: false, lit_token_id: null, created_at: now() },
    { cid: genCid(), title: 'Mock Paper 2', journal: 'Another Journal', year: 2023, keywords: ['biology'], authors: ['Smith, A.'], project_id: 2, is_encrypted: false, lit_token_id: null, created_at: now() },
  ],
  experiment: [
    { cid: genCid(), title: 'KO_vs_WT_ZIP', description: 'XCMS demo data', instrument: 'GCMS', project_id: 1, is_encrypted: false, lit_token_id: null, created_at: now() },
  ],
  analysis: [
    { cid: genCid(), title: 'Previous profiling results', description: 'Saved mock plots', source_cids: [], project_id: 1, is_encrypted: false, lit_token_id: null, created_at: now() },
  ],
  genome: [],
  spectrum: [],
  file_cids: [],
};

let nextProjectId = state.projects.reduce((m, p) => Math.max(m, p.id), 0) + 1;

export const mockdb = {
  listProjects() { return [...state.projects]; },
  createProject(name, description) {
    const row = { id: nextProjectId++, name, description: description || null, nft_id: null, created_at: now() };
    state.projects.push(row);
    return row;
  },
  setProjectNft(id, nftId) {
    const p = state.projects.find(x => x.id === id);
    if (p) p.nft_id = nftId;
    return p;
  },
  list(type, { projectId, generalOnly } = {}) {
    const rows = [...state[type] ?? []];
    if (projectId === '') return rows.filter(r => !r.project_id);
    if (typeof projectId === 'number') return rows.filter(r => r.project_id === projectId);
    if (generalOnly) return rows.filter(r => !r.project_id);
    return rows;
  },
  insert(type, row) {
    state[type].push(row);
    return row;
  },
  upsertFileCid(filename, cid) {
    const existing = state.file_cids.find((r) => r.cid === cid);
    if (!existing) state.file_cids.push({ id: state.file_cids.length + 1, filename, cid, uploaded_at: now() });
  },
  findByCid(cid) {
    for (const table of ['paper', 'experiment', 'analysis', 'genome', 'spectrum']) {
      const found = state[table].find((r) => r.cid === cid);
      if (found) return { table, row: found };
    }
    return null;
  },
  genCid,
};
