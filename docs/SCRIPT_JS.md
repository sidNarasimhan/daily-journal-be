# script.js — Embedding Backfill Utility

A one-off migration script that retroactively generates OpenAI embeddings for existing journal entries. **Not part of the running server.**

## Purpose

When the embedding feature was added to the project, older journal entries in the database didn't have embedding vectors. This script reads all existing entries and generates embeddings for them.

## Important: Legacy Schema

This script operates on the **old `stats` table**, not the current `daily_entries` table. It was written before the schema was refactored.

| Script uses | Current schema uses |
|-------------|-------------------|
| `stats` table | `daily_entries` table |
| `stats.embedding` column | `daily_entries.embedding` column |
| `stats.journal_entry` | `daily_entries.journal_entry` |

**To use this script with the current schema**, you would need to update the table name from `stats` to `daily_entries`.

## How It Works

### 1. Database Connection (Lines 1–14)

Connects directly to PostgreSQL with **hardcoded credentials** (not using dotenv):
- user: `postgres`
- host: `localhost`
- database: `daily`
- password: hardcoded
- port: `5432`

### 2. Date Formatting Helpers (Lines 15–33)

Two helper functions convert dates to human-readable words for embedding context:

- `numberToWords(n)` — Converts integers 1–31 to English words ("one", "twenty five", etc.)
- `dateToWords(date)` — Converts a Date object to `"Month day-in-words"` format (e.g., `"September twelve"`)

This gives the embedding model richer date context than raw `2024-09-12`.

### 3. Embedding Pipeline (Lines 36–74)

```
For each row in stats where journal_entry is not null/empty:
  1. Format: "Date:{month} {day-in-words} {journal_entry}"
  2. Call OpenAI text-embedding-ada-002
  3. UPDATE stats SET embedding = $1 WHERE date = $2
```

The embedding is stored as a raw array (not stringified like in `index.js`).

### 4. Execution (Lines 76–77)

Runs immediately when the file is executed:
```bash
node script.js
```

Processes all entries sequentially (no batching or parallelism). Closes the database connection when done.

## When to Use

- **You probably don't need this script.** The main server (`index.js`) generates embeddings for new entries automatically.
- Only useful if you have old entries in a `stats` table that need embeddings backfilled.
- Would need modification to work with the current `daily_entries` table.
