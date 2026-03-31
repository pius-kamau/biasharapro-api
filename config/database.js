const { Pool } = require("pg");
require("dotenv").config();

// Use connection pooler for IPv4 support
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL via Pooler");
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});

const query = async (text, params) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === "development") {
    console.log("Executed query:", { text, duration, rows: res.rowCount });
  }
  return res;
};

const getClient = async () => {
  return await pool.connect();
};

module.exports = {
  query,
  getClient,
  pool,
};
