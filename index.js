// Life Progress Tracker Backend
import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { z } from "zod";
import pkg from "pg";

const { Client } = pkg;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

client.connect();

const app = express();
const port = 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Helper function to generate embeddings
async function generateEmbedding(text) {
  try {
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: text
    });
    return `[${embeddingResponse.data[0].embedding.join(',')}]`;
  } catch (error) {
    console.error("Error generating embedding:", error);
    return null;
  }
}

// Helper function to get AI context
async function getAIContext(sessionId = null) {
  try {
    // Get recent journal entries
    const entriesResult = await client.query(
      "SELECT * FROM daily_entries ORDER BY date DESC LIMIT 7"
    );
    
    // Get active goals
    const goalsResult = await client.query(
      "SELECT g.*, la.name as life_area_name FROM goals g JOIN life_areas la ON g.life_area_id = la.id WHERE g.status = 'active'"
    );
    
    // Get active habits
    const habitsResult = await client.query(
      "SELECT h.*, la.name as life_area_name FROM habits h JOIN life_areas la ON h.life_area_id = la.id WHERE h.status = 'active'"
    );
    
    // Get recent conversations if sessionId provided
    let conversations = [];
    if (sessionId) {
      const convResult = await client.query(
        "SELECT * FROM conversations WHERE session_id = $1 ORDER BY created_at DESC LIMIT 10",
        [sessionId]
      );
      conversations = convResult.rows;
    }
    
    return {
      recentEntries: entriesResult.rows,
      activeGoals: goalsResult.rows,
      activeHabits: habitsResult.rows,
      recentConversations: conversations
    };
  } catch (error) {
    console.error("Error getting AI context:", error);
    return { recentEntries: [], activeGoals: [], activeHabits: [], recentConversations: [] };
  }
}

// Helper function to update goal progress
async function updateGoalProgress(goalId, progressChange, reason, source = 'journal') {
  try {
    // Get current goal
    const goalResult = await client.query(
      "SELECT current_progress FROM goals WHERE id = $1",
      [goalId]
    );
    
    if (goalResult.rows.length === 0) return;
    
    const currentProgress = goalResult.rows[0].current_progress;
    const newProgress = Math.min(100, Math.max(0, currentProgress + progressChange));
    
    // Update goal progress
    await client.query(
      "UPDATE goals SET current_progress = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [newProgress, goalId]
    );
    
    // Log progress update
    await client.query(
      "INSERT INTO goal_progress_logs (goal_id, progress_percentage, update_reason, source) VALUES ($1, $2, $3, $4)",
      [goalId, newProgress, reason, source]
    );
    
    return newProgress;
  } catch (error) {
    console.error("Error updating goal progress:", error);
  }
}

// Helper function to update habit streak
async function updateHabitStreak(habitId, success, notes = '') {
  try {
    // Get current habit
    const habitResult = await client.query(
      "SELECT current_streak, longest_streak FROM habits WHERE id = $1",
      [habitId]
    );
    
    if (habitResult.rows.length === 0) return;
    
    const { current_streak, longest_streak } = habitResult.rows[0];
    let newStreak = success ? current_streak + 1 : 0;
    let newLongestStreak = Math.max(longest_streak, newStreak);
    
    // Update habit streak
    await client.query(
      "UPDATE habits SET current_streak = $1, longest_streak = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
      [newStreak, newLongestStreak, habitId]
    );
    
    // Log habit completion
    await client.query(
      "INSERT INTO habit_logs (habit_id, success, notes) VALUES ($1, $2, $3)",
      [habitId, success, notes]
    );
    
    return { newStreak, newLongestStreak };
  } catch (error) {
    console.error("Error updating habit streak:", error);
  }
}

// Helper function to update goal metrics
async function updateGoalMetrics(goalId, metricName, newValue, unit = '') {
  try {
    // Check if metric exists
    const metricResult = await client.query(
      "SELECT * FROM goal_metrics WHERE goal_id = $1 AND metric_name = $2",
      [goalId, metricName]
    );
    
    if (metricResult.rows.length > 0) {
      // Update existing metric
      await client.query(
        "UPDATE goal_metrics SET current_value = $1, updated_at = CURRENT_TIMESTAMP WHERE goal_id = $2 AND metric_name = $3",
        [newValue, goalId, metricName]
      );
    } else {
      // Create new metric
      await client.query(
        "INSERT INTO goal_metrics (goal_id, metric_name, current_value, unit) VALUES ($1, $2, $3, $4)",
        [goalId, metricName, newValue, unit]
      );
    }
    
    return newValue;
  } catch (error) {
    console.error("Error updating goal metrics:", error);
  }
}

