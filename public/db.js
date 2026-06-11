const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

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

async function ensureDatabaseExists() {
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
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
      verified BOOLEAN NOT NULL DEFAULT TRUE,
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
  console.log('[DB] Tabelas verificadas/criadas com sucesso.');
}

async function runDatabaseMigrations() {
  try {
    const connection = await getConnection();
    console.log('Executando migrações...');

    const migrations = [
      'ALTER TABLE patients ADD COLUMN IF NOT EXISTS history JSONB',
      'ALTER TABLE patients ADD COLUMN IF NOT EXISTS eficacia_history JSONB',
      'ALTER TABLE patients ADD COLUMN IF NOT EXISTS simulator_state JSONB',
      'ALTER TABLE patients ADD COLUMN IF NOT EXISTS healProgress INTEGER DEFAULT 0',
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS news_sent JSONB DEFAULT '[]'",
      'ALTER TABLE patients ADD COLUMN IF NOT EXISTS imc NUMERIC(5,2)',
      'ALTER TABLE patients ADD COLUMN IF NOT EXISTS adherence_days INTEGER DEFAULT 0',
      'ALTER TABLE patients ADD COLUMN IF NOT EXISTS last_adherence_date TIMESTAMPTZ',
      'ALTER TABLE patients ADD COLUMN IF NOT EXISTS regDate VARCHAR(50)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT TRUE',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_email BOOLEAN DEFAULT TRUE',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_clinica BOOLEAN DEFAULT TRUE',
    ];

    for (const sql of migrations) {
      try { await connection.query(sql); } catch (e) {}
    }

    connection.release();
    console.log('Migrações concluídas!');
    return true;
  } catch (error) {
    console.error('Erro nas migrações:', error.message);
    return false;
  }
}

module.exports = {
  getConnection,
  ensureDatabaseExists,
  ensureRequiredTables,
  runDatabaseMigrations,
};
