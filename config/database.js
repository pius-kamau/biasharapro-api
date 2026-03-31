const { Pool } = require("pg");
require("dotenv").config();

// Configure pool with better error handling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  family: 4,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 10,
  keepAlive: true,
});

// Handle connection errors
pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL (Neon)");
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err.message);
});

// Add retry logic for queries
const query = async (text, params) => {
  try {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === "development") {
      console.log("Executed query:", { text, duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error("Query error:", error.message);
    // If connection is lost, try one more time
    if (
      error.message.includes("terminated") ||
      error.message.includes("timeout")
    ) {
      console.log("Retrying query...");
      const res = await pool.query(text, params);
      return res;
    }
    throw error;
  }
};

const getClient = async () => {
  try {
    return await pool.connect();
  } catch (error) {
    console.error("Failed to get client:", error.message);
    throw error;
  }
};

module.exports = {
  query,
  getClient,
  pool,
};
