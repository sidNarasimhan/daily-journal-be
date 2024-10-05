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
  host: "localhost",
  database: "daily",
  password: "@Sdfergh1",
  port: 5432, // default PostgreSQL port
});

client.connect();

const app = express();
const port = 5000;

app.use(cors());
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
  console.log(question)
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
    console.log(topEntries)
    // Step 6: Prepare the prompt with the most relevant entries and the user's question
    const context = topEntries.join("\n");
    const prompt = `Context: ${context}\n\nQuestion: ${question}\nAnswer:`;

    // Step 7: Call the OpenAI API to generate an answer based on the relevant entries
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [
        {
          role: "system",
          content: `You are a AI Journal which can answer questions asked based on the journal entries.The prompt i send you will be in the form of "Context" then "Question". Each answer is to be concise and not more than 2 or 3 lines. Convert any dates in the question into word format like "October four",this has to be only for the question, not the answer you send as a response. If you dont find the answer to the question then return "Hmm... It seems your journal entries make no mention of that. Feed me more information".`,
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
  const { entry } = req.body; // Get the journal entry from request body

  async function main() {
    try {
      // Send journal entry to ChatGPT
      const result = await client.query(
        "SELECT * FROM stats ORDER BY date DESC LIMIT 1;"
      );
      const completion = await openai.beta.chat.completions.parse({
        model: "gpt-4o-2024-08-06",
        messages: [
          {
            role: "system",
            content: `You are an advanced AI capable of tracking a person's stats given their daily journal. The stats are health,energy,mental,charisma,intellect,skill. Analyze the given journal entry and current stats and respond with a JSON object for stats between 0-100 skill,intellect,charisma,health,energy,mental. Also include a one-line response in the JSON object parameter message. If the entry is not detailed enough, ask for more information in the message, and return the stats as null. Your tone is one of a friend who is interested in the person's day. But you are also agressive and want me to improve my stats.`,
          },
          {
            role: "user",
            content: `Today's stats:${result.rows[0]} entry: ${entry}`,
          },
        ],
        response_format: zodResponseFormat(MathReasoning, "math_reasoning"),
      });

      const updated_stats = completion.choices[0].message.parsed;
      updated_stats.image=1
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

      // Insert journal entry and updated stats into the database
      const insertQuery = `
        INSERT INTO stats (date, health, energy, mental, charisma, intellect, skill, journal_entry,embedding)
        VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (date) 
        DO UPDATE SET 
          health = EXCLUDED.health,
          energy = EXCLUDED.energy,
          mental = EXCLUDED.mental,
          charisma = EXCLUDED.charisma,
          intellect = EXCLUDED.intellect,
          skill = EXCLUDED.skill,
          journal_entry = EXCLUDED.journal_entry,
          embedding = EXCLUDED.embedding
        RETURNING *;
      `;
      console.log(updated_stats)
      const values = [
        updated_stats.health!=0?updated_stats.health:result.rows[0].health,
        updated_stats.energy!=0?updated_stats.energy:result.rows[0].energy,
        updated_stats.mental!=0?updated_stats.mental:result.rows[0].mental,
        updated_stats.charisma!=0?updated_stats.charisma:result.rows[0].charisma,
        updated_stats.intellect!=0?updated_stats.intellect:result.rows[0].intellect,
        updated_stats.skill!=0?updated_stats.skill:result.rows[0].skill,
        entry,
        embedding
      ];

      await client.query(insertQuery, values);
      

      res.status(200).json(updated_stats); // Return the updated stats to the frontend
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
      // If no entry exists for today, return default stats
      res.status(200).json({
        health: 99,
        energy: 99,
        mental: 99,
        charisma: 99,
        intellect: 99,
        skill: 99,
      });
    } else {
      var image=1 
      var resultResponse 
      
      if (result.rows[0].health > 80) {
        image = 2
        
      }
      if (result.rows[0].energy < 50) {
        image = 3;
        
      }
      resultResponse= result.rows[0]
      resultResponse.image = image
      console.log(resultResponse)
      res.status(200).json(resultResponse); // Return today's stats from DB
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
