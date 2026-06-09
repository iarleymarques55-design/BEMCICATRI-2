// =====================================================
// server.js — BemCicatri Backend com PostgreSQL
// =====================================================

const express = require('express');
const cors = require('cors');
const emailValidator = require('./email-validator.js');
require('dotenv').config({ override: true });
const https = require('https');
const crypto = require('crypto');
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
app.use(express.static(__dirname));

// Middleware de tratamento de erros de JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('Erro de JSON malformado:', err.message, 'Body recebido:', err.body);
    return res.status(400).json({ error: 'JSON malformado' });
  }
  next();
});

// Middleware de log de requisições
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path.includes('/auth/')) {
    console.log(`${req.method} ${req.path}`);
    console.log('Headers:', req.headers);
    console.log('Body:', JSON.stringify(req.body));
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
      console.warn('Erro ao fazer parse de JSON:', value, e.message);
      return defaultValue;
    }
  }
  return defaultValue;
}

// Teste de conexão ao iniciar
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

// ===================== EMAIL SENDER (Nodemailer + Gmail) =====================
const nodemailer = require('nodemailer');

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

let APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

const gmailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});

function mailersendSendEmail({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      console.warn('⚠️ GMAIL_USER ou GMAIL_APP_PASSWORD não configurados. Email não enviado.');
      return resolve({ messageId: 'no-gmail' });
    }

    gmailTransporter.sendMail({
      from: `BemCicatri <${GMAIL_USER}>`,
      to,
      subject,
      html,
    }, (err, info) => {
      if (err) return reject(err);
      resolve({ messageId: info.messageId });
    });
  });
}

async function sendVerificationEmail(toEmail, token) {
  const confirmPageUrl = `${APP_BASE_URL}/confirm?token=${encodeURIComponent(token)}`;
  return mailersendSendEmail({
    to: toEmail,
    subject: 'Seu código de confirmação BemCicatri',
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;">
        <h2 style="color:#0f766e;">Código de confirmação BemCicatri</h2>
        <p>Olá,</p>
        <p>Seu código de confirmação é:</p>
        <p style="font-size:28px;font-weight:700;margin:16px 0;padding:16px 24px;background:#ecfdf5;color:#065f46;border-radius:14px;display:inline-block;">${token}</p>
        <p>Acesse o BemCicatri e cole este código na página de confirmação.</p>
        <p style="margin-top:18px;">Ou clique no link abaixo:</p>
        <p><a href="${confirmPageUrl}" style="color:#0f766e;">${confirmPageUrl}</a></p>
      </div>
    `
  });
}

async function sendLoginNotificationEmail(toEmail, userName, loginDate, newsArticle) {
  const newsSection = newsArticle ? `
    <div style="margin-top:24px;padding:18px;background:#f0f9ff;border:1px solid #bfdbfe;border-radius:14px;">
      <h3 style="margin:0 0 8px 0;color:#1d4ed8;">Notícia recomendada de saúde</h3>
      <p style="margin:0 0 8px 0;font-size:0.95rem;color:#334155;">${newsArticle.summary}</p>
      <p style="margin:0;font-size:0.95rem;"><a href="${newsArticle.url}" style="color:#1d4ed8; text-decoration:none;">${newsArticle.title}</a></p>
    </div>
  ` : '';

  return mailersendSendEmail({
    to: toEmail,
    subject: 'Alerta de acesso BemCicatri e notícia de saúde',
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;">
        <h2 style="color:#0f766e;">Olá ${userName},</h2>
        <p>Detectamos um acesso ao BemCicatri com seu e-mail em <strong>${loginDate}</strong>.</p>
        <p>Se você não realizou esse acesso, por favor verifique sua conta.</p>
        ${newsSection}
        <p style="margin-top:24px;font-size:0.9rem;color:#475569;">Este e-mail é automático para manter sua conta protegida e trazer notícias de saúde relevantes.</p>
      </div>
    `
  });
}

