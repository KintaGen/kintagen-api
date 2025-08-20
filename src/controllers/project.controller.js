// src/controllers/project.controller.js
import config from '../config.js';
import * as projectService from '../services/project.service.js';

export async function listProjectsHandler(req, res, next) {
  try {
    const projects = await projectService.getAllProjects();
    res.status(200).json(projects);
  } catch (error) {
    console.error('[API ERROR] in listProjectsHandler:', error);
    if (config.mockMode) return res.status(200).json([]); // ultimate fallback
    next(error);
  }
}

export async function createProjectHandler(req, res, next) {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });
    const newProject = await projectService.createProject(name, description);
    res.status(201).json(newProject);
  } catch (error) {
    console.error('[API ERROR] in createProjectHandler:', error);
    if (config.mockMode) return res.status(201).json({ id: 9999, name: req.body.name, description: req.body.description ?? null, nft_id: null });
    next(error);
  }
}

export async function mintProjectNftHandler(req, res, next) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Project ID is required.' });
    const updated = await projectService.mintNftForProject(Number(id));
    res.status(200).json(updated);
  } catch (error) {
    console.error(`[API ERROR] in mintProjectNftHandler for ID ${req.params.id}:`, error);
    if (config.mockMode) return res.status(200).json({ id: Number(req.params.id), nft_id: Math.floor(Math.random()*100000) });
    next(error);
  }
}
