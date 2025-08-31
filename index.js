// server.js
import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import pkg from "pg";
import cosineSimilarity from "cosine-similarity";

const { Client } = pkg;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


const MathReasoning = z.object({
  health: z.number(),
  energy: z.number(),
  mental: z.number(),
  charisma: z.number(),
  intellect: z.number(),
  skill: z.number(),
  message: z.string(),
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
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allow specific methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Allow specific headers
}));


app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function numberToWords(number) {
  const words = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
    "twenty", "twenty one", "twenty two", "twenty three", "twenty four", "twenty five", "twenty six", 
    "twenty seven", "twenty eight", "twenty nine", "thirty", "thirty one"
  ];

  return words[number];
}

// Function to convert Date object to 'Month Day in words' format
function dateToWords(date) {
  const options = { month: 'long' }; // Get full month name
  const month = date.toLocaleString('en-US', options); // 'September'
  const day = date.getDate(); // Get the day number

  return `${month} ${numberToWords(day)}`;
}

app.post("/api/ask", async (req, res) => {
  const question = req.body.entry;
  
  try {
    // Step 1: Generate an embedding for the question
    const questionEmbedding = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: question
    });

    const questionVector = questionEmbedding.data[0].embedding;

    // Step 2: Use a database function to calculate similarity and fetch top entries
    const fetchQuery = `
      WITH similarity_scores AS (
        SELECT 
          journal_entry, 
          date, 
          water, 
          smoke, 
          porn_streak, 
          workout_streak,
          embedding <=> $1::vector AS similarity
        FROM stats
        WHERE embedding IS NOT NULL
      )
      SELECT *
      FROM similarity_scores
      ORDER BY similarity ASC
      LIMIT 10;
    `;
    
    // Convert the questionVector array to a properly formatted PostgreSQL vector string
    const formattedVector = `[${questionVector.join(',')}]`;
    
    const result = await client.query(fetchQuery, [formattedVector]);
    const topEntries = result.rows;

    // Step 3: Prepare the context with the most relevant entries
    const context = topEntries.map(entry => 
      `Date: ${entry.date}, Entry: ${entry.journal_entry}, Water: ${entry.water}, Smoke: ${entry.smoke}, Porn Streak: ${entry.porn_streak}, Workout Streak: ${entry.workout_streak}`
    ).join("\n");

    // Step 4: Prepare the prompt with the context and the user's question
    const prompt = `Context: ${context}\n\nQuestion: ${question}\nAnswer:`;

    // Step 5: Call the OpenAI API to generate an answer based on the relevant entries
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [
        {
          role: "system",
          content: `You are my personal life coach who helps me become the best version of myself. You have access to my daily journals and other details through the context i provide. The prompt i send you will be in the form of "Context" then "Question". Each answer is to be concise and not more than 2 or 3 lines. Convert any dates in the question into word format like "October four", this has to be only for the question, not the answer you send as a response. Some questions will be vague, in these cases try your best to use the information available from the context as best as possible`,
        },
        { role: "user", content: prompt }
      ]
    });

    // Step 6: Send the response back to the frontend
    res.json({ answer: completion.choices[0].message.content });
  } catch (error) {
    console.error("Error while processing question:", error);
    res.status(500).json({ error: "Internal server error" });
  } 
});


