// src/services/flow.service.js
import * as fcl from '@onflow/fcl';
import ellipticPkg from 'elliptic';
import sha3Pkg from 'js-sha3';

const { ec: EC } = ellipticPkg;
const { sha3_256 } = sha3Pkg;
const ec = new EC('p256');

// --- 1. CONFIGURATION AND AUTHENTICATION ---

const SERVICE_ADDRESS = process.env.FLOW_TESTNET_ADDRESS;
const PRIVATE_KEY = process.env.FLOW_TESTNET_PRIVATE_KEY;
const KEY_INDEX = 0;

// Central FCL Configuration
if (!SERVICE_ADDRESS || !PRIVATE_KEY) {
  console.error("🔴 FATAL FLOW ERROR: Missing FLOW_TESTNET_ADDRESS or FLOW_TESTNET_PRIVATE_KEY in your .env file.");
  // We don't exit the process here so the main app can continue running,
  // but Flow transactions will fail.
} else {
  fcl.config()
    .put("accessNode.api", "https://rest-testnet.onflow.org")
    .put("0xNonFungibleToken", "0x631e88ae7f1d7c20") // Standard contract
    .put("0xMetadataViews", "0x631e88ae7f1d7c20")    // Standard contract
    .put("0xViewResolver", "0x631e88ae7f1d7c20")      // Standard contract
    .put("0xKintaGenNFT", SERVICE_ADDRESS);          // Your contract address
}


// Reusable Signing Function
function signWithP256Sha3(messageHex) {
  const key = ec.keyFromPrivate(Buffer.from(PRIVATE_KEY, "hex"));
  const msgHash = Buffer.from(sha3_256.arrayBuffer(Buffer.from(messageHex, "hex")));
  const signature = key.sign(msgHash, { canonical: true });
  return Buffer.concat([
    signature.r.toArrayLike(Buffer, "be", 32),
    signature.s.toArrayLike(Buffer, "be", 32),
  ]).toString("hex");
}

// Reusable FCL Authorizer for the service account
const authorization = (acct = {}) => ({
  ...acct,
  tempId: `${SERVICE_ADDRESS}-${KEY_INDEX}`,
  addr: fcl.withPrefix(SERVICE_ADDRESS),
  keyId: KEY_INDEX,
  signingFunction: async signable => ({
    addr: fcl.withPrefix(SERVICE_ADDRESS),
    keyId: KEY_INDEX,
    signature: signWithP256Sha3(signable.message),
  }),
});


// --- 2. REFACTORED SCRIPT LOGIC AS EXPORTED FUNCTIONS ---

/**
 * Mints a new KintaGenNFT for a project, depositing it into the service account's collection.
 * @param {object} params
 * @param {string} params.agent - The name of the agent creating the NFT.
 * @param {string} params.outputCID - An initial CID or identifier.
 * @param {string} params.runHash - A unique hash for this run.
 * @returns {Promise<{txId: string, nftId: number}>} The transaction ID and the new NFT ID.
 */
export async function mintProjectNFT({ agent, outputCID, runHash }) {
  const cadence = `
    import NonFungibleToken from 0xNonFungibleToken
    import KintaGenNFT from 0xKintaGenNFT
    import MetadataViews from 0xMetadataViews
    transaction(recipient: Address, agent: String, outputCID: String, runHash: String) {
        let minter: &KintaGenNFT.Minter
        let recipientCollection: &{NonFungibleToken.Receiver}
        prepare(signer: auth(BorrowValue) &Account) {
            let data = KintaGenNFT.resolveContractView(resourceType: nil, viewType: Type<MetadataViews.NFTCollectionData>())! as! MetadataViews.NFTCollectionData
            self.minter = signer.storage.borrow<&KintaGenNFT.Minter>(from: KintaGenNFT.MinterStoragePath) ?? panic("Minter not found in service account")
            self.recipientCollection = getAccount(recipient).capabilities.borrow<&{NonFungibleToken.Receiver}>(data.publicPath) ?? panic("Recipient has no NFT receiver capability")
        }
        execute {
            let nft <- self.minter.mint(agent: agent, outputCID: outputCID, runHash: runHash)
            let id = nft.id
            self.recipientCollection.deposit(token: <-nft)
            log("Minted KintaGenNFT with ID ".concat(id.toString()))
        }
    }`;

  console.log(`[FLOW] Minting project NFT...`);
  const txId = await fcl.mutate({
    cadence,
    args: (arg, t) => [
      arg(SERVICE_ADDRESS, t.Address), // The service account will own the NFT
      arg(agent, t.String),
      arg(outputCID, t.String),
      arg(runHash, t.String),
    ],
    proposer: authorization,
    payer: authorization,
    authorizations: [authorization],
    limit: 999,
  });

  console.log(`[FLOW] Submitted mint transaction: ${txId}`);
  const sealed = await fcl.tx(txId).onceSealed();
  
  if (sealed.status !== 4) { // 4 is the status code for 'SEALED'
    throw new Error(`Flow transaction failed with status: ${sealed.statusString}`);
  }
  
  console.log(`[FLOW] Mint transaction sealed: ${sealed.statusString}`);
  
  const mintEvent = sealed.events.find(e => e.type.includes('KintaGenNFT.Mint'));
  if (!mintEvent) throw new Error("Could not find Mint event in transaction.");
  
  const nftId = mintEvent.data.id;
  return { txId, nftId: Number(nftId) };
}

