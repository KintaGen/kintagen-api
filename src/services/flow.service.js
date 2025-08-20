// src/services/flow.service.js
import 'dotenv/config';

const isTrueish = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());
const MOCK_MODE = isTrueish(process.env.MOCK_MODE);

// Lazy real-Flow setup, only when NOT in mock mode
let _flowInitDone = false;
let _flowCache = null;

async function ensureFlow() {
  if (MOCK_MODE) return { mock: true };

  // Dynamic imports so mock mode doesn’t need these deps
  const fcl = await import('@onflow/fcl');
  const ellipticPkg = await import('elliptic');
  const sha3Pkg = await import('js-sha3');

  const { ec: EC } = ellipticPkg.default ?? ellipticPkg; // handle CJS/ESM
  const { sha3_256 } = sha3Pkg;
  const ec = new EC('p256');

  const SERVICE_ADDRESS = process.env.FLOW_TESTNET_ADDRESS;
  const PRIVATE_KEY = process.env.FLOW_TESTNET_PRIVATE_KEY;
  const KEY_INDEX = 0;

  if (!SERVICE_ADDRESS || !PRIVATE_KEY) {
    console.error('🔴 FATAL FLOW ERROR: Missing FLOW_TESTNET_ADDRESS or FLOW_TESTNET_PRIVATE_KEY in your .env file.');
    throw new Error('Missing Flow credentials');
  }

  if (!_flowInitDone) {
    fcl.config()
      .put('accessNode.api', 'https://rest-testnet.onflow.org')
      .put('0xNonFungibleToken', '0x631e88ae7f1d7c20')
      .put('0xMetadataViews', '0x631e88ae7f1d7c20')
      .put('0xViewResolver', '0x631e88ae7f1d7c20')
      .put('0xKintaGenNFT', SERVICE_ADDRESS);
    _flowInitDone = true;
  }

  function signWithP256Sha3(messageHex) {
    const key = ec.keyFromPrivate(Buffer.from(PRIVATE_KEY, 'hex'));
    const msgHash = Buffer.from(sha3_256.arrayBuffer(Buffer.from(messageHex, 'hex')));
    const signature = key.sign(msgHash, { canonical: true });
    return Buffer.concat([
      signature.r.toArrayLike(Buffer, 'be', 32),
      signature.s.toArrayLike(Buffer, 'be', 32),
    ]).toString('hex');
  }

  const authorization = (acct = {}) => ({
    ...acct,
    tempId: `${SERVICE_ADDRESS}-${KEY_INDEX}`,
    addr: fcl.withPrefix(SERVICE_ADDRESS),
    keyId: KEY_INDEX,
    signingFunction: async (signable) => ({
      addr: fcl.withPrefix(SERVICE_ADDRESS),
      keyId: KEY_INDEX,
      signature: signWithP256Sha3(signable.message),
    }),
  });

  _flowCache = { fcl, SERVICE_ADDRESS, authorization };
  return _flowCache;
}

export async function mintProjectNFT({ agent, outputCID, runHash }) {
  if (MOCK_MODE) {
    return { txId: 'MOCK_TX', nftId: Math.floor(Math.random() * 100000) };
  }

  const { fcl, SERVICE_ADDRESS, authorization } = await ensureFlow();

  const cadence = `
    import NonFungibleToken from 0xNonFungibleToken
    import KintaGenNFT from 0xKintaGenNFT
    transaction(recipient: Address, agent: String, outputCID: String, runHash: String) {
      prepare(signer: auth(BorrowValue) &Account) {}
      execute { log("mint") }
    }`;

  const txId = await fcl.mutate({
    cadence,
    args: (arg, t) => [
      arg(SERVICE_ADDRESS, t.Address),
      arg(agent, t.String),
      arg(outputCID, t.String),
      arg(runHash, t.String),
    ],
    proposer: authorization,
    payer: authorization,
    authorizations: [authorization],
    limit: 999,
  });

  // In a real impl you’d parse events for the actual ID.
  return { txId, nftId: Math.floor(Math.random() * 100000) };
}

export async function addLogEntry({ nftId, agent, action, outputCID }) {
  if (MOCK_MODE) {
    return { transactionId: 'MOCK_LOG_TX', nftId, agent, action, outputCID };
  }
  await ensureFlow(); // configure once
  // Keep this a stub unless you wire a real Cadence tx:
  return { transactionId: 'REAL_OR_MOCK_TX', nftId, agent, action, outputCID };
}

export async function getNftStory(id) {
  if (MOCK_MODE) {
    return [{ t: Date.now(), agent: 'MockAgent', action: 'Initialized', outputCID: 'bafyMOCK' }];
  }
  await ensureFlow(); // configure once
  // Stub a simple story; replace with a real script call if needed
  return [{ t: Date.now(), agent: 'KintaGen', action: 'Minted', outputCID: `project_init_${id}` }];
}
