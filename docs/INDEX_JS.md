# index.js — Main Server File Documentation

This is the single-file monolith containing the entire backend: Express server setup, all API routes, helper functions, OpenAI integration, and PostgreSQL queries.

**Total lines**: ~814
**Runtime**: Node.js with ES Modules

---

## Section 1: Initialization (Lines 1–38)

### Imports and Client Setup (Lines 1–14)

```
dotenv       → loads .env file into process.env
express      → HTTP framework
cors         → cross-origin middleware
OpenAI       → GPT-4o and embedding API client
z (zod)      → imported but not used — available for future validation
pg.Client    → PostgreSQL client (CommonJS → requires destructuring from default import)
```

The OpenAI client reads `OPENAI_API_KEY` from the environment. The PostgreSQL client reads `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, and `DB_SSL`.

### Database Connection (Lines 16–25)

- Uses `pg.Client` (single connection, not a pool)
- SSL configured conditionally: `DB_SSL=true` enables SSL with `rejectUnauthorized: false`
- `client.connect()` is called immediately at module load (line 25) — the server does not wait for the connection to resolve before starting

### Express Setup (Lines 27–37)

- Port hardcoded to `5000`
- CORS allows all origins (`*`), all standard methods, `Content-Type` and `Authorization` headers
- Body parsers: `express.urlencoded` (extended) and `express.json`

---

## Section 2: Helper Functions (Lines 39–185)

### `generateEmbedding(text)` — Lines 39–51

**Purpose**: Convert text into a 1536-dimensional vector using OpenAI's ada-002 model.

**Input**: Any string
**Output**: A stringified JSON array like `"[0.0123, -0.0456, ...]"` or `null` on error
**Used by**: Every endpoint that creates/updates entries, goals, habits, or conversations

**Note**: Returns a string (not an array) because it's stored directly as text in PostgreSQL. The embeddings are not stored using pgvector or any specialized vector column type.

### `getAIContext(sessionId?)` — Lines 53–91

**Purpose**: Build the full user context object that gets injected into GPT-4o prompts.

**Returns**:
```js
{
  recentEntries: [],        // Last 7 daily_entries (most recent first)
  activeGoals: [],          // All goals with status='active', joined with life_areas
  activeHabits: [],         // All habits with status='active', joined with life_areas
  recentConversations: []   // Last 10 conversations for the given sessionId (empty if no sessionId)
}
```

**Called by**: `POST /api/daily-entry` (without sessionId), `POST /api/chat` (with sessionId)

### `updateGoalProgress(goalId, progressChange, reason, source)` — Lines 93–123

**Purpose**: Increment a goal's `current_progress` and log the change.

**Parameters**:
- `goalId` — integer, the goal to update
- `progressChange` — integer, added to current progress (clamped to 0–100)
- `reason` — string, human-readable explanation stored in logs
- `source` — `'journal'` or `'conversation'`, indicates what triggered the update

**Side effects**:
1. Updates `goals.current_progress`
2. Inserts a row into `goal_progress_logs`

### `updateHabitStreak(habitId, success, notes)` — Lines 125–156

**Purpose**: Update a habit's streak counter and log the completion.

**Logic**:
- If `success=true`: `current_streak += 1`, update `longest_streak` if exceeded
- If `success=false`: `current_streak = 0`

**Side effects**:
1. Updates `habits.current_streak` and `habits.longest_streak`
2. Inserts a row into `habit_logs`

**Returns**: `{ newStreak, newLongestStreak }`

### `updateGoalMetrics(goalId, metricName, newValue, unit)` — Lines 158–185

**Purpose**: Upsert a numeric metric for a goal (e.g., weight=95.5kg, savings=15.2 lakhs).

**Logic**: If a metric with the same `goal_id + metric_name` exists, update it. Otherwise, insert a new row.

**Side effects**: Writes to `goal_metrics` table.

---

## Section 3: POST /api/daily-entry (Lines 187–365)

**The most complex endpoint.** Handles the full journal entry analysis pipeline.

### Request

```json
{ "entry": "Today I went to the gym and drank 3 liters of water..." }
```

### Processing Flow

1. **Validate** (line 191): Entry must be non-empty
2. **Generate embedding** (line 197): ada-002 vector for the journal text
3. **Load context** (line 200): `getAIContext()` fetches entries, goals, habits
4. **GPT-4o analysis** (lines 203–251): Sends a detailed prompt asking the AI to extract:
   - `mood` (1–10)
   - `energy` (1–10)
   - `water` (liters)
   - `smoke` (cigarettes)
   - `analysis` (2–3 sentence summary)
   - `goal_activities` (array of goal titles detected)
   - `habit_completions` (array of habit titles completed)
   - `habit_failures` (array of habit titles failed)
   - `metrics` (array of `{name, value, unit}`)
   - Uses `response_format: { type: "json_object" }` to enforce JSON output
5. **Update habit streaks** (lines 258–287): For each detected habit, fuzzy-match by title (`ILIKE '%title%'`), then call `updateHabitStreak`
6. **Update goal progress** (lines 290–303): For each detected goal, fuzzy-match, then call `updateGoalProgress` with +5%
7. **Update goal metrics** (lines 306–318): For each metric, fuzzy-match goal by metric name, then call `updateGoalMetrics`
8. **Store entry** (lines 321–354): Upsert into `daily_entries` using `ON CONFLICT (date) DO UPDATE`

### Response

```json
{
  "success": true,
  "entry": { /* full daily_entries row */ },
  "analysis": { /* raw GPT-4o JSON output */ }
}
```

---

## Section 4: POST /api/chat (Lines 367–528)

**Second most complex endpoint.** AI coaching conversation with auto-detection of progress.

### Request

```json
{ "message": "I ran 5km today!", "sessionId": "session_123" }
```

`sessionId` is optional. If omitted, a new one is generated as `session_${Date.now()}`.

### Processing Flow

1. **Generate embeddings** (lines 377–378): Two separate embedding calls for `userMessageEmbedding` and `fullConversationEmbedding` (currently identical — both embed just the user message)
2. **Load context** (line 381): `getAIContext(sessionId)` — includes conversation history for this session
3. **Build conversation history** (lines 384–386): Formats prior messages as `"User: ...\nAI: ..."`
4. **GPT-4o coaching response** (lines 389–422): System prompt instructs AI to act as a "personal life coach" — keeps responses to 3–4 sentences
5. **Store conversation** (lines 425–429): Insert into `conversations` table with embeddings
6. **GPT-4o progress detection** (lines 432–459): Second API call analyzes the message for goal/habit/metric mentions, returns JSON
7. **Auto-update goals** (lines 464–475): +3% progress per goal mention (source: `'conversation'`)
8. **Auto-update habits** (lines 478–503): Streak increment/reset based on detected completions/failures
9. **Auto-update metrics** (lines 506–517): Same as daily entry metric handling

### Response

```json
{
  "success": true,
  "response": "Great job on the 5km run! ...",
  "sessionId": "session_123"
}
```

---

## Section 5: Goal CRUD (Lines 530–647)

### POST /api/goals (Lines 530–551)

Creates a goal. Required: `title`, `life_area_id`. Optional: `description`, `target_date`, `goal_type` (defaults to `'achievement'`). Generates an embedding from `"title description"`.

### GET /api/goals (Lines 553–564)

Returns all goals joined with `life_areas` for `life_area_name` and `color`. Ordered by `created_at DESC`.

### PUT /api/goals/:id (Lines 566–630)

Dynamic update — only modifies fields present in the request body. Rebuilds the embedding if `title` or `description` changes. Uses parameterized query with dynamic `$N` placeholders.

### DELETE /api/goals/:id (Lines 632–647)

Simple delete by ID. Returns 404 if not found.

---

## Section 6: Habit Management (Lines 649–701)

### POST /api/habits (Lines 649–670)

Creates a habit. Required: `title`, `life_area_id`, `frequency`. Optional: `description`, `target_count` (default 1), `habit_type` (default `'formation'`).

### GET /api/habits (Lines 672–683)

Returns all habits joined with `life_areas`. Ordered by `created_at DESC`.

### POST /api/habits/:id/complete (Lines 685–701)

Logs a habit completion or failure. `success` defaults to `true` if not explicitly set to `false`. Delegates to `updateHabitStreak()`.

---

## Section 7: Read-Only Endpoints (Lines 703–808)

### GET /api/life-areas (Lines 703–712)

Returns all life area categories, ordered alphabetically.

### GET /api/stats (Lines 714–757)

Dashboard endpoint. Runs 5 queries:
1. Latest daily entry
2. Entry count in last 7 days
3. Active goals count
4. Active habits count
5. Top 5 habit streaks

Returns aggregated stats object.

### GET /api/daily-entries (Lines 759–774)

Paginated journal history. Query param: `limit` (default 30).

### GET /api/goals/:id/progress (Lines 776–791)

Returns `goal_progress_logs` for a specific goal, ordered by most recent.

### GET /api/habits/:id/logs (Lines 793–808)

Returns `habit_logs` for a specific habit, ordered by most recent.

---

## Section 8: Server Start (Lines 810–814)

```js
app.listen(5000, () => { console.log("Life Progress Tracker running on http://localhost:5000"); });
```

No graceful shutdown handler. No health check endpoint.
