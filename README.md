# Life Progress Tracker — Backend API

An AI-powered personal life coaching and progress tracking REST API. Users submit daily journal entries that are automatically analyzed by GPT-4o for mood, energy, habits, and goal progress. A conversational AI coach provides personalized guidance based on the user's full history.

## Architecture Overview

```
Client (any frontend)
    │
    ▼
Express.js REST API (index.js — single-file monolith, port 5000)
    │
    ├── OpenAI GPT-4o ── journal analysis, coaching chat, progress detection
    ├── OpenAI Embeddings (text-embedding-ada-002) ── semantic vectors for future search
    │
    └── PostgreSQL ── all persistent state
         ├── daily_entries        (journal + AI-extracted metrics)
         ├── goals                (user goals with progress tracking)
         ├── habits               (user habits with streak tracking)
         ├── goal_progress_logs   (audit trail for goal changes)
         ├── goal_metrics         (numeric KPIs tied to goals)
         ├── habit_logs           (per-completion records)
         ├── conversations        (chat history with embeddings)
         └── life_areas           (pre-populated categories)
```

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | ES Modules (`"type": "module"`) |
| Framework | Express.js | ^4.21.0 |
| Database | PostgreSQL | via `pg` ^8.13.0 |
| AI | OpenAI API | ^4.67.1 (GPT-4o + ada-002 embeddings) |
| Validation | Zod | ^3.23.8 (imported but not yet used) |
| Env Config | dotenv | ^16.4.5 |
| Dev Server | nodemon | ^3.1.7 |

## Quick Start

### Prerequisites

- Node.js (v18+)
- PostgreSQL database (local or remote)
- OpenAI API key

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=sk-your-key-here
DB_USER=postgres
DB_HOST=localhost
DB_NAME=daily
DB_PASSWORD=your-password
DB_PORT=5432
DB_SSL=false
```

Set `DB_SSL=true` for remote/cloud databases (uses `rejectUnauthorized: false`).

### 3. Set up the database

The application expects the PostgreSQL tables to already exist. See [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) for the full schema you need to create.

### 4. Run the server

```bash
node index.js
# Or with auto-reload:
npx nodemon index.js
```

The server starts on `http://localhost:5000`.

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/daily-entry` | Submit a journal entry (triggers AI analysis) |
| `GET` | `/api/daily-entries` | Get journal entry history |
| `POST` | `/api/chat` | Chat with AI life coach |
| `POST` | `/api/goals` | Create a goal |
| `GET` | `/api/goals` | List all goals |
| `PUT` | `/api/goals/:id` | Update a goal |
| `DELETE` | `/api/goals/:id` | Delete a goal |
| `GET` | `/api/goals/:id/progress` | Get goal progress history |
| `POST` | `/api/habits` | Create a habit |
| `GET` | `/api/habits` | List all habits |
| `POST` | `/api/habits/:id/complete` | Log habit completion/failure |
| `GET` | `/api/habits/:id/logs` | Get habit completion history |
| `GET` | `/api/life-areas` | List life area categories |
| `GET` | `/api/stats` | Dashboard summary statistics |

Full request/response details: [docs/API_REFERENCE.md](docs/API_REFERENCE.md)

## How the AI Integration Works

### Journal Entry Analysis (`POST /api/daily-entry`)

1. User submits free-text journal entry
2. System generates an embedding vector for semantic search
3. GPT-4o receives the entry along with context (last 7 entries, active goals, active habits)
4. AI extracts: mood (1-10), energy (1-10), water intake, smoking count, text analysis
5. AI detects mentions of goals and habits in the text
6. System auto-updates goal progress (+5% per mention) and habit streaks
7. AI detects numeric metrics (weight, savings, etc.) and updates goal_metrics
8. Everything is stored in `daily_entries` (upsert on date — one entry per day)

### AI Coach Chat (`POST /api/chat`)

1. User sends a message (optionally with a `sessionId` for multi-turn conversations)
2. System loads full context: recent entries, goals, habits, conversation history
3. GPT-4o responds as a personal life coach (3-4 sentence responses)
4. A second GPT-4o call detects any goal/habit progress mentioned in the message
5. System auto-updates goals (+3% per mention) and habits accordingly
6. Conversation is stored with embeddings for future retrieval

### AI API Calls Per Request

| Endpoint | Embedding Calls | GPT-4o Calls | Total |
|----------|----------------|-------------|-------|
| `POST /api/daily-entry` | 1 | 1 | 2 |
| `POST /api/chat` | 2 | 2 | 4 |
| `POST /api/goals` | 1 | 0 | 1 |
| `POST /api/habits` | 1 | 0 | 1 |

## Project Structure

```
daily-journal-be/
├── index.js          # Entire backend application (Express server, routes, helpers)
├── script.js         # One-off utility: backfill embeddings for old journal entries
├── package.json      # Dependencies and project metadata
├── .env              # Environment variables (not committed)
├── docs/
│   ├── INDEX_JS.md         # Line-by-line documentation of the main server file
│   ├── SCRIPT_JS.md        # Documentation of the migration script
│   ├── DATABASE_SCHEMA.md  # Full PostgreSQL schema reference
│   └── API_REFERENCE.md    # Complete API endpoint documentation
├── CLAUDE.md         # LLM agent context file (for AI coding assistants)
└── README.md         # This file
```

## Key Design Decisions

- **Single-file monolith**: All server code lives in `index.js` (~814 lines). This is a personal project/prototype — no route splitting or MVC structure.
- **One entry per day**: `daily_entries` has a unique constraint on `date` with upsert behavior. Submitting twice on the same day updates the existing entry.
- **Fuzzy matching for AI detection**: When AI identifies goal/habit mentions, the system uses `ILIKE '%title%'` to find matching records. This can produce false positives.
- **Auto-progress updates**: Journal entries increment goal progress by 5%, chat messages by 3%. This is a heuristic, not user-confirmed.
- **Embeddings stored but not queried**: Embedding vectors are generated and stored for entries, goals, habits, and conversations, but no semantic search endpoint exists yet.
- **No authentication**: All endpoints are public. This is a single-user personal tool.
- **Single database client**: Uses `pg.Client` (not `pg.Pool`), meaning one connection shared across all requests.

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key for GPT-4o and embeddings |
| `DB_USER` | Yes | — | PostgreSQL username |
| `DB_HOST` | Yes | — | PostgreSQL host |
| `DB_NAME` | Yes | — | PostgreSQL database name |
| `DB_PASSWORD` | Yes | — | PostgreSQL password |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_SSL` | No | `false` | Set to `"true"` for SSL connections |
