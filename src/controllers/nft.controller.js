// src/controllers/nft.controller.js
import * as flowService from '../services/flow.service.js';
import { query } from '../services/db.js';

/**
 * Gets the workflow story (log) for a given NFT.
 */
export async function getNftStoryHandler(req, res, next) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'NFT ID is required' });
        }
        
        const story = await flowService.getNftStory(id);
        // A null response from the service means the story/NFT wasn't found.
        // Return an empty array, which is what the frontend expects for "not found" or "empty".
        if (story === null) {
            return res.status(404).json([]);
        }
        
        res.status(200).json(story);

    } catch (error) {
        if (error.message && error.message.includes('Could not borrow view resolver')) {
            return res.status(404).json({ error: `NFT with ID ${req.params.id} not found.` });
        }
        console.error(`[API ERROR] in getNftStoryHandler for ID ${req.params.id}:`, error);
        next(error);
    }
}

/**
 * Controller to add a new log entry to a project's NFT.
 */
export async function addLogEntryHandler(req, res, next) {
    try {
        const { projectId } = req.params;
        const { action, outputCID } = req.body;

        if (!action) {
            return res.status(400).json({ error: 'Action description is required.' });
        }

        // 1. Find the project and ensure it has an NFT ID
        const projectResult = await query('SELECT nft_id FROM projects WHERE id = $1', [projectId]);
        
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ error: `Project with ID ${projectId} not found.` });
        }
        
        const nftIdString = projectResult.rows[0].nft_id;
        if (!nftIdString) {
            return res.status(400).json({ error: 'This project has not been minted as an NFT.' });
        }

        // 2. Call the Flow service with correctly typed data
        const sealedTx = await flowService.addLogEntry({
            nftId: Number(nftIdString), // Ensure it's a number
            agent: "KintaGenApp",
            action,
            outputCID: outputCID || "", // Ensure it's a string, even if empty
        });

        // Check for transaction success
        if (sealedTx.status !== 4 || sealedTx.errorMessage) {
             throw new Error(`Flow transaction failed: ${sealedTx.errorMessage || 'Unknown error'}`);
        }

        res.status(200).json({
            message: `Log entry added successfully to NFT #${nftIdString}`,
            transactionId: sealedTx.id,
        });

    } catch (error) {
        console.error(`[API ERROR] in addLogEntryHandler for project ${req.params.projectId}:`, error);
        next(error); // Pass the error to the global error handler
    }
}