// 1. Daily Entry Endpoint (Enhanced)
app.post("/api/daily-entry", async (req, res) => {
  const { entry } = req.body;
  
  if (!entry) {
    return res.status(400).json({ error: "Journal entry is required" });
  }

  try {
    // Generate embedding for the entry
    const embedding = await generateEmbedding(entry);
    
    // Get AI context
    const context = await getAIContext();
    
    // Enhanced AI analysis
    const analysisPrompt = `
You are analyzing a daily journal entry to extract insights and track progress across goals, habits, and life improvements.

Recent Journal Entries:
${context.recentEntries.map(e => `Date: ${e.date}, Entry: ${e.journal_entry}`).join('\n')}

Active Goals:
${context.activeGoals.map(g => `- ${g.title} (${g.current_progress}% complete): ${g.description}`).join('\n')}

Active Habits:
${context.activeHabits.map(h => `- ${h.title} (${h.current_streak} day streak): ${h.description}`).join('\n')}

Current Journal Entry: ${entry}

Please analyze this entry and provide:
1. Mood level (1-10, where 1=terrible, 10=excellent)
2. Energy level (1-10, where 1=exhausted, 10=very energetic)
3. Water intake mentioned (number of liters, 0 if not mentioned)
4. Smoking mentioned (number of cigarettes, 0 if not mentioned)
5. Brief analysis of the day (2-3 sentences)
6. Goal-related activities detected (list goal titles that were worked on)
7. Habit completions detected (list habit titles that were completed)
8. Habit failures detected (list habit titles that were failed)
9. Any specific metrics mentioned (weight, savings, etc. with values)

Respond in JSON format:
{
  "mood": number,
  "energy": number,
  "water": number,
  "smoke": number,
  "analysis": "your analysis here",
  "goal_activities": ["goal1", "goal2"],
  "habit_completions": ["habit1", "habit2"],
  "habit_failures": ["habit1"],
  "metrics": [
    {"name": "weight", "value": 95.5, "unit": "kg"},
    {"name": "savings", "value": 15.2, "unit": "lakhs"}
  ]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [{ role: "user", content: analysisPrompt }],
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);
    
    // Prepare habit completions and goal mentions for storage
    const habitCompletions = {};
    const goalMentions = {};
    
    // Update habit completions
    if (analysis.habit_completions && analysis.habit_completions.length > 0) {
      for (const habitTitle of analysis.habit_completions) {
        const habitResult = await client.query(
          "SELECT id FROM habits WHERE title ILIKE $1 AND status = 'active'",
          [`%${habitTitle}%`]
        );
        
        if (habitResult.rows.length > 0) {
          const habitId = habitResult.rows[0].id;
          await updateHabitStreak(habitId, true, `Completed based on journal entry`);
          habitCompletions[habitId] = { success: true, notes: 'Completed' };
        }
      }
    }
    
    // Update habit failures
    if (analysis.habit_failures && analysis.habit_failures.length > 0) {
      for (const habitTitle of analysis.habit_failures) {
        const habitResult = await client.query(
          "SELECT id FROM habits WHERE title ILIKE $1 AND status = 'active'",
          [`%${habitTitle}%`]
        );
        
        if (habitResult.rows.length > 0) {
          const habitId = habitResult.rows[0].id;
          await updateHabitStreak(habitId, false, `Failed based on journal entry`);
          habitCompletions[habitId] = { success: false, notes: 'Failed' };
        }
      }
    }
    
    // Update goal progress
    if (analysis.goal_activities && analysis.goal_activities.length > 0) {
      for (const goalTitle of analysis.goal_activities) {
        const goalResult = await client.query(
          "SELECT id FROM goals WHERE title ILIKE $1 AND status = 'active'",
          [`%${goalTitle}%`]
        );
        
        if (goalResult.rows.length > 0) {
          const goalId = goalResult.rows[0].id;
          await updateGoalProgress(goalId, 5, `Worked on goal mentioned in journal entry`);
          goalMentions[goalId] = { progress: 5, reason: 'Worked on goal' };
        }
      }
    }
    
    // Update goal metrics
    if (analysis.metrics && analysis.metrics.length > 0) {
      for (const metric of analysis.metrics) {
        // Find relevant goal for this metric
        const goalResult = await client.query(
          "SELECT id FROM goals WHERE title ILIKE $1 AND status = 'active'",
          [`%${metric.name}%`]
        );
        
        if (goalResult.rows.length > 0) {
          await updateGoalMetrics(goalResult.rows[0].id, metric.name, metric.value, metric.unit);
        }
      }
    }
    
    // Store the entry
    const insertQuery = `
      INSERT INTO daily_entries (
        date, journal_entry, embedding, ai_extracted_mood, ai_extracted_energy, 
        ai_extracted_water, ai_extracted_smoke, ai_analysis, habit_completions, goal_mentions
      )
      VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (date) 
      DO UPDATE SET 
        journal_entry = EXCLUDED.journal_entry,
        embedding = EXCLUDED.embedding,
        ai_extracted_mood = EXCLUDED.ai_extracted_mood,
        ai_extracted_energy = EXCLUDED.ai_extracted_energy,
        ai_extracted_water = EXCLUDED.ai_extracted_water,
        ai_extracted_smoke = EXCLUDED.ai_extracted_smoke,
        ai_analysis = EXCLUDED.ai_analysis,
        habit_completions = EXCLUDED.habit_completions,
        goal_mentions = EXCLUDED.goal_mentions,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [
      entry,
      embedding,
      analysis.mood,
      analysis.energy,
      analysis.water,
      analysis.smoke,
      analysis.analysis,
      JSON.stringify(habitCompletions),
      JSON.stringify(goalMentions)
    ];

    const dbResult = await client.query(insertQuery, values);

    res.status(200).json({
      success: true,
      entry: dbResult.rows[0],
      analysis: analysis
    });
  } catch (error) {
    console.error("Error processing daily entry:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2. Chat with AI Endpoint (Enhanced)
app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    // Generate embeddings
    const userMessageEmbedding = await generateEmbedding(message);
    const fullConversationEmbedding = await generateEmbedding(message);
    
    // Get AI context
    const context = await getAIContext(sessionId);
    
    // Build conversation history
    const conversationHistory = context.recentConversations
      .map(conv => `User: ${conv.user_message}\nAI: ${conv.ai_response}`)
      .join('\n\n');
    
    // Enhanced AI prompt
    const chatPrompt = `
You are a personal life coach and progress tracker. You help the user stay on track with their goals, habits, and life improvements.

User's Active Goals:
${context.activeGoals.map(g => `- ${g.title} (${g.current_progress}% complete): ${g.description}`).join('\n')}

User's Active Habits:
${context.activeHabits.map(h => `- ${h.title} (${h.current_streak} day streak): ${h.description}`).join('\n')}

Recent Journal Entries (last 7 days):
${context.recentEntries.map(e => `Date: ${e.date}, Mood: ${e.ai_extracted_mood}/10, Energy: ${e.ai_extracted_energy}/10, Entry: ${e.journal_entry}`).join('\n')}

Recent Conversation History:
${conversationHistory}

Current User Message: ${message}

Respond as a supportive life coach who:
1. Understands the user's goals, habits, and current progress
2. Provides specific, actionable advice
3. Acknowledges their recent activities and patterns
4. Helps them stay motivated and on track
5. Can help update progress if they mention working on goals/habits
6. Celebrates successes and provides gentle encouragement for setbacks

Keep your response conversational and supportive, not more than 3-4 sentences.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [{ role: "user", content: chatPrompt }]
    });

    const aiResponse = completion.choices[0].message.content;
    
    // Store the conversation
    const sessionIdToUse = sessionId || `session_${Date.now()}`;
    await client.query(
      "INSERT INTO conversations (session_id, user_message, ai_response, user_message_embedding, full_conversation_embedding) VALUES ($1, $2, $3, $4, $5)",
      [sessionIdToUse, message, aiResponse, userMessageEmbedding, fullConversationEmbedding]
    );
    
    // Check for goal/habit progress mentions and update accordingly
    const progressPrompt = `
Based on this user message: "${message}"

And these active goals:
${context.activeGoals.map(g => `- ${g.title} (${g.current_progress}% complete)`).join('\n')}

And these active habits:
${context.activeHabits.map(h => `- ${h.title} (${h.current_streak} day streak)`).join('\n')}

Does the user mention:
1. Working on or making progress on any goals? If yes, list goal titles.
2. Completing or failing any habits? If yes, list habit titles with success/failure.
3. Any specific metrics (weight, savings, etc.)? If yes, list with values.

Respond in JSON format:
{
  "goal_progress": ["goal1", "goal2"],
  "habit_completions": ["habit1", "habit2"],
  "habit_failures": ["habit1"],
  "metrics": [{"name": "weight", "value": 95.5, "unit": "kg"}]
}
`;

    const progressCompletion = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [{ role: "user", content: progressPrompt }],
      response_format: { type: "json_object" }
    });

    const progressUpdate = JSON.parse(progressCompletion.choices[0].message.content);
    
    // Update goal progress
    if (progressUpdate.goal_progress && progressUpdate.goal_progress.length > 0) {
      for (const goalTitle of progressUpdate.goal_progress) {
        const goalResult = await client.query(
          "SELECT id FROM goals WHERE title ILIKE $1 AND status = 'active'",
          [`%${goalTitle}%`]
        );
        
        if (goalResult.rows.length > 0) {
          await updateGoalProgress(goalResult.rows[0].id, 3, `Mentioned progress in conversation`, 'conversation');
        }
      }
    }
    
    // Update habit completions
    if (progressUpdate.habit_completions && progressUpdate.habit_completions.length > 0) {
      for (const habitTitle of progressUpdate.habit_completions) {
        const habitResult = await client.query(
          "SELECT id FROM habits WHERE title ILIKE $1 AND status = 'active'",
          [`%${habitTitle}%`]
        );
        
        if (habitResult.rows.length > 0) {
          await updateHabitStreak(habitResult.rows[0].id, true, `Completed based on conversation`);
        }
      }
    }
    
    // Update habit failures
    if (progressUpdate.habit_failures && progressUpdate.habit_failures.length > 0) {
      for (const habitTitle of progressUpdate.habit_failures) {
        const habitResult = await client.query(
          "SELECT id FROM habits WHERE title ILIKE $1 AND status = 'active'",
          [`%${habitTitle}%`]
        );
        
        if (habitResult.rows.length > 0) {
          await updateHabitStreak(habitResult.rows[0].id, false, `Failed based on conversation`);
        }
      }
    }
    
    // Update metrics
    if (progressUpdate.metrics && progressUpdate.metrics.length > 0) {
      for (const metric of progressUpdate.metrics) {
        const goalResult = await client.query(
          "SELECT id FROM goals WHERE title ILIKE $1 AND status = 'active'",
          [`%${metric.name}%`]
        );
        
        if (goalResult.rows.length > 0) {
          await updateGoalMetrics(goalResult.rows[0].id, metric.name, metric.value, metric.unit);
        }
      }
    }

    res.status(200).json({
      success: true,
      response: aiResponse,
      sessionId: sessionIdToUse
    });
  } catch (error) {
    console.error("Error in chat:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3. Goal Management Endpoints
app.post("/api/goals", async (req, res) => {
  const { title, description, life_area_id, target_date, goal_type } = req.body;
  
  if (!title || !life_area_id) {
    return res.status(400).json({ error: "Title and life area are required" });
  }

  try {
    const goalEmbedding = await generateEmbedding(`${title} ${description || ''}`);
    
    const result = await client.query(
      "INSERT INTO goals (title, description, goal_embedding, life_area_id, target_date, goal_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [title, description, goalEmbedding, life_area_id, target_date, goal_type || 'achievement']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating goal:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/goals", async (req, res) => {
  try {
    const result = await client.query(
      "SELECT g.*, la.name as life_area_name, la.color FROM goals g JOIN life_areas la ON g.life_area_id = la.id ORDER BY g.created_at DESC"
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching goals:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/goals/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description, life_area_id, status, current_progress, target_date, goal_type } = req.body;
  
  try {
    let goalEmbedding = null;
    if (title || description) {
      goalEmbedding = await generateEmbedding(`${title || ''} ${description || ''}`);
    }
    
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    if (title) {
      updateFields.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (description) {
      updateFields.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (life_area_id) {
      updateFields.push(`life_area_id = $${paramCount++}`);
      values.push(life_area_id);
    }
    if (status) {
      updateFields.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (current_progress !== undefined) {
      updateFields.push(`current_progress = $${paramCount++}`);
      values.push(current_progress);
    }
    if (target_date) {
      updateFields.push(`target_date = $${paramCount++}`);
      values.push(target_date);
    }
    if (goal_type) {
      updateFields.push(`goal_type = $${paramCount++}`);
      values.push(goal_type);
    }
    if (goalEmbedding) {
      updateFields.push(`goal_embedding = $${paramCount++}`);
      values.push(goalEmbedding);
    }
    
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    
    const result = await client.query(
      `UPDATE goals SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Goal not found" });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error updating goal:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/goals/:id", async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await client.query("DELETE FROM goals WHERE id = $1 RETURNING *", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Goal not found" });
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error deleting goal:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 4. Habit Management Endpoints
app.post("/api/habits", async (req, res) => {
  const { title, description, life_area_id, frequency, target_count, habit_type } = req.body;
  
  if (!title || !life_area_id || !frequency) {
    return res.status(400).json({ error: "Title, life area, and frequency are required" });
  }

  try {
    const habitEmbedding = await generateEmbedding(`${title} ${description || ''}`);
    
    const result = await client.query(
      "INSERT INTO habits (title, description, habit_embedding, life_area_id, frequency, target_count, habit_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [title, description, habitEmbedding, life_area_id, frequency, target_count || 1, habit_type || 'formation']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating habit:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/habits", async (req, res) => {
  try {
    const result = await client.query(
      "SELECT h.*, la.name as life_area_name, la.color FROM habits h JOIN life_areas la ON h.life_area_id = la.id ORDER BY h.created_at DESC"
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching habits:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/habits/:id/complete", async (req, res) => {
  const { id } = req.params;
  const { success, notes } = req.body;
  
  try {
    const result = await updateHabitStreak(id, success !== false, notes);
    
    if (!result) {
      return res.status(404).json({ error: "Habit not found" });
    }
    
    res.status(200).json({ success: true, streak: result });
  } catch (error) {
    console.error("Error completing habit:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 5. Life Areas Endpoint
app.get("/api/life-areas", async (req, res) => {
  try {
    const result = await client.query("SELECT * FROM life_areas ORDER BY name");
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching life areas:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 6. Stats Endpoint (Enhanced)
app.get("/api/stats", async (req, res) => {
  try {
    // Get latest daily entry
    const latestEntry = await client.query(
      "SELECT * FROM daily_entries ORDER BY date DESC LIMIT 1"
    );
    
    // Get consistency metrics (last 7 days)
    const consistencyResult = await client.query(
      "SELECT COUNT(*) as entries_count FROM daily_entries WHERE date >= CURRENT_DATE - INTERVAL '7 days'"
    );
    
    // Get active goals count
    const goalsResult = await client.query(
      "SELECT COUNT(*) as active_goals FROM goals WHERE status = 'active'"
    );
    
    // Get active habits count
    const habitsResult = await client.query(
      "SELECT COUNT(*) as active_habits FROM habits WHERE status = 'active'"
    );
    
    // Get habit streaks
    const streaksResult = await client.query(
      "SELECT title, current_streak, longest_streak FROM habits WHERE status = 'active' ORDER BY current_streak DESC LIMIT 5"
    );
    
    const stats = {
      latestEntry: latestEntry.rows[0] || null,
      consistency: {
        entriesLast7Days: parseInt(consistencyResult.rows[0].entries_count),
        activeGoals: parseInt(goalsResult.rows[0].active_goals),
        activeHabits: parseInt(habitsResult.rows[0].active_habits)
      },
      habitStreaks: streaksResult.rows
    };
    
    res.status(200).json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 7. Daily Entries History
app.get("/api/daily-entries", async (req, res) => {
  const { limit = 30 } = req.query;
  
  try {
    const result = await client.query(
      "SELECT * FROM daily_entries ORDER BY date DESC LIMIT $1",
      [limit]
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching daily entries:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 8. Goal Progress History
app.get("/api/goals/:id/progress", async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await client.query(
      "SELECT * FROM goal_progress_logs WHERE goal_id = $1 ORDER BY logged_at DESC",
      [id]
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching goal progress:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 9. Habit Logs
app.get("/api/habits/:id/logs", async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await client.query(
      "SELECT * FROM habit_logs WHERE habit_id = $1 ORDER BY completed_at DESC",
      [id]
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching habit logs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Life Progress Tracker running on http://localhost:${port}`);
});

