const { Pool, Client } = require('pg');

const DB_NAME = process.env.DB_NAME || 'bemcicatri';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT, 10) || 5432;
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD === undefined ? undefined : process.env.DB_PASSWORD;
const DB_SSL = process.env.DB_SSL === 'true';

const poolConfig = {
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  database: DB_NAME,
  max: 10,
  ssl: DB_SSL ? { rejectUnauthorized: false } : false,
};
if (DB_PASSWORD !== undefined && DB_PASSWORD !== '') {
  poolConfig.password = DB_PASSWORD;
}

const pool = new Pool(poolConfig);

function convertPlaceholders(queryText) {
  let index = 0;
  return queryText.replace(/\?/g, () => `$${++index}`);
}

function buildQuery(queryText, params = []) {
  return {
    text: convertPlaceholders(queryText),
    values: params,
  };
}

async function ensureDatabaseExists() {
  const adminClientConfig = {
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    database: process.env.DB_ADMIN_DATABASE || 'postgres',
    ssl: DB_SSL ? { rejectUnauthorized: false } : false,
  };
  if (DB_PASSWORD !== undefined && DB_PASSWORD !== '') {
    adminClientConfig.password = DB_PASSWORD;
  }
  const adminClient = new Client(adminClientConfig);

  await adminClient.connect();
  const result = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
  if (result.rowCount === 0) {
    await adminClient.query(`CREATE DATABASE "${DB_NAME}"`);
  }
  await adminClient.end();
}

async function getConnection() {
  const client = await pool.connect();
  return {
    query: async (queryText, params = []) => {
      const queryConfig = buildQuery(queryText, params);
      const result = await client.query(queryConfig.text, queryConfig.values);
      return [result.rows, result];
    },
    release: () => client.release(),
  };
}

async function ensureRequiredTables() {
  const connection = await getConnection();

  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      pass VARCHAR(255) NOT NULL,
      nome VARCHAR(255) NOT NULL,
      sobrenome VARCHAR(255) NOT NULL,
      tipo VARCHAR(100) NOT NULL,
      tel VARCHAR(100) NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      verification_token VARCHAR(128) NULL,
      verification_expires TIMESTAMPTZ NULL,
      notif_email BOOLEAN NOT NULL DEFAULT TRUE,
      notif_clinica BOOLEAN NOT NULL DEFAULT TRUE,
      news_sent JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome VARCHAR(255) NOT NULL,
      idade INTEGER NULL,
      diab VARCHAR(50) NULL,
      ferida VARCHAR(255) NULL,
      wagner VARCHAR(50) NULL,
      hba1c NUMERIC(5,2) NULL,
      imc NUMERIC(5,2) NULL,
      obs TEXT NULL,
      history JSONB NULL,
      simulator_state JSONB NULL,
      eficacia_history JSONB NULL,
      healProgress INTEGER NOT NULL DEFAULT 0,
      adherence_days INTEGER NOT NULL DEFAULT 0,
      last_adherence_date TIMESTAMPTZ NULL,
      regDate VARCHAR(50) NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id);
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS login_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date VARCHAR(100) NOT NULL,
      timestamp BIGINT NOT NULL
    );
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_login_user_id ON login_history(user_id);
  `);

  connection.release();
}

async function runDatabaseMigrations() {
  try {
    const connection = await getConnection();
    console.log('🔄 Executando migrações do banco de dados...');

    try {
      await connection.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS history JSONB');
      console.log('✓ Coluna history verificada');
    } catch (e) {}

    try {
      await connection.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS eficacia_history JSONB');
      console.log('✓ Coluna eficacia_history verificada');
    } catch (e) {}

    try {
      await connection.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS simulator_state JSONB');
      console.log('✓ Coluna simulator_state verificada');
    } catch (e) {}

    try {
      await connection.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS healProgress INTEGER DEFAULT 0');
      console.log('✓ Coluna healProgress verificada');
    } catch (e) {}

    try {
      await connection.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS news_sent JSONB DEFAULT '[]'");
      console.log('✓ Coluna news_sent verificada');
    } catch (e) {
      console.warn('Falha ao verificar coluna news_sent:', e.message);
    }

    try {
      await connection.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS imc NUMERIC(5,2)');
      console.log('✓ Coluna imc verificada');
    } catch (e) {}

    try {
      await connection.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS adherence_days INTEGER DEFAULT 0');
      console.log('✓ Coluna adherence_days verificada');
    } catch (e) {}

    try {
      await connection.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS last_adherence_date TIMESTAMPTZ');
      console.log('✓ Coluna last_adherence_date verificada');
    } catch (e) {}

    try {
      await connection.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS regDate VARCHAR(50)');
      console.log('✓ Coluna regDate verificada');
    } catch (e) {}

    try {
      await connection.query('ALTER TABLE patients ALTER COLUMN diab TYPE VARCHAR(50)');
      console.log('✓ Coluna diab ajustada');
    } catch (e) {}

    try {
      await connection.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE');
      await connection.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token VARCHAR(128)');
      await connection.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMPTZ');
      console.log('✓ Colunas de verificação no users verificadas');
    } catch (e) {}

    connection.release();
    console.log('✅ Migrações do banco concluídas com sucesso!');
    return true;
  } catch (error) {
    console.error('❌ Erro ao executar migrações:', error.message);
    return false;
  }
}

module.exports = {
  getConnection,
  ensureDatabaseExists,
  ensureRequiredTables,
  runDatabaseMigrations,
};
