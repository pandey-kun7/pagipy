# pagipy — Agentic Webpage Version History & Visual-Semantic Tracking

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Google Gemma](https://img.shields.io/badge/Google%20Gemma-4--26b--a4b--it-orange.svg)](https://ai.google.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-Notion%20Theme-38B2AC.svg)](https://tailwindcss.com/)
[![Vitest](https://img.shields.io/badge/Vitest-53%20Passed-success.svg)](https://vitest.dev/)

**pagipy** is an enterprise-grade agentic version-history and visual-semantic tracking platform for public webpages. It provides automated continuous monitoring, immutable historical version archival, deterministic structured difference detection, cloud LLM semantic change analysis via **Google Gemma**, and grounded temporal Question & Answering (Q&A) with paired visual screenshot evidence.

---

## Table of Contents

- [What pagipy Is About](#what-pagipy-is-about)
- [How It Works](#how-it-works)
  - [1. Paired Observation Engine](#1-paired-observation-engine)
  - [2. Change Detection & Versioning Logic](#2-change-detection--versioning-logic)
  - [3. Deterministic Structured Diffs](#3-deterministic-structured-diffs)
  - [4. Gemma Cloud LLM Semantic Analysis](#4-gemma-cloud-llm-semantic-analysis)
  - [5. Grounded Historical As-Of Q&A](#5-grounded-historical-as-of-qa)
  - [6. Webhooks & Background Asynchronous Workers](#6-webhooks--background-asynchronous-workers)
- [Architecture & Invariants](#architecture--invariants)
  - [System Flow Diagram](#system-flow-diagram)
  - [Core System Invariants](#core-system-invariants)
- [Tech Stack](#tech-stack)
- [Project Layout](#project-layout)
- [Setup & Running Commands](#setup--running-commands)
  - [Prerequisites](#prerequisites)
  - [1. Installation](#1-installation)
  - [2. Environment Configuration](#2-environment-configuration)
  - [3. Database Migrations](#3-database-migrations)
  - [4. Seeding the 20 Monitored Targets](#4-seeding-the-20-monitored-targets)
  - [5. Running the Application](#5-running-the-application)
  - [6. Running Automated Tests](#6-running-automated-tests)
- [REST API Reference](#rest-api-reference)

---

## What pagipy Is About

Modern websites change constantly: terms of service update silently, SaaS pricing models pivot, API parameters deprecate, and regulatory compliance disclosures fluctuate. Traditional web archivers capture only raw static HTML or lossy images without semantic comprehension or structured change tracking.

**pagipy** addresses this by pairing:
1. **Authoritative Markdown text extraction** via TinyFish Monitor.
2. **Native WebSocket Chrome DevTools Protocol (CDP)** full-page screenshot capture via TinyFish Browser.
3. **Structured change tracking** that eliminates duplicate noise when content is unchanged.
4. **Google Gemma AI** to synthesize natural language summaries of what changed and answer temporal questions grounded in historical evidence.

---

## How It Works

### 1. Paired Observation Engine
Every scheduled tick or manual run executes under a single logical run record (`monitor_runs`). The run coordinator simultaneously dispatches:
* **TinyFish Monitor Adapter:** Calls `POST /v1/monitors/{id}/runs` to perform monitored page evaluation and extract canonical markdown.
* **TinyFish Browser CDP Engine:** Establishes a direct WebSocket connection with remote Chromium instances via native Chrome DevTools Protocol (`Page.enable`, `Emulation.setDeviceMetricsOverride`, `Page.captureScreenshot`). It captures full-length screenshots (up to 9,000+ px) in **1.5–4 seconds**, bypassing heavy wrappers that stall on web fonts or animations.
* **Concurrency Semaphore:** Batch and scheduled executions are throttled through an `AsyncSemaphore` (max 3 concurrent browser sessions) to guarantee socket reliability.

### 2. Change Detection & Versioning Logic
A **Run** represents an *observation attempt*, while a **Version** represents an *immutable historical milestone*.
* **Baseline Capture:** The initial run creates **Version 1** (`is_baseline: true`).
* **Subsequent Runs:**
  * Normalizes the markdown text (strips transient timestamps and whitespace differences) and calculates SHA-256 hashes (`raw_content_hash` and `normalized_content_hash`).
  * **If unchanged:** Skips version creation. The run record links to the latest existing version.
  * **If changed:** Increments version count to **Version N + 1** and persists immutable artifacts to `storage/artifacts/pages/{pageId}/v{N}/`:
    * `snapshot.md` (authoritative Markdown)
    * `screenshot.png` (authentic browser screenshot)
    * `version-manifest.json` (SHA-256 checksums, metadata, and timestamps)
* **Visual Integrity Invariant:** If browser screenshot capture fails, version creation is deferred and the run is marked `partial_success`. No version is ever created without paired visual proof.

### 3. Deterministic Structured Diffs
When a new version is created, or when any two arbitrary historical versions are compared, **pagipy** executes a section-aware line diff engine:
* Breaks Markdown documents into sections (`#`, `##`, `###`).
* Identifies added lines, removed lines, and line modifications.
* Stores structured diff statistics (additions, deletions, modifications, similarity score) in `page_diffs`.

### 4. Gemma Cloud LLM Semantic Analysis
Connected to the **Google Generative Language API** (`gemma-4-26b-a4b-it`):
* **Diff Summaries:** Analyzes structured diffs and generates concise, structured JSON summaries explaining what changed, key impact areas, and high-level bullet points.
* **Version Snapshot Summaries:** Inspects individual historical `snapshot.md` files to provide on-demand semantic summaries of what a page contained at that specific version.
* **Deterministic Fallback:** Robust fallback mechanisms guarantee valid structured summaries even in offline environments or API rate-limit states.

### 5. Grounded Historical As-Of Q&A
Users can query what a monitored webpage stated as of any arbitrary date and time in the past:
* **Zero Future-Leakage:** Queries strictly filter by `observed_at <= cutoffTimestamp` ordered descending. Future version data is strictly inaccessible.
* **Evidence Citation:** The engine extracts the historical snapshot, retrieves the paired screenshot, and prompts Gemma to answer the question solely from the archived text, citing exact Markdown quotes and displaying the verified screenshot.

### 6. Webhooks & Background Asynchronous Workers
* Ingests asynchronous webhook events from TinyFish (`POST /api/webhooks/tinyfish`) with signature verification and replay prevention.
* A background `JobWorker` processes queued asynchronous evaluation tasks and reconciles run states with immutable versions.

---

## Architecture & Invariants

### Core System Invariants

1. **Paired Execution:** Every run executes both Monitor and Browser under one logical run.
2. **Immutability:** Once written, version records and storage artifacts (`snapshot.md`, `screenshot.png`) are strictly append-only and never modified.
3. **No Duplicate Versions:** Unchanged runs link to existing versions without creating redundant records.
4. **Zero Future Leakage:** Historical queries strictly enforce `observed_at <= cutoff`.
5. **No Synthetic Proof:** No fallback 1x1 base64 screenshots. Runs without genuine visual evidence defer version creation.

---

## Tech Stack

| Component | Technology | Description |
|:---|:---|:---|
| **Runtime & Language** | Node.js 22+, TypeScript 5.7+ | Strict type safety and ES Modules |
| **Execution Tool** | `tsx` | TypeScript execution without manual compilation steps |
| **Backend Framework** | Express 4.21 | Modular REST API and static file serving |
| **Database** | PostgreSQL 16 (`pg`) | Relational persistence with connection pooling and transactions |
| **Browser CDP Engine** | Native WebSocket CDP client | Chrome DevTools Protocol direct capture (bypassing heavy wrappers) |
| **Web Monitor Provider**| TinyFish Monitor API | Authoritative Markdown extraction and change detection |
| **Discovery & Preflight**| TinyFish Fetch & Search API | URL preflight validation and category candidate search |
| **Cloud LLM** | Google Gemma (`gemma-4-26b-a4b-it`) | Semantic change synthesis and grounded Q&A |
| **Frontend** | Vanilla HTML5 / Tailwind CSS | Notion-inspired high-contrast light theme with zero build step |
| **Testing Engine** | Vitest 3.0 | Unit and integration test runner (53 automated tests) |

---

## Project Layout

```text
pagipy/
├── package.json                   # Dependencies, build scripts, test scripts
├── tsconfig.json                  # TypeScript compiler options (ES2022, NodeNext)
├── vitest.config.ts               # Vitest runner configuration
├── .env.example                   # Environment configuration template
├── done.md                        # Project delivery report & verification ledger
├── public/
│   └── index.html                 # Notion-inspired single-page application
├── storage/
│   └── artifacts/                 # Local artifact storage vault
│       └── pages/                 # Versioned snapshots, screenshots, manifests
├── src/
│   └── backend/
│       ├── index.ts               # Application entrypoint & graceful lifecycle
│       ├── config.ts              # Strongly-typed environment configuration
│       ├── server.ts              # Express app initialization & error middleware
│       ├── adapters/
│       │   ├── llm/
│       │   │   └── gemmaAdapter.ts      # Google Generative Language API adapter
│       │   └── tinyfish/
│       │       ├── browserAdapter.ts    # Native WebSocket CDP screenshot engine
│       │       ├── monitorAdapter.ts    # TinyFish Monitor API integration
│       │       ├── fetchAdapter.ts      # TinyFish Fetch preflight adapter
│       │       └── searchAdapter.ts     # TinyFish Search discovery adapter
│       ├── routes/
│       │   ├── pages.ts                 # Page CRUD, search, preflight, triggers, archive
│       │   ├── runs.ts                  # Run audit queries & run details
│       │   ├── health.ts                # Health check endpoint
│       │   └── webhooks.ts              # TinyFish webhook ingestion
│       ├── db/
│       │   ├── index.ts                 # PostgreSQL pool & transaction helper
│       │   ├── migrate.ts               # Migration runner
│       │   ├── seedRealPages.ts         # Seeder for 20 official monitored targets
│       │   └── migrations/
│       │       ├── 001_initial_schema.sql
│       │       └── 002_final_audit_and_resilience.sql
│       ├── services/
│       │   ├── runCoordinator.ts        # Paired execution coordinator & concurrency semaphore
│       │   ├── versionService.ts        # Hash-based change detection & version persistence
│       │   ├── diffService.ts           # Deterministic line diff & similarity engine
│       │   ├── historyService.ts        # Temporal As-Of retrieval & Q&A grounding
│       │   ├── schedulerService.ts      # Cron & interval scheduler
│       │   ├── gemmaService.ts          # LLM summary synthesis & schema validation
│       │   ├── webhookService.ts        # Webhook idempotency & event handling
│       │   └── jobWorker.ts             # Background asynchronous queue worker
│       ├── storage/
│       │   └── artifactStorage.ts       # Filesystem artifact vault & SHA-256 verifier
│       └── utils/
│           ├── logger.ts                # Structured JSON logging
│           ├── cron.ts                  # Cron parser & schedule calculator
│           └── url.ts                   # Canonical URL normalization
└── tests/
    ├── unit/
    │   ├── urlNormalization.test.ts     # URL canonicalization tests
    │   ├── scheduleCalculator.test.ts   # Cron and interval calculation tests
    │   ├── artifactStorage.test.ts      # Storage vault and SHA-256 tests
    │   ├── runCoordinator.test.ts       # Paired execution & fallback tests
    │   ├── diffAndHistory.test.ts       # Diff engine & temporal As-Of tests
    │   └── finalAuditAnd20Targets.test.ts# Snapshot summary & visual resilience tests
    └── integration/
        ├── health.test.ts               # Healthcheck endpoint tests
        ├── pageAndScheduler.test.ts     # Page lifecycle & scheduler integration
        ├── webhookAndHistory.test.ts    # Webhook ingestion & version creation
        └── frontendAndApi.test.ts       # Full end-to-end user journey tests
```

---

## Setup & Running Commands

### Prerequisites
* **Node.js**: v20.x or v22.x LTS
* **PostgreSQL**: v14, v15, or v16 running locally or remotely
* **TinyFish API Key**: Access to TinyFish Monitor & Browser CDP services
* **Google Gemma API Key**: Access to Google Generative Language API

---

### 1. Installation

Clone the repository and install dependencies:

```bash
cd pagipy
npm install
```

---

### 2. Environment Configuration

Copy the example configuration file and adjust variables:

```bash
cp .env.example .env
```

Ensure the following keys are set in `.env`:

```env
# Application
PORT=3000
NODE_ENV=development

# Database (PostgreSQL)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/timemachine

# Artifact Storage Vault Root
STORAGE_ROOT=./storage

# TinyFish Service Credentials
TINYFISH_API_KEY=your_tinyfish_api_key_here
TINYFISH_MONITOR_ENDPOINT=https://agent.tinyfish.ai
TINYFISH_BROWSER_ENDPOINT=https://api.browser.tinyfish.ai
TINYFISH_WEBHOOK_SECRET=your_webhook_secret_here

# Google Gemma Cloud LLM
GEMMA_API_KEY=your_gemma_api_key_here
GEMMA_API_ENDPOINT=https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent
GEMMA_MODEL=gemma-4-26b-a4b-it

# Scheduling and Worker Configuration
SCHEDULER_INTERVAL_MS=30000
WORKER_INTERVAL_MS=10000
```

---

### 3. Database Migrations

Apply database schemas and composite indexes:

```bash
npm run migrate
```

---

### 4. Seeding the 20 Monitored Targets

Preflights each official page via TinyFish Fetch, registers genuine TinyFish Monitor resources, and captures paired baseline executions:

```bash
npm run seed
```

---

### 5. Running the Application

#### Production Mode
Starts the server with automatic health validation, cron scheduler, and async job worker:

```bash
npm start
```

#### Development Mode (Auto-Reloading)
Watches for code changes and reloads automatically:

```bash
npm run dev
```

Open your browser at:
```
http://localhost:3000
```

---

### 6. Running Automated Tests

Run all 53 unit and integration tests via Vitest:

```bash
npm test
```

Watch mode for active development:

```bash
npm run test:watch
```

---

## REST API Reference

| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/api/health` | Comprehensive system health check (database, storage vault) |
| `GET` | `/api/pages` | List all monitored pages with pagination and latest version info |
| `POST` | `/api/pages` | Register a new monitored page with custom schedule |
| `POST` | `/api/pages/preflight` | Preflight inspect a live URL via TinyFish Fetch before creating |
| `GET` | `/api/pages/search-candidates` | Discover candidate pages for monitoring via TinyFish Search |
| `POST` | `/api/pages/:id/run` | Trigger an immediate paired execution (Monitor + Browser CDP) |
| `POST` | `/api/pages/:id/pause` | Pause scheduled monitoring for a page |
| `POST` | `/api/pages/:id/resume` | Resume scheduled monitoring for a page |
| `GET` | `/api/pages/:id/versions` | Retrieve immutable version timeline for a page |
| `GET` | `/api/versions/:id` | Fetch specific version metadata, snapshot markdown, and screenshot path |
| `POST` | `/api/versions/:id/summary` | Generate a Gemma semantic summary of a specific version's `snapshot.md` |
| `GET` | `/api/diffs` | Compare any two historical versions (`vA` & `vB`) with structured diff |
| `POST` | `/api/history/query` | Ask an evidence-grounded temporal question as-of a specific past timestamp |
| `GET` | `/api/runs` | Audit log of recent paired execution attempts |
| `POST` | `/api/webhooks/tinyfish` | Ingest and process asynchronous TinyFish webhook events |
