// src/services/lock.service.js

let isLocked = false;
const POLLING_INTERVAL = 2000; // Check every 2000ms
const TIMEOUT = 120000; // Wait a maximum of 120 seconds

/**
 * Acquires a global lock, waiting if it's already taken.
 * Throws an error if the lock cannot be acquired within the timeout.
 */
export async function acquireLock() {
  const startTime = Date.now();
  
  while (isLocked) {
    if (Date.now() - startTime > TIMEOUT) {
      throw new Error('Failed to acquire lock: Timeout exceeded. The previous operation may be stuck.');
    }
    console.log('[LockService] Synapse is busy. Waiting...');
    await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
  }
  
  console.log('[LockService] Lock acquired.');
  isLocked = true;
}

/**
 * Releases the global lock.
 */
export function releaseLock() {
  console.log('[LockService] Lock released.');
  isLocked = false;
}