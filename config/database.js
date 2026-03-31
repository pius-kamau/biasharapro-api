const { Pool } = require("pg");
require("dotenv").config();

// Use environment variables for database connection
const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: parseInt(process.env.PGPORT || "5432"),
  database: process.env.PGDATABASE || "biasharapro",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE ? { rejectUnauthorized: false } : false,
  // Force IPv4 to avoid IPv6 issues with Supabase
  family: 4,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  // Retry settings
  max: 20,
  idleTimeoutMillis: 30000,
});

// Test connection
pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL");
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
