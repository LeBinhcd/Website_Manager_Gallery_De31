import mysql from 'mysql2/promise';

const hasDatabaseConfig = Boolean(process.env.DB_HOST);
const pool = hasDatabaseConfig ? mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'gallery_app',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'gallery',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 5,
  maxIdle: 5,
  idleTimeout: 60000,
  enableKeepAlive: true
}) : null;

export function isDatabaseConfigured() {
  return Boolean(pool);
}

export async function query(sql, values = []) {
  if (!pool) throw new Error('database_not_configured');
  const [rows] = await pool.execute(sql, values);
  return rows;
}

export async function checkDatabase() {
  if (!pool) return { configured: false, connected: false };
  await pool.query('SELECT 1');
  return { configured: true, connected: true };
}

export async function closeDatabase() {
  await pool?.end();
}
