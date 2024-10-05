import pkg from "pg";
const { Client } = pkg;
import OpenAI from "openai";



// Set up the database client
const client = new Client({
    user: "postgres",
    host: "localhost",
    database: "daily",
    password: "@Sdfergh1",
    port: 5432, // default PostgreSQL port
  });
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
  const openai = new OpenAI();
// Function to generate embeddings for journal entries
async function embedJournalEntries() {
  await client.connect();

  try {
    // Step 1: Fetch all journal entries
    const fetchQuery = "SELECT date, journal_entry FROM stats WHERE journal_entry IS NOT NULL AND journal_entry != ''";
    const res = await client.query(fetchQuery);
    const entries = res.rows;

    for (const entry of entries) {
      // Step 2: Get the journal entry
      const journalEntry = `Date:${dateToWords(entry.date)} ${entry.journal_entry}`;
      
      // Step 3: Create embeddings using OpenAI
      const completion = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: journalEntry,
      });

      const embedding = completion.data[0].embedding;

      // Step 4: Update the database with the new embedding
      const updateQuery = `
        UPDATE stats
        SET embedding = $1
        WHERE date = $2
      `;
      
      await client.query(updateQuery, [embedding, entry.date]);
      
    }

    console.log("All entries have been updated with embeddings.");
  } catch (error) {
    console.error("Error embedding journal entries:", error);
  } finally {
    await client.end();
  }
}

// Call the function
embedJournalEntries().catch(err => console.error(err));