/**
 * Adds a new log entry to an existing NFT's story.
 * @param {object} params
 * @param {number} params.nftId - The ID of the NFT to update.
 * @param {string} params.agent - The name of the agent performing the action.
 * @param {string} params.action - A description of the action taken.
 * @param {string} params.outputCID - The CID or identifier resulting from this action.
 * @returns {Promise<object>} The sealed transaction object.
 */
export async function addLogEntry({ nftId, agent, action, outputCID }) {
  const cadence = `
    import NonFungibleToken from 0xNonFungibleToken
    import KintaGenNFT from 0xKintaGenNFT
    transaction(nftID: UInt64, agent: String, actionDescription: String, outputCID: String) {
        let nftRef: &KintaGenNFT.NFT
        prepare(signer: auth(BorrowValue) &Account) {
            let collection = signer.storage.borrow<&KintaGenNFT.Collection>(from: KintaGenNFT.CollectionStoragePath)
                ?? panic("Could not borrow a reference to the owner's Collection")
            self.nftRef = collection.borrowNFT(nftID)! as! &KintaGenNFT.NFT
        }
        execute {
            self.nftRef.addLogEntry(
                agent: agent,
                actionDescription: actionDescription,
                outputCID: outputCID
            )
            log("Successfully added new log entry to NFT")
        }
    }`;
  
  console.log(`[FLOW] Submitting log entry for NFT #${nftId}...`);
  const txId = await fcl.mutate({
    cadence,
    args: (arg, t) => [
      arg(String(nftId), t.UInt64), // Ensure nftId is a string for FCL arg
      arg(agent, t.String),
      arg(action, t.String),
      arg(outputCID, t.String),
    ],
    proposer: authorization,
    payer: authorization,
    authorizations: [authorization],
    limit: 999,
  });

  console.log(`[FLOW] Submitted log entry transaction: ${txId}`);
  const sealed = await fcl.tx(txId).onceSealed();
  console.log(`[FLOW] Log entry transaction sealed: ${sealed.statusString}`);
  return sealed;
}

/**
 * Gets the workflow story (log) for a given NFT.
 * @param {number} nftId - The ID of the NFT to query.
 * @returns {Promise<object[]|null>} An array of workflow steps, or null if not found.
 */
export async function getNftStory(nftId) {
  const cadence = `
    import ViewResolver from 0xViewResolver
    import KintaGenNFT from 0xKintaGenNFT
    access(all) fun main(ownerAddress: Address, nftID: UInt64): [KintaGenNFT.WorkflowStepView]? {
        let owner = getAccount(ownerAddress)
        let collectionCap = owner.capabilities.get<&{ViewResolver.ResolverCollection}>(KintaGenNFT.CollectionPublicPath)
        if collectionCap.borrow() == nil { panic("Could not borrow collection capability.") }
        let resolver = collectionCap.borrow()!.borrowViewResolver(id: nftID) ?? panic("Could not borrow view resolver.")
        let storyView = resolver.resolveView(Type<KintaGenNFT.WorkflowStepView>())
        return storyView as? [KintaGenNFT.WorkflowStepView]
    }`;
    
  console.log(`[FLOW] Fetching story for NFT #${nftId}`);
  return fcl.query({
    cadence,
    args: (arg, t) => [arg(SERVICE_ADDRESS, t.Address), arg(String(nftId), t.UInt64)],
  });
}

/**
 * Gets all NFT IDs owned by the service account.
 * @returns {Promise<number[]>} An array of NFT IDs.
 */
export async function getAllNftIds() {
  const cadence = `
    import KintaGenNFT from 0xKintaGenNFT
    access(all) fun main(ownerAddress: Address): [UInt64] {
        let owner = getAccount(ownerAddress)
        let collectionRef = owner.capabilities
            .get<&KintaGenNFT.Collection>(KintaGenNFT.CollectionPublicPath)
            .borrow()
            ?? panic("Could not borrow a reference to the KintaGenNFT Collection.")
        return collectionRef.getIDs()
    }`;
  
  console.log(`[FLOW] Fetching all NFT IDs from account: ${SERVICE_ADDRESS}`);
  const ids = await fcl.query({
    cadence,
    args: (arg, t) => [arg(SERVICE_ADDRESS, t.Address)],
  });
  return ids || []; // Return an empty array if query result is null/undefined
}