# CLAUDE.md — LLM Context File

This file provides instant context for any LLM-based coding agent working on this repository.

## What This Project Is

A **single-user AI-powered life coaching backend**. Users write daily journal entries, and GPT-4o analyzes them to extract mood, energy, habits completed, goal progress, and health metrics. A chat endpoint lets users talk to an AI life coach that has full context of their history.

## Codebase Map

| File | Lines | Purpose |
|------|-------|---------|
| `index.js` | ~814 | **The entire backend.** Express server, all 14 REST endpoints, 5 helper functions, OpenAI integration, PostgreSQL queries. |
| `script.js` | ~78 | **One-off migration script.** Backfills embedding vectors for old journal entries in a legacy `stats` table. Not part of the running server. |
| `package.json` | ~22 | Dependencies and project config. ES Modules enabled (`"type": "module"`). |
| `docs/` | — | Documentation files for each component. |

## index.js Structure (top to bottom)

```
Lines   1-38    Imports, OpenAI client, PostgreSQL client, Express setup, CORS
Lines  39-51    generateEmbedding(text) — calls OpenAI ada-002, returns stringified array
Lines  53-91    getAIContext(sessionId?) — fetches last 7 entries + active goals + active habits + conversation history
Lines  93-123   updateGoalProgress(goalId, progressChange, reason, source) — increment/log goal progress
Lines 125-156   updateHabitStreak(habitId, success, notes) — update streak count + log
Lines 158-185   updateGoalMetrics(goalId, metricName, newValue, unit) — upsert numeric metric
Lines 187-365   POST /api/daily-entry — journal submission + full AI analysis pipeline
Lines 367-528   POST /api/chat — AI coach conversation + progress auto-detection
Lines 530-551   POST /api/goals — create goal
Lines 553-564   GET  /api/goals — list all goals
Lines 566-630   PUT  /api/goals/:id — update goal (dynamic field building)
Lines 632-647   DELETE /api/goals/:id — delete goal
Lines 649-670   POST /api/habits — create habit
Lines 672-683   GET  /api/habits — list all habits
Lines 685-701   POST /api/habits/:id/complete — log completion/failure
Lines 703-712   GET  /api/life-areas — list life area categories
Lines 714-757   GET  /api/stats — dashboard summary
Lines 759-774   GET  /api/daily-entries — entry history
Lines 776-791   GET  /api/goals/:id/progress — goal progress log
Lines 793-808   GET  /api/habits/:id/logs — habit completion log
Lines 810-814   app.listen(5000)
```

## Database Tables

Eight PostgreSQL tables. No ORM — raw SQL queries via `pg.Client`.

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `daily_entries` | date (unique), journal_entry, embedding, ai_extracted_mood/energy/water/smoke, ai_analysis | One entry per day (upsert) |
| `goals` | title, description, goal_embedding, life_area_id (FK), current_progress (0-100), status, goal_type | Types: achievement, learning, habit-breaking |
| `habits` | title, description, habit_embedding, life_area_id (FK), frequency, current_streak, longest_streak, status, habit_type | Types: formation, breaking, improvement |
| `goal_progress_logs` | goal_id (FK), progress_percentage, update_reason, source | Audit trail. Source: journal/conversation/manual |
| `goal_metrics` | goal_id (FK), metric_name, current_value, unit | Numeric KPIs (weight, savings, etc.) |
| `habit_logs` | habit_id (FK), success (boolean), notes | Per-completion record |
| `conversations` | session_id, user_message, ai_response, user_message_embedding, full_conversation_embedding | Multi-turn chat storage |
| `life_areas` | name, color, description | Pre-populated: Health, Finances, Relationships, Career, Personal Growth, etc. |

## Key Patterns to Know

1. **AI analysis pipeline**: Both `POST /api/daily-entry` and `POST /api/chat` use GPT-4o to detect goal/habit mentions, then auto-update progress via fuzzy `ILIKE '%title%'` matching.
2. **Embeddings are stored but never queried**: Every entry, goal, habit, and conversation gets an ada-002 embedding. No similarity search endpoint exists yet.
3. **One DB connection for everything**: Uses `pg.Client` (not `pg.Pool`). Single connection, no pooling.
4. **No authentication**: All endpoints are public. Single-user personal tool.
5. **No input validation**: Zod is imported but unused. Validation is minimal (just checks required fields exist).
6. **ES Modules**: All imports use `import`/`export` syntax. The `pg` package is imported via `import pkg from "pg"; const { Client } = pkg;` because it's a CommonJS package.

## Running the Project

```bash
npm install
# Create .env with: OPENAI_API_KEY, DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_SSL
# Create PostgreSQL tables (see docs/DATABASE_SCHEMA.md)
node index.js          # Starts on port 5000
```

## Common Modification Patterns

**Adding a new endpoint**: Add a new `app.get/post/put/delete` handler in `index.js` (all routes live in this single file).

**Adding a new database table**: Write raw SQL to create the table, then add queries in the endpoint handlers. No migration system exists.

**Changing AI behavior**: Modify the prompt strings in `POST /api/daily-entry` (lines 203-243) or `POST /api/chat` (lines 389-415, 432-453). Prompts include full user context.

**Adding authentication**: Would need to add middleware before the route handlers (after line 37). Currently no user model exists.

## Dependencies

| Package | Used For |
|---------|----------|
| `express` | HTTP server and routing |
| `cors` | Cross-origin requests (currently allows all origins) |
| `openai` | GPT-4o chat completions + ada-002 embeddings |
| `pg` | PostgreSQL client (raw SQL, no ORM) |
| `dotenv` | Load .env file into process.env |
| `zod` | Schema validation (imported in index.js but not actively used) |
| `cosine-similarity` | Installed but never imported or used |
| `nodemon` | Dev-only auto-restart on file changes |
