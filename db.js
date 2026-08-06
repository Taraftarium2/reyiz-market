const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  process.env.PGURL;

const isRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL);
const useSSL = process.env.PGSSL === 'true' || isRailway;

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

module.exports = pool;