// src/controllers/nft.controller.js
import * as flowService from '../services/flow.service.js';
import { query } from '../services/db.js';

/**
 * Gets the workflow story (log) for a given NFT.
 * The ID in the URL is the NFT ID itself.
 */
export async function getNftStoryHandler(req, res, next) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'NFT ID is required' });
        }
        
        const story = await flowService.getNftStory(id);
        if (!story) {
            return res.status(404).json({ error: `No story found for NFT #${id}` });
        }
        
        // The story may be an empty array, which is a valid response
        res.status(200).json(story);

    } catch (error) {
        // Handle cases where the NFT ID might be valid but not found in the collection
        if (error.message && error.message.includes('Could not borrow view resolver')) {
            return res.status(404).json({ error: `NFT with ID ${req.params.id} not found or collection not public.` });
        }
        console.error(`[API ERROR] in getNftStoryHandler for ID ${req.params.id}:`, error);
        next(error);
    }
}

/**
 * Controller to trigger adding a new log entry to a project's NFT.
 * It uses the project's database ID to find the corresponding NFT ID.
 */
export async function addLogEntryHandler(req, res, next) {
    try {
        const { projectId } = req.params; // We use the DB project ID from the URL
        const { action, outputCID } = req.body;

        if (!action || !outputCID) {
            return res.status(400).json({ error: 'Action description and output CID are required.' });
        }

        // 1. Find the project in our DB to get its NFT ID
        const projectResult = await query('SELECT nft_id FROM projects WHERE id = $1', [projectId]);
        
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found.' });
        }
        
        const nftId = projectResult.rows[0].nft_id;
        if (!nftId) {
            return res.status(400).json({ error: 'This project has not been minted as an NFT and cannot have log entries.' });
        }

        // 2. Call the Flow service to add the log entry
        const sealedTx = await flowService.addLogEntry({
            nftId,
            agent: "KintaGenApp", // Or get this from an authenticated user later
            action,
            outputCID,
        });

        res.status(200).json({
            message: `Log entry added successfully to NFT #${nftId}`,
            transactionId: sealedTx.transactionId, // FCL v1 returns transactionId
        });

    } catch (error) {
        console.error(`[API ERROR] in addLogEntryHandler for project ${req.params.projectId}:`, error);
        next(error);
    }
}