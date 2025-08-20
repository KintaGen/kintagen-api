// src/controllers/chat.controller.js
import { Queue } from 'bullmq';
import { connection } from '../queues/connection.js';

// Single queue instance
const queue = new Queue('kintagen', { connection });

/**
 * Always enqueue a research-chat job.
 * Response: 202 + { jobId } so the client can poll /api/analyze/jobs/:id
 */
export async function chatHandler(req, res, next) {
  try {
    const { messages, filecoinContext } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid request: "messages" array is required.' });
    }

    const job = await queue.add(
      'research-chat',
      { messages, filecoinContext },
      {
        removeOnComplete: true,
        removeOnFail: 200,
        attempts: 2,
        backoff: { type: 'exponential', delay: 1000 },
      }
    );

    return res.status(202).json({ jobId: job.id, name: job.name });
  } catch (error) {
    console.error('Error in chat handler:', error);
    next(error);
  }
}