// ===================== HEALTH NEWS =====================
const HEALTH_NEWS_ARTICLES = [
  { id: 'who-mental-health', title: 'OMS destaca cuidados com saúde mental pós-pandemia', url: 'https://www.who.int/news-room', summary: 'Leia orientações oficiais da Organização Mundial da Saúde para apoio à saúde mental após a pandemia.' },
  { id: 'minsaude-doencas-cronicas', title: 'Ministério da Saúde reforça prevenção de doenças crônicas', url: 'https://www.gov.br/saude/pt-br', summary: 'Recomendações práticas para controle de diabetes, hipertensão e feridas crônicas no Brasil.' },
  { id: 'jaman-diabetic-foot', title: 'JAMA publica atualizações sobre cuidados de feridas diabéticas', url: 'https://jamanetwork.com/journals/jama', summary: 'A revista médica JAMA traz protocolos de avaliação e tratamento para úlceras diabéticas.' },
  { id: 'who-vaccination', title: 'OMS atualiza recomendações de vacinação e prevenção', url: 'https://www.who.int/news-room', summary: 'Novas diretrizes para vacinação e proteção contra doenças infecciosas na população adulta.' },
  { id: 'cdc-healthy-aging', title: 'CDC orienta sobre envelhecimento saudável e prevenção de quedas', url: 'https://www.cdc.gov/media/index.html', summary: 'Conselhos práticos para manter a mobilidade e reduzir risco de complicações em idosos.' },
  { id: 'nature-skin-wound-healing', title: 'Pesquisa destaca avanços em cicatrização de feridas e bioativos naturais', url: 'https://www.nature.com/', summary: 'Estudos recentes sobre tratamento de feridas com fórmula natural e controle de infecção.' }
];

function chooseNextHealthNews(user) {
  const sentIds = safeJsonParse(user.news_sent, []);
  const nextArticle = HEALTH_NEWS_ARTICLES.find(item => !sentIds.includes(item.id));
  if (!nextArticle) return null;
  sentIds.push(nextArticle.id);
  return { nextArticle, sentIds };
}

// ===================== HEALTH CHECK =====================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Servir index.html com GOOGLE_CLIENT_ID injetado
const fs = require('fs');
const path = require('path');
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace('%%GOOGLE_CLIENT_ID%%', process.env.GOOGLE_CLIENT_ID || '');
  res.send(html);
});

// ===================== EMAIL VERIFICATION =====================
app.post('/api/email/verify', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    const emailLower = email.toLowerCase().trim();

    // Validar apenas o formato do email (sem checagem SMTP/DNS)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailLower)) {
      return res.json({ valid: false, reason: 'invalid_format', message: '✗ Formato de e-mail inválido' });
    }

    // Verificar se já está cadastrado
    try {
      const connection = await getConnection();
      const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [emailLower]);
      connection.release();

      if (existing.length > 0) {
        return res.json({ valid: false, reason: 'email_already_registered', message: '✗ E-mail já cadastrado' });
      }
    } catch (dbError) {
      console.error('⚠️ Erro ao verificar email no banco:', dbError.message);
    }

    return res.json({ valid: true, reason: 'valid', message: '✓ E-mail válido e disponível' });

  } catch (error) {
    console.error('❌ Erro na verificação de email:', error.message);
    res.status(500).json({ valid: false, reason: 'verification_error', message: 'Erro ao verificar e-mail.' });
  }
});

