// =====================================================
// server.js — BemCicatri Backend com PostgreSQL
// =====================================================

const express = require('express');
const cors = require('cors');
require('dotenv').config({ override: true });
const https = require('https');
const {
  getConnection,
  ensureDatabaseExists,
  ensureRequiredTables,
  runDatabaseMigrations,
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname, { index: false }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'JSON malformado' });
  }
  next();
});

// ===================== MIDDLEWARE DE AUTENTICAÇÃO =====================
app.use((req, res, next) => {
  const userEmail = req.headers['x-user-email'];
  if (userEmail) {
    req.authenticatedUserEmail = userEmail.toLowerCase();
  }
  next();
});

// ===================== FUNÇÃO AUXILIAR =====================
function safeJsonParse(value, defaultValue = null) {
  if (!value) return defaultValue;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      return defaultValue;
    }
  }
  return defaultValue;
}

async function testDatabaseConnection() {
  try {
    await ensureDatabaseExists();
    await ensureRequiredTables();
    const connection = await getConnection();
    await connection.query('SELECT 1');
    connection.release();
    console.log('✅ Conexão com PostgreSQL confirmada');
    await runDatabaseMigrations();
    return true;
  } catch (error) {
    console.error('❌ Erro ao conectar ao PostgreSQL:', error.message);
    return false;
  }
}

// ===================== HEALTH CHECK =====================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const fs = require('fs');
const path = require('path');
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace('%%GOOGLE_CLIENT_ID%%', process.env.GOOGLE_CLIENT_ID || '');
  res.send(html);
});

