// src/controllers/chat.controller.js
import { Queue } from 'bullmq';
import { connection } from '../queues/connection.js';

// Single queue instance
const queue = new Queue('kintagen', { connection });
async function enqueueJob(name, payload) {
  const jobId = `${name}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const job = await queue.add(name, payload, {
    jobId,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 24 * 3600 },
    attempts: 2,
  });
  return { jobId: job.id };
}
/**
 * Always enqueue a research-chat job.
 * Response: 202 + { jobId } so the client can poll /api/analyze/jobs/:id
 */
export async function chatHandler(req, res, next) {
  try {
    const { messages, filecoinContext } = req.body;

    // --- THIS IS THE CRITICAL FIX ---
    // Find the last message sent by the user to use as the 'topic'.
    const lastUserMessage = messages?.filter(m => m.sender === 'user').pop();
    const topic = lastUserMessage?.text || 'General Inquiry'; // Use the message text as the topic
    // --- END FIX ---

    // Now, create the payload that the worker actually expects.
    const jobPayload = {
      topic,
      fullContext: messages, // You can still pass the full context if needed
      knowledgeBase: filecoinContext,
    };
    
    // The name 'research-chat' must match the case in your worker.
    const { jobId } = await enqueueJob('research-chat', jobPayload);

    // The frontend only needs the jobId to start polling.
    res.status(202).json({ jobId });
  } catch (error) {
    console.error('[API][chatHandler] Error:', error);
    next(error);
  }
}
