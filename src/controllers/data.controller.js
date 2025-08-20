// src/controllers/data.controller.js
import config from '../config.js';
import { query } from '../services/db.js';
import { mockdb } from '../services/mockdb.js';

const VALID_TYPES = {
  paper: { table: 'paper', validSorts: ['created_at', 'title', 'journal', 'year', 'cid'] },
  experiment: { table: 'experiment', validSorts: ['created_at', 'title', 'instrument', 'cid'] },
  analysis: { table: 'analysis', validSorts: ['created_at', 'title', 'cid'] },
  genome: { table: 'genome', validSorts: ['created_at', 'organism', 'assembly_version', 'cid'] },
  spectrum: { table: 'spectrum', validSorts: ['created_at', 'compound', 'technique_nmr_ir_ms', 'cid'] },
  file_cids: { table: 'file_cids', validSorts: ['uploaded_at', 'filename', 'cid', 'id'] },
};

export async function queryDataHandler(req, res, next) {
  try {
    const { type } = req.params;
    if (!VALID_TYPES[type]) return res.status(400).json({ error: 'Invalid data type specified.' });

    const projectIdRaw = req.query.projectId;
    let projectId = null;
    if (projectIdRaw === '') projectId = '';
    else if (projectIdRaw != null) projectId = Number(projectIdRaw);

    if (config.mockMode) {
      const rows = mockdb.list(type, { projectId });
      return res.status(200).json({ data: rows });
    }

    // Real DB path (kept minimal)
    const { table } = VALID_TYPES[type];
    let where = '';
    const args = [];
    if (projectId === '') {
      where = 'WHERE project_id IS NULL';
    } else if (typeof projectId === 'number' && !Number.isNaN(projectId)) {
      where = 'WHERE project_id = $1'; args.push(projectId);
    }
    const sql = `SELECT * FROM ${table} ${where} ORDER BY created_at DESC LIMIT 100`;
    const result = await query(sql, args);
    return res.status(200).json({ data: result.rows });
  } catch (err) { next(err); }
}

export async function getDataByIDHandler(req, res, next) {
  try {
    const { type, cid } = req.params;
    if (!VALID_TYPES[type]) return res.status(400).json({ error: 'Invalid data type specified.' });

    if (config.mockMode) {
      const rows = mockdb.list(type);
      const row = rows.find(r => r.cid === cid);
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(row);
    }

    const { table } = VALID_TYPES[type];
    const result = await query(`SELECT * FROM ${table} WHERE cid = $1`, [cid]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function listCIDsHandler(req, res, next) {
  try {
    if (config.mockMode) {
      const all = ['paper','experiment','analysis','genome','spectrum']
        .flatMap(t => mockdb.list(t))
        .map(r => r.cid);
      return res.status(200).json({ cids: all });
    }
    const r = await query('SELECT cid FROM file_cids ORDER BY uploaded_at DESC LIMIT 500');
    res.status(200).json({ cids: r.rows.map(x => x.cid) });
  } catch (err) { next(err); }
}
