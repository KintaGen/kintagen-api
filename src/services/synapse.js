// src/services/synapse.js
import { Synapse } from '@filoz/synapse-sdk';
import { acquireLock, releaseLock } from './lock.service.js'; // <-- Import the lock
import config from '../config.js';

// Create a single, reusable Synapse instance
let synapseInstance = null;

export async function getSynapse() {
  if (!synapseInstance) {
    console.log(`[SYNAPSE] Initializing Synapse SDK for network: ${config.synapse.network} with CDN enabled`);
    synapseInstance = await Synapse.create({
      privateKey: config.synapse.privateKey,
      rpcURL: config.synapse.rpcUrl,
      withCDN: true, // Crucial flag for FilCDN
    });
    console.log('[SYNAPSE] SDK Initialized.');
  }
  return synapseInstance;
}

/**
 * A high-level function to handle the entire upload process.
 * It creates a storage service (or reuses an existing one) and uploads the data.
 * @param {Buffer} dataBuffer The file data as a buffer.
 * @param {object} [options] Optional parameters.
 * @param {number} [options.proofSetId] An existing proof set ID to use.
 * @returns {Promise<{commp: string, size: number, proofSetId: number}>} The result of the upload.
 */
export async function uploadData(dataBuffer, options = {}) {
  // 1. Acquire the lock BEFORE starting any async operations.
  // This will make subsequent requests wait here until the lock is free.
  await acquireLock();

  // We wrap the entire logic in a new Promise to control when it resolves.
  return new Promise(async (resolve, reject) => {
    try {
      // --- Standard Setup Logic ---
      const synapse = await getSynapse();
      const storage = await synapse.createStorage({
        proofSetId: options.proofSetId,
        withCDN: true,
        callbacks: {
          onProviderSelected: (provider) => console.log(`[SYNAPSE] Provider selected: ${provider.owner}`),
          onProofSetResolved: (info) => console.log(`[SYNAPSE] Proof set resolved. ID: ${info.proofSetId}, Is Existing: ${info.isExisting}`),
          onProofSetCreationStarted: (tx) => console.log(`[SYNAPSE] New proof set creation Tx: ${tx.hash}`),
          onProofSetCreationProgress: (status) => console.log(`[SYNAPSE] Creation progress: Mined=${status.transactionMined}, Live=${status.proofSetLive}`),
        }
      });
      await storage.preflightUpload(dataBuffer.length);
      
      console.log(`[SYNAPSE] Starting upload of ${dataBuffer.length} bytes...`);

      let capturedCommp = null;
      let hasResolvedForUser = false; // Flag to ensure we only resolve once

      // 2. We do NOT await this. We let it run in the background and use its callbacks.
      // We attach .then() and .catch() to its promise to handle the FINAL lock release.
      storage.upload(dataBuffer, {
        onUploadComplete: (commp) => {
          console.log(`[SYNAPSE CALLBACK] Upload to provider complete. CommP: ${commp}`);
          capturedCommp = commp;
        },
        onRootAdded: (tx) => {
          // 3. This is the FAST resolve for the user.
          if (hasResolvedForUser) return;
          hasResolvedForUser = true;

          console.log(`[SYNAPSE CALLBACK] Root addition transaction sent: ${tx?.hash}. RESOLVING PROMISE FOR USER NOW.`);
          
          resolve({
            commp: capturedCommp.toString(),
            size: dataBuffer.length,
            proofSetId: storage.proofSetId,
          });
        },
        onRootConfirmed: (rootIds) => {
          console.log(`[SYNAPSE CALLBACK] (Info only) Root IDs confirmed on-chain later: ${rootIds.join(', ')}`);
          // The .then() block below will handle the lock release.
        },
      })
      .then(() => {
        // 4a. SUCCESS CASE: The entire process, including confirmation, is done. Release the lock.
        console.log('[SYNAPSE] Full upload process (including confirmation) finished successfully.');
        releaseLock();
      })
      .catch(error => {
        // 4b. FAILURE CASE: The upload process failed at some point.
        console.error('[SYNAPSE] Upload process failed.', error);
        // If we haven't already responded to the user, we need to reject the main promise.
        if (!hasResolvedForUser) {
          reject(error);
        }
        // CRUCIAL: Always release the lock, even on failure.
        releaseLock();
      });

    } catch (initialError) {
      // This catches errors from getSynapse, createStorage, or preflightUpload.
      console.error('[SYNAPSE] Initial setup failed.', initialError);
      // We must release the lock and reject the promise.
      releaseLock();
      reject(initialError);
    }
  });
}