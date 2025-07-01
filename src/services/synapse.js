// src/services/synapse.js
import { Synapse } from '@filoz/synapse-sdk';
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
  // --- This part remains the same: setup and preflight check ---
  const synapse = await getSynapse();
  console.log('[SYNAPSE] Creating/resolving storage service...');
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

  console.log('[SYNAPSE] Performing preflight check...');
  const preflight = await storage.preflightUpload(dataBuffer.length);
  if (!preflight.allowanceCheck.sufficient) {
    throw new Error('Allowance not sufficient to upload file.');
  }
  console.log('[SYNAPSE] Preflight check passed.');

  // --- THIS IS THE NEW, FAST-RETURN LOGIC ---
  console.log(`[SYNAPSE] Starting upload of ${dataBuffer.length} bytes to proof set ${storage.proofSetId}...`);

  // We wrap the upload process in a new Promise.
  return new Promise((resolve, reject) => {
    let capturedCommp = null;
    let hasResolved = false; // A flag to prevent resolving the promise multiple times

    // We do NOT `await` this call. We let it run and listen to its callbacks.
    storage.upload(dataBuffer, {
      onUploadComplete: (commp) => {
        console.log(`[SYNAPSE CALLBACK] Upload to provider complete. CommP: ${commp}`);
        // Capture the CommP (CID) as soon as it's available.
        capturedCommp = commp;
      },
      onRootAdded: (tx) => {
        // This is the "fast" event we want to return on.
        if (hasResolved) return; // If we've already resolved, do nothing.
        hasResolved = true;

        if (tx) {
          console.log(`[SYNAPSE CALLBACK] Root addition transaction sent: ${tx.hash}. RESOLVING PROMISE NOW.`);
        } else {
          console.log('[SYNAPSE CALLBACK] Root added to proof set (legacy server). RESOLVING PROMISE NOW.');
        }

        // Resolve our custom promise with the final result object.
        resolve({
          commp: capturedCommp.toString(),
          size: dataBuffer.length,
          proofSetId: storage.proofSetId,
        });
      },
      onRootConfirmed: (rootIds) => {
        // This callback will still fire later, but our function will have already returned.
        // This is now just for logging purposes.
        console.log(`[SYNAPSE CALLBACK] (Info only) Root IDs confirmed on-chain later: ${rootIds.join(', ')}`);
      },
    }).catch(error => {
      // If the underlying storage.upload promise fails for any reason
      // before we have resolved, we should reject our promise.
      if (!hasResolved) {
        console.error('[SYNAPSE] Upload process failed.', error);
        reject(error);
      }
    });
  });
}