// ===================== AUTH — GOOGLE OAUTH =====================
app.post('/api/auth/google', async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Token ausente' });

    const googleRes = await new Promise((resolve, reject) => {
      https.get(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${access_token}`, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(data) }));
      }).on('error', reject);
    });

    if (googleRes.status !== 200 || !googleRes.body.email) {
      return res.status(401).json({ error: 'Token Google inválido' });
    }

    const { email, given_name, family_name, sub } = googleRes.body;
    const emailLower = email.toLowerCase();
    const connection = await getConnection();

    try {
      const [existing] = await connection.query('SELECT * FROM users WHERE email = ?', [emailLower]);

      let user;
      if (existing.length > 0) {
        user = existing[0];
        if (!user.verified) {
          await connection.query('UPDATE users SET verified = TRUE WHERE email = ?', [emailLower]);
          user.verified = true;
        }
      } else {
        const [result] = await connection.query(
          'INSERT INTO users (email, pass, nome, sobrenome, tipo, tel, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, TRUE, NOW())',
          [emailLower, `google_${sub}`, given_name || 'Usuário', family_name || '', 'Visitante', '']
        );
        const [newUser] = await connection.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
        user = newUser[0];
      }

      try {
        await connection.query(
          'INSERT INTO login_history (user_id, date, timestamp) VALUES (?, ?, ?)',
          [user.id, new Date().toLocaleString('pt-BR'), Date.now()]
        );
      } catch (e) {}

      connection.release();
      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          nome: user.nome,
          sobrenome: user.sobrenome,
          tipo: user.tipo,
          tel: user.tel,
          notifEmail: user.notif_email,
          notifClinica: user.notif_clinica
        }
      });
    } catch (dbError) {
      connection.release();
      res.status(500).json({ error: 'Erro interno' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao autenticar com Google' });
  }
});

// ===================== AUTH — REGISTRO (sem verificação de e-mail) =====================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, pass, nome, sobrenome, tipo, tel } = req.body;

    if (!email || !pass || !nome || !sobrenome || !tipo || !tel) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    const connection = await getConnection();
    try {
      const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
      if (existing.length > 0) {
        connection.release();
        return res.status(409).json({ error: 'email_exists' });
      }

      // Cria usuário já verificado, sem enviar e-mail
      const [result] = await connection.query(
        'INSERT INTO users (email, pass, nome, sobrenome, tipo, tel, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, TRUE, NOW())',
        [email.toLowerCase(), pass, nome, sobrenome, tipo, tel]
      );

      const [newUser] = await connection.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      const user = newUser[0];

      connection.release();
      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          nome: user.nome,
          sobrenome: user.sobrenome,
          tipo: user.tipo,
          tel: user.tel,
          notifEmail: user.notif_email,
          notifClinica: user.notif_clinica
        }
      });
    } catch (dbError) {
      connection.release();
      res.status(500).json({ error: 'Erro ao inserir no banco de dados: ' + dbError.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar usuário: ' + error.message });
  }
});

// ===================== AUTH — LOGIN =====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, pass } = req.body;

    if (!email || !pass) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    const connection = await getConnection();
    const [users] = await connection.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);

    if (users.length === 0) {
      connection.release();
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const user = users[0];

    if (user.pass !== pass) {
      connection.release();
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    try {
      await connection.query(
        'INSERT INTO login_history (user_id, date, timestamp) VALUES (?, ?, ?)',
        [user.id, new Date().toLocaleString('pt-BR'), Date.now()]
      );
    } catch (logError) {}

    connection.release();
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        sobrenome: user.sobrenome,
        tipo: user.tipo,
        tel: user.tel,
        notifEmail: user.notif_email,
        notifClinica: user.notif_clinica
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// ===================== PACIENTES — GET ALL =====================
app.get('/api/patients/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;

    if (!req.authenticatedUserEmail) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    if (req.authenticatedUserEmail !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const connection = await getConnection();

    const [user] = await connection.query('SELECT id FROM users WHERE email = ?', [userEmail.toLowerCase()]);
    if (user.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const [patientsData] = await connection.query(
      'SELECT * FROM patients WHERE user_id = ? ORDER BY created_at DESC',
      [user[0].id]
    );

    connection.release();

    const patients = patientsData.map(p => ({
      ...p,
      history: safeJsonParse(p.history, []),
      simulator_state: safeJsonParse(p.simulator_state, null),
      eficacia_history: safeJsonParse(p.eficacia_history, [])
    }));

    res.json(patients);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar pacientes: ' + error.message });
  }
});

// ===================== PACIENTES — CREATE =====================
app.post('/api/patients', async (req, res) => {
  try {
    const { userEmail, nome, idade, diab, ferida, wagner, obs } = req.body;

    if (!userEmail || !nome) {
      return res.status(400).json({ error: 'E-mail do usuário e nome são obrigatórios' });
    }

    const connection = await getConnection();

    const [user] = await connection.query('SELECT id FROM users WHERE email = ?', [userEmail.toLowerCase()]);
    if (user.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const [result] = await connection.query(
      'INSERT INTO patients (user_id, nome, idade, diab, ferida, wagner, obs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [user[0].id, nome, idade || null, diab || null, ferida || null, wagner || null, obs || null]
    );

    connection.release();
    res.json({
      success: true,
      id: result.insertId,
      userEmail: userEmail.toLowerCase(),
      nome, idade, diab, ferida, wagner, obs
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar paciente' });
  }
});

// ===================== PACIENTES — DELETE =====================
app.delete('/api/patients/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.authenticatedUserEmail) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const connection = await getConnection();

    const [patient] = await connection.query(
      'SELECT p.id, p.user_id, u.email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
      [id]
    );

    if (patient.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }

    if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) {
      connection.release();
      return res.status(403).json({ error: 'Acesso negado' });
    }

    await connection.query('DELETE FROM patients WHERE id = ?', [id]);
    connection.release();
    res.json({ deleted: true, message: 'Paciente deletado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar paciente' });
  }
});

// ===================== SETTINGS — UPDATE =====================
app.put('/api/user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const updates = req.body;

    const connection = await getConnection();

    const [users] = await connection.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (users.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const userId = users[0].id;
    const fields = [];
    const values = [];

    if (updates.nome !== undefined) { fields.push('nome = ?'); values.push(updates.nome); }
    if (updates.sobrenome !== undefined) { fields.push('sobrenome = ?'); values.push(updates.sobrenome); }
    if (updates.tel !== undefined) { fields.push('tel = ?'); values.push(updates.tel); }
    if (updates.tipo !== undefined) { fields.push('tipo = ?'); values.push(updates.tipo); }
    if (updates.notifEmail !== undefined) { fields.push('notif_email = ?'); values.push(updates.notifEmail); }
    if (updates.notifClinica !== undefined) { fields.push('notif_clinica = ?'); values.push(updates.notifClinica); }
    if (updates.pass !== undefined) { fields.push('pass = ?'); values.push(updates.pass); }

    if (fields.length === 0) {
      connection.release();
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    values.push(userId);
    await connection.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

    const [updatedUser] = await connection.query('SELECT * FROM users WHERE id = ?', [userId]);
    connection.release();

    const user = updatedUser[0];
    res.json({
      id: user.id,
      email: user.email,
      nome: user.nome,
      sobrenome: user.sobrenome,
      tipo: user.tipo,
      tel: user.tel,
      notifEmail: user.notif_email,
      notifClinica: user.notif_clinica
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// ===================== EVOLUTION — SAVE =====================
app.post('/api/patients/:id/evolution', async (req, res) => {
  try {
    const { id } = req.params;
    const { evolutionData } = req.body;

    if (!req.authenticatedUserEmail) return res.status(401).json({ error: 'Não autenticado' });
    if (!evolutionData) return res.status(400).json({ error: 'Dados de evolução obrigatórios' });

    const connection = await getConnection();

    const [patient] = await connection.query(
      'SELECT p.id, p.user_id, p.history, u.email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
      [id]
    );

    if (patient.length === 0) { connection.release(); return res.status(404).json({ error: 'Paciente não encontrado' }); }
    if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) { connection.release(); return res.status(403).json({ error: 'Acesso negado' }); }

    const currentHistory = safeJsonParse(patient[0].history, []);
    currentHistory.push(evolutionData);
    const healProgress = evolutionData.pct || 0;

    await connection.query(
      'UPDATE patients SET history = ?, healProgress = ? WHERE id = ?',
      [JSON.stringify(currentHistory), healProgress, id]
    );

    connection.release();
    res.json({ success: true, message: 'Evolução salva', evolutionCount: currentHistory.length });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar evolução' });
  }
});

// ===================== EFICÁCIA — SALVAR =====================
app.post('/api/patients/:id/eficacia', async (req, res) => {
  try {
    const { id } = req.params;
    const { day, baseEficacia, adherence, finalEficacia, hba1c, idade, imc } = req.body;

    if (!req.authenticatedUserEmail) return res.status(401).json({ error: 'Não autenticado' });

    const connection = await getConnection();
    try {
      const [patient] = await connection.query(
        'SELECT p.id, u.email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?', [id]
      );
      if (patient.length === 0) { connection.release(); return res.status(404).json({ error: 'Paciente não encontrado' }); }
      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) { connection.release(); return res.status(403).json({ error: 'Acesso negado' }); }

      const [patientData] = await connection.query('SELECT eficacia_history, hba1c, idade, imc FROM patients WHERE id = ?', [id]);
      let eficaciaHistory = safeJsonParse(patientData[0].eficacia_history, []);
      eficaciaHistory.push({ day, baseEficacia, adherence, finalEficacia, timestamp: new Date().toISOString() });

      const updateFields = ['eficacia_history = ?'];
      const updateValues = [JSON.stringify(eficaciaHistory)];
      if (hba1c !== undefined && hba1c !== null) { updateFields.push('hba1c = ?'); updateValues.push(hba1c); }
      if (idade !== undefined && idade !== null) { updateFields.push('idade = ?'); updateValues.push(idade); }
      if (imc !== undefined && imc !== null) { updateFields.push('imc = ?'); updateValues.push(imc); }
      updateValues.push(id);

      await connection.query(`UPDATE patients SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
      connection.release();
      res.json({ success: true, recordCount: eficaciaHistory.length });
    } catch (dbError) {
      connection.release();
      res.status(500).json({ error: 'Erro ao salvar eficácia: ' + dbError.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar eficácia' });
  }
});

// ===================== EFICÁCIA — RECUPERAR =====================
app.get('/api/patients/:id/eficacia', async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.authenticatedUserEmail) return res.status(401).json({ error: 'Não autenticado' });

    const connection = await getConnection();
    try {
      const [patient] = await connection.query(
        'SELECT p.id, u.email, p.eficacia_history, p.hba1c, p.idade, p.imc FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?', [id]
      );
      if (patient.length === 0) { connection.release(); return res.status(404).json({ error: 'Paciente não encontrado' }); }
      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) { connection.release(); return res.status(403).json({ error: 'Acesso negado' }); }

      const eficaciaHistory = safeJsonParse(patient[0].eficacia_history, []);
      connection.release();
      res.json({ success: true, eficaciaHistory, patientInfo: { hba1c: patient[0].hba1c, idade: patient[0].idade, imc: patient[0].imc } });
    } catch (dbError) {
      connection.release();
      res.status(500).json({ error: 'Erro ao recuperar eficácia: ' + dbError.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao recuperar eficácia' });
  }
});

// ===================== SIMULADOR — SALVAR =====================
app.post('/api/patients/:id/simulator-state', async (req, res) => {
  try {
    const { id } = req.params;
    const { currentDay, efficacy, lastUpdated } = req.body;
    if (!req.authenticatedUserEmail) return res.status(401).json({ error: 'Não autenticado' });

    const connection = await getConnection();
    try {
      const [patient] = await connection.query(
        'SELECT p.id, u.email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?', [id]
      );
      if (patient.length === 0) { connection.release(); return res.status(404).json({ error: 'Paciente não encontrado' }); }
      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) { connection.release(); return res.status(403).json({ error: 'Acesso negado' }); }

      const state = { currentDay: parseInt(currentDay) || 1, efficacy: parseFloat(efficacy) || 0.75, lastUpdated: lastUpdated || new Date().toISOString() };
      await connection.query('UPDATE patients SET simulator_state = ? WHERE id = ?', [JSON.stringify(state), id]);
      connection.release();
      res.json({ success: true, state });
    } catch (dbError) {
      connection.release();
      res.status(500).json({ error: 'Erro ao salvar estado: ' + dbError.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar estado do simulador' });
  }
});

// ===================== SIMULADOR — RECUPERAR =====================
app.get('/api/patients/:id/simulator-state', async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.authenticatedUserEmail) return res.status(401).json({ error: 'Não autenticado' });

    const connection = await getConnection();
    try {
      const [patient] = await connection.query(
        'SELECT p.id, u.email, p.simulator_state FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?', [id]
      );
      if (patient.length === 0) { connection.release(); return res.status(404).json({ error: 'Paciente não encontrado' }); }
      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) { connection.release(); return res.status(403).json({ error: 'Acesso negado' }); }

      const state = safeJsonParse(patient[0].simulator_state, null);
      connection.release();
      res.json({ success: true, state });
    } catch (dbError) {
      connection.release();
      res.status(500).json({ error: 'Erro ao recuperar estado: ' + dbError.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao recuperar estado do simulador' });
  }
});

// ===================== PACIENTE — DADOS COMPLETOS =====================
app.get('/api/patients/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.authenticatedUserEmail) return res.status(401).json({ error: 'Não autenticado' });

    const connection = await getConnection();
    try {
      const [patient] = await connection.query(
        'SELECT p.*, u.email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?', [id]
      );
      if (patient.length === 0) { connection.release(); return res.status(404).json({ error: 'Paciente não encontrado' }); }
      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) { connection.release(); return res.status(403).json({ error: 'Acesso negado' }); }

      const p = patient[0];
      connection.release();
      res.json({
        success: true,
        patient: { id: p.id, nome: p.nome, idade: p.idade, diab: p.diab, ferida: p.ferida, wagner: p.wagner, hba1c: p.hba1c, imc: p.imc, obs: p.obs, healProgress: p.healProgress, created_at: p.created_at },
        history: safeJsonParse(p.history, []),
        simulatorState: safeJsonParse(p.simulator_state, null),
        eficaciaHistory: safeJsonParse(p.eficacia_history, [])
      });
    } catch (dbError) {
      connection.release();
      res.status(500).json({ error: 'Erro ao recuperar dados: ' + dbError.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao recuperar dados do paciente' });
  }
});

// ===================== ERROR HANDLING =====================
app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ===================== START SERVER =====================
const server = app.listen(PORT, async () => {
  const dbConnected = await testDatabaseConnection();
  const actualPort = server.address().port;
  console.log(`
╔════════════════════════════════════════════════╗
║  BemCicatri Backend rodando!                   ║
║  🌐 http://localhost:${actualPort}                       ║
║  ${dbConnected ? '✅ PostgreSQL conectado' : '❌ PostgreSQL desconectado'}                         ║
╚════════════════════════════════════════════════╝
  `);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    app.listen(3001, async () => {
      await testDatabaseConnection();
      console.log('🌐 Servidor rodando na porta 3001');
    });
  } else {
    throw err;
  }
});
