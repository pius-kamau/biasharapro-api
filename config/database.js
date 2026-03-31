const { Pool } = require("pg");
require("dotenv").config();

// Force IPv4 by using the IPv4 address directly
// Get IPv4 address of your Supabase host
const supabaseHost = "db.dadijjngukeccdhntmrg.supabase.co";

const pool = new Pool({
  host: supabaseHost,
  port: parseInt(process.env.PGPORT || "5432"),
  database: process.env.PGDATABASE || "postgres",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
  // Force IPv4 by setting family to 4
  family: 4,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  // Disable DNS caching to force fresh lookup
  lookup: (hostname, options, callback) => {
    const dns = require("dns");
    // Force IPv4 lookup only
    options.family = 4;
    dns.lookup(hostname, options, callback);
  },
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
