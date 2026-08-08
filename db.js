const { Pool } = require('pg');

let connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  process.env.PGURL ||
  '';

// Yanlışlıkla yapıştırılan "railwaypostgresql://" gibi hatalı ön ekleri otomatik temizle
if (connectionString) {
  const match = connectionString.match(/(postgres(?:ql)?:\/\/.+)$/i);
  if (match) {
    connectionString = match[1];
  }
}

const isRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL);
const useSSL = process.env.PGSSL === 'true' || isRailway;

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

module.exports = pool;