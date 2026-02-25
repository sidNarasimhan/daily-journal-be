# API Reference

Base URL: `http://localhost:5000`

All endpoints accept and return JSON. No authentication required.

---

## Daily Entries

### POST /api/daily-entry

Submit a daily journal entry. Triggers full AI analysis pipeline.

**Request:**
```json
{
  "entry": "Today I went to the gym, drank 3 liters of water, and worked on my savings goal. Didn't smoke at all."
}
```

**Response (200):**
```json
{
  "success": true,
  "entry": {
    "id": 42,
    "date": "2024-11-15",
    "journal_entry": "Today I went to the gym...",
    "embedding": "[0.0123, -0.0456, ...]",
    "ai_extracted_mood": 8,
    "ai_extracted_energy": 7,
    "ai_extracted_water": 3,
    "ai_extracted_smoke": 0,
    "ai_analysis": "The user had a productive day focused on health and finances...",
    "habit_completions": {"3": {"success": true, "notes": "Completed"}},
    "goal_mentions": {"1": {"progress": 5, "reason": "Worked on goal"}},
    "created_at": "2024-11-15T10:30:00.000Z",
    "updated_at": "2024-11-15T10:30:00.000Z"
  },
  "analysis": {
    "mood": 8,
    "energy": 7,
    "water": 3,
    "smoke": 0,
    "analysis": "The user had a productive day...",
    "goal_activities": ["savings"],
    "habit_completions": ["gym", "water intake"],
    "habit_failures": [],
    "metrics": [{"name": "water", "value": 3, "unit": "liters"}]
  }
}
```

**Error (400):** `{ "error": "Journal entry is required" }`

**Side effects:**
- Generates embedding (1 OpenAI API call)
- Runs AI analysis (1 GPT-4o call)
- Auto-updates habit streaks for detected completions/failures
- Auto-increments goal progress by +5% for each detected goal mention
- Auto-updates goal metrics for detected numeric values
- Upserts into `daily_entries` (one entry per day)

---

### GET /api/daily-entries

Retrieve journal entry history.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 30 | Max entries to return |

**Example:** `GET /api/daily-entries?limit=7`

**Response (200):**
```json
[
  {
    "id": 42,
    "date": "2024-11-15",
    "journal_entry": "Today I went to the gym...",
    "ai_extracted_mood": 8,
    "ai_extracted_energy": 7,
    "ai_extracted_water": 3,
    "ai_extracted_smoke": 0,
    "ai_analysis": "The user had a productive day...",
    "habit_completions": {},
    "goal_mentions": {},
    "created_at": "2024-11-15T10:30:00.000Z",
    "updated_at": "2024-11-15T10:30:00.000Z"
  }
]
```

---

## AI Chat

### POST /api/chat

Conversational interaction with the AI life coach.

**Request:**
```json
{
  "message": "I ran 5km today and I'm feeling great about my fitness goal!",
  "sessionId": "session_1700000000000"
}
```

`sessionId` is optional. If omitted, a new session is created with ID `session_${Date.now()}`.

**Response (200):**
```json
{
  "success": true,
  "response": "That's amazing progress on your fitness goal! Running 5km shows real dedication to your health journey. Your consistency is paying off — keep building on this momentum!",
  "sessionId": "session_1700000000000"
}
```

**Error (400):** `{ "error": "Message is required" }`

**Side effects:**
- Generates 2 embeddings (2 OpenAI API calls)
- Gets coaching response (1 GPT-4o call)
- Detects progress mentions (1 GPT-4o call)
- Auto-increments goal progress by +3% for each detected goal mention
- Auto-updates habit streaks for detected completions/failures
- Auto-updates goal metrics for detected numeric values
- Stores conversation in `conversations` table

---

## Goals

### POST /api/goals

Create a new goal.

**Request:**
```json
{
  "title": "Lose 10kg",
  "description": "Reach 85kg from current 95kg through diet and exercise",
  "life_area_id": 1,
  "target_date": "2025-06-01",
  "goal_type": "achievement"
}
```

| Field | Required | Default | Values |
|-------|----------|---------|--------|
| `title` | Yes | — | Any string |
| `description` | No | null | Any string |
| `life_area_id` | Yes | — | Integer (FK to life_areas) |
| `target_date` | No | null | ISO date string |
| `goal_type` | No | `'achievement'` | `achievement`, `learning`, `habit-breaking` |

**Response (201):**
```json
{
  "id": 5,
  "title": "Lose 10kg",
  "description": "Reach 85kg from current 95kg...",
  "goal_embedding": "[0.0123, ...]",
  "life_area_id": 1,
  "target_date": "2025-06-01",
  "goal_type": "achievement",
  "current_progress": 0,
  "status": "active",
  "created_at": "2024-11-15T10:30:00.000Z",
  "updated_at": "2024-11-15T10:30:00.000Z"
}
```

---

### GET /api/goals

List all goals with life area information.

**Response (200):**
```json
[
  {
    "id": 5,
    "title": "Lose 10kg",
    "description": "Reach 85kg from current 95kg...",
    "life_area_id": 1,
    "life_area_name": "Health",
    "color": "#FF5733",
    "current_progress": 35,
    "status": "active",
    "goal_type": "achievement",
    "target_date": "2025-06-01",
    "created_at": "2024-11-15T10:30:00.000Z",
    "updated_at": "2024-11-20T08:15:00.000Z"
  }
]
```

