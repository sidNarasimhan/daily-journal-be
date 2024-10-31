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
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

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
  user: "postgres",
  host: "database-1.cz42g8gwq283.eu-north-1.rds.amazonaws.com",
  database: "postgres",
  password: "p6AStlYnGWsGJVAyAXZR",
  port: 5432, // default PostgreSQL port
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

// Initialize the OAuth2 client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Define the scopes for Google Fit API
const scopes = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.body.read'
];

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

    // Fetch Google Fit data
    const fitData = await getGoogleFitData();

    // Calculate sleep score (0-100)
    const sleepScore = Math.min(100, Math.round((fitData.sleep.totalSleep / 480) * 100)); // 480 minutes = 8 hours
    
    // Send journal entry to ChatGPT with all health data
    const completion = await openai.chat.completions.create({
      model: "gpt-4-0125-preview",
      messages: [
        {
          role: "system",
          content: `You are my personal life coach who helps me become the best version of myself. You are harsh to me when i do things that are not progressing my life and celebrate the things that do. Analyze my daily journal entry along with my health metrics and habits to provide feedback and calculate updated stats.

          Previous stats for reference: ${JSON.stringify(result.rows[0])}

          Current health metrics:
          - Steps: ${fitData.steps}
          - Calories Burned: ${Math.round(fitData.calories)}
          - Active Minutes: ${fitData.activeMinutes}
          - Heart Rate (avg/min/max): ${fitData.heartRate.avg}/${fitData.heartRate.min}/${fitData.heartRate.max} bpm
          - Oxygen Levels (avg/min/max): ${fitData.oxygenSaturation.avg}/${fitData.oxygenSaturation.min}/${fitData.oxygenSaturation.max}%
          - Sleep (minutes):
            * Total: ${Math.round(fitData.sleep.totalSleep)}
            * Deep: ${Math.round(fitData.sleep.deepSleep)}
            * REM: ${Math.round(fitData.sleep.remSleep)}
            * Light: ${Math.round(fitData.sleep.lightSleep)}
            * Awake: ${Math.round(fitData.sleep.awake)}
            * Sleep Score: ${sleepScore}/100

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
        water, smoke, journal_entry, embedding, porn_streak, workout_streak,
        steps, calories, active_minutes,
        heart_rate_avg, heart_rate_min, heart_rate_max,
        oxygen_avg, oxygen_min, oxygen_max,
        sleep_deep, sleep_light, sleep_rem, sleep_awake, sleep_total
      )
      VALUES (
        CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
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
        workout_streak = EXCLUDED.workout_streak,
        steps = EXCLUDED.steps,
        calories = EXCLUDED.calories,
        active_minutes = EXCLUDED.active_minutes,
        heart_rate_avg = EXCLUDED.heart_rate_avg,
        heart_rate_min = EXCLUDED.heart_rate_min,
        heart_rate_max = EXCLUDED.heart_rate_max,
        oxygen_avg = EXCLUDED.oxygen_avg,
        oxygen_min = EXCLUDED.oxygen_min,
        oxygen_max = EXCLUDED.oxygen_max,
        sleep_deep = EXCLUDED.sleep_deep,
        sleep_light = EXCLUDED.sleep_light,
        sleep_rem = EXCLUDED.sleep_rem,
        sleep_awake = EXCLUDED.sleep_awake,
        sleep_total = EXCLUDED.sleep_total
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
      workout_streak,
      fitData.steps,
      fitData.calories,
      fitData.activeMinutes,
      fitData.heartRate.avg,
      fitData.heartRate.min,
      fitData.heartRate.max,
      fitData.oxygenSaturation.avg,
      fitData.oxygenSaturation.min,
      fitData.oxygenSaturation.max,
      Math.round(fitData.sleep.deepSleep),
      Math.round(fitData.sleep.lightSleep),
      Math.round(fitData.sleep.remSleep),
      Math.round(fitData.sleep.awake),
      Math.round(fitData.sleep.totalSleep)
    ];

    const dbResult = await client.query(insertQuery, values);
    
    // Include all stats in the response
    updated_stats.water = water;
    updated_stats.smoke = smoke;
    updated_stats.porn_streak = porn_streak;
    updated_stats.workout_streak = workout_streak;
    updated_stats.steps = fitData.steps;
    updated_stats.calories = fitData.calories;
    updated_stats.active_minutes = fitData.activeMinutes;
    updated_stats.heart_rate = fitData.heartRate;
    updated_stats.oxygen = fitData.oxygenSaturation;
    updated_stats.sleep = fitData.sleep;
    updated_stats.sleep_score = sleepScore;

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
        steps: 0,
        calories: 0,
        active_minutes: 0,
        heart_rate_avg: 0,
        heart_rate_min: 0,
        heart_rate_max: 0,
        oxygen_avg: 0,
        oxygen_min: 0,
        oxygen_max: 0,
        sleep_deep: 0,
        sleep_light: 0,
        sleep_rem: 0,
        sleep_awake: 0,
        sleep_total: 0,
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

app.get('/auth/google-fit', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  res.redirect(authUrl);
});

app.get('/auth/google-fit/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    // Store the refresh token in your stats table
    await client.query(`
      INSERT INTO stats (date, google_fit_refresh_token)
      VALUES (CURRENT_DATE, $1)
      ON CONFLICT (date) 
      DO UPDATE SET google_fit_refresh_token = EXCLUDED.google_fit_refresh_token
    `, [tokens.refresh_token]);
    res.send('Google Fit authorization successful');
  } catch (error) {
    console.error('Error during Google Fit authorization:', error);
    res.status(500).send('Authorization failed');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

async function getGoogleFitData() {
  try {
    const result = await client.query('SELECT google_fit_refresh_token FROM stats WHERE google_fit_refresh_token IS NOT NULL ORDER BY date DESC LIMIT 1');
    const refreshToken = result.rows[0]?.google_fit_refresh_token;

    if (!refreshToken) {
      return { 
        steps: 0, 
        calories: 0, 
        activeMinutes: 0,
        heartRate: { avg: 0, min: 0, max: 0 },
        oxygenSaturation: { avg: 0, min: 0, max: 0 },
        sleep: {
          deepSleep: 0,
          lightSleep: 0,
          remSleep: 0,
          awake: 0,
          totalSleep: 0
        }
      };
    }

    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const fitness = google.fitness({ version: 'v1', auth: oauth2Client });

    const now = Date.now();
    const midnight = new Date(now).setHours(0, 0, 0, 0);

    // Request all data types
    const responses = await Promise.allSettled([
      // Basic activity data
      fitness.users.dataset.aggregate({
        userId: 'me',
        requestBody: {
          aggregateBy: [
            { dataTypeName: 'com.google.step_count.delta' },
            { dataTypeName: 'com.google.calories.expended' },
            { dataTypeName: 'com.google.activity.segment' }
          ],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: midnight,
          endTimeMillis: now
        }
      }),
      // Heart rate data
      fitness.users.dataset.aggregate({
        userId: 'me',
        requestBody: {
          aggregateBy: [{ dataTypeName: 'com.google.heart_rate.bpm' }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: midnight,
          endTimeMillis: now
        }
      }),
      // Oxygen saturation data
      fitness.users.dataset.aggregate({
        userId: 'me',
        requestBody: {
          aggregateBy: [{ dataTypeName: 'com.google.oxygen_saturation' }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: midnight,
          endTimeMillis: now
        }
      }),
      // Sleep data
      fitness.users.dataset.aggregate({
        userId: 'me',
        requestBody: {
          aggregateBy: [{ dataTypeName: 'com.google.sleep.segment' }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: midnight,
          endTimeMillis: now
        }
      })
    ]);

    // Process heart rate data
    const heartRateData = responses[1].status === 'fulfilled' ? 
      responses[1].value.data.bucket[0]?.dataset[0]?.point || [] : [];
    const heartRates = heartRateData.map(point => point.value[0].fpVal).filter(Boolean);
    const heartRate = heartRates.length ? {
      avg: Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length),
      min: Math.round(Math.min(...heartRates)),
      max: Math.round(Math.max(...heartRates))
    } : { avg: 0, min: 0, max: 0 };

    // Process oxygen data
    const oxygenData = responses[2].status === 'fulfilled' ? 
      responses[2].value.data.bucket[0]?.dataset[0]?.point || [] : [];
    const oxygenLevels = oxygenData.map(point => point.value[0].fpVal).filter(Boolean);
    const oxygenSaturation = oxygenLevels.length ? {
      avg: Math.round(oxygenLevels.reduce((a, b) => a + b, 0) / oxygenLevels.length),
      min: Math.round(Math.min(...oxygenLevels)),
      max: Math.round(Math.max(...oxygenLevels))
    } : { avg: 0, min: 0, max: 0 };

    // Process sleep data
    const sleepData = responses[3].status === 'fulfilled' ? 
      responses[3].value.data.bucket[0]?.dataset[0]?.point || [] : [];
    
    const sleep = {
      deepSleep: 0,
      lightSleep: 0,
      remSleep: 0,
      awake: 0,
      totalSleep: 0
    };

    sleepData.forEach(point => {
      const duration = (point.endTimeMillis - point.startTimeMillis) / (1000 * 60); // Convert to minutes
      switch(point.value[0].intVal) {
        case 1: // Deep sleep
          sleep.deepSleep += duration;
          sleep.totalSleep += duration;
          break;
        case 2: // Light sleep
          sleep.lightSleep += duration;
          sleep.totalSleep += duration;
          break;
        case 3: // REM
          sleep.remSleep += duration;
          sleep.totalSleep += duration;
          break;
        case 4: // Awake
          sleep.awake += duration;
          break;
      }
    });

    return {
      steps: responses[0].status === 'fulfilled' ? 
        (responses[0].value.data.bucket[0]?.dataset[0]?.point[0]?.value[0]?.intVal || 0) : 0,
      calories: responses[0].status === 'fulfilled' ? 
        (responses[0].value.data.bucket[0]?.dataset[1]?.point[0]?.value[0]?.fpVal || 0) : 0,
      activeMinutes: responses[0].status === 'fulfilled' ? 
        (responses[0].value.data.bucket[0]?.dataset[2]?.point[0]?.value[0]?.intVal || 0) : 0,
      heartRate,
      oxygenSaturation,
      sleep
    };
  } catch (error) {
    console.error('Error fetching Google Fit data:', error);
    return {
      steps: 0,
      calories: 0,
      activeMinutes: 0,
      heartRate: { avg: 0, min: 0, max: 0 },
      oxygenSaturation: { avg: 0, min: 0, max: 0 },
      sleep: {
        deepSleep: 0,
        lightSleep: 0,
        remSleep: 0,
        awake: 0,
        totalSleep: 0
      }
    };
  }
}