// ===================== AUTH — GOOGLE OAUTH =====================
app.post('/api/auth/google', async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Token ausente' });

    // Buscar dados do usuário no Google
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
      // Verificar se usuário já existe
      const [existing] = await connection.query('SELECT * FROM users WHERE email = ?', [emailLower]);

      let user;
      if (existing.length > 0) {
        user = existing[0];
        // Marcar como verificado se ainda não estiver
        if (!user.verified) {
          await connection.query('UPDATE users SET verified = TRUE WHERE email = ?', [emailLower]);
          user.verified = true;
        }
      } else {
        // Criar novo usuário com Google
        const [result] = await connection.query(
          'INSERT INTO users (email, pass, nome, sobrenome, tipo, tel, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, TRUE, NOW())',
          [emailLower, `google_${sub}`, given_name || 'Usuário', family_name || '', 'Visitante', '']
        );
        const [newUser] = await connection.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
        user = newUser[0];
      }

      // Registrar login
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
      console.error('Erro no banco ao autenticar Google:', dbError.message);
      res.status(500).json({ error: 'Erro interno' });
    }
  } catch (error) {
    console.error('Erro no Google OAuth:', error.message);
    res.status(500).json({ error: 'Erro ao autenticar com Google' });
  }
});

// ===================== AUTH — REGISTRO =====================
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

      const token = String(crypto.randomInt(100000, 1000000)).padStart(6, '0');
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const [result] = await connection.query(
        'INSERT INTO users (email, pass, nome, sobrenome, tipo, tel, verified, verification_token, verification_expires, created_at) VALUES (?, ?, ?, ?, ?, ?, FALSE, ?, ?, NOW())',
        [email.toLowerCase(), pass, nome, sobrenome, tipo, tel, token, expires]
      );

      try {
        await sendVerificationEmail(email.toLowerCase(), token);
        console.log(`✉️ Enviado e-mail de verificação para ${email.toLowerCase()}`);
      } catch (mailErr) {
        console.error('⚠️ Falha ao enviar e-mail de verificação:', mailErr.message);
      }

      connection.release();
      res.json({ 
        success: true,
        pending: true,
        message: 'Conta criada. Verifique seu e-mail para ativar a conta.',
        email: email.toLowerCase(),
        id: result.insertId
      });
    } catch (dbError) {
      connection.release();
      console.error('Erro no banco ao registrar:', dbError.message);
      res.status(500).json({ error: 'Erro ao inserir no banco de dados: ' + dbError.message });
    }
  } catch (error) {
    console.error('Erro no registro:', error.message);
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

    if (!user.verified) {
      connection.release();
      return res.status(403).json({ error: 'not_verified', message: 'E-mail não confirmado. Verifique sua caixa de entrada.' });
    }
    
    try {
      await connection.query(
        'INSERT INTO login_history (user_id, date, timestamp) VALUES (?, ?, ?)',
        [user.id, new Date().toLocaleString('pt-BR'), Date.now()]
      );
    } catch (logError) {
      console.warn('Aviso: Não foi possível registrar o login no histórico:', logError.message);
    }

    if (user.notif_email) {
      try {
        const newsResult = chooseNextHealthNews(user);
        if (newsResult) {
          await connection.query('UPDATE users SET news_sent = ? WHERE id = ?', [JSON.stringify(newsResult.sentIds), user.id]);
        }
        await sendLoginNotificationEmail(user.email, user.nome, new Date().toLocaleString('pt-BR'), newsResult?.nextArticle || null);
        console.log(`✉️ Enviado e-mail de login para ${user.email}`);
      } catch (mailError) {
        console.warn('⚠️ Não foi possível enviar e-mail de login:', mailError.message);
      }
    }

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
    console.error('Erro no login:', error);
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
      return res.status(403).json({ error: 'Acesso negado: você não pode ver pacientes de outro usuário' });
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
    console.error('Erro ao buscar pacientes:', error);
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
    console.error('Erro ao criar paciente:', error);
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
      return res.status(403).json({ error: 'Acesso negado: você não pode deletar pacientes de outro usuário' });
    }
    
    await connection.query('DELETE FROM patients WHERE id = ?', [id]);
    
    connection.release();
    res.json({ deleted: true, message: 'Paciente deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar paciente:', error);
    res.status(500).json({ error: 'Erro ao deletar paciente' });
  }
});