app.post("/api/daily-entry", async (req, res) => {
  const { entry, water, smoke, porn_streak, workout_streak } = req.body;

  try {
    // Fetch the most recent stats
    const result = await client.query(
      "SELECT * FROM stats ORDER BY date DESC LIMIT 1;"
    );

    // Send journal entry to ChatGPT with all health data
    const completion = await openai.chat.completions.create({
      model: "gpt-4-0125-preview",
      messages: [
        {
          role: "system",
          content: `You are my personal life coach who helps me become the best version of myself. You are harsh to me when i do things that are not progressing my life and celebrate the things that do. Analyze my daily journal entry along with my health metrics and habits to provide feedback and calculate updated stats.

          Previous stats for reference: ${JSON.stringify(result.rows[0])}

          Daily Habits:
          - Water Intake: ${water} cups
          - Cigarettes: ${smoke}
          - Porn Free: ${porn_streak != 0 ? "Yes" : "No"}
          - Worked Out: ${workout_streak != 0 ? "Yes" : "No"}

          Based on all this information and the journal entry, provide:
          1. A brief, direct analysis of my day
          2. Updated stats (0-100) for: health, energy, mental, charisma, intellect, skill
          
          Respond in JSON format with:
          {
            "message": "your analysis here",
            "health": number,
            "energy": number,
            "mental": number,
            "charisma": number,
            "intellect": number,
            "skill": number
          }`,
        },
        {
          role: "user",
          content: entry
        }
      ],
      response_format: { type: "json_object" }
    });

    const updated_stats = JSON.parse(completion.choices[0].message.content);
    updated_stats.image = 1;
    if (updated_stats.health > 80) updated_stats.image = 2;
    if (updated_stats.energy < 50) updated_stats.image = 3;

    // Generate embedding for the entry
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: `Date:${dateToWords(new Date())} ${entry}`
    });
    const embedding = `[${embeddingResponse.data[0].embedding.join(',')}]`;

    // Update database with all data
    const insertQuery = `
      INSERT INTO stats (
        date, health, energy, mental, charisma, intellect, skill, 
        water, smoke, journal_entry, embedding, porn_streak, workout_streak
      )
      VALUES (
        CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      ON CONFLICT (date) 
      DO UPDATE SET 
        health = EXCLUDED.health,
        energy = EXCLUDED.energy,
        mental = EXCLUDED.mental,
        charisma = EXCLUDED.charisma,
        intellect = EXCLUDED.intellect,
        skill = EXCLUDED.skill,
        water = EXCLUDED.water,
        smoke = EXCLUDED.smoke,
        journal_entry = EXCLUDED.journal_entry,
        embedding = EXCLUDED.embedding,
        porn_streak = EXCLUDED.porn_streak,
        workout_streak = EXCLUDED.workout_streak
      RETURNING *;
    `;

    const values = [
      updated_stats.health != 0 ? updated_stats.health : result.rows[0].health,
      updated_stats.energy != 0 ? updated_stats.energy : result.rows[0].energy,
      updated_stats.mental != 0 ? updated_stats.mental : result.rows[0].mental,
      updated_stats.charisma != 0 ? updated_stats.charisma : result.rows[0].charisma,
      updated_stats.intellect != 0 ? updated_stats.intellect : result.rows[0].intellect,
      updated_stats.skill != 0 ? updated_stats.skill : result.rows[0].skill,
      water,
      smoke,
      entry,
      embedding,
      porn_streak,
      workout_streak
    ];

    const dbResult = await client.query(insertQuery, values);
    
    // Include all stats in the response
    updated_stats.water = water;
    updated_stats.smoke = smoke;
    updated_stats.porn_streak = porn_streak;
    updated_stats.workout_streak = workout_streak;

    res.status(200).json(updated_stats);
  } catch (error) {
    console.error("Error updating stats:", error);
    res.status(500).send("Server error");
  }
});

// Endpoint to get today's entry
app.get("/api/stats", async (req, res) => {
  try {
    // Get the latest entry first
    const latestResult = await client.query(
      "SELECT * FROM stats ORDER BY date DESC LIMIT 1;"
    );

    if (latestResult.rows.length === 0) {
      // If no entries exist at all, return default stats
      res.status(200).json({
        health: 99,
        energy: 99,
        mental: 99,
        charisma: 99,
        intellect: 99,
        skill: 99,
        water: 0,
        smoke: 0,
        porn_streak: 0,
        workout_streak: 0,
        image: 1
      });
      return;
    }

    // Get the most recent non-zero values for each stat
    const backfillQuery = `
      SELECT 
        COALESCE(NULLIF(t1.health, 0), (SELECT health FROM stats WHERE health != 0 AND health IS NOT NULL ORDER BY date DESC LIMIT 1)) as health,
        COALESCE(NULLIF(t1.energy, 0), (SELECT energy FROM stats WHERE energy != 0 AND energy IS NOT NULL ORDER BY date DESC LIMIT 1)) as energy,
        COALESCE(NULLIF(t1.mental, 0), (SELECT mental FROM stats WHERE mental != 0 AND mental IS NOT NULL ORDER BY date DESC LIMIT 1)) as mental,
        COALESCE(NULLIF(t1.charisma, 0), (SELECT charisma FROM stats WHERE charisma != 0 AND charisma IS NOT NULL ORDER BY date DESC LIMIT 1)) as charisma,
        COALESCE(NULLIF(t1.intellect, 0), (SELECT intellect FROM stats WHERE intellect != 0 AND intellect IS NOT NULL ORDER BY date DESC LIMIT 1)) as intellect,
        COALESCE(NULLIF(t1.skill, 0), (SELECT skill FROM stats WHERE skill != 0 AND skill IS NOT NULL ORDER BY date DESC LIMIT 1)) as skill,
        t1.*
      FROM stats t1
      WHERE t1.date = (SELECT MAX(date) FROM stats)
    `;

    const backfillResult = await client.query(backfillQuery);
    const resultResponse = backfillResult.rows[0];
    
    var image = 1;
    if (resultResponse.health > 80) {
      image = 2;
    }
    if (resultResponse.energy < 50) {
      image = 3;
    }
    resultResponse.image = image;
    
    res.status(200).json(resultResponse);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).send("Server error");
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

