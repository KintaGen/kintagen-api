// src/controllers/project.controller.js
import * as projectService from '../services/project.service.js';

export async function listProjectsHandler(req, res, next) {
    try {
        const projects = await projectService.getAllProjects();
        res.status(200).json(projects);
    } catch (error) {
        console.error('[API ERROR] in listProjectsHandler:', error);
        next(error);
    }
}

export async function createProjectHandler(req, res, next) {
    try {
        const { name, description } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Project name is required' });
        }
        const newProject = await projectService.createProject(name, description);
        res.status(201).json(newProject);
    } catch (error) {
        // Handle unique constraint violation for name
        if (error.code === '23505') {
            return res.status(409).json({ error: `A project with the name "${name}" already exists.` });
        }
        console.error('[API ERROR] in createProjectHandler:', error);
        next(error);
    }
}