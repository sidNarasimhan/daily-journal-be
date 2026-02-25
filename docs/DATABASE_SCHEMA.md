# Database Schema Reference

PostgreSQL database used by the Life Progress Tracker backend. All tables must be created manually — there is no migration system.

## Entity Relationship Diagram

```
life_areas
    │
    ├──< goals ──< goal_progress_logs
    │       │
    │       └──< goal_metrics
    │
    └──< habits ──< habit_logs

daily_entries (standalone)
conversations (standalone)
```

`<` = one-to-many relationship

---

## Tables

### `life_areas`

Pre-populated reference table of life categories.

```sql
CREATE TABLE life_areas (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7),                -- hex color for UI (e.g., '#FF5733')
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Seed data** (populate after creation):

```sql
INSERT INTO life_areas (name, color, description) VALUES
('Health', '#FF5733', 'Physical and mental health'),
('Finances', '#33FF57', 'Financial goals and savings'),
('Relationships', '#3357FF', 'Family, friends, and social connections'),
('Career', '#FF33F5', 'Professional development and work'),
('Personal Growth', '#F5FF33', 'Learning, skills, and self-improvement'),
('Fitness', '#33FFF5', 'Exercise and physical activity'),
('Mental Health', '#FF8C33', 'Emotional wellbeing and mindfulness');
```

---

### `daily_entries`

One row per calendar day. Stores the journal entry and all AI-extracted metrics.

```sql
CREATE TABLE daily_entries (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,               -- one entry per day (used for upsert)
    journal_entry TEXT NOT NULL,
    embedding TEXT,                           -- stringified JSON array of 1536 floats
    ai_extracted_mood INTEGER,               -- 1-10 scale
    ai_extracted_energy INTEGER,             -- 1-10 scale
    ai_extracted_water DECIMAL,              -- liters
    ai_extracted_smoke INTEGER,              -- cigarette count
    ai_analysis TEXT,                        -- AI's 2-3 sentence analysis
    habit_completions JSONB,                 -- {"habitId": {"success": true, "notes": "..."}}
    goal_mentions JSONB,                     -- {"goalId": {"progress": 5, "reason": "..."}}
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key behavior**: `ON CONFLICT (date) DO UPDATE` — submitting a second entry on the same day overwrites the first.

---

### `goals`

User-defined goals with progress tracking.

```sql
CREATE TABLE goals (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    goal_embedding TEXT,                     -- stringified embedding of "title description"
    life_area_id INTEGER REFERENCES life_areas(id),
    target_date DATE,
    goal_type VARCHAR(50) DEFAULT 'achievement',  -- achievement, learning, habit-breaking
    current_progress INTEGER DEFAULT 0,      -- 0-100 percentage
    status VARCHAR(20) DEFAULT 'active',     -- active, completed, archived
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Progress updates**: Automatically incremented by +5% (journal) or +3% (chat) when AI detects the goal was mentioned. Manual updates via `PUT /api/goals/:id`.

---

### `goal_progress_logs`

Audit trail for every goal progress change.

```sql
CREATE TABLE goal_progress_logs (
    id SERIAL PRIMARY KEY,
    goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
    progress_percentage INTEGER NOT NULL,    -- the new progress value after the update
    update_reason TEXT,                      -- human-readable reason
    source VARCHAR(20),                      -- 'journal', 'conversation', or 'manual'
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

### `goal_metrics`

Numeric KPIs associated with goals (e.g., weight, savings amount).

```sql
CREATE TABLE goal_metrics (
    id SERIAL PRIMARY KEY,
    goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
    metric_name VARCHAR(100) NOT NULL,       -- e.g., 'weight', 'savings', 'distance'
    current_value DECIMAL NOT NULL,
    unit VARCHAR(50),                        -- e.g., 'kg', 'lakhs', 'km'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Upsert logic**: The application checks for existing `goal_id + metric_name` before inserting. No unique constraint in the schema — enforced in application code.

---

### `habits`

User-defined habits with streak tracking.

```sql
CREATE TABLE habits (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    habit_embedding TEXT,                    -- stringified embedding of "title description"
    life_area_id INTEGER REFERENCES life_areas(id),
    frequency VARCHAR(20) NOT NULL,          -- 'daily', 'weekly', 'monthly'
    target_count INTEGER DEFAULT 1,          -- times per period
    habit_type VARCHAR(50) DEFAULT 'formation',  -- formation, breaking, improvement
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',     -- active, paused, archived
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Streak logic**:
- Success → `current_streak += 1`, `longest_streak = max(longest_streak, current_streak)`
- Failure → `current_streak = 0`

---

### `habit_logs`

Per-completion/failure record for habits.

```sql
CREATE TABLE habit_logs (
    id SERIAL PRIMARY KEY,
    habit_id INTEGER REFERENCES habits(id) ON DELETE CASCADE,
    success BOOLEAN NOT NULL,
    notes TEXT,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

### `conversations`

Stores AI coach chat history with embeddings.

```sql
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,        -- groups multi-turn conversations
    user_message TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    user_message_embedding TEXT,              -- stringified embedding of user message
    full_conversation_embedding TEXT,         -- stringified embedding (currently same as user_message_embedding)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Session IDs**: Either provided by the client or auto-generated as `session_${Date.now()}`.

---

## Full Setup Script

Run this to create all tables from scratch:

```sql
-- 1. Life Areas (reference table)
CREATE TABLE life_areas (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO life_areas (name, color, description) VALUES
('Health', '#FF5733', 'Physical and mental health'),
('Finances', '#33FF57', 'Financial goals and savings'),
('Relationships', '#3357FF', 'Family, friends, and social connections'),
('Career', '#FF33F5', 'Professional development and work'),
('Personal Growth', '#F5FF33', 'Learning, skills, and self-improvement'),
('Fitness', '#33FFF5', 'Exercise and physical activity'),
('Mental Health', '#FF8C33', 'Emotional wellbeing and mindfulness');

-- 2. Daily Entries
CREATE TABLE daily_entries (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    journal_entry TEXT NOT NULL,
    embedding TEXT,
    ai_extracted_mood INTEGER,
    ai_extracted_energy INTEGER,
    ai_extracted_water DECIMAL,
    ai_extracted_smoke INTEGER,
    ai_analysis TEXT,
    habit_completions JSONB,
    goal_mentions JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Goals
CREATE TABLE goals (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    goal_embedding TEXT,
    life_area_id INTEGER REFERENCES life_areas(id),
    target_date DATE,
    goal_type VARCHAR(50) DEFAULT 'achievement',
    current_progress INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Goal Progress Logs
CREATE TABLE goal_progress_logs (
    id SERIAL PRIMARY KEY,
    goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
    progress_percentage INTEGER NOT NULL,
    update_reason TEXT,
    source VARCHAR(20),
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Goal Metrics
CREATE TABLE goal_metrics (
    id SERIAL PRIMARY KEY,
    goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
    metric_name VARCHAR(100) NOT NULL,
    current_value DECIMAL NOT NULL,
    unit VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Habits
CREATE TABLE habits (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    habit_embedding TEXT,
    life_area_id INTEGER REFERENCES life_areas(id),
    frequency VARCHAR(20) NOT NULL,
    target_count INTEGER DEFAULT 1,
    habit_type VARCHAR(50) DEFAULT 'formation',
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Habit Logs
CREATE TABLE habit_logs (
    id SERIAL PRIMARY KEY,
    habit_id INTEGER REFERENCES habits(id) ON DELETE CASCADE,
    success BOOLEAN NOT NULL,
    notes TEXT,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Conversations
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    user_message TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    user_message_embedding TEXT,
    full_conversation_embedding TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Notes

- **No migration system**: Tables must be created/altered manually.
- **No indexes beyond primary keys**: Consider adding indexes on `goals.status`, `habits.status`, `daily_entries.date`, `conversations.session_id` for production use.
- **Embeddings stored as TEXT**: Not using pgvector. Stored as stringified JSON arrays. To enable actual vector similarity search, you would need to install the pgvector extension and change the column types.
- **JSONB columns**: `daily_entries.habit_completions` and `daily_entries.goal_mentions` store structured data as JSONB.