// ===================== AUTH — CONFIRM EMAIL =====================
app.get('/confirm', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('<h1>Token ausente</h1><p>Não foi possível confirmar seu e-mail. Tente novamente.</p>');
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Confirmar e-mail — BemCicatri</title>
        <style>
          body { font-family: Arial, sans-serif; background:#f5f7fb; color:#222; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
          .container { background:#fff; padding:28px; border-radius:16px; box-shadow:0 20px 50px rgba(0,0,0,.08); max-width:420px; width:100%; text-align:center; }
          button { background:#10b981; color:#fff; border:none; border-radius:10px; padding:14px 28px; font-size:16px; cursor:pointer; }
          button:hover { opacity:.94; }
          p { margin:18px 0 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Confirmar e-mail</h1>
          <p>Clique no botão abaixo para confirmar sua conta.</p>
          <form action="/api/auth/confirm" method="POST">
            <input type="hidden" name="token" value="${token}" />
            <button type="submit">Confirmo</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

app.post('/api/auth/confirm', async (req, res) => {
  try {
    const token = req.body.token || req.query.token;
    if (!token) return res.status(400).json({ error: 'missing_token' });

    const connection = await getConnection();
    const [users] = await connection.query('SELECT id, verification_expires FROM users WHERE verification_token = ?', [token]);
    if (users.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'invalid_token' });
    }

    const user = users[0];
    const now = new Date();
    const expires = new Date(user.verification_expires);
    if (expires < now) {
      connection.release();
      return res.status(410).json({ error: 'token_expired' });
    }

    await connection.query('UPDATE users SET verified = TRUE, verification_token = NULL, verification_expires = NULL WHERE id = ?', [user.id]);
    connection.release();

    res.json({ success: true, message: 'E-mail confirmado com sucesso' });
  } catch (error) {
    console.error('Erro ao confirmar e-mail:', error.message);
    res.status(500).json({ error: 'Erro ao confirmar e-mail' });
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
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// ===================== EVOLUTION — SAVE SIMULATION =====================
app.post('/api/patients/:id/evolution', async (req, res) => {
  try {
    const { id } = req.params;
    const { evolutionData } = req.body;

    if (!req.authenticatedUserEmail) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    if (!evolutionData) {
      return res.status(400).json({ error: 'Dados de evolução obrigatórios' });
    }

    const connection = await getConnection();

    const [patient] = await connection.query(
      'SELECT p.id, p.user_id, p.history, u.email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
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

    const currentHistory = safeJsonParse(patient[0].history, []);
    currentHistory.push(evolutionData);

    const healProgress = evolutionData.pct || 0;

    await connection.query(
      'UPDATE patients SET history = ?, healProgress = ? WHERE id = ?',
      [JSON.stringify(currentHistory), healProgress, id]
    );

    connection.release();
    res.json({ 
      success: true, 
      message: 'Evolução salva com sucesso',
      evolutionCount: currentHistory.length
    });
  } catch (error) {
    console.error('Erro ao salvar evolução:', error);
    res.status(500).json({ error: 'Erro ao salvar evolução' });
  }
});

// ===================== EFICÁCIA DINÂMICA — SALVAR =====================
app.post('/api/patients/:id/eficacia', async (req, res) => {
  try {
    const { id } = req.params;
    const { day, baseEficacia, adherence, finalEficacia, hba1c, idade, imc } = req.body;

    if (!req.authenticatedUserEmail) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const connection = await getConnection();

    try {
      const [patient] = await connection.query(`
        SELECT p.id, u.email 
        FROM patients p 
        JOIN users u ON p.user_id = u.id 
        WHERE p.id = ?
      `, [id]);

      if (patient.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Paciente não encontrado' });
      }

      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) {
        connection.release();
        return res.status(403).json({ error: 'Acesso negado' });
      }

      let patientData;
      try {
        [patientData] = await connection.query(
          'SELECT eficacia_history, hba1c, idade, imc FROM patients WHERE id = ?',
          [id]
        );
      } catch (columnError) {
        [patientData] = await connection.query(
          'SELECT hba1c, idade, imc FROM patients WHERE id = ?',
          [id]
        );
        patientData[0] = { ...patientData[0], eficacia_history: null };
      }

      let eficaciaHistory = safeJsonParse(patientData[0].eficacia_history, []);

      eficaciaHistory.push({
        day, baseEficacia, adherence, finalEficacia,
        timestamp: new Date().toISOString()
      });

      const updateFields = ['eficacia_history = ?'];
      const updateValues = [JSON.stringify(eficaciaHistory)];

      if (hba1c !== undefined && hba1c !== null) { updateFields.push('hba1c = ?'); updateValues.push(hba1c); }
      if (idade !== undefined && idade !== null) { updateFields.push('idade = ?'); updateValues.push(idade); }
      if (imc !== undefined && imc !== null) { updateFields.push('imc = ?'); updateValues.push(imc); }

      updateValues.push(id);

      await connection.query(
        `UPDATE patients SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );

      connection.release();
      res.json({ success: true, message: 'Eficácia salva com sucesso', recordCount: eficaciaHistory.length });
    } catch (dbError) {
      connection.release();
      console.error('Erro no banco ao salvar eficácia:', dbError);
      res.status(500).json({ error: 'Erro ao salvar eficácia: ' + dbError.message });
    }
  } catch (error) {
    console.error('Erro ao salvar eficácia:', error);
    res.status(500).json({ error: 'Erro ao salvar eficácia' });
  }
});

// ===================== EFICÁCIA DINÂMICA — RECUPERAR =====================
app.get('/api/patients/:id/eficacia', async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.authenticatedUserEmail) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const connection = await getConnection();

    try {
      const [patient] = await connection.query(`
        SELECT p.id, u.email, p.eficacia_history, p.hba1c, p.idade, p.imc 
        FROM patients p 
        JOIN users u ON p.user_id = u.id 
        WHERE p.id = ?
      `, [id]);

      if (patient.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Paciente não encontrado' });
      }

      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) {
        connection.release();
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const eficaciaHistory = safeJsonParse(patient[0].eficacia_history, []);

      connection.release();
      res.json({
        success: true,
        eficaciaHistory,
        patientInfo: {
          hba1c: patient[0].hba1c,
          idade: patient[0].idade,
          imc: patient[0].imc
        }
      });
    } catch (dbError) {
      connection.release();
      console.error('Erro no banco ao recuperar eficácia:', dbError);
      res.status(500).json({ error: 'Erro ao recuperar eficácia: ' + dbError.message });
    }
  } catch (error) {
    console.error('Erro ao recuperar eficácia:', error);
    res.status(500).json({ error: 'Erro ao recuperar eficácia' });
  }
});

// ===================== ESTADO DO SIMULADOR — SALVAR =====================
app.post('/api/patients/:id/simulator-state', async (req, res) => {
  try {
    const { id } = req.params;
    const { currentDay, efficacy, lastUpdated } = req.body;

    if (!req.authenticatedUserEmail) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const connection = await getConnection();

    try {
      const [patient] = await connection.query(`
        SELECT p.id, u.email, p.simulator_state
        FROM patients p 
        JOIN users u ON p.user_id = u.id 
        WHERE p.id = ?
      `, [id]);

      if (patient.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Paciente não encontrado' });
      }

      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) {
        connection.release();
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const state = {
        currentDay: parseInt(currentDay) || 1,
        efficacy: parseFloat(efficacy) || 0.75,
        lastUpdated: lastUpdated || new Date().toISOString()
      };

      await connection.query(
        'UPDATE patients SET simulator_state = ? WHERE id = ?',
        [JSON.stringify(state), id]
      );

      connection.release();
      res.json({ success: true, state });
    } catch (dbError) {
      connection.release();
      console.error('Erro ao salvar estado do simulador:', dbError);
      res.status(500).json({ error: 'Erro ao salvar estado: ' + dbError.message });
    }
  } catch (error) {
    console.error('Erro ao salvar estado do simulador:', error);
    res.status(500).json({ error: 'Erro ao salvar estado do simulador' });
  }
});

// ===================== ESTADO DO SIMULADOR — RECUPERAR =====================
app.get('/api/patients/:id/simulator-state', async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.authenticatedUserEmail) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const connection = await getConnection();

    try {
      const [patient] = await connection.query(`
        SELECT p.id, u.email, p.simulator_state
        FROM patients p 
        JOIN users u ON p.user_id = u.id 
        WHERE p.id = ?
      `, [id]);

      if (patient.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Paciente não encontrado' });
      }

      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) {
        connection.release();
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const state = safeJsonParse(patient[0].simulator_state, null);

      connection.release();
      res.json({ success: true, state });
    } catch (dbError) {
      connection.release();
      console.error('Erro ao recuperar estado do simulador:', dbError);
      res.status(500).json({ error: 'Erro ao recuperar estado: ' + dbError.message });
    }
  } catch (error) {
    console.error('Erro ao recuperar estado do simulador:', error);
    res.status(500).json({ error: 'Erro ao recuperar estado do simulador' });
  }
});

// ===================== PACIENTE — HISTÓRICO E EVOLUÇÃO COMPLETA =====================
app.get('/api/patients/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.authenticatedUserEmail) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const connection = await getConnection();

    try {
      const [patient] = await connection.query(`
        SELECT p.*, u.email
        FROM patients p 
        JOIN users u ON p.user_id = u.id 
        WHERE p.id = ?
      `, [id]);

      if (patient.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Paciente não encontrado' });
      }

      if (patient[0].email.toLowerCase() !== req.authenticatedUserEmail) {
        connection.release();
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const p = patient[0];
      
      const history = safeJsonParse(p.history, []);
      const simulatorState = safeJsonParse(p.simulator_state, null);
      const eficaciaHistory = safeJsonParse(p.eficacia_history, []);

      connection.release();
      res.json({
        success: true,
        patient: {
          id: p.id,
          nome: p.nome,
          idade: p.idade,
          diab: p.diab,
          ferida: p.ferida,
          wagner: p.wagner,
          hba1c: p.hba1c,
          imc: p.imc,
          obs: p.obs,
          healProgress: p.healProgress,
          created_at: p.created_at
        },
        history,
        simulatorState,
        eficaciaHistory
      });
    } catch (dbError) {
      connection.release();
      console.error('Erro ao recuperar dados completos do paciente:', dbError);
      res.status(500).json({ error: 'Erro ao recuperar dados: ' + dbError.message });
    }
  } catch (error) {
    console.error('Erro ao recuperar dados completos:', error);
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
  if (!process.env.APP_BASE_URL) {
    APP_BASE_URL = `http://localhost:${actualPort}`;
  }
  console.log(`
╔════════════════════════════════════════════════╗
║  BemCicatri Backend rodando!                   ║
║  🌐 http://localhost:${actualPort}                       ║
║  ${dbConnected ? '✅ PostgreSQL conectado' : '❌ PostgreSQL desconectado'}                         ║
╚════════════════════════════════════════════════╝
  `);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️ Porta ${PORT} em uso. Tentando porta 3001...`);
    const server2 = app.listen(3001, async () => {
      const dbConnected = await testDatabaseConnection();
      const actualPort = server2.address().port;
      if (!process.env.APP_BASE_URL) {
        APP_BASE_URL = `http://localhost:${actualPort}`;
      }
      console.log(`
╔════════════════════════════════════════════════╗
║  BemCicatri Backend rodando!                   ║
║  🌐 http://localhost:${actualPort}                       ║
║  ${dbConnected ? '✅ PostgreSQL conectado' : '❌ PostgreSQL desconectado'}                         ║
╚════════════════════════════════════════════════╝
      `);
    });
  } else {
    throw err;
  }
});