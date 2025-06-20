// src/services/project.service.js
import { query } from './db.js';

export async function getAllProjects() {
  const result = await query('SELECT id, name, description, created_at FROM projects ORDER BY name ASC');
  return result.rows;
}

export async function createProject(name, description) {
  const result = await query(
    'INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING *',
    [name, description]
  );
  return result.rows[0];
}