---

### PUT /api/goals/:id

Update a goal. Only include fields you want to change.

**Request:**
```json
{
  "current_progress": 50,
  "status": "active"
}
```

All fields are optional: `title`, `description`, `life_area_id`, `status`, `current_progress`, `target_date`, `goal_type`.

**Response (200):** Updated goal object.
**Error (404):** `{ "error": "Goal not found" }`

---

### DELETE /api/goals/:id

Delete a goal.

**Response (200):** `{ "success": true }`
**Error (404):** `{ "error": "Goal not found" }`

---

### GET /api/goals/:id/progress

Get the progress change history for a goal.

**Response (200):**
```json
[
  {
    "id": 12,
    "goal_id": 5,
    "progress_percentage": 35,
    "update_reason": "Worked on goal mentioned in journal entry",
    "source": "journal",
    "logged_at": "2024-11-15T10:30:00.000Z"
  },
  {
    "id": 11,
    "goal_id": 5,
    "progress_percentage": 30,
    "update_reason": "Mentioned progress in conversation",
    "source": "conversation",
    "logged_at": "2024-11-14T15:00:00.000Z"
  }
]
```

---

## Habits

### POST /api/habits

Create a new habit.

**Request:**
```json
{
  "title": "Drink 3L water daily",
  "description": "Stay hydrated throughout the day",
  "life_area_id": 1,
  "frequency": "daily",
  "target_count": 1,
  "habit_type": "formation"
}
```

| Field | Required | Default | Values |
|-------|----------|---------|--------|
| `title` | Yes | — | Any string |
| `description` | No | null | Any string |
| `life_area_id` | Yes | — | Integer (FK to life_areas) |
| `frequency` | Yes | — | `daily`, `weekly`, `monthly` |
| `target_count` | No | 1 | Integer |
| `habit_type` | No | `'formation'` | `formation`, `breaking`, `improvement` |

**Response (201):** Created habit object with `current_streak: 0`, `longest_streak: 0`.

---

### GET /api/habits

List all habits with life area information.

**Response (200):**
```json
[
  {
    "id": 3,
    "title": "Drink 3L water daily",
    "description": "Stay hydrated...",
    "life_area_id": 1,
    "life_area_name": "Health",
    "color": "#FF5733",
    "frequency": "daily",
    "target_count": 1,
    "habit_type": "formation",
    "current_streak": 12,
    "longest_streak": 15,
    "status": "active",
    "created_at": "2024-11-01T08:00:00.000Z",
    "updated_at": "2024-11-15T10:30:00.000Z"
  }
]
```

---

### POST /api/habits/:id/complete

Log a habit completion or failure.

**Request:**
```json
{
  "success": true,
  "notes": "Drank 3.5L today"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `success` | No | true | `false` to log a failure (resets streak to 0) |
| `notes` | No | `''` | Optional details |

**Response (200):**
```json
{
  "success": true,
  "streak": {
    "newStreak": 13,
    "newLongestStreak": 15
  }
}
```

**Error (404):** `{ "error": "Habit not found" }`

---

### GET /api/habits/:id/logs

Get completion/failure history for a habit.

**Response (200):**
```json
[
  {
    "id": 45,
    "habit_id": 3,
    "success": true,
    "notes": "Drank 3.5L today",
    "completed_at": "2024-11-15T10:30:00.000Z"
  }
]
```

---

## Life Areas

### GET /api/life-areas

List all life area categories (pre-populated reference data).

**Response (200):**
```json
[
  {
    "id": 1,
    "name": "Career",
    "color": "#FF33F5",
    "description": "Professional development and work",
    "created_at": "2024-10-01T00:00:00.000Z"
  },
  {
    "id": 2,
    "name": "Finances",
    "color": "#33FF57",
    "description": "Financial goals and savings",
    "created_at": "2024-10-01T00:00:00.000Z"
  }
]
```

---

## Statistics

### GET /api/stats

Dashboard summary statistics.

**Response (200):**
```json
{
  "latestEntry": {
    "id": 42,
    "date": "2024-11-15",
    "journal_entry": "Today I went to the gym...",
    "ai_extracted_mood": 8,
    "ai_extracted_energy": 7,
    "ai_extracted_water": 3,
    "ai_extracted_smoke": 0,
    "ai_analysis": "Productive day..."
  },
  "consistency": {
    "entriesLast7Days": 5,
    "activeGoals": 3,
    "activeHabits": 7
  },
  "habitStreaks": [
    {
      "title": "Drink 3L water daily",
      "current_streak": 12,
      "longest_streak": 15
    },
    {
      "title": "Morning meditation",
      "current_streak": 8,
      "longest_streak": 20
    }
  ]
}
```

`habitStreaks` returns up to 5 active habits, sorted by `current_streak` descending.

---

## Error Responses

All endpoints return errors in this format:

```json
{ "error": "Error message here" }
```

| Status Code | Meaning |
|-------------|---------|
| 400 | Missing required fields |
| 404 | Resource not found |
| 500 | Internal server error (check server logs for details) |
