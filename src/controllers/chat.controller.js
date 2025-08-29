// src/controllers/chat.controller.js

import { z } from 'zod';
import { getLogger } from '../services/logger.js';

// ✅ Reuse the singleton BullMQ queue instance exported from your queues module.
//    Do NOT create a new Queue here — that caused the "Identifier 'queue' has already been declared" error.
import { jobs as jobsQueue } from '../queues/queue.js';

// ---------- validation ----------
const ChatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        sender: z.string(),
        text: z.string().default(''),
      })
    )
    .min(1, 'messages must contain at least one item'),
  filecoinContext: z.any().optional(),
});

function parseChatBody(body) {
  const parsed = ChatBodySchema.safeParse(body);
  if (!parsed.success) {
    const err = new Error('Invalid body for /chat');
    err.statusCode = 400;
    err.details = parsed.error.flatten();
    throw err;
  }
  return parsed.data;
}

// ---------- enqueue helper ----------
async function enqueueJob(name, payload) {
  // Stable, unique-ish jobId that shows the job type
  const jobId = `${name}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  // Use the shared queue instance. No local new Queue() here.
  const job = await jobsQueue.add(name, payload, {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    // keep some history around for test polling / debugging
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });

  return { jobId: job.id };
}

// ---------- controller ----------
/**
 * POST /api/chat
 * Always enqueues a "research-chat" job and returns 202 with { jobId }.
 */
export async function chatHandler(req, res, next) {
  const log = getLogger();
  try {
    const { messages, filecoinContext } = parseChatBody(req.body);

    // derive a topic from the latest user message; fallback keeps tests deterministic
    const lastUserMessage = [...messages].reverse().find((m) => m.sender === 'user');
    const topic = lastUserMessage?.text?.trim() || 'General Inquiry';

    const jobPayload = {
      topic,
      fullContext: messages,
      knowledgeBase: filecoinContext,
    };

    const { jobId } = await enqueueJob('research-chat', jobPayload);

    log.info({ jobId, topic }, '[API][chat] enqueued');
    res.status(202).json({ jobId });
  } catch (error) {
    next(error);
  }
}

export default { chatHandler };
