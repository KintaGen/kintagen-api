# KintaGen API (Backend)

> Node.js 18+ · Express 5 · PostgreSQL · Synapse SDK (Filecoin) · Flow · Lit Protocol

This repository contains the **server-side application** for KintaGen. It orchestrates all backend logic, including:

*   REST endpoints for data upload, querying, chat (RAG), and analysis.
*   Securely uploading files to **Filecoin** via the Synapse SDK with FilCDN hot-storage.
*   Executing on-chain transactions with **Flow** for NFT minting and logbook updates.
*   Managing all metadata in a **PostgreSQL** database.
*   Running local **R-scripts** for scientific computations (LD50, XCMS).

---

## 1. Prerequisites

| Item | Version | Purpose |
| :--- | :--- | :--- |
| **Node.js** | ≥ 18 LTS | JavaScript Runtime |
| **pnpm** | ≥ 8 | Recommended Package Manager |
| **PostgreSQL** | ≥ 15 | Metadata Database (`paper`, `experiment`, etc.) |
| **Docker** *(optional)* | Latest | For quickly running a local Postgres instance |
| **Flow Testnet Account** | with ~0.2 FLOW | To sign transactions for NFT minting |
| **Filecoin Wallet Key** | 66-char hex | For signing Synapse uploads to Filecoin |

---

## 2. Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/KintaGen/kintagen.git
    cd kintagen
    ```
2.  **Install all dependencies:**
    ```bash
    pnpm install
    ```
    > This command installs dependencies for both the frontend and backend workspaces.

---

## 3. Environment Variables

The server will exit on startup if critical keys are missing.

1.  **Copy the template:**
    ```bash
    cp server/.env.example server/.env
    ```
2.  **Edit `server/.env` with your credentials:**

| Variable | Description |
| :--- | :--- |
| `PORT` | HTTP port for the API server (defaults to 3001). |
| `POSTGRES_DSN` | Full connection string for your PostgreSQL database. |
| `SYNAPSE_PRIVATE_KEY` | Your **0x-prefixed** private key for a Filecoin wallet. |
| `SYNAPSE_NETWORK` | The target Filecoin network (e.g., `calibration`). |
| `SYNAPSE_RPC_URL` | *(Optional)* Overrides the default RPC for the specified network. |
| `MOSAIA_HTTP_API_KEY` | API key for the Mosaia service (LLM completions). |
| `EXA_API_KEY` | API key for Exa semantic web search. |
| `FLOW_TESTNET_ADDRESS` | Address of the service account that will own and manage NFTs. |
| `FLOW_TESTNET_PRIVATE_KEY` | Private key for the Flow service account. |
| `DISABLE_R_SCRIPTS` | *(Optional)* Set to `true` if R is not installed; analysis endpoints will return a 503 error. |

---

## 4. Database Setup

### 4.1. Quick Start with Docker

This is the recommended way to run a local database for development.

```bash
# This command starts a Postgres 15 container on port 5432
docker run --name kintagen-db -e POSTGRES_USER=kintagen -e POSTGRES_PASSWORD=kintagen -e POSTGRES_DB=kintagen -p 5432:5432 -d postgres:15

# Set your DSN to match
export POSTGRES_DSN=postgresql://kintagen:kintagen@localhost:5432/kintagen
```

### 4.2. Initialize Schema

After setting up your database and `POSTGRES_DSN` variable, run the initialization script:

```bash
# From the repository root
pnpm --filter server run init-db
```
This creates all the necessary tables and foreign key relationships as defined in `src/init-db.js`.

---

## 5. Running in Development

```bash
# This command uses nodemon for auto-reloading on file changes
pnpm --filter server run dev
```
The server will start on `http://localhost:3001`. On a successful boot, you will see logs confirming database, Synapse, and Flow service connections.

---

## 6. Key NPM Scripts

All scripts are run from the repository root using the `--filter server` flag.

| Command | Purpose |
| :--- | :--- |
| `pnpm --filter server run dev` | Starts the server with `--watch` for development. |
| `pnpm --filter server run start` | Runs the server in production mode. |
| `pnpm --filter server run init-db` | Creates all database tables if they don't exist. |
| `pnpm --filter server run reset-db --force` | **DESTRUCTIVE!** Drops all tables. Requires `--force` flag. |
| `pnpm --filter server run setup` | One-time Synapse wallet diagnostic and token approval setup. |

---

## 7. Project Structure

```plaintext
server/
├─ src/
│  ├─ controllers/     # Route handlers (the "C" in MVC)
│  ├─ services/        # Business logic layer (e.g., db queries, chain interactions)
│  │   ├─ db.js        # PostgreSQL Pool wrapper
│  │   ├─ flow.service.js   # Flow Cadence transaction logic
│  │   ├─ synapse.js   # Filecoin upload via Synapse SDK
│  │   ├─ ai.service.js     # Mosaia & Exa integrations
│  │   └─ analysis.service.js # Spawns and manages R scripts
│  ├─ routes/          # API route definitions
│  └─ server.js        # Express application entrypoint & middleware
├─ scripts/            # R pipelines (ld50_analysis.R, xcms_analysis.R)
└─ .env.example        # Environment variable template
```

---

## 8. API Endpoints

| Method & Path | Purpose |
| :--- | :--- |
| `POST /api/upload` | Upload a paper or experiment file. Handled by `multer`. |
| `GET /api/data/:type` | List records (e.g., `paper`, `experiment`) with sorting & filtering. |
| `POST /api/analyze-ld50` | Body `{dataUrl}` → runs LD50 script → returns JSON result with plot. |
| `POST /api/projects` | Create a new project in the database. |
| `POST /api/projects/:id/mint` | Mints the on-chain Flow NFT logbook for a project. |
| `POST /api/projects/:id/log` | Appends a new step to a project's NFT logbook. |
| `GET /api/nfts/:id/story` | Returns the `WorkflowStepView` array for rendering a timeline. |
| `POST /api/chat` | Send a message history for a RAG-based chat response. |

*(See `src/routes/api.js` for the complete list and request/response details.)*

---

## 9. Production Deployment

1.  **Build the Frontend:** Ensure the frontend is built (`pnpm build`) and served by a static host (e.g., NGINX, Vercel).
2.  **Configure Environment:** In your production environment (e.g., Docker, cloud VM), set all required environment variables. **Never commit private keys to Git.** Use your platform's secret management tools (e.g., Docker Secrets, HashiCorp Vault).
3.  **Run the Server:** Use a process manager like `pm2` or `systemd` to run the application and ensure it restarts on failure.
    ```bash
    # Example using pm2
    pnpm --filter server run start
    ```
4.  **Database Migrations:** Before deploying a new version, run any necessary database migration scripts in your CI/CD pipeline or manually.

---

## 10. Troubleshooting

| Log Prefix / Error | Meaning & Action |
| :--- | :--- |
| **`[SYNAPSE] Upload process failed`** | Most likely insufficient USDFC allowance or deposit. **Action:** Run `pnpm --filter server run setup` to approve the service and deposit funds. |
| **`[FLOW] Transaction failed`** | Often caused by insufficient gas in the service account wallet. **Action:** Fund your `FLOW_TESTNET_ADDRESS` with testnet FLOW from a faucet. |
| **`psql: connection refused`** | The API server cannot connect to the database. **Actions:** 1. Ensure your Postgres server (or Docker container) is running. 2. Verify the `POSTGRES_DSN` in your `.env` file is correct. |
| **`[API ERROR] in processAndUploadHandler`** | A general error during file upload. Check the server logs for details. Often caused by a malformed file or a downstream service (like AI metadata extraction) failing. |
