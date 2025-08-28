// src/controllers/chat.controller.js
import { Queue } from 'bullmq';
import { connection } from '../queues/connection.js';

import { z } from 'zod';
import { getLogger } from '../services/logger.js';
import { jobs as queue } from '../queues/queue.js';

// Single queue instance
const queue = new Queue('kintagen', { connection });

async function enqueueJob(name, payload) {
  const jobId = `${name}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const job = await queue.add(name, payload, {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return { jobId: job.id };
}


function parseChatBody(body) {
  const schema = z.object({
    messages: z.array(z.object({ sender: z.string(), text: z.string().default('') })).min(1),
    filecoinContext: z.any().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const err = new Error('Invalid body for /chat');
    err.statusCode = 400;
    err.details = parsed.error.flatten();
    throw err;
  }
  return parsed.data;
}
/**
 * Always enqueue a research-chat job.
 * Response: 202 + { jobId } so the client can poll /api/analyze/jobs/:id
 */
export async function chatHandler(req, res, next) {
  const log = getLogger();
  try {
    const { messages, filecoinContext } = parseChatBody(req.body);
    const lastUserMessage = [...messages].reverse().find((m) => m.sender === 'user');
    const topic = lastUserMessage?.text?.trim() || 'General Inquiry';

    const jobPayload = { topic, fullContext: messages, knowledgeBase: filecoinContext };
    const { jobId } = await enqueueJob('research-chat', jobPayload);

    log.info({ jobId, topic }, '[API][chat] enqueued');
    res.status(202).json({ jobId });
  } catch (error) { next(error); }
}
