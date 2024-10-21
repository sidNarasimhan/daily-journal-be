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

app.post("/api/ask", async (req, res) => {
  const  question  = req.body.entry;
  
  try {
    // Step 1: Generate an embedding for the question
    const questionEmbedding = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: question
    });

    const questionVector = questionEmbedding.data[0].embedding;

    // Step 2: Fetch all journal embeddings from the database
    
    const fetchQuery = "SELECT journal_entry, embedding , date FROM stats WHERE embedding IS NOT NULL";
    const result = await client.query(fetchQuery);
    const entries = result.rows;

    // Step 3: Calculate similarity between question embedding and each journal entry embedding
    const similarities = entries.map(entry => ({
      journal_entry: `Date:${entry.date} ${entry.journal_entry}`,
      similarity: cosineSimilarity(questionVector, entry.embedding)
    }));

    // Step 4: Sort the entries based on similarity (descending order)
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Step 5: Select the top 5 most relevant journal entries
    const topEntries = similarities.slice(0, 10).map(entry => `${entry.journal_entry}`);
    
    // Step 6: Prepare the prompt with the most relevant entries and the user's question
    const context = topEntries.join("\n");
    const prompt = `Context: ${context}\n\nQuestion: ${question}\nAnswer:`;

    // Step 7: Call the OpenAI API to generate an answer based on the relevant entries
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [
        {
          role: "system",
          content: `You are my personal life coach who helps me become the best version of myself. You have access to my daily journals and other details through the context i provide.The prompt i send you will be in the form of "Context" then "Question". Each answer is to be concise and not more than 2 or 3 lines. Convert any dates in the question into word format like "October four",this has to be only for the question, not the answer you send as a response. Some questions will be vauge, in these cases try your best to use the information availble from the context as best as possible`,
        },
        { role: "user", content: prompt }
      ]
    });

    // Step 8: Send the response back to the frontend
    res.json({ answer: completion.choices[0].message.content });
  } catch (error) {
    console.error("Error while processing question:", error);
    res.status(500).json({ error: "Internal server error" });
  } 
});


app.post("/api/daily-entry", async (req, res) => {
  const { entry, water, smoke, nsfw, workout } = req.body;
  
  async function main() {
    try {
      // Validate inputs
      if (typeof water !== 'number' || typeof smoke !== 'number' ||
          typeof nsfw !== 'boolean' || typeof workout !== 'boolean') {
        return res.status(400).json({ error: "Invalid input types" });
      }

      // Fetch the most recent stats
      const result = await client.query(
        "SELECT * FROM stats ORDER BY date DESC LIMIT 1;"
      );

      // Send journal entry to ChatGPT
      const completion = await openai.beta.chat.completions.parse({
        model: "gpt-4o-2024-08-06",
        messages: [
          {
            role: "system",
            content: `You are my personal life coach who helps me become the best version of myself. You are harsh to me when i do things that are not progressing my life and celebrate the things that do. You will be provided a daily journal entry which you need to analyse and respond to, along with updating some stats. The stats are health,energy,mental,charisma,intellect,skill. Analyze the given journal entry and current stats and respond with a JSON object for stats between 0-100 skill,intellect,charisma,health,energy,mental. Also include a one-line response in the JSON object parameter message. If the entry is not detailed enough, ask for more information in the message, and return the stats as null. Your tone is one of a friend who is interested in the person's day. But you are also aggressive and want me to improve my stats.`,
          },
          {
            role: "user",
            content: `Today's stats:${result.rows[0]} entry: ${entry}`,
          },
        ],
        response_format: zodResponseFormat(MathReasoning, "math_reasoning"),
      });

      const updated_stats = completion.choices[0].message.parsed;
      updated_stats.image = 1;
      // Determine the image to show based on the stats (for your frontend)
      if (updated_stats.health > 80) {
        updated_stats.image = 2;
      }
      if (updated_stats.energy < 50) {
        updated_stats.image = 3;
      }
      const date = new Date();
      
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: `Date:${dateToWords(date)} ${entry}`
      });
  
      const embedding = embeddingResponse.data[0].embedding; 

      // Calculate new streak values
      const newPornStreak = porn ? 0 : (result.rows[0].porn_streak + 1);
      const newWorkoutStreak = workout ? 0 : (result.rows[0].workout_streak + 1);

      // Update the insert query to include all new columns
      const insertQuery = `
        INSERT INTO stats (date, health, energy, mental, charisma, intellect, skill, water, smoke, porn_streak, workout_streak, journal_entry, embedding)
        VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
          nsfw_streak = EXCLUDED.nsfw_streak,
          workout_streak = EXCLUDED.workout_streak,
          journal_entry = EXCLUDED.journal_entry,
          embedding = EXCLUDED.embedding
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
        newNsfwStreak,
        newWorkoutStreak,
        entry,
        embedding
      ];

      const dbResult = await client.query(insertQuery, values);
      
      // Include all stats in the response
      updated_stats.water = water;
      updated_stats.smoke = smoke;
      updated_stats.nsfw_streak = newNsfwStreak;
      updated_stats.workout_streak = newWorkoutStreak;

      res.status(200).json(updated_stats);
    } catch (error) {
      console.error("Error updating stats:", error);
      res.status(500).send("Server error");
    }
  }

  main();
});

// Endpoint to get today's entry
app.get("/api/stats", async (req, res) => {
  try {
    const result = await client.query(
      "SELECT * FROM stats ORDER BY date DESC LIMIT 1;"
    );
    
    if (result.rows.length === 0) {
      // If no entry exists, return default stats
      res.status(200).json({
        health: 99,
        energy: 99,
        mental: 99,
        charisma: 99,
        intellect: 99,
        skill: 99,
        water: 0,
        smoke: 0,
        nsfw_streak: 0,
        workout_streak: 0,
        image: 1
      });
    } else {
      var image = 1;
      var resultResponse = result.rows[0];
      
      if (resultResponse.health > 80) {
        image = 2;
      }
      if (resultResponse.energy < 50) {
        image = 3;
      }
      resultResponse.image = image;
      
      res.status(200).json(resultResponse);
    }
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).send("Server error");
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
