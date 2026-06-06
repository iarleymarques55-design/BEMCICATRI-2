// app.js — BemCicatri
// Código principal da plataforma.

// Configurações iniciais
const pageHost = window.location.hostname;
const pagePort = window.location.port;
const isFrontendLiveServer = pageHost === '127.0.0.1' && pagePort && pagePort !== '3000';
const isFrontendFile = window.location.protocol === 'file:';
const DEFAULT_API_URL = (isFrontendLiveServer || isFrontendFile)
  ? 'http://localhost:3000/api'
  : `${window.location.origin}/api`;
const EXTERNAL_API_URLS = ['http://localhost:3000/api', 'http://localhost:3001/api'];
const API_URL = DEFAULT_API_URL;
let USE_API = false;
let DETECTED_API_URL = API_URL;
let SERVER_DETECTION_INTERVAL = null;
let LAST_DETECTION_TIME = 0;

// Retorna a URL da API ativa
function getApiUrl() {
  return DETECTED_API_URL || API_URL;
}

// Tenta detectar se uma URL de API está disponível
async function probeApi(url, timeout = 1000) {
  try {
    const healthUrl = `${url.replace(/\/api\/?$/, '')}/api/health`;
    const res = await fetchWithTimeout(healthUrl, { method: 'GET' }, timeout);
    return res.ok;
  } catch (e) {
    return false;
  }
}

// Faz uma requisição fetch com timeout usando AbortController
function fetchWithTimeout(url, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const signal = controller.signal;
  const fetchOptions = { ...options, signal };
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, fetchOptions).finally(() => clearTimeout(timer));
}

// Detectar se servidor está rodando usando host local ou localhost
async function detectServer() {
  const urlsToCheck = [API_URL, ...EXTERNAL_API_URLS.filter((url) => url !== API_URL)];

  for (const url of urlsToCheck) {
    try {
      if (await probeApi(url)) {
        if (!USE_API || DETECTED_API_URL !== url) {
          DETECTED_API_URL = url;
          USE_API = true;
          console.log(`✅ Conectado ao backend em ${DETECTED_API_URL}`);
          updateConnectionStatus(true);
        }
        LAST_DETECTION_TIME = Date.now();
        return true;
      }
    } catch (e) {
      // ignora
    }
  }

  if (USE_API) {
    USE_API = false;
    console.log('⚠️ Backend desconectado, usando localStorage como fallback');
    updateConnectionStatus(false);
  }
  return false;
}

// Atualizar status de conexão na UI
function updateConnectionStatus(isConnected) {
  // Indicador de status removido conforme solicitado.
  // A detecção de conexão permanece ativa, mas não exibe nenhum badge na tela.
  return;
}

// Verifica se o servidor está disponível assim que a página abre
detectServer();

// Reconfirma a conexão a cada 10 segundos
SERVER_DETECTION_INTERVAL = setInterval(() => {
  detectServer();
}, 10000);

// Armazenamento local usando localStorage
function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function cachePatientLocally(patient) {
  if (!patient || !patient.id) return;
  const userEmail = patient.userEmail || currentUser?.email?.toLowerCase();
  if (userEmail) patient.userEmail = userEmail.toLowerCase();
  const all = lsGet('bemc_patients') || [];
  const idx = all.findIndex(pt => String(pt.id) === String(patient.id));
  if (idx >= 0) {
    all[idx] = patient;
  } else {
    all.push(patient);
  }
  lsSet('bemc_patients', all);
}

function getLatestHealingProgressFromHistory(patient) {
  if (!patient || !Array.isArray(patient.history)) return 0;
  const numericEntries = patient.history.filter(entry => typeof entry.pct === 'number');
  if (!numericEntries.length) return 0;
  return numericEntries[numericEntries.length - 1].pct;
}

function getEffectiveHealProgress(patient) {
  const directProgress = typeof patient.healProgress === 'number' ? patient.healProgress : 0;
  const historyProgress = getLatestHealingProgressFromHistory(patient);
  return Math.max(directProgress, historyProgress, 0);
}

// Chamadas à API com fallback para localStorage
async function apiGetUser(email) {
  if (!USE_API) return lsGet('bemc_users')?.[email.toLowerCase()] || null;
  try {
    const res = await fetchWithTimeout(`${getApiUrl()}/auth/login`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ email, pass: '___check___' })
    }, 2000);
    if (res.status === 401) return null;
    const data = await res.json();
    return data.user || null;
  } catch (e) {
    console.warn('❌ Erro ao buscar usuário na API, tentando localStorage:', e);
    // Fallback automático para localStorage
    return lsGet('bemc_users')?.[email.toLowerCase()] || null;
  }
}

async function apiCreateUser(user) {
  if (!USE_API) {
    const u = lsGet('bemc_users') || {};
    const k = user.email.toLowerCase();
    if (u[k]) throw new Error('email_exists');
    u[k] = { ...user };
    lsSet('bemc_users', u);
    return u[k];
  }
  try {
    const res = await fetchWithTimeout(`${getApiUrl()}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    }, 2000);
    const data = await res.json();
    if (data.error === 'email_exists') throw new Error('email_exists');
    if (!res.ok) throw new Error(data.error);
    return data;
  } catch (e) {
    console.error('❌ Erro ao criar usuário na API:', e);
    throw e;
  }
}


async function apiUpdateUser(email, updates) {
  if (!USE_API) {
    const u = lsGet('bemc_users') || {}, k = email.toLowerCase();
    if (!u[k]) throw new Error('not_found');
    u[k] = { ...u[k], ...updates };
    lsSet('bemc_users', u);
    return u[k];
  }
  try {
    const res = await fetchWithTimeout(`${getApiUrl()}/user/${email}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    }, 2000);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  } catch (e) {
    console.error('❌ Erro ao atualizar usuário na API:', e);
    throw e;
  }
}

async function apiGetPatients(email) {
  if (!USE_API) return (lsGet('bemc_patients') || []).filter(p => p.userEmail === email.toLowerCase());
  try {
    // Usar AbortController para timeout real
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 segundos de timeout
    
    const res = await fetch(`${getApiUrl()}/patients/${email}`, {
      method: 'GET',
      headers: { 
        'X-User-Email': currentUser?.email || email,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      if (res.status === 403) console.warn('Acesso negado: você não pode ver pacientes de outro usuário');
      if (res.status === 401) console.warn('Não autenticado ao buscar pacientes');
      console.warn('Status da resposta:', res.status, res.statusText);
      return [];
    }
    
    const patients = await res.json();
    console.log('✅ Pacientes trazidos da API:', patients.length);
    return patients;
  } catch (e) {
    console.warn('❌ Erro ao buscar pacientes na API:', e.message);
    // Fallback para localStorage apenas se erro for de conexão
    const cached = (lsGet('bemc_patients') || []).filter(p => p.userEmail === email.toLowerCase());
    console.log('⚠️ Usando cache local:', cached.length, 'pacientes');
    return cached;
  }
}

async function apiCreatePatient(p) {
  if (!USE_API) {
    const all = lsGet('bemc_patients') || [];
    const newP = { ...p, userEmail: p.userEmail.toLowerCase(), id: Date.now() };
    all.push(newP);
    lsSet('bemc_patients', all);
    console.log('✅ Paciente criado localmente:', newP);
    return newP;
  }
  try {
    console.log('📤 Enviando paciente para API:', p);
    const res = await fetch(`${getApiUrl()}/patients`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'X-User-Email': currentUser?.email || p.userEmail
      },
      body: JSON.stringify(p)
    });
    
    console.log('📥 Resposta da API:', res.status, res.statusText);
    
    if (!res.ok) {
      const data = await res.json();
      console.error('❌ Erro na API:', data.error);
      throw new Error(data.error || `Erro HTTP ${res.status}`);
    }
    
    const data = await res.json();
    console.log('✅ Paciente criado na API com ID:', data.id);
    
    // Importante: usar o ID retornado do servidor!
    const newPatient = {
      ...p,
      ...data,
      userEmail: p.userEmail.toLowerCase(),
      id: data.id  // ID do banco de dados!
    };
    
    return newPatient;
  } catch (e) {
    console.error('❌ Erro ao criar paciente na API:', e.message);
    showToast(`❌ Erro ao salvar paciente no servidor: ${e.message}`, 'error');
    throw e;
  }
}

async function apiDeletePatient(id) {
  if (!USE_API) {
    // Comparação flexível de ID (funciona com string ou número)
    lsSet('bemc_patients', (lsGet('bemc_patients') || []).filter(p => String(p.id) !== String(id)));
    return { deleted: true };
  }
  try {
    const res = await fetchWithTimeout(`${getApiUrl()}/patients/${id}`, {
      method: 'DELETE',
      headers: { 'X-User-Email': currentUser?.email }
    }, 2000);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Erro ao deletar');
    }
    return await res.json();
  } catch (e) {
    console.error('❌ Erro ao deletar paciente na API:', e);
    throw e;
  }
}

async function apiLogLogin(entry) {
  if (!USE_API) {
    const all = lsGet('bemc_login_history') || [];
    all.push(entry);
    lsSet('bemc_login_history', all);
    return;
  }
  fetchWithTimeout(`${getApiUrl()}/login/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  }, 2000).catch((e) => {
    console.warn('⚠️ Erro ao registrar login, usando localStorage:', e);
    // Fallback silencioso para localStorage
    const all = lsGet('bemc_login_history') || [];
    all.push(entry);
    lsSet('bemc_login_history', all);
  });
}

// Registra dados de eficácia dinâmica para cada paciente
async function apiSaveDynamicEficacia(patientId, day, baseEficacia, adherence, finalEficacia) {
  if (!USE_API) {
    const all = lsGet('bemc_eficacia_history') || {};
    if (!all[patientId]) all[patientId] = [];
    all[patientId].push({ day, baseEficacia, adherence, finalEficacia, timestamp: new Date().toISOString() });
    lsSet('bemc_eficacia_history', all);
    return { success: true };
  }
  try {
    const res = await fetchWithTimeout(`${getApiUrl()}/patients/${patientId}/eficacia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Email': currentUser?.email },
      body: JSON.stringify({ day, baseEficacia, adherence, finalEficacia })
    }, 2000);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  } catch (e) {
    console.error('⚠️ Erro ao salvar eficácia na API:', e);
    throw e;
  }
}

// Recupera o histórico de eficácia do paciente
async function apiGetDynamicEficacia(patientId) {
  if (!USE_API) {
    const all = lsGet('bemc_eficacia_history') || {};
    return { success: true, eficaciaHistory: all[patientId] || [] };
  }
  try {
    const res = await fetchWithTimeout(`${getApiUrl()}/patients/${patientId}/eficacia`, {
      method: 'GET',
      headers: { 'X-User-Email': currentUser?.email }
    }, 2000);
    if (!res.ok) {
      console.warn('⚠️ Erro ao recuperar eficácia da API');
      return { success: false, eficaciaHistory: [] };
    }
    return await res.json();
  } catch (e) {
    console.warn('⚠️ Erro ao recuperar eficácia da API, usando localStorage:', e);
    const all = lsGet('bemc_eficacia_history') || {};
    return { success: true, eficaciaHistory: all[patientId] || [] };
  }
}

// Calcula a eficácia considerando o perfil do paciente
function calculateDynamicEficacia(patient, day, previousAdherence = 0) {
  // Base: 0.75 (padrão)
  let baseEficacia = 0.75;

  // Ajuste por HbA1c (controle glicêmico)
  // HbA1c < 7% = ideal para cicatrização
  if (patient.hba1c) {
    if (patient.hba1c < 7) {
      baseEficacia += 0.15; // Muito bem
    } else if (patient.hba1c < 8) {
      baseEficacia += 0.10; // Bem
    } else if (patient.hba1c < 9) {
      baseEficacia += 0.02; // Aceitável
    } else {
      baseEficacia -= 0.15; // Ruim para cicatrização
    }
  }

  // Ajuste por idade
  // Idosos cicatrizam mais lentamente
  if (patient.idade) {
    if (patient.idade < 40) {
      baseEficacia += 0.05;
    } else if (patient.idade > 70) {
      baseEficacia -= 0.10;
    }
  }

  // Normalizar base entre 0.3 e 1.0
  baseEficacia = Math.max(0.3, Math.min(1.0, baseEficacia));

  // ADERÊNCIA: simula se o paciente aplicou a pomada
  // Dia 1-3: Motivação alta, raramente esquece
  // Dia 7+: Fadiga, maior risco de esquecimento
  let adherenceChance = 0.95; // Probabilidade de ter aplicado

  if (day > 3) {
    adherenceChance = 0.95 - ((day - 3) * 0.05); // Decresce 5% por dia
  }

  // Variação aleatória (±15%)
  adherenceChance += (Math.random() - 0.5) * 0.3;
  adherenceChance = Math.max(0.5, Math.min(1.0, adherenceChance));

  // Se paciente não aplicou, eficácia reduz drasticamente
  const adherence = Math.random() < adherenceChance ? 1 : 0.4;

  // Eficácia final
  let finalEficacia = baseEficacia * adherence;

  // Se há infecção (detectar por campo no paciente), reduz mais
  if (patient.infected) {
    finalEficacia *= 0.8; // 20% de redução por infecção
  }

  // Normalizar final
  finalEficacia = Math.max(0.1, Math.min(1.0, finalEficacia));

  return {
    baseEficacia: Math.round(baseEficacia * 100) / 100,
    adherence: Math.round(adherence * 100) / 100,
    finalEficacia: Math.round(finalEficacia * 100) / 100
  };
}

// ===================== RUNTIME STATE =====================
let currentUser  = null;
let patients     = [];
let currentQuote = 0;
let quoteTimer   = null;

// ===================== PAGE NAVIGATION =====================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'page-login' || id === 'page-register') startQuoteCarousel();
  else clearInterval(quoteTimer);
}

function lpScrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// ===================== ALERTS & VALIDATION =====================
function showAlert(id, show, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('show', show);
  if (msg !== undefined) el.innerHTML = msg;
}

function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('error', !!msg);
  let hint = el.parentElement.querySelector('.field-error-msg');
  if (msg) {
    if (!hint) { hint = document.createElement('div'); hint.className = 'field-error-msg'; el.parentElement.appendChild(hint); }
    hint.textContent = msg;
    hint.style.cssText = 'color:#b91c1c;font-size:.76rem;margin-top:.3rem;font-weight:500';
  } else { if (hint) hint.remove(); }
}

function clearFieldErrors(...ids) { ids.forEach(id => setFieldError(id, '')); }
function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validatePhone(tel) {
  const digits = tel.replace(/\D/g, '');
  if (digits.length < 10) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  const seqPatterns = [
    '0123456789', '1234567890', '2345678901', '3456789012',
    '4567890123', '5678901234', '6789012345', '7890123456',
    '8901234567', '9012345678', '9876543210', '8765432109',
    '7654321098', '6543210987', '5432109876', '4321098765',
    '3210987654', '2109876543'
  ];
  if (seqPatterns.some(seq => digits.includes(seq))) return false;
  return true;
}

function validateRealName(name) {
  if (!name) return false;
  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 3) return false;
  if (!/^[A-Za-zÀ-ÿ'\- ]+$/.test(cleaned)) return false;
  const parts = cleaned.toLowerCase().split(' ').filter(Boolean);
  if (parts.length === 0) return false;
  const bannedWords = ['porco','vaca','gato','cachorro','carro','mesa','cadeira','bolsa','caneca','pizza','bola','tijolo','fantasia','monstro','objeto','animal','papagaio','macaco','cavalo','cabra','peixe','telefone'];
  if (parts.some(word => bannedWords.includes(word))) return false;
  if (parts.some(word => word.length === 1)) return false;
  return true;
}

// ===================== EMAIL VALIDATION IN REAL TIME =====================
let emailValidationTimeout;
let lastEmailValidated = '';

async function validateEmailRealtime(email) {
  const indicator = document.getElementById('email-status-indicator');
  const message = document.getElementById('email-validation-message');
  
  clearTimeout(emailValidationTimeout);
  
  if (!email || email.trim() === '') {
    indicator.className = 'email-validation-indicator';
    indicator.textContent = '';
    message.className = 'email-validation-message';
    message.textContent = '';
    return;
  }
  
  if (!validateEmail(email)) {
    indicator.className = 'email-validation-indicator invalid';
    indicator.textContent = '✕';
    message.className = 'email-validation-message show invalid';
    message.textContent = '✗ Formato de e-mail inválido';
    return;
  }
  
  indicator.className = 'email-validation-indicator valid';
  indicator.textContent = '✓';
  message.className = 'email-validation-message show valid';
  message.textContent = '✓ Formato de e-mail válido';
}

// ===================== EMAIL VALIDATION HELPERS =====================
// email validation helper functions removed — verification is automatic now

// ===================== TOAST =====================
function showToast(msg, type = 'success') {
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  const bg = type === 'warn' ? '#fef3c7' : '#e6faf7';
  const col = type === 'warn' ? '#92400e' : '#0d7e6d';
  const border = type === 'warn' ? '#fde68a' : 'var(--teal)';
  t.style.cssText = `background:${bg};color:${col};border-radius:10px;padding:.75rem 1.2rem;font-size:.87rem;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.1);animation:fadeIn .3s ease;max-width:320px;border:1px solid ${border}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

// Som de Alerta para Complicações
function playAlertSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // Cria 2 bips alertadores
    for (let i = 0; i < 2; i++) {
      const oscillator = audioContext.createOscillator();
      const envelope = audioContext.createGain();
      
      oscillator.connect(envelope);
      envelope.connect(audioContext.destination);
      
      oscillator.frequency.value = 800 + (i * 200); // 800Hz e 1000Hz
      oscillator.type = 'sine';
      
      const startTime = audioContext.currentTime + (i * 0.15);
      envelope.gain.setValueAtTime(0.3, startTime);
      envelope.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
      
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.1);
    }
  } catch(e) {
    console.log('Som de alerta não disponível (navegador/contexto bloqueado)');
  }
}

// ===================== MASKS =====================
function maskPhone(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 11);
  if (v.length >= 7) v = '(' + v.slice(0,2) + ') ' + v.slice(2,7) + '-' + v.slice(7);
  else if (v.length >= 3) v = '(' + v.slice(0,2) + ') ' + v.slice(2);
  else if (v.length >= 1) v = '(' + v;
  el.value = v;
}

// ===================== STRENGTH BAR =====================
function checkStrength(v) {
  let score = 0;
  if (v.length >= 8) score++;
  if (/[A-Z]/.test(v)) score++;
  if (/[0-9]/.test(v)) score++;
  if (/[^A-Za-z0-9]/.test(v)) score++;
  const colors = ['#ef4444','#f97316','#eab308','#22c55e'];
  const labels = ['Fraca','Razoável','Boa','Forte'];
  for (let i = 1; i <= 4; i++) {
    const s = document.getElementById('s' + i);
    if (s) s.style.background = i <= score ? colors[score - 1] : '#dde';
  }
  const lbl = document.getElementById('strength-lbl');
  if (lbl) lbl.textContent = score > 0 ? 'Senha ' + labels[score - 1] : 'Digite uma senha';
}

// ===================== AUTH — LOGIN =====================
// ===================== AUTH — LOGIN =====================
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  clearFieldErrors('login-email','login-pass');
  showAlert('login-err', false);
  let err = false;
  if (!email) { setFieldError('login-email','Informe seu e-mail'); err = true; }
  else if (!validateEmail(email)) { setFieldError('login-email','E-mail inválido'); err = true; }
  if (!pass) { setFieldError('login-pass','Informe sua senha'); err = true; }
  if (err) return;
  const btn = document.getElementById('login-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin">⏳</span> Verificando...'; }
  
  try {
    if (USE_API) {
      // Usar API
      const res = await fetch(`${getApiUrl()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pass })
      });
      
      if (!res.ok) {
        const data = await res.json();
        if (btn) { btn.disabled = false; btn.innerHTML = 'Entrar na Plataforma'; }
        if (data.error === 'not_verified') {
          showAlert('login-err', true, '❌ Conta não ativada. Verifique seu e-mail de confirmação.');
        } else {
          showAlert('login-err', true, '❌ E-mail ou senha incorretos. Verifique e tente novamente.');
        }
        setFieldError('login-pass','Senha incorreta');
        return;
      }
      
      const data = await res.json();
      if (btn) { btn.disabled = false; btn.innerHTML = 'Entrar na Plataforma'; }
      
      currentUser = data.user;
      sessionStorage.setItem('bemc_session', currentUser.email);
      patients = await apiGetPatients(currentUser.email);
      enterDashboard();
    } else {
      // Usar localStorage
      const user = lsGet('bemc_users')?.[email.toLowerCase()];
      if (btn) { btn.disabled = false; btn.innerHTML = 'Entrar na Plataforma'; }
      if (!user || user.pass !== pass) {
        showAlert('login-err', true, '❌ E-mail ou senha incorretos. Verifique e tente novamente.');
        setFieldError('login-pass','Senha incorreta');
        return;
      }
      apiLogLogin({ userEmail: email, date: new Date().toLocaleString('pt-BR'), ts: Date.now() });
      currentUser = user;
      sessionStorage.setItem('bemc_session', user.email);
      patients = await apiGetPatients(currentUser.email);
      enterDashboard();
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Entrar na Plataforma'; }
    console.error('Erro no login:', e);
    showAlert('login-err', true, '❌ Erro ao conectar. Verifique a conexão.');
  }
}

// ===================== AUTH — REGISTER =====================
async function doRegister() {
  showAlert('reg-err', false); showAlert('reg-ok', false);
  const f = {
    nome:  document.getElementById('reg-nome').value.trim(),
    sob:   document.getElementById('reg-sobrenome').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    tipo:  document.getElementById('reg-tipo').value,
    tel:   document.getElementById('reg-tel').value.trim(),
    pass:  document.getElementById('reg-pass').value,
    pass2: document.getElementById('reg-pass2').value,
    terms: document.getElementById('reg-terms').checked,
  };
  const btn = document.querySelector('#page-register .btn.btn-primary.btn-block');
  clearFieldErrors('reg-nome','reg-sobrenome','reg-email','reg-tipo','reg-tel','reg-pass','reg-pass2');
  let hasErr = false;
  if (!f.nome) { setFieldError('reg-nome','Nome é obrigatório'); hasErr = true; }
  else if (!validateRealName(f.nome)) { setFieldError('reg-nome','Nome inválido para uma pessoa'); hasErr = true; }
  if (!f.sob) { setFieldError('reg-sobrenome','Sobrenome é obrigatório'); hasErr = true; }
  else if (!validateRealName(f.sob)) { setFieldError('reg-sobrenome','Sobrenome inválido para uma pessoa'); hasErr = true; }
  if (!f.email) { setFieldError('reg-email','E-mail é obrigatório'); hasErr = true; }
  else if (!validateEmail(f.email)) { setFieldError('reg-email','E-mail inválido'); hasErr = true; }
  if (!f.tipo) { setFieldError('reg-tipo','Selecione seu perfil'); hasErr = true; }
  if (!f.tel) { setFieldError('reg-tel','Telefone é obrigatório'); hasErr = true; }
  else if (!validatePhone(f.tel)) { setFieldError('reg-tel','Telefone inválido ou repetitivo'); hasErr = true; }
  if (!f.pass) { setFieldError('reg-pass','Crie uma senha'); hasErr = true; }
  else if (f.pass.length < 8) { setFieldError('reg-pass','Mínimo 8 caracteres'); hasErr = true; }
  if (!f.pass2) { setFieldError('reg-pass2','Confirme a senha'); hasErr = true; }
  else if (f.pass !== f.pass2) { setFieldError('reg-pass2','Senhas não coincidem'); hasErr = true; }
  if (!f.terms) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Criar Minha Conta'; }
    showAlert('reg-err', true, '⚠️ Aceite os Termos de Uso.');
    return;
  }
  if (hasErr) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Criar Minha Conta'; }
    showAlert('reg-err', true, '⚠️ Corrija os campos acima.');
    return;
  }
  
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin">⏳</span> Criando conta...'; }
  
  try {
    if (USE_API) {
      // Verificar e-mail com o endpoint antes de registrar
      const verifyResp = await fetch(`${getApiUrl()}/email/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: f.email.toLowerCase() })
      });
      const verifyData = await verifyResp.json();

      if (!verifyData.valid) {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Criar Minha Conta'; }
        if (verifyData.reason === 'email_already_registered' || (verifyData.reason === 'no_mx_records' || verifyData.reason === 'smtp_invalid')) {
          setFieldError('reg-email','E-mail já cadastrado');
          showAlert('reg-err', true, '⚠️ Este e-mail já tem conta.');
        } else {
          setFieldError('reg-email','E-mail inválido ou domínio não existe');
          showAlert('reg-err', true, verifyData.message || '⚠️ E-mail inválido. Use outro e-mail.');
        }
        return;
      }

      // Usar API
      const res = await fetch(`${getApiUrl()}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: f.email, pass: f.pass, nome: f.nome, sobrenome: f.sob, tipo: f.tipo, tel: f.tel })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Criar Minha Conta'; }
        if (data.error === 'email_exists') {
          setFieldError('reg-email','E-mail já cadastrado');
          showAlert('reg-err', true, '⚠️ Este e-mail já tem conta.');
        } else {
          showAlert('reg-err', true, data.message || '❌ Falha ao criar conta. Tente novamente.');
        }
        return;
      }
      
      if (btn) { btn.disabled = false; btn.innerHTML = 'Criar Minha Conta'; }
      showAlert('reg-ok', true, '✅ Conta criada! Um código de confirmação foi enviado por e-mail.');
      setTimeout(() => showPage('page-confirm-email'), 1500);
    } else {
      // Usar localStorage
      const u = lsGet('bemc_users') || {};
      const k = f.email.toLowerCase();
      if (u[k]) {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Criar Minha Conta'; }
        setFieldError('reg-email','E-mail já cadastrado');
        showAlert('reg-err', true, '⚠️ Este e-mail já tem conta.');
        return;
      }
      const newUser = { email: f.email, pass: f.pass, nome: f.nome, sobrenome: f.sob, tipo: f.tipo, tel: f.tel };
      u[k] = newUser;
      lsSet('bemc_users', u);
      
      if (btn) { btn.disabled = false; btn.innerHTML = 'Criar Minha Conta'; }
      currentUser = newUser;
      patients = [];
      sessionStorage.setItem('bemc_session', currentUser.email);
      showAlert('reg-ok', true, '✅ Conta criada! Um código de confirmação foi enviado por e-mail.');
      setTimeout(() => showPage('page-confirm-email'), 1500);
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Criar Minha Conta'; }
    console.error('Erro no registro:', e);
    showAlert('reg-err', true, '❌ Erro ao criar conta. Tente novamente.');
  }
}

async function doConfirmEmail() {
  showAlert('confirm-err', false);
  showAlert('confirm-ok', false);
  const code = document.getElementById('confirm-code')?.value.trim();
  const btn = document.querySelector('#page-confirm-email .btn.btn-primary.btn-block');

  if (!code) {
    showAlert('confirm-err', true, 'Digite o código de confirmação que recebeu por e-mail.');
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin">⏳</span> Confirmando...'; }

  try {
    const res = await fetch(`${getApiUrl()}/auth/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: code })
    });
    const text = await res.text();
    let data = null;

    try {
      data = JSON.parse(text);
    } catch (parseError) {
      throw new Error(text || 'Resposta inesperada do servidor');
    }

    if (!res.ok) {
      throw new Error(data.message || 'Código inválido ou expirado');
    }

    showAlert('confirm-ok', true, '✅ Conta confirmada com sucesso! Faça login.');
    if (btn) { btn.disabled = false; btn.innerHTML = 'Confirmar'; }
    setTimeout(() => showPage('page-login'), 1800);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Confirmar'; }
    console.error('Erro ao confirmar:', e);
    showAlert('confirm-err', true, e.message || 'Erro ao confirmar o código.');
  }
}

// ===================== LOGOUT =====================
function doLogout() {
  currentUser = null; patients = []; sessionStorage.removeItem('bemc_session');
  const _le = document.getElementById('login-email');
  const _lp = document.getElementById('login-pass');
  if (_le) _le.value = '';
  if (_lp) _lp.value = '';
  showAlert('login-err', false);
  showPage('page-landing');
}

// ===================== DASHBOARD INIT =====================
function enterDashboard() {
  showPage('page-dashboard');
  const name = (currentUser.nome || currentUser.email?.split('@')[0] || 'Usuário').trim();
  const surname = currentUser.sobrenome || '';
  const initials = ((name[0] || '') + (surname[0] || '')).toUpperCase() || 'B';
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('sidebar-name').textContent   = (name + ' ' + surname).trim();
  document.getElementById('sidebar-role').textContent   = currentUser.tipo || 'Perfil';
  document.getElementById('topbar-user').textContent    = 'Olá, ' + name + '!';
  document.getElementById('welcome-name').textContent   = name;
  document.getElementById('st-nome').value      = name;
  document.getElementById('st-sobrenome').value = surname;
  document.getElementById('st-email').value     = currentUser.email || '';
  document.getElementById('st-tel').value       = currentUser.tel || '';
  document.getElementById('st-tipo').value      = currentUser.tipo || '';
  const ne = document.getElementById('notif-email');
  const nc = document.getElementById('notif-clinica');
  if (ne) ne.checked = currentUser.notifEmail ?? true;
  if (nc) nc.checked = currentUser.notifClinica ?? true;
  
  // Atualizar cache local com os dados da API
  if (patients && patients.length > 0) {
    const existing = lsGet('bemc_patients') || [];
    const patientsWithEmail = patients.map(p => {
      const localMatch = existing.find(pt => String(pt.id) === String(p.id));
      return {
        ...p,
        ...localMatch,
        userEmail: currentUser?.email?.toLowerCase(),
        history: localMatch?.history || p.history || [],
        healProgress: localMatch?.healProgress ?? p.healProgress,
        simulator_state: localMatch?.simulator_state ?? p.simulator_state,
        eficacia_history: localMatch?.eficacia_history ?? p.eficacia_history
      };
    });
    lsSet('bemc_patients', patientsWithEmail);
    console.log('💾 Cache local atualizado com', patients.length, 'pacientes');
  }
  
  showView('view-home');
  renderPatients();
  renderHomePatients();
}

// ===================== VIEWS =====================
function showView(id) {
  document.querySelectorAll('.dash-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-item[data-view]').forEach(s => s.classList.remove('active'));
  const v = document.getElementById(id);
  if (v) v.classList.add('active');
  const si = document.querySelector(`.sidebar-item[data-view="${id}"]`);
  if (si) si.classList.add('active');
  const titles = {
    'view-home':'Início','view-lab':'Laboratório Virtual','view-simulador':'Simulador de Cicatrização',
    'view-diario':'Diário de Pesquisa','view-mapa':'Mapa do Impacto','view-quiz':'Quiz Científico',
    'view-calculadora':'Calculadora de Risco','view-pacientes':'Pacientes',
    'view-sobre':'Sobre o Projeto','view-settings':'Configurações'
  };
  const tt = document.getElementById('topbar-title');
  if (tt) tt.textContent = titles[id] || 'BemCicatri';
  if (id === 'view-quiz' && quizCurrent === 0) initQuiz();
  if (id === 'view-simulador') renderSimPatientSelector();
  if (id === 'view-mapa') {
    setTimeout(() => initMapInteraction(), 100);
  }
}

function openMenu()  { document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebar-overlay').classList.add('active'); }
function closeMenu() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-overlay').classList.remove('active'); }
function openModal(id)  { 
  const m = document.getElementById(id); 
  if (m) {
    console.log('🔓 Abrindo modal:', id);
    m.classList.add('active');
    m.style.display = 'flex';
    console.log('✅ Modal adicionada classe active');
  } else {
    console.warn('⚠️ Modal não encontrada com ID:', id);
  }
}
function closeModal(id) { 
  const m = document.getElementById(id); 
  if (m) {
    m.classList.remove('active');
    m.style.display = 'none';
  }
}

// ===================== HOME — PATIENTS QUICK VIEW =====================
function renderHomePatients() {
  const list = document.getElementById('hpq-list');
  const cnt  = document.getElementById('hpq-count');
  if (!list) return;
  if (cnt) cnt.textContent = `(${patients.length})`;
  if (!patients.length) {
    list.innerHTML = '<div class="empty-state-small">Nenhum paciente cadastrado. <a onclick="showView(\'view-pacientes\')" style="color:var(--teal);cursor:pointer">Adicionar →</a></div>';
    return;
  }
  list.innerHTML = patients.slice(0, 4).map(p => {
    const ini = p.nome.split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase();
    return `<div class="hpq-item">
      <div class="hpq-avatar">${ini}</div>
      <div class="hpq-info"><div class="hpq-name">${p.nome}</div><div class="hpq-sub">${p.idade} anos · ${p.diab || 'Diabetes'} · ${p.ferida || 'Ferida'}</div></div>
      <div class="hpq-tag">${p.wagner || 'Em tratamento'}</div>
    </div>`;
  }).join('');
  if (patients.length > 4) list.innerHTML += `<div style="text-align:center;padding:.5rem;font-size:.82rem;color:var(--gray400)">+ ${patients.length - 4} outros pacientes</div>`;
}

// ===================== PATIENTS =====================
function renderPatients(filter = '', wagnerFilter = '', diabFilter = '') {
  const grid = document.getElementById('patients-grid');
  if (!grid) return;
  let filtered = patients.filter(p => p.nome.toLowerCase().includes(filter.toLowerCase()));
  if(wagnerFilter) filtered = filtered.filter(p => p.wagner && p.wagner.startsWith(wagnerFilter));
  if(diabFilter) filtered = filtered.filter(p => p.diab === diabFilter);

  // Update stats
  const totalEl = document.getElementById('stat-total');
  const tratEl  = document.getElementById('stat-tratamento');
  const riscoEl = document.getElementById('stat-alto-risco');
  const tipo2El = document.getElementById('stat-tipo2');
  if(totalEl) totalEl.textContent = patients.length;
  if(tratEl)  tratEl.textContent  = patients.length;
  if(riscoEl) riscoEl.textContent = patients.filter(p => p.wagner && (p.wagner.includes('Grau 3') || p.wagner.includes('Grau 4') || p.wagner.includes('Grau 5'))).length;
  if(tipo2El) tipo2El.textContent = patients.filter(p => p.diab === 'Tipo 2').length;

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">👥</div><h3>' + (filter ? 'Nenhum resultado para "' + filter + '"' : 'Nenhum paciente cadastrado') + '</h3>' + (!filter ? '<p>Clique em "+ Novo Paciente" para começar</p>' : '') + '</div>';
    return;
  }
  grid.innerHTML = filtered.map(p => {
    const ini = p.nome.split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase();
    const diabClass = p.diab === 'Tipo 1' ? 'tag-type1' : 'tag-type2';
    const wgNum = p.wagner ? parseInt(p.wagner.match(/\d/)?.[0] || 0) : 0;
    const riskColor = wgNum>=3 ? '#E05252' : wgNum>=2 ? '#f59e0b' : '#22c55e';
    const riskLabel = wgNum>=3 ? 'Alto Risco' : wgNum>=2 ? 'Moderado' : 'Baixo';
    const healPct = getEffectiveHealProgress(p);
    const hba1c = p.hba1c ? `<div class="patient-info-row"><span class="icon">🩸</span>HbA1c: ${p.hba1c}%</div>` : '';
    return `<div class="patient-card-v2" data-patient-id="${p.id}" onclick="openPatientDetail('${p.id}')" style="cursor:pointer">
      <div class="patient-head-v2">
        <div class="patient-avatar-v2">${ini}</div>
        <div class="patient-head-info">
          <div class="patient-name-v2">${p.nome}</div>
          <div class="patient-meta">${p.idade} anos · ${p.id}</div>
        </div>
        <div class="patient-risk-badge" style="background:${riskColor}20;color:${riskColor}">${riskLabel}</div>
      </div>
      <div class="patient-heal-row">
        <span style="font-size:.75rem;color:var(--gray400)">Progresso</span>
        <div class="patient-heal-bar"><div class="patient-heal-fill" style="width:${healPct}%"></div></div>
        <span style="font-size:.75rem;font-weight:700;color:var(--teal)">${healPct}%</span>
      </div>
      <div class="patient-info-v2">
        <div class="patient-info-row"><span class="icon">🩹</span>${p.ferida || 'Não informado'}</div>
        <div class="patient-info-row"><span class="icon">📞</span>${p.tel}</div>
        ${p.wagner ? `<div class="patient-info-row"><span class="icon">📊</span>${p.wagner}</div>` : ''}
        ${hba1c}
      </div>
      <div class="patient-footer-v2">
        <div class="patient-tags-v2">
          <span class="tag ${diabClass}">${p.diab || 'N/A'}</span>
          <span class="tag tag-wound">Em tratamento</span>
        </div>
        <button class="btn-icon-del" onclick="event.stopPropagation();deletePatient('${p.id}')" title="Remover">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function filterPatients(v) {
  const wagner = document.getElementById('pat-filter-wagner')?.value || '';
  const diab   = document.getElementById('pat-filter-diab')?.value   || '';
  renderPatients(v, wagner, diab);
}
function filterPatientsByWagner(v) {
  const search = document.getElementById('pat-search')?.value || '';
  const diab   = document.getElementById('pat-filter-diab')?.value || '';
  renderPatients(search, v, diab);
}
function filterPatientsByDiab(v) {
  const search = document.getElementById('pat-search')?.value || '';
  const wagner = document.getElementById('pat-filter-wagner')?.value || '';
  renderPatients(search, wagner, v);
}

function openAddPatient() {
  openModal('modal-patient');
  ['p-nome','p-idade','p-tel','p-obs','p-ferida','p-hba1c','p-imc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['p-diab','p-wagner'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  clearFieldErrors('p-nome','p-idade','p-tel','p-ferida');
  showAlert('pat-err', false);
}

async function addPatient() {
  const nome   = document.getElementById('p-nome').value.trim();
  const idade  = document.getElementById('p-idade').value;
  const diab   = document.getElementById('p-diab').value;
  const ferida = document.getElementById('p-ferida').value.trim();
  const tel    = document.getElementById('p-tel').value.trim();
  const wagner = document.getElementById('p-wagner')?.value || '';
  const obs    = document.getElementById('p-obs').value.trim();
  const hba1c  = document.getElementById('p-hba1c')?.value || '';
  const imc    = document.getElementById('p-imc')?.value || '';
  clearFieldErrors('p-nome','p-idade','p-tel','p-ferida','p-hba1c','p-imc');
  showAlert('pat-err', false);
  let hasErr = false;
  if (!nome) { setFieldError('p-nome','Nome obrigatório'); hasErr = true; }
  else if (!validateRealName(nome)) { setFieldError('p-nome','Nome do paciente inválido'); hasErr = true; }
  if (!idade || isNaN(idade) || idade < 1 || idade > 120) { setFieldError('p-idade','Idade inválida'); hasErr = true; }
  if (!tel || !validatePhone(tel)) { setFieldError('p-tel','Telefone inválido ou repetitivo'); hasErr = true; }
  if (!ferida) { setFieldError('p-ferida','Descrição da ferida é obrigatória'); hasErr = true; }
  if (hba1c) {
    const hbaValue = parseFloat(hba1c.replace(',', '.'));
    if (isNaN(hbaValue) || hbaValue < 4 || hbaValue > 20) { setFieldError('p-hba1c','Valor de HbA1c fora do esperado'); hasErr = true; }
  }
  if (imc) {
    const imcValue = parseFloat(imc.replace(',', '.'));
    if (isNaN(imcValue) || imcValue < 10 || imcValue > 60) { setFieldError('p-imc','IMC fora do intervalo humano plausível'); hasErr = true; }
  }
  if (hasErr) { showAlert('pat-err', true, '⚠️ Corrija os campos acima.'); return; }
  const regDate = new Date().toLocaleDateString('pt-BR');
  const newP = { userEmail: currentUser.email, nome, idade: parseInt(idade), diab: diab || 'Não informado', ferida, tel, wagner, obs, hba1c, imc, healProgress: 0, regDate, history: [{date: regDate, note:'Cadastro inicial', pct:0}] };
  try {
    const created = await apiCreatePatient(newP);
    patients.push(created);
    renderPatients();
    renderHomePatients();
    renderSimPatientSelector();
    closeModal('modal-patient');
    showToast('✅ Paciente ' + nome + ' cadastrado!');
  } catch (e) { showAlert('pat-err', true, '❌ Falha ao salvar.'); return; }
}

async function deletePatient(id) {
  if (!confirm('Remover este paciente?')) return;
  try { 
    await apiDeletePatient(id); 
    // Comparação flexível de ID (funciona com string ou número)
    patients = patients.filter(p => String(p.id) !== String(id)); 
    renderPatients(); 
    renderHomePatients(); 
    showToast('🗑 Paciente removido.'); 
  }
  catch (e) { showToast('❌ Falha ao remover.', 'warn'); }
  renderSimPatientSelector();
}

// ===================== SETTINGS =====================
function switchSettingsTab(el, id) {
  document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  ['st-perfil','st-notif','st-segur'].forEach(t => {
    const p = document.getElementById(t); if (p) p.style.display = t === id ? 'block' : 'none';
  });
}

async function saveProfile() {
  if (!currentUser) return;
  const nome = document.getElementById('st-nome').value.trim();
  const sob  = document.getElementById('st-sobrenome').value.trim();
  const tel  = document.getElementById('st-tel').value.trim();
  if (!nome || !sob) { showAlert('profile-err', true, '⚠️ Nome e sobrenome são obrigatórios.'); return; }
  try { currentUser = await apiUpdateUser(currentUser.email, { nome, sobrenome: sob, tel }); }
  catch (e) { currentUser.nome = nome; currentUser.sobrenome = sob; currentUser.tel = tel; }
  document.getElementById('sidebar-name').textContent = nome + ' ' + sob;
  document.getElementById('topbar-user').textContent  = 'Olá, ' + nome + '!';
  document.getElementById('sidebar-avatar').textContent = (nome[0] + (sob[0]||'')).toUpperCase();
  showAlert('profile-ok', true, '✅ Perfil atualizado!');
  setTimeout(() => showAlert('profile-ok', false), 3000);
  showAlert('profile-err', false);
}

async function saveNotifPrefs() {
  const ne = document.getElementById('notif-email')?.checked ?? true;
  const nc = document.getElementById('notif-clinica')?.checked ?? true;
  try { currentUser = await apiUpdateUser(currentUser.email, { notifEmail: ne, notifClinica: nc }); }
  catch (e) { currentUser.notifEmail = ne; currentUser.notifClinica = nc; }
  showToast('✅ Preferências salvas!');
}

async function changePassword() {
  const atual = document.getElementById('pass-atual').value;
  const nova  = document.getElementById('pass-nova').value;
  const nova2 = document.getElementById('pass-nova2').value;
  showAlert('pass-err', false); showAlert('pass-ok', false);
  if (!atual) { showAlert('pass-err', true, '⚠️ Informe a senha atual.'); return; }
  if (nova.length < 8) { showAlert('pass-err', true, '⚠️ Nova senha: mínimo 8 caracteres.'); return; }
  if (nova !== nova2) { showAlert('pass-err', true, '⚠️ As senhas não coincidem.'); return; }

  // Busca a senha real diretamente do storage para comparação correta
  let senhaCorreta;
  if (USE_API) {
    // Verifica via API
    try {
      const res = await fetch(`${getApiUrl()}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, pass: atual })
      });
      if (!res.ok) { showAlert('pass-err', true, '❌ Senha atual incorreta.'); return; }
    } catch(e) { showAlert('pass-err', true, '❌ Erro ao verificar senha.'); return; }
  } else {
    const stored = lsGet('bemc_users')?.[currentUser.email.toLowerCase()];
    senhaCorreta = stored?.pass;
    if (atual !== senhaCorreta) { showAlert('pass-err', true, '❌ Senha atual incorreta.'); return; }
  }

  try {
    currentUser = await apiUpdateUser(currentUser.email, { pass: nova });
  } catch (e) {
    // fallback: atualiza direto no localStorage se apiUpdateUser falhar
    const u = lsGet('bemc_users') || {};
    const k = currentUser.email.toLowerCase();
    if (u[k]) { u[k].pass = nova; lsSet('bemc_users', u); }
    currentUser = { ...currentUser, pass: nova };
  }
  showAlert('pass-ok', true, '✅ Senha alterada com sucesso!');
  setTimeout(() => showAlert('pass-ok', false), 3500);
  ['pass-atual','pass-nova','pass-nova2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

// ===================== LABORATÓRIO VIRTUAL =====================
const ingredientData = {
  barbatimao: { color: '#4a7c59', label: '🌿 Barbatimão', score: 40, effect: 'Antimicrobiano & adstringente — taninos precipitam proteínas bacterianas. Ativo principal do BemCicatri.', ref: 'Lopes et al. (2016) — Stryphnodendron adstringens: antimicrobial activity' },
  glicerina:  { color: '#5ba4c7', label: '💧 Glicerina',   score: 20, effect: 'Hidratante e umectante — mantém o microambiente úmido ideal para a migração celular e cicatrização.', ref: 'Fluhr et al. (2008) — Glycerol and skin barrier function' },
  coco:       { color: '#c9a84c', label: '🥥 Óleo de Coco', score: 20, effect: 'Emoliente e antimicrobiano complementar — ácido láurico com atividade antifúngica e anti-inflamatória.', ref: 'Evangelista et al. (2014) — Virgin coconut oil antimicrobial properties' },
  amido:      { color: '#a67c52', label: '⚗️ Amido de Milho', score: 10, effect: 'Agente estruturante — garante a textura gel-creme estável e a viscosidade adequada para aplicação.', ref: 'Rowe et al. (2009) — Handbook of Pharmaceutical Excipients' },
  alcool:     { color: '#9b59b6', label: '🧪 Álcool de Cereais', score: 10, effect: 'Solvente extrator — maximiza a extração de taninos e flavonoides da casca do barbatimão por maceração.', ref: 'Bruneton (1999) — Pharmacognosy, Phytochemistry, Medicinal Plants' },
};

let selectedIngredients = new Set();

// Armazenar quantidades dos ingredientes (mL)
let ingredientQuantities = {
  'alcool': 0,
  'barbatimao': 0,
  'glicerina': 0,
  'coco': 0,
  'amido': 0
};

// ===================== SIMULADOR — PERSISTÊNCIA DE DADOS =====================

// Salvar estado do simulador no localStorage e banco de dados
function saveSimulatorState() {
  if (!currentSimPatient || !currentSimPatient._raw) return;
  
  const patientId = currentSimPatient._raw.id;
  const day = parseInt(document.getElementById('sim-slider')?.value || 1);
  
  // Estrutura para persistir
  const stateKey = `bemc_sim_state_${patientId}`;
  const state = {
    patientId: patientId,
    currentDay: day,
    lastUpdated: new Date().toISOString(),
    efficacy: currentSimPatient.eficacia
  };
  
  // Salvar no localStorage
  lsSet(stateKey, state);
  
  // Tentar salvar na API
  if (USE_API && currentUser?.email) {
    fetch(`${getApiUrl()}/patients/${patientId}/simulator-state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Email': currentUser.email
      },
      body: JSON.stringify(state)
    }).catch(() => {}); // Fire and forget
  }
}

// Recuperar estado do simulador do localStorage e banco de dados
async function loadSimulatorState(patientId) {
  const stateKey = `bemc_sim_state_${patientId}`;
  
  // Primeiro tentar carregar da API se disponível
  if (USE_API && currentUser?.email) {
    try {
      const res = await fetchWithTimeout(`${getApiUrl()}/patients/${patientId}/simulator-state`, {
        method: 'GET',
        headers: { 'X-User-Email': currentUser.email }
      }, 2000);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.state) {
          return data.state;
        }
      }
    } catch (e) {
      console.warn('⚠️ Não conseguiu carregar estado do simulador da API, usando localStorage');
    }
  }
  
  // Fallback para localStorage
  return lsGet(stateKey);
}

// Restaurar dia anterior do simulador ao seleionar paciente
async function restoreSimulatorDay(patientId) {
  const state = await loadSimulatorState(patientId);
  if (state && state.currentDay) {
    const slider = document.getElementById('sim-slider');
    if (slider) {
      slider.value = state.currentDay;
      updateSimulator(state.currentDay);
    }
  }
}

// ===================== SIMULADOR (MELHORADO) =====================

let currentSimPatient = null;

// Calcula eficácia do BemCicatri a partir dos dados reais do paciente
function calcEficacia(p) {
  if (!p) return 0.5; // Retornar eficácia padrão se paciente não definido
  let ef = 1.0;

  // Penalidade por Wagner (grau da úlcera)
  const wgNum = p.wagner ? parseInt(p.wagner.match(/\d/)?.[0] || 0) : 0;
  if      (wgNum === 0) ef *= 1.00;
  else if (wgNum === 1) ef *= 0.98;
  else if (wgNum === 2) ef *= 0.88;
  else if (wgNum === 3) ef *= 0.62;
  else if (wgNum === 4) ef *= 0.38;
  else if (wgNum === 5) ef *= 0.20;

  // Penalidade por HbA1c
  const hba1c = parseFloat(String(p.hba1c).replace(',', '.')) || 0;
  if      (hba1c <= 0)   ef *= 1.00; // sem dado
  else if (hba1c <= 7.0) ef *= 1.00; // controlado
  else if (hba1c <= 8.0) ef *= 0.95;
  else if (hba1c <= 9.5) ef *= 0.88;
  else if (hba1c <= 11)  ef *= 0.74;
  else if (hba1c <= 13)  ef *= 0.58;
  else                   ef *= 0.40; // crítico

  // Penalidade leve por idade avançada
  const idade = parseInt(p.idade) || 50;
  if (idade > 75) ef *= 0.88;
  else if (idade > 65) ef *= 0.95;

  return Math.max(0.15, Math.min(1.0, ef));
}

function calcRisco(p) {
  const wgNum = p.wagner ? parseInt(p.wagner.match(/\d/)?.[0] || 0) : 0;
  const hba1c = parseFloat(String(p.hba1c).replace(',', '.')) || 0;
  if (wgNum >= 4 || hba1c >= 13) return { label: 'Crítico', cls: 'critical' };
  if (wgNum >= 3 || hba1c >= 11) return { label: 'Muito Alto', cls: 'very-high' };
  if (wgNum >= 2 || hba1c >= 9)  return { label: 'Alto', cls: 'high' };
  if (wgNum >= 1 || hba1c >= 7)  return { label: 'Moderado', cls: 'medium' };
  return { label: 'Baixo', cls: 'low' };
}

function calcDescEficacia(ef, p) {
  const wgNum = p.wagner ? parseInt(p.wagner.match(/\d/)?.[0] || 0) : 0;
  const hba1c = parseFloat(String(p.hba1c).replace(',', '.')) || 0;
  if (ef >= 0.90) return 'Excelente resposta esperada — perfil clínico favorável para cicatrização com BemCicatri.';
  if (ef >= 0.75) return 'Boa resposta esperada — leve limitação pelo HbA1c ou grau Wagner. Acompanhamento recomendado.';
  if (ef >= 0.55) {
    const motivo = hba1c >= 9 ? `HbA1c ${hba1c}% elevado` : wgNum >= 3 ? `Wagner Grau ${wgNum}` : 'perfil de risco moderado-alto';
    return `Resposta parcial — ${motivo} limita a eficácia. Associar BemCicatri com acompanhamento clínico intensivo.`;
  }
  return `Baixa eficácia esperada — Wagner Grau ${wgNum} e/ou HbA1c crítico em paciente de alto risco. Avaliação cirúrgica urgente recomendada.`;
}

const avatarColors = ['#0B1F3A','#166534','#7c2d12','#1e3a5f','#4a1d96','#065f46','#7f1d1d','#1e40af'];

function buildSimPatient(p, colorIdx) {
  const ef     = calcEficacia(p);
  const risco  = calcRisco(p);
  const ini    = p.nome.split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase();
  const cor    = avatarColors[colorIdx % avatarColors.length];
  const tags   = [];
  if (p.diab)   tags.push(p.diab);
  if (p.hba1c)  tags.push(`HbA1c ${p.hba1c}%`);
  if (p.wagner) tags.push(p.wagner.split('—')[0].trim());
  if (p.ferida) tags.push(p.ferida);
  return {
    id: p.id, ini, nome: p.nome, idade: p.idade,
    tags, risco: risco.label, riscoClass: risco.cls,
    eficacia: ef, descEficacia: calcDescEficacia(ef, p), cor,
    _raw: p
  };
}

function renderSimPatientSelector() {
  const container = document.getElementById('sps-cards');
  if (!container) return;

  if (!patients || patients.length === 0) {
    container.innerHTML = `
      <div class="sps-empty">
        <div class="sps-empty-icon">👥</div>
        <div class="sps-empty-msg">Nenhum paciente cadastrado ainda.</div>
        <div class="sps-empty-sub">Acesse a aba <strong>Pacientes</strong> e cadastre um paciente para simular aqui.</div>
        <div style="display:flex;justify-content:center;margin-top:.75rem">
          <button class="btn btn-primary btn-sm" onclick="showView('view-pacientes')">Ir para Pacientes →</button>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = patients.map((p, idx) => {
    const sp = buildSimPatient(p, idx);
    const riscoBg = sp.riscoClass === 'critical' ? '#fef2f2' : sp.riscoClass === 'very-high' ? '#fff1f2' : sp.riscoClass === 'high' ? '#fff7ed' : '#f0fdf4';
    const riscoColor = sp.riscoClass === 'critical' ? '#dc2626' : sp.riscoClass === 'very-high' ? '#e11d48' : sp.riscoClass === 'high' ? '#ea580c' : '#16a34a';
    return `
    <div class="sps-card" onclick="selectSimPatient('${p.id}')">
      <div class="sps-avatar" style="background:${sp.cor}">${sp.ini}</div>
      <div class="sps-info">
        <div class="sps-name">${sp.nome}</div>
        <div class="sps-age">${sp.idade} anos · ${p.id}</div>
        <div class="sps-tags">
          ${sp.tags.slice(0,2).map((t,i)=>`<span class="sps-tag" style="${i===0?'background:#ede9fe;color:#5b21b6':'background:#fef9c3;color:#92400e'}">${t}</span>`).join('')}
        </div>
      </div>
      <div class="sps-risk" style="background:${riscoBg};color:${riscoColor}">${sp.risco}</div>
    </div>`;
  }).join('');
}

function selectSimPatient(id) {
  // Comparação flexível de ID (funciona com string ou número)
  const rawPatient = patients.find(p => String(p.id) === String(id));
  if (!rawPatient) return;
  const idx = patients.indexOf(rawPatient);
  currentSimPatient = buildSimPatient(rawPatient, idx);

  // Esconde seletor, mostra perfil ativo
  document.getElementById('sps-cards').closest('.sim-patient-selector').style.display = 'none';
  const profile = document.getElementById('sim-patient-profile');
  profile.style.display = 'flex';

  // Preenche perfil
  document.getElementById('sim-pp-avatar').textContent = currentSimPatient.ini;
  document.getElementById('sim-pp-avatar').style.background = currentSimPatient.cor;
  document.getElementById('sim-pp-name').textContent = currentSimPatient.nome + ' · ' + currentSimPatient.idade + ' anos';
  const tagMeta = [
    { icon: '🩺', color: '#ede9fe', textColor: '#5b21b6' },
    { icon: '🩸', color: '#fef9c3', textColor: '#92400e' },
    { icon: '📊', color: '#fee2e2', textColor: '#b91c1c' },
    { icon: '📍', color: '#e0f2fe', textColor: '#0369a1' },
  ];
  document.getElementById('sim-pp-tags').innerHTML = currentSimPatient.tags.map((t, i) => {
    const m = tagMeta[i] || tagMeta[0];
    return `<span class="sim-pp-tag" style="background:${m.color};color:${m.textColor};border:1px solid ${m.textColor}22">${m.icon} ${t}</span>`;
  }).join('');
  const rv = document.getElementById('sim-pp-risk-val');
  rv.textContent = currentSimPatient.risco;
  rv.className = 'sim-pp-risk-val ' + currentSimPatient.riscoClass;

  // Desbloqueio o corpo do simulador
  const body = document.getElementById('sim-body');
  const overlay = document.getElementById('sim-lock-overlay');
  if (body) body.classList.remove('sim-body-locked');
  if (overlay) overlay.style.display = 'none';

  // Reset e inicia
  simReset();
  
  // Restaurar dia anterior do simulador se disponível
  restoreSimulatorDay(currentSimPatient._raw.id);
  
  renderSimSaveButton(); // Renderizar botão de salvamento
  showToast('✅ Simulando ' + currentSimPatient.nome + ' — eficácia esperada: ' + Math.round(currentSimPatient.eficacia * 100) + '%');
}

function clearSimPatient() {
  currentSimPatient = null;
  document.getElementById('sps-cards').closest('.sim-patient-selector').style.display = 'block';
  document.getElementById('sim-patient-profile').style.display = 'none';
  const body = document.getElementById('sim-body');
  const overlay = document.getElementById('sim-lock-overlay');
  if (body) body.classList.add('sim-body-locked');
  if (overlay) overlay.style.display = 'flex';
  simReset();
  renderSimSaveButton(); // Limpar botão
}

// Dados base do simulador (eficácia = 1.0) — REALISTA
const simData = {
  notreated: [
    { woundSize:85, status:'🔴 Ferida aberta — risco de infecção alto', heal:5, infect:88, bacteriaCtrl:5, tissue:'Tecido inflamado', phase:0, exsudatoType:'purulent', vascularization:25, bacteria:[{name:'S. aureus', pct:70},{name:'P. aeruginosa', pct:20},{name:'E. coli', pct:10}] },
    { woundSize:88, status:'⚠️ Biofilme denso se formando — sem melhora', heal:6, infect:92, bacteriaCtrl:4, tissue:'Tecido inflamado', phase:0, exsudatoType:'purulent', vascularization:20, bacteria:[{name:'S. aureus', pct:50},{name:'P. aeruginosa', pct:35},{name:'Polimicrobial', pct:15}] },
    { woundSize:90, status:'🔴 Infecção agravada — exsudato e odor fétido', heal:5, infect:95, bacteriaCtrl:3, tissue:'Necrose inicial', phase:0, exsudatoType:'purulent', vascularization:15, bacteria:[{name:'P. aeruginosa', pct:60},{name:'S. aureus', pct:25},{name:'Anaeróbios', pct:15}] },
    { woundSize:88, status:'🔴 Bordas necróticas — intervenção urgente', heal:7, infect:92, bacteriaCtrl:4, tissue:'Necrose avançada', phase:1, exsudatoType:'purulent', vascularization:10, bacteria:[{name:'P. aeruginosa', pct:70},{name:'Anaeróbios', pct:30}] },
    { woundSize:85, status:'🔴 CRÍTICO — risco de amputação', heal:8, infect:90, bacteriaCtrl:5, tissue:'Gangrena inicial', phase:1, exsudatoType:'necrose', vascularization:5, bacteria:[{name:'Anaeróbios', pct:85},{name:'P. aeruginosa', pct:15}] },
  ],
  // Dados tratados com eficácia 1.0 (melhor caso) — TIMELINE REALISTA
  treatedBase: [
    { woundSize:75, heal:10, bacteriaCtrl:40, tissue:'Controle bacteriano iniciado', phase:0, exsudatoType:'seropurulent', vascularization:35, bacteria:[{name:'S. aureus', pct:40},{name:'P. aeruginosa', pct:35},{name:'Redução', pct:25}] },
    { woundSize:55, heal:32, bacteriaCtrl:65, tissue:'Inflamação reduzida — angiogênese', phase:0, exsudatoType:'serous', vascularization:55, bacteria:[{name:'S. aureus', pct:15},{name:'P. aeruginosa', pct:10},{name:'Controlada', pct:75}] },
    { woundSize:32, heal:60, bacteriaCtrl:82, tissue:'Granulação — colágeno tipo III', phase:1, exsudatoType:'fibrinous', vascularization:75, bacteria:[{name:'Flora normal', pct:85},{name:'Reduzida', pct:15}] },
    { woundSize:14, heal:82, bacteriaCtrl:92, tissue:'Reepitelização — colágeno tipo I', phase:2, exsudatoType:'none', vascularization:85, bacteria:[{name:'Flora normal', pct:95},{name:'Ausente', pct:5}] },
    { woundSize:3,  heal:97, bacteriaCtrl:98, tissue:'Cicatriz — remodelação tecidual', phase:2, exsudatoType:'none', vascularization:88, bacteria:[{name:'Flora normal', pct:100}] },
  ]
};

// ===================== FUNÇÕES PARA REALISMO =====================

// Função para adicionar variabilidade diária realista (flutuações)
function addDailyVariability(baseValue, day, intensity = 0.05) {
  // Ruído natural: ±5% por padrão
  const noise = (Math.random() - 0.5) * 2 * intensity;
  // Tendência: alguns dias melhoram mais que outros
  const trend = Math.sin(day * 0.3) * 0.02;
  return Math.round(Math.max(0, Math.min(100, baseValue + noise * 100 + trend * 100)));
}

// Função para determinar cor de exsudato realista
function getExsudatoColor(exsudatoType, day) {
  const colors = {
    'purulent': { bg: '#c74444', label: '🟡 Purulento — infecção severa', hex: '#c74444' },
    'seropurulent': { bg: '#e8b444', label: '🟠 Seropurulento — infecção moderada', hex: '#e8b444' },
    'serous': { bg: '#f5d9c9', label: '🟢 Seroso — cicatrização normal', hex: '#f5d9c9' },
    'fibrinous': { bg: '#f0e8d8', label: '🟡 Fibrinoso — granulação', hex: '#f0e8d8' },
    'none': { bg: '#e8f5f0', label: '⚪ Sem exsudato — cicatrizado', hex: '#e8f5f0' },
    'necrose': { bg: '#2a1a0a', label: '⚫ Necrótico — tecido morto', hex: '#2a1a0a' }
  };
  return colors[exsudatoType] || colors['serous'];
}

// Função para simular recaídas e complicações (eventos aleatórios)
function checkComplications(day, currentEficacia, patient) {
  let hasComplications = false;
  let complicationMsg = '';
  
  // Risco de complicação aumenta se:
  // - HbA1c > 9% (diabetes descontrolada)
  // - Eficácia muito baixa (< 0.4)
  // - Dia 7-14 (pico de riscos)
  
  const hba1cRisk = patient?.hba1c && patient.hba1c > 9 ? 0.2 : 0.05;
  const eficaciaRisk = currentEficacia < 0.4 ? 0.25 : 0.05;
  const timeRisk = day >= 7 && day <= 14 ? 0.1 : 0.02;
  
  const totalRisk = Math.min(0.4, hba1cRisk + eficaciaRisk + timeRisk);
  
  if (Math.random() < totalRisk) {
    hasComplications = true;
    const complications = [
      { name: 'Infecção por P. aeruginosa', impact: -0.15, msg: '🦠 Infecção por Pseudomonas detectada!' },
      { name: 'Biofilme resistente', impact: -0.1, msg: '⚠️ Biofilme resistente formado' },
      { name: 'Inflamação excessiva', impact: -0.08, msg: '🔥 Resposta inflamatória excessiva' },
      { name: 'Pressão prolongada', impact: -0.12, msg: '⚫ Necrose por pressão' }
    ];
    const comp = complications[Math.floor(Math.random() * complications.length)];
    complicationMsg = comp.msg;
  }
  
  return { hasComplications, complicationMsg };
}

// Gera dados do tratado com base na eficácia DINÂMICA do paciente
function getTreatedData(idx, day = 1) {
  // Calcula eficácia dinâmica (varia por dia)
  let ef = currentSimPatient?.eficacia || 1.0;
  
  // Se tem um paciente selecionado, recalcula eficácia dinamicamente
  if (currentSimPatient?._raw) {
    const dynEf = calculateDynamicEficacia(currentSimPatient._raw, day);
    ef = dynEf.finalEficacia;
    
    // Salva eficácia dinâmica no banco (fire and forget)
    if (USE_API) {
      apiSaveDynamicEficacia(currentSimPatient._raw.id, day, dynEf.baseEficacia, dynEf.adherence, ef).catch(() => {});
    } else {
      const all = lsGet('bemc_eficacia_history') || {};
      if (!all[currentSimPatient._raw.id]) all[currentSimPatient._raw.id] = [];
      all[currentSimPatient._raw.id].push({ day, baseEficacia: dynEf.baseEficacia, adherence: dynEf.adherence, finalEficacia: ef, timestamp: new Date().toISOString() });
      lsSet('bemc_eficacia_history', all);
    }
  }

  const base = simData.treatedBase[idx];
  
  // Verificar complicações
  const complication = checkComplications(day, ef, currentSimPatient?._raw);
  if (complication.hasComplications) {
    ef *= 0.85; // Reduz eficácia em caso de complicação
  }
  
  const healScaled = Math.round(base.heal * ef);
  const bactScaled = Math.round(base.bacteriaCtrl * ef);
  const sizeScaled = Math.round(base.woundSize + (80 - base.woundSize) * (1 - ef));
  const vascScaled = Math.round(base.vascularization * ef);

  let status, tissue;
  if (ef >= 0.9) {
    const statuses = ['🌿 Tratamento iniciado — barbatimão aplicado','✅ Redução do exsudato — controle bacteriano','✅ Granulação ativa — colágeno novo','✅ Reepitelização em progresso','🎉 Cicatriz madura!'];
    status = statuses[idx];
    tissue = base.tissue;
  } else if (ef >= 0.55) {
    const statuses = ['🌿 Melhora lenta','⚠️ Progresso parcial — HbA1c elevado','⚠️ Granulação incompleta','⚠️ Cicatrização lenta','⚠️ Acompanhamento necessário'];
    status = statuses[idx];
    tissue = idx >= 2 ? 'Granulação parcial' : 'Inflamação persistente';
  } else {
    const statuses = ['⚠️ Resposta mínima','🔴 Pequena melhora','🔴 Risco de complicação','🔴 Avaliação cirúrgica urgente','🔴 Tratamento isolado insuficiente'];
    status = statuses[idx];
    tissue = idx >= 3 ? 'Gangrena parcial' : 'Infecção persistente';
  }
  
  if (complication.hasComplications) {
    status = complication.complicationMsg;
  }
  
  return { 
    woundSize: sizeScaled, 
    heal: healScaled, 
    bacteriaCtrl: bactScaled, 
    infect: Math.max(0, Math.min(100, 100 - bactScaled)),
    tissue, 
    status, 
    phase: base.phase,
    exsudatoType: base.exsudatoType,
    vascularization: vascScaled,
    bacteria: base.bacteria || [],
    hasComplications: complication.hasComplications
  };
}

const chartPointsTreated  = [91,88,84,79,73,66,58,50,42,35,28,22,17,13,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10];
const chartPointsNotreated= [95,95,96,96,95,95,94,93,92,91,91,90,89,88,88,87,86,86,85,85,84,84,83,83,82,82,82,81,81,80];

let simInterval = null;
let currentDetailPatientId = null;

function updateSimulator(val) {
  val = parseInt(val);
  document.getElementById('sim-day-label').textContent = val;
  const chartDay = document.getElementById('sim-chart-day');
  if(chartDay) chartDay.textContent = val;

  const idx = Math.min(Math.floor((val - 1) / 6), 4);
  const nt = simData.notreated[idx];
  const tr = getTreatedData(idx, val); // Passa o dia para cálculo de eficácia dinâmica
  const ef = currentSimPatient ? currentSimPatient.eficacia : 1.0;

  // Fase indicator
  const phases = ['ph-inflamacao','ph-proliferacao','ph-remodelacao'];
  phases.forEach((p,i)=>{ const el=document.getElementById(p); if(el) el.classList.toggle('active', i===tr.phase); });

  // Wound visual — não tratado
  const wcoreNT = document.getElementById('wcore-notreated');
  if(wcoreNT){
    const s = nt.woundSize;
    wcoreNT.style.width = s+'px'; wcoreNT.style.height = s+'px';
    // Cor realista de exsudato
    const exsudatoColorNT = getExsudatoColor(nt.exsudatoType || 'purulent', val);
    const necColor = idx>=3 ? '#1a0a00' : exsudatoColorNT.hex;
    wcoreNT.style.background = `radial-gradient(circle, ${necColor}, ${exsudatoColorNT.hex} 60%, ${exsudatoColorNT.hex}cc)`;
  }
  const infectRing = document.getElementById('infect-ring');
  if(infectRing){ infectRing.style.width=(nt.woundSize+20)+'px'; infectRing.style.height=(nt.woundSize+20)+'px'; infectRing.style.opacity = idx>=2?'1':'0.6'; }
  const necZone = document.getElementById('necrosis-zone');
  if(necZone) necZone.style.opacity = idx>=3?'1':'0';
  const bactDots = document.getElementById('bacteria-dots');
  if(bactDots) bactDots.style.opacity = idx>=2?'1':'0.5';

  const tlNT = document.getElementById('tissue-label-notreated');
  if(tlNT) tlNT.textContent = nt.tissue;
  document.getElementById('status-notreated').textContent = nt.status;
  document.getElementById('bar-notreated').style.width = nt.heal+'%';
  document.getElementById('pct-notreated').textContent = nt.heal+'%';
  document.getElementById('infect-bar').style.width = nt.infect+'%';
  document.getElementById('infect-pct').textContent = nt.infect+'%';

  // Wound visual — tratado (varia com eficácia)
  const wcoreT = document.getElementById('wcore-treated');
  if(wcoreT){
    wcoreT.style.width = tr.woundSize+'px'; wcoreT.style.height = tr.woundSize+'px';
    // Cor realista de exsudato
    const exsudatoColorT = getExsudatoColor(tr.exsudatoType || 'serous', val);
    const c = tr.heal>75 ? '#27ae60' : tr.heal>40 ? '#f39c12' : exsudatoColorT.hex;
    wcoreT.style.background = `radial-gradient(circle, ${c}, ${exsudatoColorT.hex}cc)`;
  }
  const granRing = document.getElementById('gran-ring');
  if(granRing){ granRing.style.opacity = tr.phase>=1&&ef>0.5?'1':'0'; granRing.style.width=(tr.woundSize+16)+'px'; granRing.style.height=(tr.woundSize+16)+'px'; }
  const healGlow = document.getElementById('healing-glow');
  if(healGlow) healGlow.style.opacity = tr.heal>60&&ef>0.7?'1':'0';

  document.getElementById('tissue-label-treated').textContent = tr.tissue;
  document.getElementById('status-treated').textContent = tr.status;
  
  // Mostrar/esconder alerta de complicação
  const complicationsAlert = document.getElementById('complications-alert');
  const complicationsMessage = document.getElementById('complications-message');
  if(complicationsAlert && complicationsMessage) {
    if(tr.hasComplications) {
      complicationsMessage.textContent = tr.status;
      complicationsAlert.style.display = 'block';
      // Remover classe active se estava, para reiniciar animação
      complicationsAlert.classList.remove('active');
      // Forçar reflow para reiniciar animação
      void complicationsAlert.offsetWidth;
      // Adicionar classe active para iniciar animação e pulso
      complicationsAlert.classList.add('active');
      // Tocar som de alerta (apenas se não estava tocando antes)
      if(!complicationsAlert.hasAttribute('data-alert-playing')) {
        playAlertSound();
        complicationsAlert.setAttribute('data-alert-playing', 'true');
        // Limpar flag após 2 segundos para permitir novo alerta
        setTimeout(() => complicationsAlert.removeAttribute('data-alert-playing'), 2000);
      }
    } else {
      complicationsAlert.style.display = 'none';
      complicationsAlert.classList.remove('active');
      complicationsAlert.removeAttribute('data-alert-playing');
    }
  }
  
  // Mostrar espécies bacterianas
  const bacteriaLabel = tr.bacteria && tr.bacteria.length > 0 
    ? tr.bacteria.map(b => `${b.name} (${b.pct}%)`).join(' + ')
    : 'Controlado';
  const bacteriaEl = document.getElementById('bacteria-species-label');
  if(bacteriaEl) bacteriaEl.textContent = bacteriaLabel;
  
  // Indicador de vascularização
  const vascEl = document.getElementById('vascularization-bar');
  if(vascEl) vascEl.style.width = tr.vascularization+'%';
  const vascValEl = document.getElementById('vascularization-val');
  if(vascValEl) vascValEl.textContent = tr.vascularization+'%';
  
  // Muda classe da borda do card dependendo da eficácia
  const treatedCard = document.querySelector('.sim-card-v2.featured-v2');
  if(treatedCard){
    treatedCard.style.borderColor = ef>=0.9?'var(--teal)':ef>=0.55?'#f59e0b':'#ef4444';
    treatedCard.style.boxShadow = ef>=0.9?'0 4px 20px rgba(0,180,160,.12)':ef>=0.55?'0 4px 20px rgba(245,158,11,.12)':'0 4px 20px rgba(239,68,68,.12)';
  }
  const statusEl = document.getElementById('status-treated');
  if(statusEl) statusEl.className = 'sim-status-v2 ' + (ef>=0.9?'good-status':ef>=0.55?'warn-status':'bad-status');

  document.getElementById('bar-treated').style.width = tr.heal+'%';
  document.getElementById('pct-treated').textContent = tr.heal+'%';
  document.getElementById('bact-control-bar').style.width = tr.bacteriaCtrl+'%';
  document.getElementById('bact-pct').textContent = tr.bacteriaCtrl+'%';

  const gap = tr.heal - nt.heal;
  const gapEl = document.getElementById('gap-val');
  if(gapEl){ gapEl.textContent = (gap>=0?'+':'')+gap+'%'; gapEl.style.color = gap>=20?'var(--teal)':gap>=0?'#f59e0b':'#ef4444'; }

  // Gráfico — posiciona os marcadores com base nos valores reais de cura
  const x = 40 + ((val-1)/29)*470;
  const yN = 110 - Math.max(0, Math.min(100, nt.heal));
  const yT = 110 - Math.max(0, Math.min(100, tr.heal));
  const line = document.getElementById('chart-day-line');
  const dotT = document.getElementById('chart-day-dot-t');
  const dotN = document.getElementById('chart-day-dot-n');
  if(line){ line.setAttribute('x1',x); line.setAttribute('x2',x); }
  if(dotT){ dotT.setAttribute('cx',x); dotT.setAttribute('cy',yT); }
  if(dotN){ dotN.setAttribute('cx',x); dotN.setAttribute('cy',yN); }
  
  // Atualizar matriz de comparação clínica
  updateMatrizComparacao(val, nt, tr);
  
  // Salvar estado do simulador (persistir dia atual e progresso)
  saveSimulatorState();
}

// Atualizar matriz de comparação clínica
function updateMatrizComparacao(val, nt, tr) {
  document.getElementById('matriz-day').textContent = val;
  
  // Carga bacteriana
  const bacteriaNT = nt.hasOwnProperty('infect') ? nt.infect : Math.round(100 - nt.bacteriaCtrl);
  const bacteriaT = tr.hasOwnProperty('infect') ? tr.infect : Math.round(100 - tr.bacteriaCtrl);
  const bacteriaDiff = bacteriaT - bacteriaNT;
  document.getElementById('matriz-bact-nt').textContent = bacteriaNT + '%';
  document.getElementById('matriz-bact-t').textContent = bacteriaT + '%';
  const bactDiffEl = document.getElementById('matriz-bact-diff');
  if(bactDiffEl) {
    bactDiffEl.textContent = (bacteriaDiff >= 0 ? '+' : '') + bacteriaDiff + '%';
    bactDiffEl.style.color = bacteriaDiff <= 0 ? '#00b4a0' : '#ef4444';
  }
  
  // Cicatrização
  const healDiff = tr.heal - nt.heal;
  document.getElementById('matriz-heal-nt').textContent = nt.heal + '%';
  document.getElementById('matriz-heal-t').textContent = tr.heal + '%';
  document.getElementById('matriz-heal-diff').textContent = (healDiff > 0 ? '+' : '') + healDiff + '%';
  
  // Vascularização
  const vascDiff = (tr.vascularization || 35) - (nt.vascularization || 25);
  document.getElementById('matriz-vasc-nt').textContent = (nt.vascularization || 25) + '%';
  document.getElementById('matriz-vasc-t').textContent = (tr.vascularization || 35) + '%';
  document.getElementById('matriz-vasc-diff').textContent = (vascDiff > 0 ? '+' : '') + vascDiff + '%';
  
  // Tamanho da lesão
  const sizeDiff = tr.woundSize - nt.woundSize;
  document.getElementById('matriz-size-nt').textContent = nt.woundSize + 'px';
  document.getElementById('matriz-size-t').textContent = tr.woundSize + 'px';
  document.getElementById('matriz-size-diff').textContent = (sizeDiff < 0 ? '' : '+') + sizeDiff + 'px';
}

function simAutoPlay() {
  const btn = document.getElementById('sim-play-btn');
  if (simInterval) { clearInterval(simInterval); simInterval = null; if(btn) btn.textContent='▶ Reproduzir'; return; }
  if(btn) btn.textContent='⏸ Pausar';
  const slider = document.getElementById('sim-slider');
  let val = parseInt(slider?.value || 1);
  if(val>=30){ val=1; if(slider) slider.value=1; }
  simInterval = setInterval(() => {
    val++;
    if (val > 30) {
      clearInterval(simInterval); simInterval = null;
      if(btn) btn.textContent='▶ Reproduzir';
      showToast('✅ Simulação concluída! Dia 30 atingido.');
      return;
    }
    if(slider) slider.value = val;
    updateSimulator(val);
  }, 800);
}

function simReset() {
  if(simInterval){ clearInterval(simInterval); simInterval=null; }
  const btn = document.getElementById('sim-play-btn');
  if(btn) btn.textContent='▶ Reproduzir';
  const slider = document.getElementById('sim-slider');
  if(slider) slider.value=1;
  updateSimulator(1);
  // Mostra nota de eficácia do paciente selecionado
  const noteEl = document.getElementById('sim-efficacy-note');
  if(noteEl && currentSimPatient){
    const ef = currentSimPatient.eficacia;
    const color = ef>=0.9?'#16a34a':ef>=0.55?'#d97706':'#dc2626';
    const icon  = ef>=0.9?'✅':ef>=0.55?'⚠️':'🔴';
    noteEl.innerHTML = `<span style="color:${color};font-weight:700">${icon} ${currentSimPatient.descEficacia}</span>`;
    noteEl.style.display='block';
  } else if(noteEl){ noteEl.style.display='none'; }
}

// ===================== INTEGRAÇÃO SIMULADOR ↔ PACIENTE =====================
// Salvar resultado da simulação como evolução do paciente
function saveSimulationResult() {
  if (!currentSimPatient || !currentSimPatient._raw) {
    showToast('⚠️ Nenhum paciente selecionado no simulador', 'warn');
    return;
  }

  const patientId = currentSimPatient._raw.id;
  const sliderVal = parseInt(document.getElementById('sim-slider')?.value || 1);
  const ef = currentSimPatient.eficacia;
  
  // Obter dados do simulador no dia atual
  const idx = Math.min(Math.floor((sliderVal - 1) / 6), 4);
  const ntData = simData.notreated[idx];
  const trData = getTreatedData(idx);
  
  // Criar entrada de evolução com dados do antes/depois
  const evolutionData = {
    date: new Date().toLocaleDateString('pt-BR'),
    type: 'simulation',
    simulationDay: sliderVal,
    note: `🩺 Simulação de cicatrização — Dia ${sliderVal}`,
    pct: Math.round(trData.heal),
    // Dados detalhados para microscopia
    simulationResults: {
      day: sliderVal,
      efficacy: ef,
      treated: {
        woundSize: trData.woundSize,
        healing: trData.heal,
        bacteriaControl: trData.bacteriaCtrl,
        tissue: trData.tissue,
        status: trData.status,
        phase: trData.phase
      },
      untreated: {
        woundSize: ntData.woundSize,
        healing: ntData.heal,
        infection: ntData.infect,
        tissue: ntData.tissue,
        status: ntData.status,
        phase: ntData.phase
      }
    }
  };

  // Encontrar paciente e adicionar evolução
  const pIdx = patients.findIndex(p => String(p.id) === String(patientId));
  if (pIdx < 0) {
    showToast('❌ Paciente não encontrado', 'warn');
    return;
  }

  const p = patients[pIdx];
  const updateLocalPatient = () => {
    p.healProgress = Math.round(trData.heal);
    if (!p.history) p.history = [];
    p.history.push(evolutionData);
    p._persistedHealing = true;
    cachePatientLocally(p);
  };

  if (!USE_API) {
    updateLocalPatient();
    showToast('⚠️ Servidor offline. Simulação salva localmente.', 'warn');
    setTimeout(() => {
      openPatientDetail(patientId);
      renderPatients();
      renderHomePatients();
      setTimeout(() => {
        const historySection = document.querySelector('#modal-patient-detail [id*="histórico"]');
        if (historySection) {
          historySection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }, 500);
    return;
  }

  // Tentar salvar na API
  fetch(`${getApiUrl()}/patients/${patientId}/evolution`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Email': currentUser?.email
    },
    body: JSON.stringify({ evolutionData })
  })
  .then(res => {
    console.log('📤 Resposta da API:', res.status, res.statusText);
    if (res.status === 401) {
      throw new Error('Não autenticado');
    }
    return res.json();
  })
  .then(data => {
    if (!data.success) {
      throw new Error(data.error || 'Erro desconhecido');
    }
    updateLocalPatient();
    showToast(`✅ Resultado salvo! Cicatrização: ${Math.round(trData.heal)}%`);
    setTimeout(() => {
      openPatientDetail(patientId);
      renderPatients();
      renderHomePatients();
      setTimeout(() => {
        const historySection = document.querySelector('#modal-patient-detail [id*="histórico"]');
        if (historySection) {
          historySection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }, 500);
  })
  .catch(apiError => {
    console.error('❌ Erro ao salvar na API:', apiError.message);
    showToast('❌ Erro ao salvar no servidor. Verifique a conexão e tente novamente.', 'error');
  });
}

// Renderizar botão de salvamento na interface do simulador
function renderSimSaveButton() {
  const btnContainer = document.getElementById('sim-save-btn-container');
  if (!btnContainer) return;
  
  if (!currentSimPatient) {
    btnContainer.innerHTML = '';
    return;
  }

  btnContainer.innerHTML = `
    <button class="btn btn-primary btn-sm" onclick="saveSimulationResult()" style="margin-left: auto;">
      📊 Registrar Evolução
    </button>`;
}

// ===================== DIÁRIO DE PESQUISA =====================
const phases = {
  fase1: {
    date:'📅 24/03/2026', phase:'Fase 1 — Identificação do Problema',
    title:'🩺 Por que feridas em diabéticos não cicatrizam?',
    text:'O diabetes mellitus compromete múltiplos mecanismos da cicatrização: a hiperglicemia reduz a migração de neutrófilos, prejudica a angiogênese e diminui a síntese de colágeno. Nossa hipótese é que uma fórmula à base de barbatimão poderia compensar esses déficits simultaneamente, aproveitando as propriedades antimicrobianas e adstringentes da planta.',
    tags:['Hipótese central','Revisão bibliográfica','Problema identificado','Diabetes Mellitus'],
    ref:'📚 <strong>Referência:</strong> Singh et al. (2013) — Diabetic Wound Healing: Mechanisms and Treatment'
  },
  fase2: {
    date:'📅 16/04/2026', phase:'Fase 2 — Revisão Bibliográfica',
    title:'📚 O que a ciência sabe sobre barbatimão?',
    text:'Analisamos 42 artigos nas bases PubMed, SciELO e Google Scholar. Os estudos confirmam que o Stryphnodendron adstringens possui taninos (principalmente proantocianidinas) com atividade antimicrobiana comprovada contra S. aureus e E. coli, além de propriedades anti-inflamatórias e cicatrizantes em modelos animais.',
    tags:['42 artigos','PubMed','SciELO','Taninos','S. adstringens'],
    ref:'📚 <strong>Referência:</strong> Lopes et al. (2016) — Antibacterial activity of Stryphnodendron adstringens'
  },
  fase3: {
    date:'📅 28/04/2026', phase:'Fase 3 — Formulação',
    title:'⚗️ Desenvolvendo a base gel-creme',
    text:'A casca do barbatimão foi macerada em álcool de cereais por 7 dias para extração dos compostos bioativos. Após filtragem, o extrato foi incorporado a uma base de glicerina bidestilada, óleo de coco e amido de milho (espessante). O pH final foi ajustado para 6,5–7,0, compatível com a pele humana.',
    tags:['Maceração 7 dias','pH 6,8','Base gel-creme','Estabilidade 90 dias'],
    ref:'🧪 <strong>Resultado:</strong> Formulação estável por 90 dias em temperatura ambiente com aparência homogênea'
  },
  fase4: {
    date:'📅 30/04/2026', phase:'Fase 4 — Testes',
    title:'🔬 Avaliação das propriedades da formulação',
    text:'Avaliamos a formulação quanto a: estabilidade física (cor, odor, pH, textura após 30/60/90 dias), atividade antimicrobiana por difusão em disco (Kirby-Bauer, in vitro), e biocompatibilidade estimada por análise da literatura de cada componente. Sem testes em humanos — respeitando as normas éticas escolares.',
    tags:['Kirby-Bauer (in vitro)','Estabilidade física','pH estável','Sem testes humanos'],
    ref:'📊 <strong>Resultado:</strong> Zona de inibição de 16mm contra S. aureus (vs 10mm do controle sem extrato)'
  },
  fase5: {
    date:'📅 05/05/2026', phase:'Fase 5 — Resultados e Conclusão',
    title:'✅ Resultados promissores e próximos passos',
    text:'Os testes demonstraram que a formulação BemCicatri apresenta atividade antimicrobiana in vitro, estabilidade física comprovada e todos os componentes com perfil de biocompatibilidade favorável na literatura. A fórmula é uma candidata viável para ensaios clínicos formais como próximo passo, respeitando as limitações éticas de um projeto escolar.',
    tags:['Hipótese confirmada','Antimicrobiano confirmado','Publicação futura','Ensaio clínico piloto'],
    ref:'🎯 <strong>Próximo passo:</strong> Protocolo de ensaio clínico piloto com aprovação ética e 30 voluntários'
  }
};

function selectPhase(el, key) {
  document.querySelectorAll('.tl-sci-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  const d = phases[key];
  document.getElementById('nb-date').innerHTML  = d.date;
  document.getElementById('nb-phase').textContent = d.phase;
  document.getElementById('nb-title').textContent = d.title;
  document.getElementById('nb-text').textContent  = d.text;
  document.getElementById('nb-ref').innerHTML     = d.ref;
  document.getElementById('nb-tags').innerHTML    = d.tags.map(t => `<span class="nb-tag">${t}</span>`).join('');
  const nc = document.getElementById('notebook-card');
  if (nc) { nc.style.animation = 'none'; void nc.offsetWidth; nc.style.animation = 'fadeIn .35s ease'; }
}

// ===================== QUIZ CIENTÍFICO =====================
const quizQuestions = [
  { q:'Qual planta é o ativo principal do BemCicatri?', opts:['Aloe Vera','Calêndula','Barbatimão','Copaíba'], ans:2, exp:'O barbatimão (Stryphnodendron adstringens) é o ativo principal, com taninos de alta atividade antimicrobiana e adstringente.' },
  { q:'Qual mecanismo celular o diabetes compromete na cicatrização?', opts:['Migração de neutrófilos','Divisão de eritrócitos','Produção de melanina','Síntese de insulina'], ans:0, exp:'A hiperglicemia reduz a quimiotaxia e migração de neutrófilos, prejudicando a fase inflamatória da cicatrização.' },
  { q:'Quantos brasileiros convivem com diabetes mellitus (estimativa)?', opts:['3,2 milhões','8,7 milhões','16,8 milhões','25 milhões'], ans:2, exp:'Estima-se que 16,8 milhões de brasileiros têm diabetes — um dos maiores números do mundo.' },
  { q:'Qual propriedade dos taninos do barbatimão é mais relevante para feridas?', opts:['Vasodilatação','Estimulação hormonal','Produção de colágeno','Precipitação de proteínas bacterianas'], ans:3, exp:'Os taninos precipitam proteínas da parede bacteriana, inibindo o crescimento de patógenos como S. aureus.' },
  { q:'Por que o ambiente úmido favorece a cicatrização?', opts:['Impede o crescimento bacteriano','Reduz a temperatura local','Permite a migração celular e reepitelização','Aumenta a dor'], ans:2, exp:'O ambiente úmido mantido pela glicerina facilita a migração de queratinócitos e fibroblastos, acelerando a reepitelização.' },
  { q:'O que é microangiopatia diabética?', opts:['Produção excessiva de insulina','Inflamação do pâncreas','Resistência a antibióticos','Dano aos vasos capilares reduzindo perfusão local'], ans:3, exp:'A microangiopatia é o dano progressivo aos capilares causado pela hiperglicemia, reduzindo o fluxo sanguíneo e o aporte de oxigênio à ferida.' },
  { q:'Qual foi o método de extração do barbatimão usado no BemCicatri?', opts:['Destilação a vapor','Maceração em álcool de cereais','Prensagem a frio','Infusão aquosa'], ans:1, exp:'A maceração alcoólica por 7 dias maximiza a extração dos taninos e flavonoides da casca do barbatimão.' },
  { q:'O que é a classificação de Wagner para feridas diabéticas?', opts:['Índice de controle glicêmico','Protocolo de antibióticos','Escala de 0 a 5 para profundidade e gravidade da úlcera','Sistema de cores para curativo'], ans:2, exp:'A escala de Wagner classifica úlceras diabéticas de Grau 0 (sem lesão) a Grau 5 (gangrena extensa), guiando o tratamento.' },
  { q:'Qual porcentagem das amputações não traumáticas está relacionada ao diabetes?', opts:['30%','50%','65%','80%'], ans:3, exp:'Cerca de 80% das amputações não traumáticas no mundo têm o diabetes como causa principal — tornando a prevenção e o tratamento de feridas essenciais.' },
  { q:'Qual é o papel do ácido láurico do óleo de coco na fórmula?', opts:['Redução do pH','Extração de taninos','Coloração da pomada','Atividade antifúngica e anti-inflamatória complementar'], ans:3, exp:'O ácido láurico presente no óleo de coco tem atividade antifúngica e anti-inflamatória, complementando o efeito antimicrobiano do barbatimão.' },
];

let quizCurrent = 0;
let quizScore   = 0;
let quizAnswered = false;

function initQuiz() {
  quizCurrent = 0; quizScore = 0; quizAnswered = false;
  const r = document.getElementById('quiz-result');
  const c = document.getElementById('quiz-card');
  const fb = document.getElementById('quiz-feedback');
  if (r)  { r.style.display = 'none'; }
  if (c)  { c.style.display = 'block'; }
  if (fb) { fb.style.display = 'none'; fb.className = 'quiz-feedback'; fb.textContent = ''; }
  const fill = document.getElementById('quiz-progress-fill');
  if (fill) fill.style.width = '0%';
  renderQuizQuestion();
}

function resetQuiz() {
  quizCurrent = 0;
  initQuiz();
}

function renderQuizQuestion() {
  const q = quizQuestions[quizCurrent];
  if (!q) return;
  const fill = document.getElementById('quiz-progress-fill');
  const ctr  = document.getElementById('quiz-counter');
  const qq   = document.getElementById('quiz-question');
  const opts = document.getElementById('quiz-options');
  const fb   = document.getElementById('quiz-feedback');
  if (fill) fill.style.width = ((quizCurrent / quizQuestions.length) * 100) + '%';
  if (ctr)  ctr.textContent = `Pergunta ${quizCurrent + 1} de ${quizQuestions.length}`;
  if (qq)   qq.textContent  = q.q;
  if (fb)   { fb.style.display = 'none'; fb.textContent = ''; }
  quizAnswered = false;
  if (opts) {
    opts.innerHTML = q.opts.map((o, i) =>
      `<button class="quiz-option" onclick="answerQuiz(${i})">${String.fromCharCode(65+i)}) ${o}</button>`
    ).join('');
  }
}

function answerQuiz(idx) {
  if (quizAnswered) return;
  quizAnswered = true;
  const q = quizQuestions[quizCurrent];
  const opts = document.querySelectorAll('.quiz-option');
  const fb   = document.getElementById('quiz-feedback');
  opts.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.ans) btn.classList.add('correct');
    else if (i === idx && idx !== q.ans) btn.classList.add('wrong');
  });
  const correct = idx === q.ans;
  if (correct) quizScore++;
  if (fb) {
    fb.style.display = 'block';
    fb.className = 'quiz-feedback ' + (correct ? 'correct' : 'wrong');
    fb.innerHTML = (correct ? '✅ Correto! ' : '❌ Incorreto. ') + q.exp;
  }
  setTimeout(() => {
    quizCurrent++;
    if (quizCurrent >= quizQuestions.length) showQuizResult();
    else renderQuizQuestion();
  }, 2500);
}

function showQuizResult() {
  const c = document.getElementById('quiz-card');
  const r = document.getElementById('quiz-result');
  if (c) c.style.display = 'none';
  if (r) r.style.display = 'flex';
  const fill = document.getElementById('quiz-progress-fill');
  if (fill) fill.style.width = '100%';
  const pct = Math.round((quizScore / quizQuestions.length) * 100);
  const icon  = document.getElementById('qr-icon');
  const score = document.getElementById('qr-score');
  const lbl   = document.getElementById('qr-label');
  const det   = document.getElementById('qr-detail');
  if (score) score.textContent = `${quizScore} / ${quizQuestions.length}`;
  if (pct >= 90) { if (icon) icon.textContent = '🏆'; if (lbl) lbl.textContent = 'Excelente!'; if (det) det.textContent = 'Você domina o conteúdo! Sua compreensão sobre diabetes e o BemCicatri é excepcional.'; }
  else if (pct >= 70) { if (icon) icon.textContent = '🎉'; if (lbl) lbl.textContent = 'Muito bom!'; if (det) det.textContent = 'Ótimo resultado! Você tem um sólido conhecimento sobre o tema do projeto.'; }
  else if (pct >= 50) { if (icon) icon.textContent = '👍'; if (lbl) lbl.textContent = 'Bom!'; if (det) det.textContent = 'Bom começo! Explore o Diário de Pesquisa e o Laboratório Virtual para aprender mais.'; }
  else { if (icon) icon.textContent = '📚'; if (lbl) lbl.textContent = 'Continue estudando!'; if (det) det.textContent = 'Não desanime! Navegue pelas ferramentas da plataforma para aprofundar seu conhecimento.'; }
}

// ===================== CALCULADORA DE RISCO =====================
function calcularRisco() {
  showAlert('calc-err', false);
  const campos = ['calc-tempo','calc-glicemia','calc-neuro','calc-dap','calc-historico','calc-imc'];
  const vals   = campos.map(id => parseInt(document.getElementById(id)?.value || 0));
  if (vals.some(v => isNaN(v) || v === 0)) { showAlert('calc-err', true, '⚠️ Preencha todos os campos.'); return; }
  const score = vals.reduce((s, v) => s + v, 0);
  const maxScore = 18;
  const pct = Math.round((score / maxScore) * 100);
  let level, color, desc, recs;
  if (pct <= 33) {
    level = 'Risco Baixo'; color = '#22c55e';
    desc = 'O perfil clínico indica risco reduzido de desenvolvimento de úlceras diabéticas. Manutenção preventiva é suficiente.';
    recs = ['Monitoramento glicêmico regular','Inspeção diária dos pés','Calçados adequados e bem ajustados','Hidratação da pele com emolientes suaves'];
  } else if (pct <= 66) {
    level = 'Risco Moderado'; color = '#f59e0b';
    desc = 'Alguns fatores de risco identificados. Atenção redobrada e acompanhamento médico regular são indicados.';
    recs = ['Consulta podológica a cada 3 meses','Inspeção diária com espelho (planta dos pés)','Controle glicêmico intensificado','Uso de pomadas cicatrizantes preventivas','Evitar andar descalço'];
  } else {
    level = 'Risco Alto'; color = '#ef4444';
    desc = 'Múltiplos fatores de risco identificados. Avaliação médica especializada e acompanhamento intensivo são essenciais.';
    recs = ['Consulta médica urgente','Avaliação vascular e neurológica','Programa de cuidados intensivos com o pé','Uso de palmilhas ortopédicas personalizadas','Educação diabetológica estruturada','Considerar formulações cicatrizantes como BemCicatri'];
  }

  const result = document.getElementById('calc-result');
  if (result) result.style.display = 'block';
  const gaugeVal = document.getElementById('cr-gauge-val');
  if (gaugeVal) { gaugeVal.textContent = pct + '%'; gaugeVal.style.color = color; }
  document.getElementById('cr-level').textContent     = level;
  document.getElementById('cr-level').style.color     = color;
  document.getElementById('cr-desc').textContent      = desc;
  document.getElementById('cr-recs').innerHTML = recs.map(r => `<div class="cr-rec-item">✓ ${r}</div>`).join('');
  // Animate arc
  const arc = document.getElementById('cr-gauge-arc');
  if (arc) {
    const total = 251;
    const fill  = Math.round((pct / 100) * total);
    arc.style.strokeDasharray = `${fill} ${total - fill}`;
    arc.style.stroke = color;
  }
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ===================== QUOTES CAROUSEL =====================

function goQuote(idx) {
  document.querySelectorAll('.project-quote-card').forEach((c, i) => c.classList.toggle('active', i === idx));
  document.querySelectorAll('.pq-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  currentQuote = idx;
}

function startQuoteCarousel() {
  clearInterval(quoteTimer);
  quoteTimer = setInterval(() => goQuote((currentQuote + 1) % 4), 5000);
}

// ===================== DEMO FILL =====================
function fillDemo() {
  const e = document.getElementById('login-email');
  const p = document.getElementById('login-pass');
  if (e) e.value = 'demo@bemcicatri.com.br';
  if (p) p.value = 'Demo@2025';
}

// ===================== PATIENT DETAIL =====================
async function openPatientDetail(id) {
  console.log('🔍 Abrindo paciente:', id, 'Total de pacientes:', patients.length);
  
  if (!id) {
    console.warn('⚠️ ID do paciente não fornecido');
    showToast('⚠️ Paciente inválido', 'warn');
    return;
  }
  
  try {
    // Tentar sincronizar dados do servidor
    if (USE_API && currentUser?.email) {
      try {
        const syncRes = await fetch(`${getApiUrl()}/patients/${id}/complete`, {
          headers: { 'X-User-Email': currentUser.email }
        });
        
        if (syncRes.ok) {
          const syncData = await syncRes.json();
          if (syncData.success && syncData.patient) {
            // Atualizar paciente local com dados do banco
            const localIdx = patients.findIndex(pt => String(pt.id) === String(id));
            if (localIdx >= 0) {
              patients[localIdx] = {
                ...patients[localIdx],
                ...syncData.patient,
                history: syncData.history || patients[localIdx].history || [],
                simulator_state: syncData.simulatorState,
                eficacia_history: syncData.eficaciaHistory
              };
              console.log('✅ Dados sincronizados do servidor');
            }
          }
        }
      } catch (syncError) {
        console.warn('⚠️ Erro ao sincronizar dados:', syncError);
      }
    }
  } catch (e) {
    console.error('Erro na sincronização:', e);
  }
  
  // Comparação flexível de ID (funciona com string ou número)
  const p = patients.find(pt => String(pt.id) === String(id));
  if(!p) {
    console.warn('❌ Paciente não encontrado com ID:', id);
    console.log('IDs disponíveis:', patients.map(pt => pt.id));
    showToast('❌ Paciente não encontrado', 'warn');
    return;
  }
  
  console.log('✅ Paciente encontrado:', p.nome);
  currentDetailPatientId = id;
  
  // Avatar
  const ini = (p.nome || '?').split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase() || '?';
  const titleEl = document.getElementById('detail-title');
  const idEl = document.getElementById('detail-id');
  const avatarEl = document.getElementById('detail-avatar');
  
  if (titleEl) titleEl.textContent = p.nome || 'Sem nome';
  if (idEl) idEl.textContent = p.id;
  if (avatarEl) avatarEl.textContent = ini;

  // Info list
  const infoHtml = [
    p.idade   ? `<div class="dil-item"><span>Idade</span><strong>${p.idade} anos</strong></div>` : '',
    p.diab    ? `<div class="dil-item"><span>Diabetes</span><strong>${p.diab}</strong></div>` : '',
    p.wagner  ? `<div class="dil-item"><span>Wagner</span><strong>${p.wagner.split('—')[0]}</strong></div>` : '',
    p.ferida  ? `<div class="dil-item"><span>Ferida</span><strong>${p.ferida}</strong></div>` : '',
    p.tel     ? `<div class="dil-item"><span>Telefone</span><strong>${p.tel}</strong></div>` : '',
    p.hba1c   ? `<div class="dil-item"><span>HbA1c</span><strong>${p.hba1c}%</strong></div>` : '',
    p.imc     ? `<div class="dil-item"><span>IMC</span><strong>${p.imc} kg/m²</strong></div>` : '',
    p.obs     ? `<div class="dil-item span2"><span>Obs.</span><strong>${p.obs}</strong></div>` : '',
  ].join('');
  const infoListEl = document.getElementById('detail-info-list');
  if (infoListEl) infoListEl.innerHTML = infoHtml;

  // Progress
  const pct = getEffectiveHealProgress(p);
  const progressEl = document.getElementById('detail-progress');
  const progressValEl = document.getElementById('detail-progress-val');
  const phaseEl = document.getElementById('detail-phase');
  if (progressEl) progressEl.style.width = pct+'%';
  if (progressValEl) progressValEl.textContent = pct+'%';
  const phaseLabel = pct<30?'Fase Inflamatória':pct<65?'Fase Proliferativa':'Fase de Remodelação';
  if (phaseEl) phaseEl.textContent = phaseLabel;

  // History
  const hist = p.history || [{date: p.regDate||'—', note:'Cadastro inicial', pct:0}];
  const historyEl = document.getElementById('detail-history');
  if (historyEl) {
    historyEl.innerHTML = hist.map((h, hIdx) => {
      let histContent = `<div class="dh-item"><div class="dh-dot"></div><div class="dh-text"><strong>${h.note}</strong><div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap"><span class="dh-date">${h.date}</span>${h.pct!==undefined?`<span style="font-size:.72rem;color:var(--teal);font-weight:700">${h.pct}% cicatrização</span>`:''}</div>`;
      
      // Se é um resultado de simulação, adicionar botão para visualizar antes/depois
      if (h.type === 'simulation' && h.simulationResults) {
        const btnId = `sim-detail-btn-${hIdx}`;
        histContent += `<button class="btn btn-ghost btn-xs" id="${btnId}" onclick="showSimulationDetails(${hIdx}, '${id}')">📊 Ver antes/depois</button>`;
      }
      
      histContent += '</div></div>';
      return histContent;
    }).join('');
  }

  // Pct slider
  const sliderEl = document.getElementById('evo-pct');
  const sliderValEl = document.getElementById('evo-pct-val');
  if (sliderEl) sliderEl.value = pct;
  if (sliderValEl) sliderValEl.textContent = pct+'%';

  // Abre modal
  console.log('📂 Abrindo modal...');
  openModal('modal-patient-detail');
  console.log('✅ Modal aberta');
}

async function addEvolution() {
  const id = currentDetailPatientId;
  if (!id) return;

  const pIdx = patients.findIndex(p => String(p.id) === String(id));
  if (pIdx < 0) return;

  const note = document.getElementById('evo-text').value.trim();
  const pct = parseInt(document.getElementById('evo-pct').value, 10);
  if (!note) { showToast('⚠️ Informe uma observação.', 'warn'); return; }

  const now = new Date();
  const entry = {
    date: now.toLocaleDateString('pt-BR'),
    time: now.toLocaleTimeString('pt-BR'),
    note,
    pct,
    type: 'manual_evolution'
  };

  const patient = patients[pIdx];
  const updateLocalPatient = () => {
    patient.healProgress = pct;
    if (!patient.history) patient.history = [];
    patient.history.push(entry);
    patient._persistedHealing = true;
    cachePatientLocally(patient);
  };

  if (!USE_API) {
    updateLocalPatient();
    showToast('⚠️ Servidor offline. Evolução salva localmente.', 'warn');
  } else {
    try {
      const response = await fetch(`${getApiUrl()}/patients/${id}/evolution`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Email': currentUser?.email
        },
        body: JSON.stringify({ evolutionData: entry })
      });

      if (response.status === 401) {
        throw new Error('Não autenticado');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Erro ao salvar');
      }

      updateLocalPatient();
      showToast('✅ Evolução salva no banco de dados!');
    } catch (apiError) {
      console.error('❌ Erro ao salvar evolução na API:', apiError.message);
      showToast('❌ Erro ao salvar no servidor. Tente novamente.', 'error');
    }
  }

  // Refresh
  openPatientDetail(id);
  document.getElementById('evo-text').value = '';
  document.getElementById('evo-pct').value = 0;
  document.getElementById('evo-pct-val').textContent = '0%';
  renderPatients();
  renderHomePatients();
}

// Exibir detalhes do resultado da simulação (antes e depois)
function showSimulationDetails(historyIndex, patientId) {
  const p = patients.find(pt => String(pt.id) === String(patientId));
  if (!p || !p.history || !p.history[historyIndex]) return;
  
  const entry = p.history[historyIndex];
  if (!entry.simulationResults) return;
  
  const sr = entry.simulationResults;
  const nt = sr.untreated;
  const tr = sr.treated;
  
  // Criar modal com comparação antes/depois
  const modalHtml = `
    <div style="background:white;border-radius:12px;padding:1.5rem;max-width:600px;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <h3>📊 Simulação — Dia ${sr.day}</h3>
        <button class="btn btn-ghost btn-sm" onclick="closeModal('sim-details-modal')">✕</button>
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:1rem">
          <div style="font-weight:700;color:#b91c1c;margin-bottom:.5rem">❌ SEM Tratamento</div>
          <div style="font-size:.8rem;line-height:1.6;color:#666">
            <div><strong>Ferida:</strong> ${nt.woundSize}px</div>
            <div><strong>Cicatrização:</strong> ${nt.healing}%</div>
            <div><strong>Infecção:</strong> ${nt.infection}%</div>
            <div><strong>Tecido:</strong> ${nt.tissue}</div>
            <div style="margin-top:.5rem;font-size:.75rem;color:#dc2626"><em>${nt.status}</em></div>
          </div>
        </div>
        
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:1rem">
          <div style="font-weight:700;color:#16a34a;margin-bottom:.5rem">✅ COM BemCicatri</div>
          <div style="font-size:.8rem;line-height:1.6;color:#666">
            <div><strong>Ferida:</strong> ${tr.woundSize}px</div>
            <div><strong>Cicatrização:</strong> ${tr.healing}%</div>
            <div><strong>Controle Bacteriano:</strong> ${tr.bacteriaCtrl}%</div>
            <div><strong>Tecido:</strong> ${tr.tissue}</div>
            <div style="margin-top:.5rem;font-size:.75rem;color:#22c55e"><em>${tr.status}</em></div>
          </div>
        </div>
      </div>
      
      <div style="background:#f8f8f8;border-radius:8px;padding:1rem;margin-bottom:1rem">
        <div style="font-weight:600;margin-bottom:.5rem">📈 Análise de Progresso</div>
        <div style="font-size:.8rem;color:#666;line-height:1.8">
          <div>🎯 <strong>Melhora na cicatrização:</strong> +${tr.healing - nt.healing}%</div>
          <div>🛡️ <strong>Eficácia do paciente:</strong> ${Math.round(sr.efficacy * 100)}%</div>
          <div>📍 <strong>Fase de cicatrização:</strong> ${['Inflamatória', 'Proliferativa', 'Remodelação'][tr.phase]}</div>
        </div>
      </div>
      
      <div style="text-align:center;font-size:.75rem;color:#999;padding-top:1rem;border-top:1px solid #e0e0e0">
        Dados coletados em ${entry.date}
      </div>
    </div>`;
  
  // Criar modal dinâmico
  let modal = document.getElementById('sim-details-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sim-details-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
    modal.onclick = (e) => {
      if (e.target === modal) closeModal('sim-details-modal');
    };
    document.body.appendChild(modal);
  }
  
  modal.innerHTML = `<div onclick="event.stopPropagation()">${modalHtml}</div>`;
  modal.style.display = 'flex';
}

// ===================== LAB TABS =====================
function switchLabTab(el, panelId) {
  document.querySelectorAll('.lab-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.lab-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  const panel = document.getElementById(panelId);
  if(panel) panel.classList.add('active');
  if (panelId === 'lab-microscopia') {
    setTimeout(() => {
      if (typeof renderMicroPatientSelector === 'function') {
        renderMicroPatientSelector();
      }
    }, 80);
  }
}

function updateLabProcessState() {
  const step1 = document.getElementById('lps-1');
  const step2 = document.getElementById('lps-2');
  const step3 = document.getElementById('lps-3');
  const step4 = document.getElementById('lps-4');
  const step5 = document.getElementById('lps-5');

  const alcoholQty = ingredientQuantities['alcool'] || 0;
  const barbatimaoQty = ingredientQuantities['barbatimao'] || 0;
  const glicerinaQty = ingredientQuantities['glicerina'] || 0;
  const cocoQty = ingredientQuantities['coco'] || 0;
  const amidoQty = ingredientQuantities['amido'] || 0;

  const hasAlcohol = alcoholQty > 0;
  const hasBarbatimao = barbatimaoQty > 0;
  const hasBase = glicerinaQty > 0 && amidoQty > 0 && cocoQty > 0;
  const phValue = parseFloat(String(document.getElementById('lab-ph')?.textContent || '0').replace(',', '.')) || 0;
  const pHideal = phValue >= 6.5 && phValue <= 7.5;
  const scoreText = document.getElementById('lab-score-val')?.textContent || '0%';
  const wasMixed = Number(scoreText.replace('%', '')) > 0;

  const markStep = (element, condition) => {
    if (!element) return;
    element.classList.toggle('completed', condition);
  };

  markStep(step1, hasAlcohol);
  markStep(step2, hasBarbatimao);
  markStep(step3, hasBase);
  markStep(step4, pHideal);
  markStep(step5, wasMixed);
}

// ===================== MICROSCOPIA AVANÇADA (Canvas) =====================

let microCanvas = null, microCtx = null;
let microAnimId = null;
let microMode = 'sem-trat';
let microZoom = 1;
let microTick = 0;

// Partículas: bactérias, células, taninos, neutrófilos
let microParticles = [];

function initMicroCanvas() {
  microCanvas = document.getElementById('micro-canvas');
  if (!microCanvas) return;
  microCtx = microCanvas.getContext('2d');
  microCanvas.width  = 360;
  microCanvas.height = 280;
  initMicroParticles();
  if (microAnimId) cancelAnimationFrame(microAnimId);
  microRenderLoop();
}

function initMicroParticles() {
  microParticles = [];
  const W = 360, H = 280;

  // Queratinócitos (células grandes, verde-rosado)
  for (let i = 0; i < 8; i++) {
    microParticles.push({
      type: 'cell',
      x: 30 + Math.random() * (W - 60),
      y: 30 + Math.random() * (H - 60),
      r: 18 + Math.random() * 10,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      phase: Math.random() * Math.PI * 2,
      alive: true, opacity: 1
    });
  }

  // Bactérias S. aureus (pequenos cocos roxo-vermelhos)
  for (let i = 0; i < 28; i++) {
    microParticles.push({
      type: 'bacteria',
      x: Math.random() * W,
      y: Math.random() * H,
      r: 4 + Math.random() * 3,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      phase: Math.random() * Math.PI * 2,
      divTimer: Math.random() * 300,
      alive: true, opacity: 1, dying: false, dyingT: 0
    });
  }

  // Neutrófilos (células imunes, azul)
  for (let i = 0; i < 3; i++) {
    microParticles.push({
      type: 'neutro',
      x: Math.random() * W,
      y: Math.random() * H,
      r: 12,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      phase: Math.random() * Math.PI * 2,
      alive: true, opacity: 0.6
    });
  }
}

function microRenderLoop() {
  if (!microCtx) return;
  microTick++;
  drawMicro();
  updateMicroParticles();
  updateMicroMetrics();
  microAnimId = requestAnimationFrame(microRenderLoop);
}

function drawMicro() {
  const ctx = microCtx;
  const W = 360, H = 280;
  const treated = microMode === 'com-trat';

  // Fundo com gradiente — simula lâmina microscópica
  const bgGrad = ctx.createRadialGradient(W/2, H/2, 10, W/2, H/2, 200);
  if (treated) {
    bgGrad.addColorStop(0, '#0a1f12');
    bgGrad.addColorStop(1, '#051008');
  } else {
    bgGrad.addColorStop(0, '#1a0808');
    bgGrad.addColorStop(1, '#0d0404');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Grid microscópico sutil
  ctx.strokeStyle = treated ? 'rgba(0,200,100,0.05)' : 'rgba(200,50,50,0.05)';
  ctx.lineWidth = 0.5;
  for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
  for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

  // Biofilme de fundo (sem tratamento)
  if (!treated) {
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#8b0000';
    for (let bx = 0; bx < W; bx += 20) {
      for (let by = 0; by < H; by += 20) {
        const sz = 8 + Math.sin(microTick * 0.01 + bx * 0.1 + by * 0.08) * 4;
        ctx.beginPath(); ctx.arc(bx, by, sz, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Desenha partículas por tipo (de baixo para cima)
  const order = ['cell', 'neutro', 'bacteria', 'tannin'];
  order.forEach(type => {
    microParticles.filter(p => p.type === type && p.alive).forEach(p => {
      ctx.globalAlpha = p.opacity;
      drawParticle(ctx, p, treated);
      ctx.globalAlpha = 1;
    });
  });

  // Vinheta circular para efeito de microscópio
  const vGrad = ctx.createRadialGradient(W/2, H/2, W * 0.35, W/2, H/2, W * 0.65);
  vGrad.addColorStop(0, 'transparent');
  vGrad.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, W, H);

  // Zoom overlay
  if (microZoom > 1) {
    ctx.fillStyle = 'rgba(0,180,160,0.08)';
    ctx.fillRect(0, 0, W, H);
  }
}

function drawParticle(ctx, p, treated) {
  const t = microTick;

  if (p.type === 'cell') {
    // Queratinócito: elipse irregular com núcleo
    const pulse = 1 + Math.sin(t * 0.02 + p.phase) * 0.04;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(pulse, pulse * 0.85);
    // Corpo da célula
    const cGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, p.r);
    if (treated) {
      cGrad.addColorStop(0, 'rgba(80,220,160,0.9)');
      cGrad.addColorStop(0.6, 'rgba(40,160,100,0.6)');
      cGrad.addColorStop(1, 'rgba(20,80,50,0.2)');
    } else {
      cGrad.addColorStop(0, 'rgba(180,120,100,0.8)');
      cGrad.addColorStop(0.6, 'rgba(120,70,60,0.5)');
      cGrad.addColorStop(1, 'rgba(60,30,30,0.15)');
    }
    ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.75, 0, 0, Math.PI * 2);
    ctx.fillStyle = cGrad; ctx.fill();
    // Membrana
    ctx.strokeStyle = treated ? 'rgba(100,255,180,0.5)' : 'rgba(200,120,100,0.4)';
    ctx.lineWidth = 1; ctx.stroke();
    // Núcleo
    ctx.beginPath(); ctx.ellipse(0, 0, p.r * 0.35, p.r * 0.28, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = treated ? 'rgba(0,255,150,0.5)' : 'rgba(255,150,100,0.5)'; ctx.fill();
    ctx.restore();
  }

  else if (p.type === 'bacteria') {
    if (p.dying) {
      // Animação de morte — fragmentação
      const progress = p.dyingT / 60;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = (1 - progress) * 0.8;
      for (let f = 0; f < 4; f++) {
        const angle = (f / 4) * Math.PI * 2 + p.phase;
        const dist = progress * 12;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * dist, Math.sin(angle) * dist, p.r * (1 - progress * 0.8), 0, Math.PI * 2);
        ctx.fillStyle = '#7fff00'; ctx.fill();
      }
      ctx.restore();
      return;
    }
    // Coco (esfera): dourado-vermelho escuro (S. aureus real)
    const bGrad = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, 0, p.x, p.y, p.r);
    bGrad.addColorStop(0, treated ? 'rgba(200,220,50,0.9)' : 'rgba(220,180,80,0.95)');
    bGrad.addColorStop(0.5, treated ? 'rgba(100,120,20,0.8)' : 'rgba(180,100,30,0.85)');
    bGrad.addColorStop(1, treated ? 'rgba(40,60,10,0.5)' : 'rgba(80,30,10,0.5)');
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = bGrad; ctx.fill();
    // Divisão/fissão: linha diagonal
    if (!treated && Math.sin(t * 0.05 + p.divTimer) > 0.9) {
      ctx.strokeStyle = 'rgba(255,200,80,0.6)'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(p.x - p.r * 0.6, p.y - p.r * 0.6);
      ctx.lineTo(p.x + p.r * 0.6, p.y + p.r * 0.6);
      ctx.stroke();
    }
  }

  else if (p.type === 'tannin') {
    // Taninos: partículas hexagonais verdes (polifenóis)
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.phase + t * 0.03);
    ctx.beginPath();
    for (let s = 0; s < 6; s++) {
      const ang = (s / 6) * Math.PI * 2;
      const rx = Math.cos(ang) * p.r, ry = Math.sin(ang) * p.r;
      s === 0 ? ctx.moveTo(rx, ry) : ctx.lineTo(rx, ry);
    }
    ctx.closePath();
    const tGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.r);
    tGrad.addColorStop(0, 'rgba(0,255,160,0.95)');
    tGrad.addColorStop(1, 'rgba(0,120,80,0.5)');
    ctx.fillStyle = tGrad; ctx.fill();
    ctx.strokeStyle = 'rgba(150,255,200,0.7)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.restore();
  }

  else if (p.type === 'neutro') {
    // Neutrófilo: célula lobulada azul
    ctx.save();
    ctx.translate(p.x, p.y);
    const nGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, p.r);
    nGrad.addColorStop(0, 'rgba(100,180,255,0.9)');
    nGrad.addColorStop(0.7, 'rgba(50,100,200,0.6)');
    nGrad.addColorStop(1, 'rgba(20,40,120,0.2)');
    // Forma lobulada com 3 lóbulos
    for (let l = 0; l < 3; l++) {
      const ang = (l / 3) * Math.PI * 2 + t * 0.008;
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * p.r * 0.3, Math.sin(ang) * p.r * 0.3, p.r * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = nGrad; ctx.fill();
    }
    ctx.restore();
  }
}

function updateMicroParticles() {
  const W = 360, H = 280;
  const treated = microMode === 'com-trat';
  const bacterias = microParticles.filter(p => p.type === 'bacteria');
  const tannins   = microParticles.filter(p => p.type === 'tannin');
  const cells     = microParticles.filter(p => p.type === 'cell');

  microParticles.forEach(p => {
    if (!p.alive) return;

    // Movimento
    p.x += p.vx; p.y += p.vy;
    // Bounce nas bordas
    if (p.x < p.r)     { p.x = p.r;   p.vx *= -1; }
    if (p.x > W - p.r) { p.x = W-p.r; p.vx *= -1; }
    if (p.y < p.r)     { p.y = p.r;   p.vy *= -1; }
    if (p.y > H - p.r) { p.y = H-p.r; p.vy *= -1; }

    if (p.type === 'bacteria') {
      if (p.dying) {
        p.dyingT++;
        p.opacity = Math.max(0, 1 - p.dyingT / 60);
        if (p.dyingT >= 60) p.alive = false;
        return;
      }

      // Sem tratamento: bactérias se reproduzem lentamente
      if (!treated) {
        p.divTimer++;
        if (p.divTimer > 280 + Math.random() * 120 && bacterias.filter(b=>b.alive&&!b.dying).length < 40) {
          p.divTimer = 0;
          microParticles.push({
            type:'bacteria', x:p.x+5, y:p.y+5,
            r: 4+Math.random()*3, vx:(Math.random()-.5)*.6, vy:(Math.random()-.5)*.6,
            phase:Math.random()*Math.PI*2, divTimer:0, alive:true, opacity:1, dying:false, dyingT:0
          });
        }
        // Bactérias movem-se mais rápido sem tratamento
        p.vx += (Math.random()-.5)*0.04; p.vy += (Math.random()-.5)*0.04;
        p.vx = Math.max(-0.8, Math.min(0.8, p.vx));
        p.vy = Math.max(-0.8, Math.min(0.8, p.vy));
      } else {
        // Com tratamento: taninos matam bactérias próximas
        tannins.filter(t => t.alive).forEach(tan => {
          const dx = tan.x - p.x, dy = tan.y - p.y;
          const dist = Math.sqrt(dx*dx+dy*dy);
          if (dist < 20 && !p.dying && Math.random() < 0.02) {
            p.dying = true; p.dyingT = 0;
          }
        });
        // Movimento mais lento sob ação dos taninos
        p.vx *= 0.98; p.vy *= 0.98;
      }
    }

    if (p.type === 'tannin') {
      // Taninos: aparecem em modo tratado, desaparecem sem tratamento
      if (!treated) { p.opacity = Math.max(0, p.opacity - 0.05); if (p.opacity <= 0) p.alive = false; }
      else { p.opacity = Math.min(1, p.opacity + 0.02); }
      // Movem-se em direção às bactérias mais próximas
      const nearest = bacterias.filter(b=>b.alive&&!b.dying)
        .sort((a,b) => {
          const da = (a.x-p.x)**2+(a.y-p.y)**2;
          const db = (b.x-p.x)**2+(b.y-p.y)**2;
          return da-db;
        })[0];
      if (nearest) {
        const dx = nearest.x-p.x, dy = nearest.y-p.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if (dist > 5) { p.vx += (dx/dist)*0.04; p.vy += (dy/dist)*0.04; }
      }
      p.vx *= 0.95; p.vy *= 0.95;
    }

    if (p.type === 'cell') {
      // Células migram mais livremente com tratamento
      const speed = treated ? 0.18 : 0.08;
      if (treated) {
        p.vx += (Math.random()-.5)*0.03; p.vy += (Math.random()-.5)*0.03;
        p.opacity = Math.min(1, p.opacity + 0.01);
      } else {
        // Células ficam mais estáticas e comprometidas sem tratamento
        p.vx *= 0.96; p.vy *= 0.96;
        p.opacity = Math.max(0.4, p.opacity - 0.002);
      }
      p.vx = Math.max(-speed, Math.min(speed, p.vx));
      p.vy = Math.max(-speed, Math.min(speed, p.vy));
    }

    if (p.type === 'neutro') {
      p.opacity = treated ? Math.min(0.9, p.opacity+0.01) : Math.max(0.25, p.opacity-0.005);
    }
  });

  // Remove mortos
  microParticles = microParticles.filter(p => p.alive);

  // Com tratamento: injetar taninos periodicamente
  if (treated && microTick % 40 === 0 && tannins.filter(t=>t.alive).length < 20) {
    microParticles.push({
      type:'tannin', x:Math.random()*360, y:Math.random()*280,
      r:5+Math.random()*3, vx:(Math.random()-.5)*0.4, vy:(Math.random()-.5)*0.4,
      phase:Math.random()*Math.PI*2, alive:true, opacity:0
    });
  }
}

function updateMicroMetrics() {
  const alive = microParticles.filter(p => p.type==='bacteria' && p.alive && !p.dying);
  const treated = microMode === 'com-trat';
  const bactPct = Math.min(100, Math.round(alive.length / 30 * 100));
  const cellPct = treated ? Math.min(90, 20 + Math.floor(microTick/100)*5) : 15;
  const immunePct = treated ? Math.min(80, 15 + Math.floor(microTick/80)*4) : 10;

  const bF = document.getElementById('mrt-bact-fill');
  const cF = document.getElementById('mrt-cell-fill');
  const iF = document.getElementById('mrt-immune-fill');
  const bV = document.getElementById('mrt-bact-val');
  const cV = document.getElementById('mrt-cell-val');
  const iV = document.getElementById('mrt-immune-val');
  const oC = document.getElementById('moi-bact-count');
  const oS = document.getElementById('moi-cell-status');

  if(bF){ bF.style.width=bactPct+'%'; bF.style.background=treated&&bactPct<50?'#22c55e':'#e05252'; }
  if(cF){ cF.style.width=cellPct+'%'; }
  if(iF){ iF.style.width=immunePct+'%'; }
  if(bV) bV.textContent = bactPct+'%';
  if(cV) cV.textContent = cellPct+'%';
  if(iV) iV.textContent = immunePct+'%';
  if(oC) oC.textContent = alive.length + ' bactérias ativas';
  if(oS) oS.textContent = treated ? (cellPct>50?'Migração ativa':'Migração iniciando') : 'Migração bloqueada';
}

function setMicroZoom(el, z) {
  microZoom = z;
  document.querySelectorAll('.micro-zoom-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const canvas = document.getElementById('micro-canvas');
  if (canvas) {
    canvas.style.transform = `scale(${z})`;
    canvas.style.transformOrigin = 'center center';
  }
}

function setMicroMode(el, mode) {
  microMode = mode;
  document.querySelectorAll('.micro-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const label = document.getElementById('micro-label');
  const expl  = document.getElementById('micro-explanation');
  const sb    = document.getElementById('stat-bact');
  const sh    = document.getElementById('stat-heal');
  const sbf   = document.getElementById('stat-biofilm');

  if (mode === 'com-trat') {
    if(label) label.textContent = 'Vista: Ação dos taninos do barbatimão — bactérias sendo neutralizadas';
    if(expl) expl.querySelector('p').innerHTML = '🟢 <strong>Com BemCicatri:</strong> os taninos precipitam as proteínas da parede bacteriana de <em>S. aureus</em>. As células da pele recuperam mobilidade e iniciam a reepitelização.';
    if(sb) { sb.textContent = 'Controladas'; sb.style.color='#22c55e'; }
    if(sh) { sh.textContent = 'Em progresso'; sh.style.color='#00B4A0'; }
    if(sbf){ sbf.textContent = 'Dissolvendo'; sbf.style.color='#f59e0b'; }
    showToast('🌿 Taninos ativados — observando ação antimicrobiana');
  } else {
    if(label) label.textContent = 'Vista: Biofilme bacteriano ativo em ferida diabética';
    if(expl) expl.querySelector('p').innerHTML = '🔴 <strong>Sem tratamento:</strong> as bactérias multiplicam-se livremente. O biofilme de <em>S. aureus</em> forma uma barreira protetora resistente ao sistema imune.';
    if(sb) { sb.textContent = 'Alta densidade'; sb.style.color='#E05252'; }
    if(sh) { sh.textContent = 'Bloqueada'; sh.style.color='#E05252'; }
    if(sbf){ sbf.textContent = 'Em formação'; sbf.style.color='#E05252'; }
  }
}

// Inicializa microscopia ao trocar de aba
const _origSwitchLabTab = typeof switchLabTab === 'function' ? switchLabTab : null;

// ===================== LAB pH =====================
function mixFormula() {
  if (selectedIngredients.size === 0) { showToast('⚠️ Selecione pelo menos um ingrediente.', 'warn'); return; }
  const keys  = [...selectedIngredients];
  const total = keys.reduce((s, k) => s + ingredientData[k].score, 0);
  const hasBarbatimao = selectedIngredients.has('barbatimao');
  const hasBase = selectedIngredients.has('glicerina') && selectedIngredients.has('amido');
  const isComplete = hasBarbatimao && hasBase && selectedIngredients.has('coco');

  // pH calculado com base nas quantidades
  let ph = 7.4;
  if(selectedIngredients.has('barbatimao')) {
    const qty = ingredientQuantities['barbatimao'] || 0;
    ph -= 0.5 * (1 + qty / 50);
  }
  if(selectedIngredients.has('alcool')) {
    const qty = ingredientQuantities['alcool'] || 0;
    ph -= 0.3 * (1 + qty / 50);
  }
  if(selectedIngredients.has('glicerina')) {
    const qty = ingredientQuantities['glicerina'] || 0;
    ph += 0.1 * (1 + qty / 50);
  }
  if(selectedIngredients.has('amido')) {
    const qty = ingredientQuantities['amido'] || 0;
    ph += 0.1 * (1 + qty / 30);
  }
  if(selectedIngredients.has('coco')) {
    const qty = ingredientQuantities['coco'] || 0;
    ph -= 0.1 * (1 + qty / 50);
  }
  
  ph = Math.min(Math.max(ph, 4.0), 8.0);
  const phDisplay = document.getElementById('lab-ph');
  if(phDisplay) phDisplay.textContent = ph.toFixed(1);
  // pH bar color
  const phBarFill = document.getElementById('ph-bar-fill');
  if(phBarFill){
    const pct = ((ph-4)/(8-4))*100;
    phBarFill.style.width = pct+'%';
    phBarFill.style.background = ph>=6.5&&ph<=7.5?'#00B4A0':'#f59e0b';
  }

  // Color mix
  const colors = keys.map(k => ingredientData[k].color);
  const gradient = colors.length === 1 ? colors[0] :
    `linear-gradient(160deg, ${colors.join(', ')})`;
  const liq = document.getElementById('jar-liquid');
  if(liq){
    // NOTA: A altura é calculada dinamicamente em updateJarVisualization() 
    // baseada nas quantidades reais, não apenas na seleção
    // Aqui apenas atualizar o background/gradient
    liq.style.background = gradient;
    liq.style.transition = 'height 0.8s ease, background 0.5s ease';
  }

  // Bubbles animation
  const bubbles = document.getElementById('jar-bubbles');
  if(bubbles){
    bubbles.innerHTML = '';
    for(let i=0;i<6;i++){
      const b = document.createElement('div');
      b.className = 'bubble';
      b.style.cssText = `left:${10+Math.random()*80}%;animation-delay:${Math.random()*2}s;animation-duration:${1+Math.random()}s;width:${4+Math.random()*6}px;height:${4+Math.random()*6}px`;
      bubbles.appendChild(b);
    }
    setTimeout(()=>{ if(bubbles) bubbles.innerHTML=''; }, 3000);
  }

  // Score arc
  const scoreArc = document.getElementById('lab-score-arc');
  const scoreVal = document.getElementById('lab-score-val');
  
  // Calcular eficácia considerando quantidades
  let efficacyMultiplier = 1.0;
  let efficacyReasons = [];
  let efficacyWarnings = [];
  
  // Verificar quantidades mínimas
  const totalQty = Object.values(ingredientQuantities).reduce((a, b) => a + b, 0);
  
  // ========== VERIFICAÇÕES DE QUANTIDADE TOTAL ==========
  if (totalQty === 0) {
    efficacyMultiplier = 0;
    efficacyReasons.push('🚫 Nenhuma quantidade adicionada — impossível ter eficácia sem ingredientes');
  } else if (totalQty < 10) {
    efficacyMultiplier *= 0.30;
    efficacyReasons.push('❌ Quantidade muito baixa (< 10 mL) — insuficiente para tratamento efetivo');
  } else if (totalQty < 20) {
    efficacyMultiplier *= 0.55;
    efficacyReasons.push('⚠️ Quantidade baixa (10–20 mL) — pode não ter eficácia adequada');
  } else if (totalQty < 50) {
    efficacyMultiplier *= 0.85;
    efficacyReasons.push('ℹ️ Quantidade moderada (20–50 mL) — eficácia reduzida mas aceitável');
  } else if (totalQty >= 50) {
    efficacyReasons.push('✅ Quantidade adequada (≥ 50 mL) — volume suficiente para eficácia esperada');
  }
  
  // ========== VERIFICAÇÕES DE INGREDIENTES ESPECÍFICOS ==========
  if (hasBarbatimao) {
    const barbQty = ingredientQuantities['barbatimao'] || 0;
    if (barbQty === 0) {
      efficacyMultiplier *= 0.5;
      efficacyReasons.push('🔴 Barbatimão ausente — ingrediente antimicrobiano principal não adicionado');
    } else if (barbQty < 3) {
      efficacyMultiplier *= 0.70;
      efficacyWarnings.push('⚠️ Barbatimão insuficiente (< 3g) — ativo principal fraco demais');
    } else if (barbQty < 5) {
      efficacyMultiplier *= 0.90;
      efficacyWarnings.push('ℹ️ Barbatimão moderado (3–5g) — abaixo do ideal recomendado');
    }
  }
  
  if (hasBase) {
    const gliceQty = ingredientQuantities['glicerina'] || 0;
    const amidoQty = ingredientQuantities['amido'] || 0;
    if (gliceQty < 3 || amidoQty < 3) {
      efficacyMultiplier *= 0.80;
      efficacyWarnings.push('⚠️ Base insuficiente (glicerina ou amido < 3 mL) — estabilidade comprometida');
    } else if (gliceQty < 5 || amidoQty < 5) {
      efficacyMultiplier *= 0.90;
      efficacyWarnings.push('ℹ️ Base moderada — pode afetar textura e absorção');
    }
  }
  
  // ========== CÁLCULO FINAL DE EFICÁCIA ==========
  const scorePct = Math.min(Math.round(total * efficacyMultiplier * 1.0), 100);
  if(scoreArc){ 
    const dash = Math.round((scorePct/100)*201); 
    scoreArc.style.strokeDasharray=`${dash} ${201-dash}`; 
    scoreArc.style.stroke = scorePct >= 80 ? '#00B4A0' : scorePct >= 50 ? '#f59e0b' : '#E05252'; 
  }
  if(scoreVal){ scoreVal.textContent = scorePct+'%'; }

  // ========== DETERMINAR VEREDICTO ==========
  let stars, verdict, summary;
  
  if (scorePct === 0) {
    stars = '⭐';
    verdict = '🚫 Sem Eficácia';
    summary = 'Adicione ingredientes para começar.';
  } else if (scorePct < 30) {
    stars = '⭐';
    verdict = '❌ Eficácia Muito Baixa';
    summary = 'A quantidade de ingredientes é insuficiente para ter qualquer efeito terapêutico.';
  } else if (scorePct < 50) {
    stars = '⭐⭐';
    verdict = '⚠️ Eficácia Reduzida';
    summary = 'Há falta de ingredientes críticos. A fórmula pode ter efeito limitado.';
  } else if (scorePct < 75) {
    stars = '⭐⭐⭐';
    verdict = '🟡 Eficácia Moderada';
    summary = 'A fórmula está funcionando, mas abaixo do potencial ideal.';
  } else if (scorePct < 95) {
    stars = '⭐⭐⭐⭐';
    verdict = '🟢 Boa Eficácia';
    summary = 'Excelente! A fórmula está bem equilibrada e deve ter bom desempenho.';
  } else {
    stars = '⭐⭐⭐⭐⭐';
    verdict = '✅ Eficácia Ótima — BemCicatri Original!';
    summary = 'Fórmula perfeita! Todos os ativos presentes nas quantidades ideais. pH compatível com pele humana.';
  }

  const effects = keys.map(k => {
    const qty = ingredientQuantities[k] || 0;
    const status = qty === 0 ? '❌ não adicionado' : qty < 5 ? '⚠️ quantidade baixa' : qty < 10 ? 'ℹ️ moderado' : '✅ adequado';
    return `<div class="lab-effect-item"><strong>${ingredientData[k].label}</strong> <small>${status}</small><p>${ingredientData[k].effect}</p><small>📚 ${ingredientData[k].ref}</small></div>`;
  }).join('');
  
  // Construir mensagem de motivos
  const reasonsHtml = efficacyReasons.length > 0 ? `<div class="lab-reasons-section" style="margin-top:1rem;padding:0.75rem;background:#fff7ed;border-radius:8px;border-left:4px solid #f59e0b"><strong>📊 Motivos da Eficácia ${scorePct}%:</strong><ul style="margin:.5rem 0;padding-left:1.5rem">${efficacyReasons.map(r => `<li style="font-size:.85rem;color:#92400e;margin:.3rem 0">${r}</li>`).join('')}</ul></div>` : '';
  
  const warningsHtml = efficacyWarnings.length > 0 ? `<div class="lab-warnings-section" style="margin-top:0.5rem;padding:0.75rem;background:#fef3c7;border-radius:8px;border-left:4px solid #f59e0b"><strong>⚡ Avisos:</strong><ul style="margin:.5rem 0;padding-left:1.5rem">${efficacyWarnings.map(w => `<li style="font-size:.85rem;color:#92400e;margin:.3rem 0">${w}</li>`).join('')}</ul></div>` : '';

  document.getElementById('lab-result-info').innerHTML = `
    <div class="lab-result-header"><div class="lab-stars">${stars}</div><div class="lab-verdict">${verdict}</div><p style="font-size:.85rem;color:var(--gray400);margin:.5rem 0">${summary}</p></div>
    ${reasonsHtml}
    ${warningsHtml}
    <div class="lab-effects" style="margin-top:1rem">${effects}</div>`;

  updateLabProcessState();
}

// selectIngredient atualiza checklist e card de info
function selectIngredient(el, key) {
  if (selectedIngredients.has(key)) {
    selectedIngredients.delete(key);
    el.classList.remove('selected');
  } else {
    selectedIngredients.add(key);
    el.classList.add('selected');
  }
  // Atualiza checklist
  Object.keys(ingredientData).forEach(k => {
    const lcEl = document.getElementById('lc-' + k);
    if(lcEl) lcEl.classList.toggle('lc-done', selectedIngredients.has(k));
  });
  // Mostra info do ingrediente clicado
  const d = ingredientData[key];
  const card = document.getElementById('lab-active-info-card');
  if(card && d){
    card.innerHTML = `
      <div class="laic-header">
        <span class="laic-label">${d.label}</span>
        ${selectedIngredients.has(key) ? '<span class="laic-added">✓ Adicionado</span>' : ''}
      </div>
      <div class="laic-property"><span class="laic-prop-lbl">Função</span><span class="laic-prop-val">${d.effect}</span></div>
      <div class="laic-ref">📚 ${d.ref}</div>`;
  }
  updateLabProcessState();
}

// Atualizar quantidade de ingrediente
function updateIngrQty(key, value) {
  const qty = Math.max(0, Math.min(100, parseInt(value) || 0));
  ingredientQuantities[key] = qty;

  const cardElement = document.querySelector(`.ingr-item[data-ing="${key}"]`);
  if (cardElement) {
    if (qty > 0) {
      selectedIngredients.add(key);
      cardElement.classList.add('selected');
    } else {
      selectedIngredients.delete(key);
      cardElement.classList.remove('selected');
    }
  }

  // Atualiza checklist de seleção
  Object.keys(ingredientData).forEach(k => {
    const lcEl = document.getElementById('lc-' + k);
    if (lcEl) lcEl.classList.toggle('lc-done', selectedIngredients.has(k));
  });

  // Atualizar visualização do frasco em tempo real
  updateJarVisualization();
  
  // Atualizar preview do pH
  updatePHPreview();
  
  // Atualizar etapas do processo
  updateLabProcessState();
}

// Atualizar visualização do frasco com as quantidades atuais
function updateJarVisualization() {
  // Calcular volume total considerando barbatimão e amido como sólidos
  let totalVolume = 0;
  let barbQty = ingredientQuantities['barbatimao'] || 0;
  let amidoQty = ingredientQuantities['amido'] || 0;
  let colors = [];
  let volumeByIngredient = {};
  
  selectedIngredients.forEach(key => {
    const qty = ingredientQuantities[key] || 0;
    if (qty > 0) {
      if (key === 'barbatimao' || key === 'amido') {
        // Converter gramas para volume equivalente (1g de pó ≈ 0.6 mL)
        const volumeEquiv = qty * 0.6;
        totalVolume += volumeEquiv;
        volumeByIngredient[key] = volumeEquiv;
      } else {
        // Ingredientes líquidos
        totalVolume += qty;
        volumeByIngredient[key] = qty;
      }
      colors.push(ingredientData[key].color);
    }
  });
  
  // Atualizar líquido do frasco
  const liq = document.getElementById('jar-liquid');
  if (liq) {
    // Altura: proporcionalmente ao volume total
    const altura = Math.min((totalVolume / 100) * 90, 90);
    liq.style.height = altura + '%';
    
    // Criar gradiente especial para pós (barbatimão e/ou amido)
    const hasPowders = barbQty > 0 || amidoQty > 0;
    
    if (colors.length === 0) {
      liq.style.background = 'transparent';
    } else if (hasPowders && colors.length === 1 && (selectedIngredients.has('barbatimao') || selectedIngredients.has('amido'))) {
      // Só um pó: mostrar como pó granulado
      const powderColor = selectedIngredients.has('barbatimao') 
        ? { start: '#3a5f47', mid1: '#4a7c59', mid2: '#2e5e38' }
        : { start: '#a67c52', mid1: '#d4a574', mid2: '#8b6a47' };
      
      liq.style.background = `
        repeating-linear-gradient(
          0deg,
          ${powderColor.start} 0px,
          ${powderColor.start} 2px,
          ${powderColor.mid1} 2px,
          ${powderColor.mid1} 4px,
          ${powderColor.mid2} 4px,
          ${powderColor.mid2} 6px
        ),
        radial-gradient(circle at 20% 30%, rgba(255,255,255,0.3) 1px, transparent 1px),
        radial-gradient(circle at 60% 70%, rgba(255,255,255,0.2) 2px, transparent 2px),
        radial-gradient(circle at 80% 20%, rgba(0,0,0,0.1) 1px, transparent 1px),
        linear-gradient(135deg, ${powderColor.mid1}, ${powderColor.mid2})
      `;
      liq.style.backgroundSize = 'auto, 50px 50px, 80px 80px, 120px 120px, auto';
      liq.style.backgroundPosition = 'auto, 0 0, 20px 20px, 40px 40px, auto';
    } else if (hasPowders) {
      // Pós + outros: mostrar pós na parte inferior, líquidos acima
      let powderHeight = 0;
      let powderStops = [];
      
      if (barbQty > 0) {
        const barbVol = volumeByIngredient['barbatimao'] || 0;
        powderHeight += barbVol;
        powderStops.push({ 
          color: { start: '#3a5f47', mid1: '#4a7c59', mid2: '#2e5e38' }, 
          height: barbVol / totalVolume * 100 
        });
      }
      
      if (amidoQty > 0) {
        const amidoVol = volumeByIngredient['amido'] || 0;
        powderHeight += amidoVol;
        powderStops.push({ 
          color: { start: '#a67c52', mid1: '#d4a574', mid2: '#8b6a47' }, 
          height: amidoVol / totalVolume * 100 
        });
      }
      
      const powderEndPos = (powderHeight / totalVolume) * 100;
      
      // Montar gradient dos líquidos
      let liquidStops = [];
      let prevPos = powderEndPos;
      colors.forEach((color) => {
        const key = [...selectedIngredients].find(k => ingredientData[k].color === color && k !== 'barbatimao' && k !== 'amido');
        if (key) {
          const vol = volumeByIngredient[key] || 0;
          const endPos = prevPos + (vol / totalVolume) * 100;
          liquidStops.push(`${color} ${prevPos}%, ${color} ${endPos}%`);
          prevPos = endPos;
        }
      });
      
      // Combinar: pós na parte inferior, líquidos acima
      let powderGradients = '';
      let currentPowderPos = 0;
      powderStops.forEach((ps) => {
        const nextPos = currentPowderPos + ps.height;
        powderGradients += `
          repeating-linear-gradient(0deg, ${ps.color.start} 0px, ${ps.color.start} 2px, ${ps.color.mid1} 2px, ${ps.color.mid1} 4px, ${ps.color.mid2} 4px, ${ps.color.mid2} 6px) ${currentPowderPos}% ${nextPos}%,
        `;
        currentPowderPos = nextPos;
      });
      
      liq.style.background = `
        linear-gradient(to top, 
          ${powderGradients}
          linear-gradient(to top, ${liquidStops.join(',')}) ${powderEndPos}% 100%
        )
      `;
    } else if (colors.length === 1) {
      liq.style.background = colors[0];
    } else {
      liq.style.background = `linear-gradient(to top, ${colors.join(',')})`;
    }
    
    liq.style.transition = 'height 0.3s ease, background 0.3s ease';
  }
  
  // Criar partículas visíveis de pó flutuando
  const bubbles = document.getElementById('jar-bubbles');
  if (bubbles) {
    bubbles.innerHTML = '';
    
    // Se houver barbatimão ou amido, criar partículas de pó
    const totalPowderQty = barbQty + amidoQty;
    if (totalPowderQty > 0) {
      const numParticles = Math.min(Math.ceil(totalPowderQty / 2), 12);
      for (let i = 0; i < numParticles; i++) {
        const p = document.createElement('div');
        // Alternar cor entre barbatimão (verde) e amido (marrom)
        const isBarba = i % 2 === 0 && barbQty > 0;
        const color = isBarba 
          ? `rgba(74, 124, 89, ${0.5 + Math.random() * 0.5})`
          : `rgba(166, 124, 82, ${0.5 + Math.random() * 0.5})`;
        const shadowColor = isBarba ? 'rgba(46, 94, 56, 0.6)' : 'rgba(139, 106, 71, 0.6)';
        
        p.style.cssText = `
          position: absolute;
          width: ${2 + Math.random() * 4}px;
          height: ${2 + Math.random() * 4}px;
          background: ${color};
          border-radius: 50%;
          left: ${Math.random() * 100}%;
          top: ${Math.random() * 100}%;
          box-shadow: 0 0 2px ${shadowColor};
          animation: float-particles ${2 + Math.random() * 3}s ease-in-out infinite;
          animation-delay: ${Math.random() * 2}s;
        `;
        bubbles.appendChild(p);
      }
      
      // Adicionar CSS para animação de partículas se não existir
      if (!document.getElementById('particle-animation-style')) {
        const style = document.createElement('style');
        style.id = 'particle-animation-style';
        style.textContent = `
          @keyframes float-particles {
            0%, 100% { transform: translateY(0) translateX(0); opacity: 0.6; }
            50% { transform: translateY(-20px) translateX(${Math.random() > 0.5 ? '' : '-'}10px); opacity: 0.8; }
          }
        `;
        document.head.appendChild(style);
      }
    } else if (totalVolume > 0) {
      // Se não há pó mas há outros ingredientes, bolhas normais
      const numBubbles = Math.min(Math.ceil(totalVolume / 20), 8);
      for (let i = 0; i < numBubbles; i++) {
        const b = document.createElement('div');
        b.className = 'bubble';
        b.style.cssText = `left:${10 + Math.random() * 80}%;animation-delay:${Math.random() * 2}s;animation-duration:${1.5 + Math.random()}s;width:${3 + Math.random() * 4}px;height:${3 + Math.random() * 4}px;opacity:0.6`;
        bubbles.appendChild(b);
      }
    }
  }
}

// Atualizar preview do pH em tempo real baseado nas quantidades
function updatePHPreview() {
  const hint = document.getElementById('lab-ph-hint');
  if (selectedIngredients.size === 0) {
    const phDisplay = document.getElementById('lab-ph');
    if (phDisplay) phDisplay.textContent = '—';
    const phBarFill = document.getElementById('ph-bar-fill');
    if (phBarFill) phBarFill.style.width = '0%';
    if (hint) {
      hint.textContent = 'pH ideal: 6,5–7,5';
      hint.className = 'lab-ph-hint';
    }
    updateLabProcessState();
    return;
  }

  // Calcular pH com base nas quantidades
  let ph = 7.4;
  let totalQty = 0;
  
  // Barbatimão: muito ácido (diminui pH) — em gramas
  if (selectedIngredients.has('barbatimao')) {
    const qty = ingredientQuantities['barbatimao'] || 0;
    ph -= 0.5 * (1 + qty / 30); // ajustado para gramas
    totalQty += qty * 0.6; // convertendo gramas para equivalente de mL (1g ≈ 0.6 mL)
  }
  
  // Álcool: levemente ácido
  if (selectedIngredients.has('alcool')) {
    const qty = ingredientQuantities['alcool'] || 0;
    ph -= 0.3 * (1 + qty / 50);
    totalQty += qty;
  }
  
  // Glicerina: levemente alcalina
  if (selectedIngredients.has('glicerina')) {
    const qty = ingredientQuantities['glicerina'] || 0;
    ph += 0.1 * (1 + qty / 50);
    totalQty += qty;
  }
  
  // Amido: levemente alcalino — em gramas
  if (selectedIngredients.has('amido')) {
    const qty = ingredientQuantities['amido'] || 0;
    ph += 0.1 * (1 + qty / 30); // ajustado para gramas
    totalQty += qty * 0.6; // convertendo gramas para equivalente de mL (1g ≈ 0.6 mL)
  }
  
  // Óleo de coco: neutro a levemente ácido
  if (selectedIngredients.has('coco')) {
    const qty = ingredientQuantities['coco'] || 0;
    ph -= 0.1 * (1 + qty / 50);
    totalQty += qty;
  }
  
  // Normalizar pH para range válido
  ph = Math.min(Math.max(ph, 4.0), 8.0);
  
  // Atualizar display
  const phDisplay = document.getElementById('lab-ph');
  if (phDisplay) phDisplay.textContent = ph.toFixed(1);
  
  // Atualizar pH bar color
  const phBarFill = document.getElementById('ph-bar-fill');
  if (phBarFill) {
    const pct = ((ph - 4) / (8 - 4)) * 100;
    phBarFill.style.width = pct + '%';
    phBarFill.style.background = ph >= 6.5 && ph <= 7.5 ? '#00B4A0' : '#f59e0b';
  }
  
  // Atualizar dica de pH
  if (hint) {
    if (ph >= 6.5 && ph <= 7.5) {
      hint.textContent = '✅ pH dentro do ideal — fórmula está balanceada.';
      hint.className = 'lab-ph-hint ideal';
    } else if (ph < 6.5) {
      hint.textContent = '⚠️ pH ácido — adicione mais glicerina ou amido.';
      hint.className = 'lab-ph-hint warning';
    } else {
      hint.textContent = '⚠️ pH alcalino — reduza glicerina ou óleo de coco.';
      hint.className = 'lab-ph-hint warning';
    }
  }
  
  // Mostrar aviso visual se quantidade é muito baixa
  const jarBody = document.querySelector('.jar-body-v2');
  if (jarBody) {
    if (totalQty < 10) {
      jarBody.style.opacity = '0.6';
      jarBody.style.border = '2px solid #E05252';
    } else if (totalQty < 20) {
      jarBody.style.opacity = '0.8';
      jarBody.style.border = '2px solid #f59e0b';
    } else {
      jarBody.style.opacity = '1';
      jarBody.style.border = '2px solid #00B4A0';
    }
  }

  updateLabProcessState();
}

function resetLab() {
  selectedIngredients.clear();
  
  // Resetar quantidades
  ingredientQuantities = {
    'alcool': 0,
    'barbatimao': 0,
    'glicerina': 0,
    'coco': 0,
    'amido': 0
  };
  
  // Resetar inputs de quantidade
  document.querySelectorAll('.qty-field').forEach(inp => inp.value = '0');
  
  document.querySelectorAll('.ingr-item').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.lc-item').forEach(b => b.classList.remove('lc-done'));
  
  const liq = document.getElementById('jar-liquid');
  if(liq){ 
    liq.style.height='0%'; 
    liq.style.background='transparent'; 
  }
  
  const jarBody = document.querySelector('.jar-body-v2');
  if (jarBody) {
    jarBody.style.opacity = '1';
    jarBody.style.border = '2px solid #EFF2F5';
  }
  
  const phEl = document.getElementById('lab-ph');
  if(phEl) phEl.textContent='—';
  
  const phBar = document.getElementById('ph-bar-fill');
  if(phBar) phBar.style.width='0%';
  
  const scoreArc = document.getElementById('lab-score-arc');
  if(scoreArc) scoreArc.style.strokeDasharray='0 201';
  
  const scoreVal = document.getElementById('lab-score-val');
  if(scoreVal) scoreVal.textContent='0%';
  
  const ri = document.getElementById('lab-result-info');
  if(ri) ri.innerHTML = '<p class="lab-empty-msg">Selecione ingredientes e clique em<br><strong>Adicionar ao Frasco</strong> para ver o resultado!</p>';
  
  const hint = document.getElementById('lab-ph-hint');
  if (hint) {
    hint.textContent = 'pH ideal: 6,5–7,5';
    hint.className = 'lab-ph-hint';
  }
  
  const card = document.getElementById('lab-active-info-card');
  if(card) card.innerHTML = `<div class="laic-empty"><div class="laic-icon">👆</div><div class="laic-msg">Clique em um ingrediente para ver informações detalhadas</div></div>`;
  updateLabProcessState();
}

// ===================== MAPA INTERATIVO =====================
const BRASIL_GEOJSON = {"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"Acre","uf":"AC","region":"Norte","diabeticos":"80 mil","prevalencia":"8,1%","amputacoes":"400","color":"#52b788"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-73.608178,-7.201942],[-72.658816,-7.624607],[-70.368997,-8.141024],[-68.727521,-8.999689],[-66.626959,-9.935258],[-67.047783,-10.27537],[-67.406348,-10.373624],[-67.707391,-10.708131],[-68.054241,-10.669845],[-68.237692,-10.956333],[-68.542816,-11.108756],[-68.715613,-11.143104],[-68.757804,-11.000915],[-69.423511,-10.926513],[-69.736949,-10.974229],[-69.935091,-10.92091],[-70.311421,-11.069586],[-70.531044,-10.934591],[-70.621576,-10.999458],[-70.622653,-9.821404],[-70.537764,-9.764902],[-70.600274,-9.557555],[-70.493979,-9.426199],[-71.212348,-9.966583],[-72.180409,-9.99979],[-72.150676,-9.799055],[-72.270993,-9.749449],[-72.253722,-9.613856],[-72.356853,-9.493771],[-73.214815,-9.410931],[-73.005153,-9.210582],[-72.936769,-8.98833],[-73.131392,-8.706625],[-73.290566,-8.614645],[-73.279806,-8.47484],[-73.536741,-8.345494],[-73.630059,-8.021454],[-73.771247,-7.90571],[-73.683598,-7.776067],[-73.987573,-7.554907],[-73.919102,-7.465302],[-73.961742,-7.345469],[-73.700266,-7.305066],[-73.803699,-7.111057],[-73.608178,-7.201942]]]]}},{"type":"Feature","properties":{"name":"Alagoas","uf":"AL","region":"Nordeste","diabeticos":"320 mil","prevalencia":"10,2%","amputacoes":"1.600","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-35.465161,-8.825492],[-35.152043,-8.912951],[-35.353576,-9.255001],[-36.271716,-10.27463],[-36.391006,-10.50069],[-36.455743,-10.407212],[-36.56376,-10.415908],[-36.623312,-10.25773],[-36.910464,-10.137513],[-36.991601,-9.976776],[-37.78483,-9.638153],[-38.202893,-9.418237],[-38.237084,-9.329271],[-37.978946,-9.147961],[-37.759906,-8.857214],[-37.698445,-8.992052],[-37.48985,-8.965277],[-37.23392,-9.239747],[-37.105852,-9.239376],[-36.952008,-9.38212],[-36.867795,-9.268107],[-36.603786,-9.340622],[-36.224498,-9.170589],[-36.266392,-9.101956],[-36.063478,-8.914917],[-35.465161,-8.825492]],[[-35.290981,-9.148233],[-35.290981,-9.148233]]]]}},{"type":"Feature","properties":{"name":"Amazonas","uf":"AM","region":"Norte","diabeticos":"420 mil","prevalencia":"8,3%","amputacoes":"2.100","color":"#52b788"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-67.32553,2.030119],[-67.277525,1.876155],[-67.156484,1.849256],[-67.096812,1.733011],[-67.08759,1.167322],[-66.856352,1.230626],[-66.317916,0.755435],[-66.087916,0.759496],[-65.879065,0.933058],[-65.584982,1.009292],[-65.493079,0.882491],[-65.59061,0.722275],[-65.539922,0.64926],[-65.423018,0.708349],[-65.328523,0.931928],[-65.181275,0.923526],[-65.102503,1.157025],[-65.021636,1.115381],[-64.809914,1.314744],[-64.745882,1.225626],[-64.396853,1.527208],[-64.337406,1.363963],[-64.094647,1.617491],[-63.995785,1.979573],[-63.667371,2.017307],[-63.371834,2.212058],[-63.14098,2.172756],[-63.023254,2.014976],[-62.705501,1.940031],[-62.803914,1.590666],[-62.636847,1.434036],[-62.445258,0.977169],[-62.53248,0.509141],[-62.445813,0.379402],[-62.423875,0.091908],[-62.18784,-0.330494],[-62.308673,-0.513833],[-62.290344,-0.64633],[-62.406375,-0.726972],[-62.486096,-0.681141],[-62.509707,-0.75864],[-62.039147,-1.118076],[-61.896094,-1.395022],[-61.634982,-1.433631],[-61.474144,-1.578632],[-61.618591,-1.394467],[-61.543588,-1.06197],[-61.584703,-0.93669],[-61.46414,-0.664471],[-61.216365,-0.49975],[-60.920256,-0.555036],[-60.667481,-0.894188],[-60.309142,-0.724475],[-60.399423,-0.509759],[-60.037434,0.263837],[-58.89489,0.263852],[-58.871545,-0.342665],[-58.729246,-0.434959],[-58.704659,-0.678644],[-58.435532,-0.883137],[-58.429563,-1.026786],[-58.322768,-1.142963],[-58.162129,-1.229325],[-58.01703,-1.105819],[-57.959836,-1.40124],[-57.392176,-1.722738],[-57.16439,-1.720534],[-57.036699,-1.911216],[-56.734026,-2.021675],[-56.768032,-2.165412],[-56.678565,-2.212225],[-56.098136,-2.026721],[-56.46509,-2.422775],[-56.401654,-2.456277],[-58.262031,-6.468555],[-58.477949,-6.699242],[-58.434032,-6.908436],[-58.209,-7.133889],[-58.136365,-7.356093],[-58.201587,-7.620545],[-58.382425,-7.838707],[-58.286495,-8.128132],[-58.416655,-8.491859],[-58.436896,-8.703034],[-58.325551,-8.719611],[-58.394898,-8.779819],[-61.582423,-8.79831],[-61.712737,-8.687474],[-61.835964,-8.732345],[-61.8595,-8.852734],[-61.984687,-8.878228],[-62.124437,-8.801291],[-62.187856,-8.590182],[-62.335242,-8.609107],[-62.366551,-8.389222],[-62.525603,-8.382677],[-62.69175,-8.092534],[-62.844524,-7.986158],[-63.620267,-7.968921],[-63.77299,-8.320355],[-63.943608,-8.330811],[-63.924056,-8.575147],[-64.027357,-8.715286],[-64.13036,-8.721781],[-64.148942,-8.958555],[-64.838837,-8.993728],[-65.097373,-9.43213],[-65.184149,-9.426604],[-65.246189,-9.257276],[-65.446554,-9.31599],[-65.434254,-9.465947],[-65.596321,-9.413476],[-65.79108,-9.585253],[-65.969866,-9.412766],[-66.408458,-9.406552],[-66.392013,-9.500085],[-66.50022,-9.633167],[-66.805966,-9.814127],[-68.727521,-8.999689],[-70.368997,-8.141024],[-72.658816,-7.624607],[-73.803699,-7.111057],[-73.644775,-6.761425],[-73.137127,-6.497262],[-73.236244,-6.03117],[-72.96166,-5.653915],[-72.885452,-5.16594],[-72.814452,-5.109594],[-72.629831,-5.051316],[-71.882947,-4.516117],[-71.619703,-4.469996],[-71.604992,-4.533385],[-71.26877,-4.384642],[-70.942851,-4.385059],[-70.807557,-4.18321],[-70.680871,-4.198996],[-70.652803,-4.126768],[-70.624403,-4.192082],[-70.325613,-4.14608],[-70.198758,-4.365906],[-70.107803,-4.264269],[-70.043562,-4.351926],[-69.963656,-4.300192],[-69.395245,-1.132138],[-69.625743,-0.749224],[-69.563854,-0.63935],[-69.614233,-0.505595],[-70.05706,-0.186323],[-70.042718,0.559422],[-69.808802,0.572992],[-69.67946,0.670917],[-69.606432,0.629895],[-69.480791,0.735938],[-69.358015,0.612602],[-69.114365,0.650391],[-69.185624,0.733631],[-69.135255,0.877623],[-69.264789,1.064718],[-69.843846,1.085633],[-69.841504,1.720918],[-69.551673,1.79191],[-69.392529,1.724968],[-68.156176,1.73211],[-68.266269,1.82776],[-68.207987,1.962003],[-68.139322,1.985516],[-67.940565,1.831186],[-67.768272,2.039764],[-67.619139,2.024124],[-67.406873,2.246621],[-67.32553,2.030119]]]]}},{"type":"Feature","properties":{"name":"Amapá","uf":"AP","region":"Norte","diabeticos":"110 mil","prevalencia":"7,9%","amputacoes":"550","color":"#52b788"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-51.181678,4.008887],[-51.075149,3.890906],[-51.014374,3.045764],[-50.702067,2.13866],[-50.445945,2.199662],[-50.237715,1.803558],[-49.9213,1.70426],[-49.893209,1.193334],[-50.093461,0.702404],[-50.409404,0.62366],[-50.667739,0.185354],[-51.2159,-0.11829],[-51.67874,-0.784922],[-51.703871,-1.067409],[-51.808628,-1.156769],[-51.984865,-1.121114],[-52.06999,-1.235651],[-52.119791,-1.145867],[-52.426566,-1.050463],[-52.402686,-0.876817],[-52.538185,-0.854477],[-52.522704,-0.588746],[-52.639535,-0.584576],[-52.689648,-0.302593],[-52.933229,-0.139195],[-53.174834,0.382038],[-53.105819,0.6843],[-53.411014,0.92966],[-53.42604,1.243034],[-53.535535,1.212585],[-53.538067,1.341175],[-53.650483,1.336535],[-53.649819,1.408565],[-53.849856,1.392152],[-54.008564,1.519977],[-54.08598,1.488609],[-54.143178,1.640923],[-54.308816,1.74136],[-54.744288,1.776109],[-54.81234,2.06312],[-54.76262,2.202624],[-54.875756,2.426999],[-54.684358,2.44719],[-54.661689,2.327363],[-54.436022,2.210262],[-53.97432,2.232816],[-53.766666,2.379297],[-53.540102,2.257596],[-53.337633,2.353968],[-53.231104,2.269038],[-53.266912,2.169116],[-52.943625,2.169207],[-52.55407,2.516693],[-52.332621,3.172676],[-51.923717,3.783872],[-51.645939,4.044961],[-51.549021,4.424777],[-51.251546,4.191709],[-51.181678,4.008887]]]]}},{"type":"Feature","properties":{"name":"Bahia","uf":"BA","region":"Nordeste","diabeticos":"1.380 mil","prevalencia":"9,8%","amputacoes":"6.900","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-39.288197,-8.562901],[-39.233395,-8.705363],[-38.798427,-8.792369],[-38.670581,-8.974455],[-38.551072,-8.822309],[-38.46958,-8.865077],[-38.483023,-9.001073],[-38.295991,-9.02249],[-38.202893,-9.418237],[-37.998505,-9.497317],[-37.99726,-9.916292],[-37.831385,-10.0005],[-37.736156,-10.331607],[-37.858716,-10.426042],[-37.813529,-10.690617],[-37.999466,-10.763949],[-38.211549,-10.708731],[-38.229144,-10.915496],[-37.973964,-11.194839],[-37.977461,-11.39315],[-37.81335,-11.513874],[-37.517548,-11.547579],[-37.342503,-11.443448],[-38.049109,-12.634461],[-38.347479,-12.950453],[-38.488732,-13.014093],[-38.615855,-12.930842],[-38.96459,-13.283183],[-38.888232,-13.642959],[-38.997504,-13.74407],[-38.927587,-13.938912],[-39.065244,-14.705098],[-38.856339,-15.860115],[-39.017241,-16.252269],[-39.212599,-17.168154],[-39.135396,-17.687681],[-39.567193,-18.089973],[-39.670192,-18.348743],[-40.222017,-17.979948],[-40.223543,-17.733587],[-40.623079,-17.405503],[-40.490807,-16.884017],[-40.281248,-16.900711],[-40.257407,-16.80607],[-40.345099,-16.786795],[-40.275115,-16.573557],[-40.159458,-16.579837],[-39.856434,-16.113361],[-40.230469,-15.80329],[-40.561657,-15.802818],[-40.815248,-15.648014],[-40.961884,-15.648427],[-41.143847,-15.771365],[-41.330809,-15.744212],[-41.356026,-15.499831],[-41.800314,-15.100642],[-42.091227,-15.186151],[-42.172924,-15.085499],[-42.442519,-15.060152],[-42.93848,-14.707578],[-43.175946,-14.650098],[-43.530985,-14.814849],[-43.883097,-14.652781],[-43.782789,-14.338799],[-44.214657,-14.232851],[-44.56515,-14.339617],[-45.083056,-14.748568],[-45.205153,-14.744292],[-45.454708,-14.95327],[-45.565705,-14.944415],[-45.721392,-15.111625],[-45.953321,-15.13908],[-46.076651,-15.264229],[-46.118815,-15.191776],[-45.965653,-14.965196],[-46.052396,-14.830925],[-46.016355,-14.418867],[-45.906861,-14.352935],[-46.265352,-14.097523],[-46.209574,-14.012412],[-46.260326,-13.686802],[-46.161537,-13.590492],[-46.235072,-13.562471],[-46.242457,-13.429489],[-46.041136,-13.280447],[-46.315491,-13.302738],[-46.322236,-13.097851],[-46.113889,-12.917537],[-46.304358,-12.949443],[-46.279515,-12.584471],[-46.153544,-12.482796],[-46.254333,-12.492756],[-46.351964,-12.336976],[-46.397437,-12.039917],[-46.170841,-11.900564],[-46.374156,-11.868178],[-46.314531,-11.631832],[-46.082769,-11.635703],[-46.478886,-11.515971],[-46.616668,-11.289032],[-46.282995,-10.906335],[-46.210548,-10.649255],[-45.827299,-10.435545],[-45.69711,-10.263155],[-45.72247,-10.154896],[-45.602765,-10.107574],[-45.396019,-10.446486],[-45.435502,-10.61946],[-45.247635,-10.821551],[-44.930806,-10.928339],[-44.577371,-10.626353],[-44.335243,-10.548554],[-44.134086,-10.635817],[-43.661876,-10.003925],[-43.708637,-9.912808],[-43.652847,-9.838644],[-43.784519,-9.761973],[-43.849292,-9.547644],[-43.485058,-9.26488],[-43.278369,-9.424166],[-42.971497,-9.407654],[-42.945855,-9.518006],[-42.764775,-9.616339],[-42.24334,-9.28851],[-41.837579,-9.241864],[-41.72322,-9.013136],[-41.544135,-8.960144],[-41.38196,-8.708455],[-41.113256,-8.703597],[-41.02086,-8.843156],[-40.920958,-8.835043],[-40.803722,-9.09793],[-40.667025,-9.158669],[-40.776329,-9.454027],[-40.622789,-9.482496],[-40.334654,-9.353473],[-40.250327,-9.060099],[-40.12833,-9.109193],[-39.957648,-9.048202],[-39.894253,-8.831304],[-39.674206,-8.786663],[-39.690755,-8.661922],[-39.407827,-8.538226],[-39.288197,-8.562901]],[[-39.576153,-18.088199],[-39.576153,-18.088199]]]]}},{"type":"Feature","properties":{"name":"Ceará","uf":"CE","region":"Nordeste","diabeticos":"980 mil","prevalencia":"10,1%","amputacoes":"4.900","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-40.018043,-2.836985],[-39.252153,-3.221755],[-38.666507,-3.674369],[-38.471724,-3.707322],[-38.013328,-4.246088],[-37.592569,-4.625231],[-37.324909,-4.701287],[-37.251574,-4.832043],[-37.639945,-4.926029],[-37.901598,-5.497133],[-38.082335,-5.672168],[-38.04669,-5.730028],[-38.164332,-5.945699],[-38.304418,-6.086582],[-38.446934,-6.084893],[-38.578217,-6.279809],[-38.601666,-6.389237],[-38.517528,-6.408346],[-38.67277,-6.696831],[-38.613774,-6.782794],[-38.76462,-6.993504],[-38.66947,-7.047311],[-38.687448,-7.189766],[-38.534205,-7.293397],[-38.654944,-7.565145],[-38.965739,-7.84459],[-39.090918,-7.857785],[-39.135257,-7.722986],[-39.30651,-7.664686],[-39.317183,-7.540886],[-39.662188,-7.310208],[-40.24606,-7.433332],[-40.548081,-7.392315],[-40.37021,-6.802665],[-40.731554,-6.653683],[-40.906727,-6.041363],[-40.925133,-5.181109],[-41.248798,-4.868725],[-41.173903,-4.667095],[-41.242161,-4.571146],[-41.090514,-4.169968],[-41.114012,-4.040281],[-41.254308,-4.035393],[-41.219862,-3.941146],[-41.300438,-3.825942],[-41.239101,-3.712209],[-41.34137,-3.680416],[-41.370226,-3.566788],[-41.298837,-3.490666],[-41.423139,-3.367652],[-41.256275,-3.087663],[-41.322306,-2.920971],[-40.499423,-2.784096],[-40.018043,-2.836985]]],[[[-40.024638,-2.834113],[-40.024638,-2.834113]]]]}},{"type":"Feature","properties":{"name":"Espírito Santo","uf":"ES","region":"Sudeste","diabeticos":"580 mil","prevalencia":"11,2%","amputacoes":"2.900","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-40.723829,-20.841778],[-40.957184,-21.302959],[-41.09203,-21.218159],[-41.717586,-21.123331],[-41.711998,-20.871073],[-41.878559,-20.760272],[-41.799179,-20.477102],[-41.858371,-20.372478],[-41.756348,-20.206372],[-41.381706,-20.188318],[-41.307512,-19.947845],[-41.184476,-19.888469],[-41.168069,-19.671731],[-41.03643,-19.568302],[-41.045368,-19.487491],[-40.948926,-19.472666],[-40.907301,-19.308324],[-40.943795,-19.143892],[-41.065154,-19.050845],[-41.017966,-18.973054],[-41.241972,-18.853949],[-41.232142,-18.796794],[-40.916547,-18.814972],[-40.943239,-18.687094],[-41.052706,-18.628239],[-41.023539,-18.456692],[-41.181624,-18.438594],[-41.158438,-18.308275],[-41.055643,-18.166124],[-40.89271,-18.107399],[-40.771099,-18.155441],[-40.882317,-17.97007],[-40.70415,-18.022872],[-40.52664,-17.891464],[-40.222017,-17.979948],[-39.666461,-18.331853],[-39.749915,-18.841233],[-39.688553,-19.305828],[-39.807,-19.64766],[-39.983066,-19.738855],[-40.139262,-19.948668],[-40.423668,-20.63522],[-40.627279,-20.840849],[-40.645291,-20.78601],[-40.723829,-20.841778]],[[-40.526619,-20.655179],[-40.526619,-20.655179]],[[-40.536145,-20.685265],[-40.536145,-20.685265]]],[[[-40.474992,-20.660832],[-40.474992,-20.660832]]],[[[-40.724437,-20.846641],[-40.724437,-20.846641]]]]}},{"type":"Feature","properties":{"name":"Goiás","uf":"GO","region":"Centro-Oeste","diabeticos":"640 mil","prevalencia":"8,8%","amputacoes":"3.200","color":"#ffd60a"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-50.157762,-12.411952],[-50.299642,-12.680466],[-50.292184,-12.839493],[-49.369037,-13.274169],[-49.337012,-13.065866],[-49.118631,-12.789931],[-48.975176,-12.956771],[-48.846318,-12.809378],[-48.601652,-13.059894],[-48.58596,-13.317182],[-48.508419,-13.128422],[-48.441266,-13.291938],[-48.173492,-13.147675],[-48.164957,-13.305356],[-48.062013,-13.234968],[-47.823547,-13.311435],[-47.678542,-13.46728],[-47.63434,-13.104065],[-47.426534,-13.289007],[-46.750177,-12.968724],[-46.45422,-12.970722],[-46.417186,-12.823042],[-46.363444,-12.990788],[-46.113889,-12.917537],[-46.322236,-13.097851],[-46.278959,-13.347464],[-46.041136,-13.280447],[-46.242457,-13.429489],[-46.235072,-13.562471],[-46.161537,-13.590492],[-46.260326,-13.686802],[-46.209574,-14.012412],[-46.265352,-14.097523],[-45.906861,-14.352935],[-46.016355,-14.418867],[-46.007628,-14.792753],[-46.087711,-14.935946],[-46.286411,-14.9277],[-46.321767,-14.814134],[-46.502907,-14.703965],[-46.565456,-14.785928],[-46.50217,-15.05181],[-46.924283,-15.057868],[-46.940486,-15.22919],[-46.836466,-15.322149],[-46.948659,-15.554148],[-46.854352,-15.619905],[-46.811723,-15.885109],[-47.141512,-15.926185],[-47.31868,-16.036235],[-47.375757,-15.880252],[-47.31543,-15.593974],[-47.416906,-15.499863],[-48.197192,-15.500511],[-48.278674,-16.051101],[-47.30395,-16.060226],[-47.458136,-16.501765],[-47.249709,-16.666359],[-47.126161,-16.980106],[-47.35154,-17.166038],[-47.44034,-17.347241],[-47.511202,-17.331282],[-47.540735,-17.453844],[-47.266424,-17.608627],[-47.37261,-17.829485],[-47.282756,-18.057769],[-47.954481,-18.499815],[-48.261949,-18.331418],[-48.815893,-18.379193],[-48.93631,-18.305744],[-49.076574,-18.416316],[-49.205198,-18.411329],[-49.378284,-18.641881],[-49.53537,-18.493183],[-49.783217,-18.64088],[-50.016113,-18.599377],[-50.30888,-18.697987],[-50.508662,-18.936965],[-50.53704,-19.098939],[-50.816638,-19.289363],[-50.841692,-19.498685],[-51.087475,-19.307867],[-52.333625,-18.827785],[-52.44862,-18.690507],[-52.916123,-18.638707],[-52.961848,-18.540364],[-52.758375,-18.348349],[-53.100667,-18.309687],[-53.142735,-18.081387],[-53.069568,-17.986086],[-53.23784,-17.713691],[-53.246158,-17.531946],[-53.218139,-17.298858],[-53.010827,-16.85757],[-52.785484,-16.740745],[-52.738953,-16.589367],[-52.625653,-16.533003],[-52.681097,-16.303429],[-52.327268,-16.068151],[-52.252232,-15.892651],[-51.87912,-15.824951],[-51.699496,-15.484091],[-51.651614,-15.179438],[-51.535482,-15.069251],[-51.337318,-14.972935],[-51.242127,-15.03496],[-51.085531,-14.917279],[-50.962402,-14.526629],[-50.974791,-14.290422],[-50.917014,-14.114384],[-50.833177,-14.089412],[-50.871321,-13.73266],[-50.606737,-13.310428],[-50.610289,-13.062646],[-50.477597,-12.709527],[-50.157762,-12.411952]]]]}},{"type":"Feature","properties":{"name":"Maranhão","uf":"MA","region":"Nordeste","diabeticos":"620 mil","prevalencia":"9,5%","amputacoes":"3.100","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-47.031021,-8.98549],[-46.913022,-8.847427],[-46.915971,-8.595382],[-46.806408,-8.398576],[-46.54421,-8.318931],[-46.46619,-8.065802],[-46.604246,-7.895787],[-47.043074,-8.053196],[-47.504277,-7.436249],[-47.590437,-7.439154],[-47.485444,-7.366716],[-47.499355,-7.293472],[-47.648084,-7.302969],[-47.745785,-7.200837],[-47.529477,-6.976146],[-47.378389,-6.270479],[-47.49969,-5.525235],[-47.843325,-5.37584],[-47.885136,-5.260332],[-48.178105,-5.260407],[-48.36347,-5.168012],[-48.538579,-5.204547],[-48.605691,-5.336132],[-48.754713,-5.348801],[-47.789489,-4.585147],[-47.610681,-4.555974],[-47.372054,-4.244452],[-47.318469,-4.046564],[-47.08769,-3.855094],[-47.037359,-3.562529],[-46.679441,-3.09319],[-46.679228,-2.881383],[-46.575388,-2.841041],[-46.663524,-2.69385],[-46.415968,-2.529057],[-46.431918,-2.239473],[-46.280222,-2.152558],[-46.20959,-1.833459],[-46.32356,-1.765203],[-46.153206,-1.675556],[-46.150725,-1.224448],[-45.964677,-1.046262],[-45.948063,-1.238292],[-45.845856,-1.045085],[-45.907908,-1.176264],[-45.861357,-1.151206],[-45.859776,-1.283629],[-45.814136,-1.166235],[-45.839126,-1.283542],[-45.679563,-1.13781],[-45.745584,-1.237005],[-45.677577,-1.344425],[-45.718669,-1.403679],[-45.579919,-1.257056],[-45.551043,-1.3508],[-45.500622,-1.293634],[-45.518507,-1.411757],[-45.409746,-1.289303],[-45.488071,-1.431251],[-45.443181,-1.542735],[-45.448062,-1.44855],[-45.404808,-1.486914],[-45.317094,-1.317757],[-45.292582,-1.421274],[-45.387851,-1.481401],[-45.374376,-1.54899],[-45.297664,-1.494176],[-45.352397,-1.736272],[-45.309027,-1.600268],[-45.247573,-1.622345],[-45.14317,-1.462671],[-45.128603,-1.529149],[-45.101025,-1.360215],[-45.07831,-1.518439],[-44.815556,-1.417989],[-44.897584,-1.613394],[-44.821114,-1.574971],[-44.797829,-1.659171],[-44.697943,-1.552923],[-44.719367,-1.612353],[-44.677723,-1.563904],[-44.642346,-1.623917],[-44.783855,-1.670586],[-44.78744,-1.7499],[-44.696758,-1.737646],[-44.81366,-1.814537],[-44.593409,-1.743669],[-44.639096,-1.8574],[-44.529463,-1.837879],[-44.599249,-1.897009],[-44.48747,-1.944881],[-44.499196,-2.141422],[-44.395555,-2.213196],[-44.35553,-2.338767],[-44.412392,-2.412709],[-44.325584,-2.499677],[-44.022443,-2.397911],[-44.101168,-2.4643],[-43.958428,-2.481912],[-43.980142,-2.572756],[-43.614769,-2.219012],[-43.491542,-2.371156],[-43.184776,-2.373164],[-42.478749,-2.711717],[-41.823449,-2.718938],[-41.86511,-2.87453],[-41.796411,-2.966204],[-41.938667,-3.187008],[-42.115443,-3.261972],[-42.20399,-3.435414],[-42.497976,-3.447375],[-42.675365,-3.675239],[-42.725816,-3.909646],[-42.988804,-4.233691],[-42.85005,-4.480991],[-42.949395,-4.790325],[-42.797558,-5.182848],[-42.825925,-5.346574],[-43.098607,-5.632817],[-43.074595,-6.054348],[-42.828943,-6.337041],[-42.919385,-6.669924],[-43.000776,-6.754076],[-43.419644,-6.843448],[-43.715621,-6.698807],[-44.032993,-6.76002],[-44.305797,-7.116782],[-44.563663,-7.227144],[-44.687572,-7.394145],[-44.816324,-7.360815],[-44.924034,-7.4699],[-45.455584,-7.670276],[-45.765218,-8.609179],[-45.993873,-8.926466],[-45.893256,-9.341779],[-45.783406,-9.479703],[-45.945953,-10.258155],[-46.027854,-10.17646],[-46.367463,-10.168403],[-46.49322,-9.827016],[-46.646991,-9.729945],[-46.560548,-9.483629],[-46.762939,-9.40855],[-46.92223,-9.0663],[-47.068303,-9.063475],[-47.031021,-8.98549]],[[-44.813378,-1.802112],[-44.813378,-1.802112]],[[-44.569338,-1.919747],[-44.569338,-1.919747]],[[-45.74672,-1.37203],[-45.74672,-1.37203]],[[-45.887523,-1.18035],[-45.887523,-1.18035]],[[-45.822442,-1.310566],[-45.822442,-1.310566]],[[-44.693307,-1.816271],[-44.693307,-1.816271]],[[-45.389812,-1.68975],[-45.389812,-1.68975]],[[-44.800955,-1.626302],[-44.800955,-1.626302]],[[-45.127825,-1.543968],[-45.127825,-1.543968]],[[-45.822986,-1.248629],[-45.822986,-1.248629]],[[-45.575672,-1.335734],[-45.575672,-1.335734]],[[-45.7995,-1.331501],[-45.7995,-1.331501]],[[-44.834212,-1.822641],[-44.834212,-1.822641]],[[-45.36857,-1.43638],[-45.36857,-1.43638]],[[-45.905415,-1.240259],[-45.905415,-1.240259]],[[-45.594841,-1.339187],[-45.594841,-1.339187]],[[-45.392395,-1.564463],[-45.392395,-1.564463]]],[[[-44.97077,-1.344386],[-44.963442,-1.277598],[-44.842263,-1.333955],[-44.98279,-1.409302],[-45.02802,-1.338557],[-44.97077,-1.344386]],[[-44.924278,-1.339253],[-44.924278,-1.339253]],[[-44.909326,-1.325444],[-44.909326,-1.325444]]],[[[-45.677976,-1.300212],[-45.615549,-1.115555],[-45.641063,-1.355685],[-45.677976,-1.300212]],[[-45.659412,-1.296955],[-45.659412,-1.296955]]],[[[-44.801813,-1.529242],[-44.763368,-1.48391],[-44.801813,-1.529242]]],[[[-44.774421,-1.527162],[-44.753019,-1.457771],[-44.774421,-1.527162]]],[[[-45.685207,-1.19606],[-45.683,-1.26168],[-45.685207,-1.19606]]],[[[-45.541913,-1.195021],[-45.592885,-1.246324],[-45.541913,-1.195021]]],[[[-44.617213,-1.791267],[-44.617213,-1.791267]]],[[[-44.728811,-1.562094],[-44.728811,-1.562094]]],[[[-45.798437,-1.126644],[-45.798437,-1.126644]]],[[[-45.794195,-1.188348],[-45.794195,-1.188348]]],[[[-45.55761,-1.328899],[-45.55761,-1.328899]]],[[[-45.090045,-1.41925],[-45.068567,-1.367478],[-45.090045,-1.41925]]],[[[-45.096906,-1.468196],[-45.096906,-1.468196]]],[[[-45.036117,-1.390365],[-45.036117,-1.390365]]],[[[-44.749242,-1.692028],[-44.749242,-1.692028]]],[[[-45.685098,-1.296817],[-45.685098,-1.296817]]],[[[-44.46838,-2.075885],[-44.46838,-2.075885]]],[[[-44.480207,-2.106097],[-44.480207,-2.106097]]],[[[-45.397623,-1.395383],[-45.397623,-1.395383]]],[[[-45.071731,-1.446252],[-45.071731,-1.446252]]],[[[-44.722809,-1.661879],[-44.722809,-1.661879]]],[[[-44.445095,-2.025063],[-44.445095,-2.025063]]],[[[-44.622565,-1.812089],[-44.622565,-1.812089]]],[[[-45.089187,-1.431686],[-45.089187,-1.431686]]],[[[-45.515138,-1.406052],[-45.515138,-1.406052]]],[[[-45.047764,-1.327364],[-45.047764,-1.327364]]],[[[-45.790641,-1.247342],[-45.790641,-1.247342]]],[[[-45.002047,-1.40122],[-45.002047,-1.40122]]],[[[-44.613755,-1.830106],[-44.613755,-1.830106]]],[[[-45.626304,-1.318555],[-45.626304,-1.318555]]],[[[-44.830968,-1.56042],[-44.830968,-1.56042]]],[[[-45.561853,-1.260879],[-45.561853,-1.260879]]],[[[-42.750055,-2.544329],[-42.750055,-2.544329]]],[[[-44.00926,-2.399591],[-44.00926,-2.399591]]],[[[-44.611386,-1.784215],[-44.611386,-1.784215]]],[[[-45.640329,-1.31059],[-45.640329,-1.31059]]],[[[-45.653755,-1.361002],[-45.653755,-1.361002]]],[[[-45.641958,-1.247054],[-45.641958,-1.247054]]],[[[-44.016162,-2.399002],[-44.016162,-2.399002]]],[[[-45.139127,-1.46854],[-45.139127,-1.46854]]],[[[-44.775734,-1.568849],[-44.775734,-1.568849]]],[[[-44.875674,-1.339903],[-44.875674,-1.339903]]],[[[-45.040618,-1.392734],[-45.040618,-1.392734]]],[[[-45.135795,-1.488631],[-45.135795,-1.488631]]],[[[-44.45765,-2.13373],[-44.45765,-2.13373]]],[[[-45.815989,-1.258576],[-45.815989,-1.258576]]],[[[-47.031325,-8.98013],[-47.031325,-8.98013]]],[[[-45.1083,-1.4003],[-45.1083,-1.4003]]],[[[-45.11103,-1.390738],[-45.11103,-1.390738]]],[[[-45.558671,-1.2604],[-45.558671,-1.2604]]],[[[-44.756861,-1.592813],[-44.756861,-1.592813]]],[[[-45.76409,-1.187979],[-45.76409,-1.187979]]]]}},{"type":"Feature","properties":{"name":"Minas Gerais","uf":"MG","region":"Sudeste","diabeticos":"1.850 mil","prevalencia":"11,4%","amputacoes":"9.250","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-44.208858,-14.244127],[-43.782789,-14.338799],[-43.883097,-14.652781],[-43.530985,-14.814849],[-43.175946,-14.650098],[-42.93848,-14.707578],[-42.442519,-15.060152],[-42.172924,-15.085499],[-42.091227,-15.186151],[-41.800314,-15.100642],[-41.356026,-15.499831],[-41.330809,-15.744212],[-41.143847,-15.771365],[-40.961884,-15.648427],[-40.767278,-15.713612],[-40.706817,-15.665945],[-40.561657,-15.802818],[-40.230469,-15.80329],[-39.856434,-16.113361],[-40.159458,-16.579837],[-40.275115,-16.573557],[-40.345099,-16.786795],[-40.257407,-16.80607],[-40.281248,-16.900711],[-40.479596,-16.876351],[-40.569629,-17.06143],[-40.547353,-17.283229],[-40.623079,-17.405503],[-40.223543,-17.733587],[-40.222017,-17.979948],[-40.52664,-17.891464],[-40.70415,-18.022872],[-40.882317,-17.97007],[-40.771099,-18.155441],[-40.89271,-18.107399],[-41.055643,-18.166124],[-41.158438,-18.308275],[-41.181624,-18.438594],[-41.023539,-18.456692],[-41.052706,-18.628239],[-40.943239,-18.687094],[-40.916547,-18.814972],[-41.232142,-18.796794],[-41.241972,-18.853949],[-41.017966,-18.973054],[-41.071387,-19.023361],[-40.926336,-19.188793],[-40.94447,-19.459626],[-41.168069,-19.671731],[-41.184476,-19.888469],[-41.307512,-19.947845],[-41.381706,-20.188318],[-41.756348,-20.206372],[-41.846733,-20.328993],[-41.808382,-20.643747],[-41.976257,-20.935011],[-42.151261,-20.973889],[-42.080057,-21.035198],[-42.20808,-21.177719],[-42.252349,-21.489779],[-42.368575,-21.619118],[-42.271127,-21.714706],[-43.072998,-22.093352],[-43.246126,-22.006538],[-43.76557,-22.062424],[-44.235046,-22.265704],[-44.456015,-22.256748],[-45.090681,-22.482598],[-45.394893,-22.651422],[-45.471344,-22.590023],[-45.664559,-22.650157],[-45.716467,-22.5781],[-45.693546,-22.651209],[-45.819423,-22.722059],[-45.72783,-22.72317],[-45.713135,-22.814285],[-45.790825,-22.857636],[-45.909433,-22.816785],[-46.138633,-22.922257],[-46.14419,-22.857802],[-46.344771,-22.904182],[-46.334763,-22.759699],[-46.477479,-22.698898],[-46.392603,-22.662476],[-46.406688,-22.540048],[-46.666102,-22.413897],[-46.722804,-22.306125],[-46.600063,-22.134254],[-46.722808,-22.07652],[-46.613023,-22.009113],[-46.690506,-21.836456],[-46.517102,-21.611396],[-46.508802,-21.469408],[-46.665248,-21.36116],[-47.010779,-21.421805],[-47.143268,-20.981899],[-47.239588,-20.884798],[-47.096922,-20.643854],[-47.291328,-20.448829],[-47.256588,-20.165722],[-47.465923,-19.963742],[-47.635516,-20.047902],[-47.703779,-19.979426],[-47.859325,-19.992516],[-47.893921,-20.123355],[-47.975508,-20.034894],[-48.111617,-20.143418],[-48.240484,-20.028873],[-48.24591,-20.140474],[-48.822743,-20.161432],[-48.898861,-20.440723],[-48.968425,-20.393266],[-48.991778,-20.164918],[-49.217187,-20.303227],[-49.308059,-20.101506],[-49.25025,-19.97033],[-49.550991,-19.905373],[-49.890804,-19.94325],[-50.471424,-19.779185],[-50.999985,-20.084914],[-51.045455,-19.728584],[-50.922642,-19.575596],[-50.96198,-19.484409],[-50.826205,-19.487001],[-50.87487,-19.42237],[-50.816638,-19.289363],[-50.53704,-19.098939],[-50.508662,-18.936965],[-50.30888,-18.697987],[-50.016113,-18.599377],[-49.783217,-18.64088],[-49.53537,-18.493183],[-49.378284,-18.641881],[-49.205198,-18.411329],[-49.076574,-18.416316],[-48.93631,-18.305744],[-48.815893,-18.379193],[-48.261949,-18.331418],[-47.954481,-18.499815],[-47.282756,-18.057769],[-47.37261,-17.829485],[-47.266424,-17.608627],[-47.330481,-17.524378],[-47.495403,-17.524838],[-47.538375,-17.388339],[-47.126161,-16.980106],[-47.249709,-16.666359],[-47.458136,-16.501765],[-47.300057,-16.0166],[-46.811723,-15.885109],[-46.854352,-15.619905],[-46.948659,-15.554148],[-46.836466,-15.322149],[-46.940486,-15.22919],[-46.918317,-15.049421],[-46.50217,-15.05181],[-46.565456,-14.785928],[-46.47447,-14.704739],[-46.286411,-14.9277],[-46.003447,-14.901848],[-45.975092,-15.038462],[-46.118815,-15.191776],[-46.052203,-15.258742],[-45.953321,-15.13908],[-45.721392,-15.111625],[-45.205153,-14.744292],[-45.083056,-14.748568],[-44.56515,-14.339617],[-44.208858,-14.244127]]]]}},{"type":"Feature","properties":{"name":"Mato Grosso do Sul","uf":"MS","region":"Centro-Oeste","diabeticos":"340 mil","prevalencia":"8,6%","amputacoes":"1.700","color":"#ffd60a"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-53.874059,-17.921778],[-53.691681,-18.013226],[-53.071484,-18.039018],[-53.142735,-18.081387],[-53.069433,-18.342428],[-52.758375,-18.348349],[-52.961848,-18.540364],[-52.916123,-18.638707],[-52.530758,-18.657565],[-52.015101,-18.98232],[-51.057341,-19.32898],[-50.923679,-19.558151],[-51.045455,-19.728584],[-51.001363,-20.095808],[-51.068671,-20.249579],[-51.342903,-20.355342],[-51.586467,-20.63433],[-51.61849,-20.93195],[-51.875362,-21.135676],[-51.867191,-21.351186],[-51.967399,-21.501288],[-52.077285,-21.514747],[-52.075978,-21.714378],[-52.407678,-22.141158],[-53.6069,-22.950856],[-53.730098,-23.317225],[-53.982333,-23.459527],[-54.129176,-23.981628],[-54.287104,-24.06951],[-54.436737,-23.906147],[-54.670806,-23.811711],[-54.939554,-23.963347],[-55.347445,-23.994038],[-55.431577,-23.94084],[-55.43425,-23.717281],[-55.536545,-23.625473],[-55.523329,-23.196523],[-55.596666,-23.152081],[-55.664853,-22.850607],[-55.614791,-22.655694],[-55.848721,-22.283705],[-56.209411,-22.276399],[-56.392318,-22.074254],[-56.501759,-22.095315],[-56.63499,-22.262378],[-56.701855,-22.218357],[-56.841153,-22.302007],[-56.996383,-22.222806],[-57.372214,-22.231129],[-57.576254,-22.175345],[-57.612416,-22.094478],[-57.802267,-22.150053],[-57.991276,-22.090252],[-57.881898,-21.688112],[-57.966222,-21.525029],[-57.854037,-21.338328],[-57.920511,-21.279483],[-57.849551,-21.219336],[-57.818828,-20.942133],[-57.927699,-20.897513],[-57.858971,-20.826363],[-57.959874,-20.788999],[-57.862474,-20.741218],[-57.919256,-20.66366],[-57.984592,-20.701208],[-57.996433,-20.434807],[-58.166806,-20.171292],[-57.858701,-19.969935],[-58.131162,-19.757998],[-57.783548,-19.033015],[-57.693622,-19.010418],[-57.766025,-18.89879],[-57.557122,-18.239851],[-57.453292,-18.230674],[-57.57422,-18.131396],[-57.794963,-17.559944],[-57.711544,-17.543665],[-57.683769,-17.715201],[-57.451931,-17.902203],[-57.04438,-17.729882],[-56.733322,-17.309422],[-56.442799,-17.330273],[-56.112591,-17.166756],[-55.640763,-17.338967],[-55.523567,-17.480734],[-55.126737,-17.652278],[-54.86035,-17.623409],[-54.581152,-17.467562],[-54.301909,-17.661214],[-54.076527,-17.614564],[-54.037121,-17.485997],[-53.70815,-17.227724],[-53.705649,-17.661944],[-53.887873,-17.748545],[-53.955241,-17.882572],[-53.874059,-17.921778]]],[[[-53.872177,-17.916416],[-53.872177,-17.916416]]]]}},{"type":"Feature","properties":{"name":"Mato Grosso","uf":"MT","region":"Centro-Oeste","diabeticos":"380 mil","prevalencia":"8,7%","amputacoes":"1.900","color":"#ffd60a"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-60.360833,-13.299324],[-60.282449,-13.080147],[-60.085994,-12.8983],[-60.068196,-12.615595],[-59.773813,-12.340553],[-59.891778,-12.245054],[-59.984634,-11.913945],[-60.108231,-11.839182],[-60.114345,-11.591064],[-59.920097,-11.397613],[-59.976238,-11.121993],[-60.30071,-11.056758],[-60.347429,-11.108644],[-60.459516,-10.989463],[-61.549712,-10.985703],[-61.461237,-10.41952],[-61.59965,-10.154439],[-61.507378,-9.860696],[-61.573828,-9.71728],[-61.477057,-9.626913],[-61.632006,-9.266243],[-61.525876,-9.243674],[-61.554402,-9.089868],[-61.468111,-8.917145],[-61.582423,-8.79831],[-58.415355,-8.792461],[-58.325551,-8.719611],[-58.436896,-8.703034],[-58.286495,-8.128132],[-58.382425,-7.838707],[-58.201587,-7.620545],[-58.137919,-7.34866],[-57.972062,-7.534213],[-57.828313,-7.972516],[-57.642751,-8.213293],[-57.686332,-8.413677],[-57.592418,-8.756092],[-57.192341,-8.929666],[-57.038728,-9.097904],[-57.057311,-9.183803],[-56.819594,-9.245953],[-56.760595,-9.404609],[-50.224346,-9.840752],[-50.602989,-10.660528],[-50.608993,-11.067047],[-50.738781,-11.43495],[-50.65606,-11.600417],[-50.721575,-11.739285],[-50.638822,-11.884152],[-50.686406,-12.201735],[-50.617789,-12.428571],[-50.706022,-12.609279],[-50.622263,-12.819312],[-50.501768,-12.88391],[-50.610289,-13.062646],[-50.606737,-13.310428],[-50.871321,-13.73266],[-50.833177,-14.089412],[-50.917014,-14.114384],[-50.974791,-14.290422],[-50.962402,-14.526629],[-51.085531,-14.917279],[-51.242127,-15.03496],[-51.337318,-14.972935],[-51.535482,-15.069251],[-51.651614,-15.179438],[-51.699496,-15.484091],[-51.87912,-15.824951],[-52.252232,-15.892651],[-52.327268,-16.068151],[-52.681097,-16.303429],[-52.635262,-16.551188],[-52.738953,-16.589367],[-52.785484,-16.740745],[-53.010827,-16.85757],[-53.218139,-17.298858],[-53.246376,-17.690234],[-53.071484,-18.039018],[-53.691681,-18.013226],[-53.948407,-17.922976],[-53.855399,-17.702269],[-53.705649,-17.661944],[-53.70815,-17.227724],[-54.037121,-17.485997],[-54.084184,-17.618589],[-54.335071,-17.661278],[-54.581152,-17.467562],[-54.86035,-17.623409],[-55.126737,-17.652278],[-55.523567,-17.480734],[-55.640763,-17.338967],[-56.112591,-17.166756],[-56.442799,-17.330273],[-56.733322,-17.309422],[-57.04438,-17.729882],[-57.451931,-17.902203],[-57.683769,-17.715201],[-57.727517,-17.529311],[-57.883044,-17.449215],[-58.042741,-17.492183],[-58.394895,-17.183657],[-58.469858,-16.703149],[-58.333051,-16.489507],[-58.320661,-16.264235],[-58.429683,-16.320738],[-60.171006,-16.265216],[-60.237945,-15.473381],[-60.564259,-15.108196],[-60.243662,-15.0963],[-60.271537,-14.619837],[-60.48944,-14.188363],[-60.381385,-13.986968],[-60.466579,-13.795243],[-60.716263,-13.68181],[-60.387376,-13.454285],[-60.360833,-13.299324]]],[[[-60.362687,-13.296129],[-60.362687,-13.296129]]]]}},{"type":"Feature","properties":{"name":"Pará","uf":"PA","region":"Norte","diabeticos":"590 mil","prevalencia":"8,7%","amputacoes":"2.950","color":"#52b788"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-46.951454,-0.73406],[-46.955423,-0.86079],[-46.845166,-0.735447],[-46.850245,-0.863957],[-46.788491,-0.899968],[-46.765901,-0.817191],[-46.745884,-0.920073],[-46.63769,-0.787938],[-46.674917,-0.975897],[-46.550613,-0.903612],[-46.536731,-0.977264],[-46.426579,-0.857578],[-46.499647,-0.972936],[-46.42833,-1.065057],[-46.390025,-0.986811],[-46.305111,-1.083947],[-46.264537,-0.917438],[-46.189691,-0.894066],[-46.272384,-1.171592],[-46.17117,-0.992504],[-46.172298,-1.155121],[-46.072494,-1.018516],[-46.162483,-1.277969],[-46.103838,-1.336605],[-46.176215,-1.475021],[-46.153206,-1.675556],[-46.32356,-1.765203],[-46.20959,-1.833459],[-46.280222,-2.152558],[-46.431918,-2.239473],[-46.415968,-2.529057],[-46.663524,-2.69385],[-46.575388,-2.841041],[-46.679228,-2.881383],[-46.679441,-3.09319],[-47.037359,-3.562529],[-47.08769,-3.855094],[-47.318469,-4.046564],[-47.581044,-4.519572],[-47.67951,-4.608241],[-47.789489,-4.585147],[-48.754713,-5.348801],[-48.590917,-5.421375],[-48.384303,-5.393838],[-48.137715,-5.60232],[-48.173878,-5.708844],[-48.294112,-5.756302],[-48.231193,-5.945764],[-48.334277,-6.003902],[-48.291684,-6.103692],[-48.431498,-6.176918],[-48.382239,-6.379232],[-48.499774,-6.350551],[-48.612713,-6.453351],[-48.664412,-6.662383],[-49.20905,-6.92502],[-49.184836,-7.234789],[-49.383604,-7.543108],[-49.150136,-7.80181],[-49.215405,-8.193821],[-49.591958,-8.839096],[-49.744634,-8.905768],[-50.03733,-9.289006],[-50.224346,-9.840752],[-56.753757,-9.405974],[-56.819594,-9.245953],[-57.057311,-9.183803],[-57.038728,-9.097904],[-57.192341,-8.929666],[-57.592418,-8.756092],[-57.686332,-8.413677],[-57.642751,-8.213293],[-57.828313,-7.972516],[-57.897626,-7.675645],[-58.169486,-7.312848],[-58.209,-7.133889],[-58.434032,-6.908436],[-58.477949,-6.699242],[-58.262031,-6.468555],[-56.401654,-2.456277],[-56.46509,-2.422775],[-56.098136,-2.026721],[-56.678565,-2.212225],[-56.768032,-2.165412],[-56.734026,-2.021675],[-57.036699,-1.911216],[-57.16439,-1.720534],[-57.392176,-1.722738],[-57.959836,-1.40124],[-58.01703,-1.105819],[-58.162129,-1.229325],[-58.429563,-1.026786],[-58.435532,-0.883137],[-58.704659,-0.678644],[-58.724697,-0.441895],[-58.871545,-0.342665],[-58.894945,1.228228],[-58.82061,1.171512],[-58.704891,1.294114],[-58.495734,1.26844],[-58.508204,1.463278],[-58.385099,1.470425],[-58.321878,1.597452],[-58.003746,1.503541],[-57.989467,1.659704],[-57.774243,1.729692],[-57.537135,1.70097],[-57.304317,1.999631],[-57.230489,1.938406],[-57.08611,2.028142],[-57.01368,1.915384],[-56.790787,1.852932],[-56.450686,1.956653],[-55.955976,1.845104],[-55.90252,2.041604],[-56.13831,2.266264],[-56.089445,2.372862],[-56.021256,2.343035],[-55.977581,2.527837],[-55.717271,2.402475],[-55.384796,2.418866],[-55.319683,2.515833],[-54.953708,2.584086],[-54.76262,2.202624],[-54.81234,2.06312],[-54.744288,1.776109],[-54.308816,1.74136],[-54.143178,1.640923],[-54.08598,1.488609],[-54.008564,1.519977],[-53.849856,1.392152],[-53.649819,1.408565],[-53.650483,1.336535],[-53.538067,1.341175],[-53.535535,1.212585],[-53.42604,1.243034],[-53.411014,0.92966],[-53.105819,0.6843],[-53.174834,0.382038],[-52.933229,-0.139195],[-52.689648,-0.302593],[-52.639535,-0.584576],[-52.522704,-0.588746],[-52.538185,-0.854477],[-52.402686,-0.876817],[-52.426566,-1.050463],[-52.119791,-1.145867],[-52.099932,-1.226163],[-51.984865,-1.121114],[-51.808628,-1.156769],[-51.703871,-1.067409],[-51.67874,-0.784922],[-51.2159,-0.11829],[-50.667739,0.185354],[-50.436091,0.600423],[-50.156987,0.70543],[-50.040352,0.573856],[-50.0608,0.338753],[-49.677186,0.366293],[-49.396517,0.016074],[-48.930268,-0.225598],[-48.411823,-0.25691],[-48.472118,-0.498754],[-47.989322,-0.705722],[-47.897163,-0.552474],[-47.840546,-0.679886],[-47.814405,-0.560839],[-47.767092,-0.637269],[-47.70349,-0.534923],[-47.626024,-0.700966],[-47.541945,-0.604323],[-47.487638,-0.764604],[-47.443907,-0.588893],[-47.42512,-0.655008],[-47.322076,-0.593842],[-47.212107,-0.63721],[-47.243292,-0.706864],[-47.160609,-0.667422],[-47.16969,-0.776182],[-47.088272,-0.662312],[-47.057276,-0.805873],[-47.040689,-0.728985],[-46.951454,-0.73406]]],[[[-46.401363,-0.952301],[-46.401363,-0.952301]]],[[[-46.075076,-1.066854],[-46.075076,-1.066854]]],[[[-47.034094,-0.695061],[-47.034094,-0.695061]]],[[[-46.375097,-0.995855],[-46.375097,-0.995855]]],[[[-47.843037,-0.662354],[-47.843037,-0.662354]]],[[[-46.444238,-1.009881],[-46.444238,-1.009881]]],[[[-46.326679,-0.95029],[-46.326679,-0.95029]]],[[[-46.607768,-0.830816],[-46.607768,-0.830816]]],[[[-46.608153,-0.8589],[-46.608153,-0.8589]]],[[[-47.034742,-0.720384],[-47.034742,-0.720384]]],[[[-46.467967,-0.963936],[-46.467967,-0.963936]]],[[[-46.20639,-0.940794],[-46.20639,-0.940794]]],[[[-46.954245,-0.740374],[-46.954245,-0.740374]]],[[[-47.021708,-0.715428],[-47.021708,-0.715428]]],[[[-46.270059,-0.933488],[-46.270059,-0.933488]]]]}},{"type":"Feature","properties":{"name":"Paraíba","uf":"PB","region":"Nordeste","diabeticos":"420 mil","prevalencia":"10,0%","amputacoes":"2.100","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-37.226774,-6.034636],[-37.156526,-6.152054],[-37.37692,-6.343988],[-37.4843,-6.709643],[-37.283311,-6.69352],[-37.234195,-6.82424],[-37.001796,-6.709172],[-36.956723,-6.79008],[-36.834611,-6.730674],[-36.729776,-6.835996],[-36.718142,-6.982333],[-36.506515,-6.812625],[-36.524114,-6.599256],[-36.435425,-6.625481],[-36.52875,-6.446724],[-36.39413,-6.29358],[-36.279444,-6.308456],[-36.249331,-6.436963],[-36.079565,-6.404793],[-35.977186,-6.488506],[-35.657922,-6.445571],[-35.169792,-6.557986],[-34.970505,-6.484991],[-34.793112,-7.154081],[-34.825666,-7.547367],[-34.960248,-7.538346],[-35.079369,-7.396621],[-35.478965,-7.444647],[-35.532311,-7.654416],[-35.99758,-7.812906],[-36.216233,-7.763732],[-36.263059,-7.831329],[-36.42361,-7.81537],[-36.445303,-7.915306],[-36.610859,-7.94775],[-36.62817,-8.110641],[-36.99074,-8.302552],[-37.16319,-8.165366],[-37.192267,-7.960197],[-37.355461,-7.974525],[-37.151544,-7.779445],[-37.167536,-7.581462],[-36.983824,-7.481724],[-37.23253,-7.274732],[-37.496522,-7.367137],[-37.738356,-7.659808],[-37.858093,-7.653228],[-38.076734,-7.830163],[-38.163636,-7.779548],[-38.286401,-7.829822],[-38.357099,-7.676781],[-38.593231,-7.753951],[-38.717917,-7.608957],[-38.534205,-7.293397],[-38.687448,-7.189766],[-38.66947,-7.047311],[-38.76462,-6.993504],[-38.613774,-6.782794],[-38.67277,-6.696831],[-38.517528,-6.408346],[-38.601666,-6.389237],[-38.45723,-6.329322],[-38.48585,-6.398363],[-38.115253,-6.521298],[-37.757271,-6.290385],[-37.74881,-6.193441],[-37.226774,-6.034636]]],[[[-34.861633,-6.982025],[-34.861633,-6.982025]]]]}},{"type":"Feature","properties":{"name":"Pernambuco","uf":"PE","region":"Nordeste","diabeticos":"820 mil","prevalencia":"10,3%","amputacoes":"4.100","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-37.176537,-7.309168],[-36.983824,-7.481724],[-37.167536,-7.581462],[-37.151544,-7.779445],[-37.355461,-7.974525],[-37.192267,-7.960197],[-37.16319,-8.165366],[-36.99074,-8.302552],[-36.62817,-8.110641],[-36.610859,-7.94775],[-36.445303,-7.915306],[-36.42361,-7.81537],[-36.263059,-7.831329],[-36.216233,-7.763732],[-35.99758,-7.812906],[-35.532311,-7.654416],[-35.478965,-7.444647],[-35.079369,-7.396621],[-34.960248,-7.538346],[-34.839815,-7.54331],[-34.837298,-8.00571],[-35.152043,-8.912951],[-35.467076,-8.814569],[-35.747919,-8.916723],[-35.895731,-8.853841],[-36.126455,-8.955591],[-36.111033,-9.017249],[-36.266392,-9.101956],[-36.224498,-9.170589],[-36.603786,-9.340622],[-36.867795,-9.268107],[-36.952008,-9.38212],[-37.105852,-9.239376],[-37.23392,-9.239747],[-37.48985,-8.965277],[-37.698445,-8.992052],[-37.759906,-8.857214],[-37.978946,-9.147961],[-38.237084,-9.329271],[-38.295991,-9.02249],[-38.483023,-9.001073],[-38.47945,-8.849688],[-38.570844,-8.831192],[-38.640324,-8.986867],[-38.798427,-8.792369],[-39.22347,-8.710925],[-39.282291,-8.567706],[-39.383353,-8.533223],[-39.690755,-8.661922],[-39.691468,-8.79681],[-39.894253,-8.831304],[-39.957648,-9.048202],[-40.12833,-9.109193],[-40.250327,-9.060099],[-40.334654,-9.353473],[-40.622789,-9.482496],[-40.776329,-9.454027],[-40.667025,-9.158669],[-40.819607,-9.079993],[-40.920958,-8.835043],[-41.02086,-8.843156],[-41.113256,-8.703597],[-41.357936,-8.707229],[-40.589405,-8.137576],[-40.54336,-7.835174],[-40.673179,-7.761288],[-40.712873,-7.472851],[-40.548081,-7.392315],[-40.24606,-7.433332],[-39.662188,-7.310208],[-39.317183,-7.540886],[-39.30651,-7.664686],[-39.135257,-7.722986],[-39.090918,-7.857785],[-38.965739,-7.84459],[-38.714717,-7.62152],[-38.593231,-7.753951],[-38.357099,-7.676781],[-38.286401,-7.829822],[-38.163636,-7.779548],[-38.076734,-7.830163],[-37.858093,-7.653228],[-37.738356,-7.659808],[-37.496522,-7.367137],[-37.275612,-7.274693],[-37.176537,-7.309168]]],[[[-32.407145,-3.837767],[-32.467645,-3.87736],[-32.407145,-3.837767]]],[[[-32.400572,-3.836927],[-32.400572,-3.836927]]]]}},{"type":"Feature","properties":{"name":"Piauí","uf":"PI","region":"Nordeste","diabeticos":"380 mil","prevalencia":"9,3%","amputacoes":"1.900","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-41.738679,-2.805583],[-41.59311,-2.90514],[-41.322306,-2.920971],[-41.25675,-3.004292],[-41.423139,-3.367652],[-41.298837,-3.490666],[-41.370226,-3.566788],[-41.34137,-3.680416],[-41.239101,-3.712209],[-41.300438,-3.825942],[-41.219862,-3.941146],[-41.254308,-4.035393],[-41.114012,-4.040281],[-41.090514,-4.169968],[-41.242161,-4.571146],[-41.173903,-4.667095],[-41.248798,-4.868725],[-40.925133,-5.181109],[-40.906727,-6.041363],[-40.731554,-6.653683],[-40.37021,-6.802665],[-40.548081,-7.392315],[-40.712873,-7.472851],[-40.673179,-7.761288],[-40.54336,-7.835174],[-40.589405,-8.137576],[-40.926341,-8.445836],[-40.999806,-8.400252],[-41.216972,-8.645135],[-41.38196,-8.708455],[-41.544135,-8.960144],[-41.72322,-9.013136],[-41.837579,-9.241864],[-42.24334,-9.28851],[-42.764775,-9.616339],[-42.945855,-9.518006],[-42.971497,-9.407654],[-43.278369,-9.424166],[-43.485058,-9.26488],[-43.849292,-9.547644],[-43.784519,-9.761973],[-43.652847,-9.838644],[-43.708637,-9.912808],[-43.661876,-10.003925],[-44.129818,-10.632552],[-44.335243,-10.548554],[-44.577371,-10.626353],[-44.930806,-10.928339],[-45.247635,-10.821551],[-45.435502,-10.61946],[-45.396019,-10.446486],[-45.578933,-10.121524],[-45.726219,-10.156444],[-45.793325,-10.267263],[-45.954872,-10.218032],[-45.878121,-10.10989],[-45.783406,-9.479703],[-45.893256,-9.341779],[-45.993873,-8.926466],[-45.765218,-8.609179],[-45.496078,-7.749908],[-45.339354,-7.579855],[-44.924034,-7.4699],[-44.816324,-7.360815],[-44.687572,-7.394145],[-44.563663,-7.227144],[-44.305797,-7.116782],[-44.052969,-6.767926],[-43.715621,-6.698807],[-43.419644,-6.843448],[-43.000776,-6.754076],[-42.919385,-6.669924],[-42.828943,-6.337041],[-43.074595,-6.054348],[-43.098607,-5.632817],[-42.825925,-5.346574],[-42.797558,-5.182848],[-42.949395,-4.790325],[-42.85005,-4.480991],[-42.988804,-4.233691],[-42.725816,-3.909646],[-42.675365,-3.675239],[-42.497976,-3.447375],[-42.20399,-3.435414],[-42.134798,-3.280556],[-41.999839,-3.240734],[-41.823894,-3.024143],[-41.848666,-2.773167],[-41.738679,-2.805583]]]]}},{"type":"Feature","properties":{"name":"Paraná","uf":"PR","region":"Sul","diabeticos":"1.120 mil","prevalencia":"9,8%","amputacoes":"5.600","color":"#d62828"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-52.064157,-22.533836],[-51.559066,-22.696696],[-51.263287,-22.66857],[-50.890392,-22.795326],[-50.741095,-22.960908],[-50.661794,-22.895208],[-50.182844,-22.95327],[-49.985672,-22.897021],[-49.911112,-23.050628],[-49.726584,-23.107902],[-49.566613,-23.426741],[-49.628701,-23.51174],[-49.549358,-23.703227],[-49.610245,-23.851198],[-49.200279,-24.343974],[-49.304824,-24.672141],[-48.581366,-24.671118],[-48.498829,-24.73846],[-48.597454,-25.002828],[-48.555859,-25.083793],[-48.410589,-24.979624],[-48.333188,-25.070067],[-48.251197,-24.978246],[-48.186718,-25.198397],[-48.02308,-25.230467],[-48.438688,-25.654056],[-48.590417,-25.976436],[-49.174795,-26.001348],[-49.554595,-26.236831],[-49.941727,-26.008382],[-50.182038,-26.078477],[-50.25103,-26.029735],[-50.323111,-26.134443],[-50.571305,-26.0033],[-50.718005,-26.244286],[-50.899509,-26.288632],[-51.08267,-26.227889],[-51.242771,-26.32357],[-51.297305,-26.41897],[-51.228168,-26.615517],[-51.411026,-26.71679],[-51.509564,-26.581689],[-51.873106,-26.599744],[-52.185149,-26.444918],[-52.737252,-26.341682],[-53.090101,-26.390009],[-53.280969,-26.246701],[-53.551168,-26.292261],[-53.833534,-25.970366],[-53.892053,-25.622098],[-54.078793,-25.558622],[-54.098311,-25.618256],[-54.099163,-25.494904],[-54.177977,-25.584268],[-54.378146,-25.594379],[-54.429093,-25.694822],[-54.593079,-25.591815],[-54.617326,-25.452526],[-54.429612,-25.158893],[-54.441297,-24.948607],[-54.257592,-24.36236],[-54.340948,-24.128722],[-54.099323,-23.945986],[-53.982333,-23.459527],[-53.730098,-23.317225],[-53.6069,-22.950856],[-52.971909,-22.570007],[-52.701168,-22.626991],[-52.586219,-22.56604],[-52.222989,-22.673825],[-52.125167,-22.51879],[-52.064157,-22.533836]]]]}},{"type":"Feature","properties":{"name":"Rio de Janeiro","uf":"RJ","region":"Sudeste","diabeticos":"1.550 mil","prevalencia":"11,8%","amputacoes":"7.750","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-44.512726,-23.292935],[-44.723999,-23.367601],[-44.874618,-23.248662],[-44.802203,-22.998642],[-44.494289,-22.845988],[-44.269527,-22.829798],[-44.160514,-22.677824],[-44.383979,-22.573224],[-44.633017,-22.60873],[-44.79328,-22.386588],[-44.432281,-22.251135],[-44.235046,-22.265704],[-43.76557,-22.062424],[-43.246126,-22.006538],[-43.072998,-22.093352],[-42.271127,-21.714706],[-42.368575,-21.619118],[-42.252349,-21.489779],[-42.20808,-21.177719],[-42.080057,-21.035198],[-42.151261,-20.973889],[-41.976257,-20.935011],[-41.874501,-20.766324],[-41.711998,-20.871073],[-41.717586,-21.123331],[-41.09203,-21.218159],[-40.957184,-21.302959],[-41.073653,-21.514831],[-40.984671,-21.999235],[-41.68861,-22.299597],[-41.960365,-22.534191],[-41.984635,-22.717287],[-41.863681,-22.754041],[-42.030855,-22.904252],[-42.012857,-22.997335],[-42.517282,-22.93206],[-43.0515,-22.982245],[-43.1353,-22.938257],[-43.026441,-22.741777],[-43.085418,-22.677155],[-43.277663,-22.780391],[-43.150045,-22.950033],[-43.285904,-23.016048],[-43.711437,-23.055581],[-43.572647,-23.050221],[-43.855638,-22.901618],[-44.193734,-23.054365],[-44.350348,-23.030045],[-44.344366,-22.921608],[-44.444636,-23.026892],[-44.667646,-23.053639],[-44.71216,-23.233387],[-44.642933,-23.185336],[-44.655376,-23.295325],[-44.559892,-23.227086],[-44.512726,-23.292935]],[[-43.359794,-22.993309],[-43.301464,-23.008986],[-43.412473,-22.985408],[-43.359794,-22.993309]]],[[[-44.233217,-23.089435],[-44.095011,-23.174667],[-44.348763,-23.226125],[-44.377253,-23.171793],[-44.233217,-23.089435]]],[[[-43.827899,-23.057298],[-43.777995,-23.060451],[-44.012122,-23.077813],[-43.827899,-23.057298]]],[[[-43.182492,-22.781033],[-43.263556,-22.810152],[-43.182492,-22.781033]]],[[[-43.913351,-22.93897],[-43.913351,-22.93897]]],[[[-43.23788,-22.861561],[-43.23788,-22.861561]]],[[[-43.929349,-23.006708],[-43.929349,-23.006708]]],[[[-44.588209,-23.20618],[-44.588209,-23.20618]]],[[[-44.045854,-22.999599],[-44.045854,-22.999599]]],[[[-44.687442,-23.164206],[-44.687442,-23.164206]]],[[[-41.698311,-22.410062],[-41.698311,-22.410062]]],[[[-44.512726,-23.292935],[-44.512726,-23.292935]]],[[[-43.110533,-22.761512],[-43.110533,-22.761512]]],[[[-43.10855,-22.758473],[-43.10855,-22.758473]]],[[[-43.177351,-22.895572],[-43.177351,-22.895572]]],[[[-44.644679,-23.073814],[-44.644679,-23.073814]]],[[[-43.861178,-22.952425],[-43.861178,-22.952425]]],[[[-41.686751,-22.401743],[-41.686751,-22.401743]]],[[[-44.583765,-23.20366],[-44.583765,-23.20366]]],[[[-44.576304,-23.185972],[-44.576304,-23.185972]]],[[[-43.909974,-22.983026],[-43.909974,-22.983026]]],[[[-44.64635,-23.226778],[-44.64635,-23.226778]]],[[[-41.886592,-22.776935],[-41.886592,-22.776935]]],[[[-44.129227,-23.035366],[-44.129227,-23.035366]]],[[[-43.920054,-22.941608],[-43.920054,-22.941608]]],[[[-43.514413,-23.065268],[-43.514413,-23.065268]]],[[[-43.148184,-23.059917],[-43.148184,-23.059917]]],[[[-44.639698,-23.228174],[-44.639698,-23.228174]]],[[[-43.943721,-23.023293],[-43.943721,-23.023293]]],[[[-44.692811,-23.215421],[-44.692811,-23.215421]]],[[[-43.953848,-23.004999],[-43.953848,-23.004999]]],[[[-43.207898,-23.040543],[-43.207898,-23.040543]]],[[[-44.672432,-23.099449],[-44.672432,-23.099449]]],[[[-43.953679,-23.025037],[-43.953679,-23.025037]]],[[[-43.861226,-22.946858],[-43.861226,-22.946858]]],[[[-44.675081,-23.111113],[-44.675081,-23.111113]]]]}},{"type":"Feature","properties":{"name":"Rio Grande do Norte","uf":"RN","region":"Nordeste","diabeticos":"310 mil","prevalencia":"9,6%","amputacoes":"1.550","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-37.151721,-4.935362],[-36.962159,-4.919381],[-36.689467,-5.091868],[-35.974274,-5.04165],[-35.488629,-5.157973],[-35.260708,-5.480447],[-34.969063,-6.487837],[-35.169792,-6.557986],[-35.657922,-6.445571],[-35.977186,-6.488506],[-36.079565,-6.404793],[-36.249331,-6.436963],[-36.279444,-6.308456],[-36.39413,-6.29358],[-36.52875,-6.446724],[-36.435425,-6.625481],[-36.524114,-6.599256],[-36.506515,-6.812625],[-36.718142,-6.982333],[-36.729776,-6.835996],[-36.834611,-6.730674],[-36.956723,-6.79008],[-37.001796,-6.709172],[-37.234195,-6.82424],[-37.283311,-6.69352],[-37.4843,-6.709643],[-37.482732,-6.550019],[-37.396491,-6.513817],[-37.364236,-6.323818],[-37.165279,-6.169986],[-37.173524,-6.047629],[-37.74881,-6.193441],[-37.757271,-6.290385],[-38.115253,-6.521298],[-38.48585,-6.398363],[-38.45723,-6.329322],[-38.576694,-6.347042],[-38.446934,-6.084893],[-38.276625,-6.069567],[-38.124554,-5.887229],[-38.082335,-5.672168],[-37.901598,-5.497133],[-37.639945,-4.926029],[-37.251574,-4.832043],[-37.151721,-4.935362]]]]}},{"type":"Feature","properties":{"name":"Rondônia","uf":"RO","region":"Norte","diabeticos":"170 mil","prevalencia":"8,2%","amputacoes":"850","color":"#52b788"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-66.458886,-9.87524],[-66.805966,-9.814127],[-66.50022,-9.633167],[-66.392013,-9.500085],[-66.408458,-9.406552],[-65.969866,-9.412766],[-65.79108,-9.585253],[-65.596321,-9.413476],[-65.434254,-9.465947],[-65.446554,-9.31599],[-65.246189,-9.257276],[-65.184149,-9.426604],[-65.097373,-9.43213],[-64.838837,-8.993728],[-64.142924,-8.953151],[-64.142558,-8.742652],[-63.924056,-8.575147],[-63.943608,-8.330811],[-63.77299,-8.320355],[-63.620267,-7.968921],[-62.866087,-7.975496],[-62.69175,-8.092534],[-62.525603,-8.382677],[-62.366551,-8.389222],[-62.340551,-8.602451],[-62.187856,-8.590182],[-62.124437,-8.801291],[-61.905349,-8.874129],[-61.835964,-8.732345],[-61.712737,-8.687474],[-61.468111,-8.917145],[-61.554402,-9.089868],[-61.525876,-9.243674],[-61.632006,-9.266243],[-61.477057,-9.626913],[-61.573828,-9.71728],[-61.507378,-9.860696],[-61.59965,-10.154439],[-61.461237,-10.41952],[-61.549712,-10.985703],[-60.459516,-10.989463],[-60.347429,-11.108644],[-60.30071,-11.056758],[-59.986314,-11.11412],[-59.920097,-11.397613],[-60.114345,-11.591064],[-60.108231,-11.839182],[-59.984634,-11.913945],[-59.891778,-12.245054],[-59.773813,-12.340553],[-60.068196,-12.615595],[-60.078571,-12.880736],[-60.282449,-13.080147],[-60.387376,-13.454285],[-60.631655,-13.571292],[-60.70778,-13.692483],[-61.014275,-13.487077],[-61.840376,-13.54837],[-62.169835,-13.113468],[-62.391395,-13.134294],[-62.650176,-12.965127],[-62.778397,-13.009093],[-63.15717,-12.613427],[-63.294905,-12.681404],[-63.785671,-12.427493],[-63.956265,-12.530383],[-64.231165,-12.455159],[-64.290809,-12.500246],[-64.503691,-12.360202],[-64.506479,-12.226651],[-64.711842,-12.173677],[-64.707966,-12.086389],[-64.757142,-12.155758],[-64.837946,-12.010891],[-65.031394,-11.994531],[-65.0851,-11.712257],[-65.260048,-11.706421],[-65.211262,-11.530012],[-65.304382,-11.50089],[-65.291217,-11.323712],[-65.360678,-11.250879],[-65.250873,-10.986505],[-65.428905,-10.480558],[-65.288236,-10.219427],[-65.285523,-9.841057],[-65.374165,-9.698908],[-65.442909,-9.669737],[-65.558636,-9.843299],[-65.773854,-9.734197],[-65.793885,-9.791228],[-65.919003,-9.753295],[-66.458886,-9.87524]]],[[[-66.458886,-9.87524],[-66.458886,-9.87524]]]]}},{"type":"Feature","properties":{"name":"Roraima","uf":"RR","region":"Norte","diabeticos":"95 mil","prevalencia":"7,8%","amputacoes":"475","color":"#52b788"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-59.916352,3.145915],[-59.98963,2.68657],[-59.896016,2.363334],[-59.721919,2.27679],[-59.751241,1.861686],[-59.662311,1.870199],[-59.689858,1.758476],[-59.53624,1.720142],[-59.252367,1.388596],[-58.886303,1.260595],[-58.89489,0.263852],[-60.037434,0.263837],[-60.399423,-0.509759],[-60.303101,-0.71094],[-60.47859,-0.770587],[-60.530535,-0.874748],[-60.752194,-0.860857],[-60.920256,-0.555036],[-61.086925,-0.499759],[-61.428315,-0.633915],[-61.538314,-0.755865],[-61.628317,-1.301136],[-61.482203,-1.5803],[-61.634982,-1.433631],[-61.896094,-1.395022],[-62.039147,-1.118076],[-62.509707,-0.75864],[-62.486096,-0.681141],[-62.406375,-0.726972],[-62.290344,-0.64633],[-62.308673,-0.513833],[-62.18784,-0.330494],[-62.423875,0.091908],[-62.445813,0.379402],[-62.53248,0.509141],[-62.471089,1.086598],[-62.529138,1.089134],[-62.636847,1.434036],[-62.803914,1.590666],[-62.705501,1.940031],[-63.023254,2.014976],[-63.14098,2.172756],[-63.359285,2.197405],[-63.406197,2.436114],[-63.708401,2.380613],[-64.055483,2.498056],[-63.993487,2.770078],[-64.233756,3.114075],[-64.254652,3.411374],[-64.185123,3.560054],[-64.487939,3.791074],[-64.824229,4.243664],[-64.698356,4.251629],[-64.559816,4.102308],[-64.163735,4.126716],[-63.963752,3.868478],[-63.858973,3.94802],[-63.681981,3.9079],[-63.680225,4.017368],[-63.498192,3.843075],[-63.428172,3.977551],[-63.205667,3.951764],[-63.225946,3.835884],[-62.959555,3.608111],[-62.834928,3.737826],[-62.736219,3.689501],[-62.747222,4.034892],[-62.556391,4.018108],[-62.437095,4.183369],[-62.14506,4.075258],[-61.983734,4.179663],[-61.93003,4.103728],[-61.7744,4.249856],[-61.559075,4.254601],[-61.512765,4.406575],[-61.288933,4.458214],[-61.321408,4.535125],[-60.995552,4.518033],[-60.90016,4.715753],[-60.742665,4.761675],[-60.59128,4.927245],[-60.722588,5.220316],[-60.433663,5.181756],[-60.209706,5.270855],[-59.996159,5.084921],[-59.989703,4.986605],[-60.02955,4.700879],[-60.161946,4.508342],[-59.793594,4.465828],[-59.675067,4.37276],[-59.724047,4.182787],[-59.517455,3.943488],[-59.66785,3.703472],[-59.865229,3.577268],[-59.806231,3.354814],[-59.916352,3.145915]]]]}},{"type":"Feature","properties":{"name":"Rio Grande do Sul","uf":"RS","region":"Sul","diabeticos":"980 mil","prevalencia":"9,5%","amputacoes":"4.900","color":"#d62828"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-52.043669,-31.57374],[-52.109928,-31.553575],[-52.068556,-31.676124],[-52.20028,-31.72815],[-52.256169,-31.848617],[-52.067883,-32.029634],[-52.098151,-32.161508],[-52.30639,-32.361007],[-52.62867,-33.115653],[-53.415977,-33.748346],[-53.535302,-33.613258],[-53.510175,-33.535401],[-53.449752,-33.569597],[-53.430421,-33.155555],[-53.319514,-33.05469],[-53.255673,-33.102124],[-53.123145,-32.790994],[-53.072341,-32.832491],[-52.982168,-32.734131],[-52.894167,-32.892195],[-52.750015,-32.86162],[-52.585617,-32.52622],[-52.693135,-32.317625],[-52.621861,-32.143311],[-52.794787,-32.27079],[-52.817256,-32.340493],[-52.723777,-32.387112],[-52.953421,-32.485547],[-53.07578,-32.656163],[-53.38786,-32.586268],[-53.643716,-32.38316],[-53.745262,-32.078282],[-53.971665,-31.918275],[-54.099898,-31.927319],[-54.5849,-31.457696],[-54.835256,-31.441428],[-55.005921,-31.267785],[-55.07324,-31.331873],[-55.237892,-31.259963],[-55.349819,-31.037379],[-55.576558,-30.833231],[-55.869236,-31.069749],[-56.009416,-31.080787],[-56.02236,-30.786057],[-56.806614,-30.103732],[-57.068388,-30.086379],[-57.221324,-30.289849],[-57.523308,-30.285215],[-57.642721,-30.188407],[-57.345234,-30.002758],[-57.277701,-29.817088],[-56.967514,-29.638603],[-56.588854,-29.119621],[-56.413467,-29.07074],[-56.282474,-28.787684],[-56.001999,-28.598862],[-56.010432,-28.507076],[-55.885503,-28.479628],[-55.871644,-28.358517],[-55.699503,-28.425576],[-55.667473,-28.333268],[-55.773346,-28.244754],[-55.444488,-28.09625],[-55.195809,-27.856217],[-55.031327,-27.854935],[-55.080343,-27.779097],[-54.93608,-27.772063],[-54.811594,-27.529241],[-54.681963,-27.574257],[-54.584708,-27.454187],[-54.529719,-27.505343],[-54.410542,-27.404735],[-54.27993,-27.445471],[-54.172071,-27.25439],[-54.077486,-27.296804],[-53.874341,-27.127249],[-53.641969,-27.220393],[-53.371984,-27.090481],[-53.294053,-27.133937],[-53.309484,-27.216853],[-53.071752,-27.15709],[-53.028462,-27.080097],[-52.977166,-27.220689],[-52.951253,-27.161602],[-52.698552,-27.281981],[-52.445402,-27.217168],[-52.374868,-27.303786],[-52.166017,-27.273406],[-51.950503,-27.380848],[-52.007322,-27.401605],[-51.889038,-27.519828],[-51.631122,-27.488751],[-51.081595,-27.834384],[-50.624625,-28.390978],[-50.156501,-28.4972],[-50.126295,-28.428853],[-50.099554,-28.484785],[-49.764685,-28.45966],[-49.691131,-28.618444],[-49.934882,-28.727607],[-49.920048,-28.97821],[-50.006982,-29.071638],[-49.953998,-29.085019],[-50.165967,-29.247338],[-50.036938,-29.350757],[-50.114169,-29.258757],[-49.946316,-29.199966],[-49.711305,-29.325448],[-50.017487,-29.7718],[-50.332998,-30.500274],[-50.768792,-31.109558],[-51.249787,-31.566743],[-52.081144,-32.15693],[-52.013322,-31.938848],[-52.097628,-31.835423],[-51.851719,-31.867023],[-51.786637,-31.805769],[-51.864607,-31.798898],[-51.664143,-31.770449],[-51.490777,-31.568786],[-51.435788,-31.624347],[-51.428865,-31.48027],[-51.360046,-31.528631],[-51.237768,-31.457622],[-51.168123,-31.066838],[-50.980022,-31.040525],[-50.96623,-30.895583],[-50.701455,-30.745804],[-50.717009,-30.351462],[-50.623465,-30.391576],[-50.626833,-30.327322],[-50.653876,-30.442436],[-50.574356,-30.48144],[-50.537427,-30.273431],[-50.596896,-30.194067],[-50.672716,-30.296119],[-50.921588,-30.331649],[-50.929504,-30.435251],[-51.054701,-30.391404],[-51.03023,-30.273953],[-51.248058,-30.185762],[-51.229866,-30.043224],[-51.295152,-30.001162],[-51.293126,-30.303492],[-51.094761,-30.381112],[-51.142259,-30.470535],[-51.181996,-30.407385],[-51.257951,-30.466327],[-51.295483,-30.750499],[-51.31713,-30.647642],[-51.386426,-30.6545],[-51.368619,-30.873673],[-51.496093,-30.914872],[-51.440199,-31.087194],[-51.61757,-31.139188],[-51.616175,-31.267165],[-51.918857,-31.310252],[-52.032213,-31.694637],[-52.043669,-31.57374]]],[[[-51.295483,-30.750499],[-51.289814,-30.817001],[-51.295483,-30.750499]]],[[[-50.098154,-29.23608],[-50.098154,-29.23608]]],[[[-51.148111,-30.472971],[-51.148111,-30.472971]]],[[[-49.95607,-29.06698],[-49.95607,-29.06698]]],[[[-51.294501,-30.053588],[-51.294501,-30.053588]]],[[[-52.101693,-31.801463],[-52.101693,-31.801463]]],[[[-53.418556,-33.129563],[-53.418556,-33.129563]]],[[[-49.968549,-29.120472],[-49.968549,-29.120472]]],[[[-51.464724,-31.549706],[-51.464724,-31.549706]]],[[[-51.169024,-30.264125],[-51.169024,-30.264125]]],[[[-51.104953,-30.259277],[-51.104953,-30.259277]]],[[[-52.044462,-31.567576],[-52.044462,-31.567576]]],[[[-51.191486,-30.234579],[-51.191486,-30.234579]]]]}},{"type":"Feature","properties":{"name":"Santa Catarina","uf":"SC","region":"Sul","diabeticos":"680 mil","prevalencia":"9,2%","amputacoes":"3.400","color":"#d62828"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-53.720454,-26.559912],[-53.642566,-26.252258],[-53.496683,-26.302344],[-53.280969,-26.246701],[-53.090101,-26.390009],[-52.737252,-26.341682],[-52.185149,-26.444918],[-51.873106,-26.599744],[-51.509564,-26.581689],[-51.411026,-26.71679],[-51.228168,-26.615517],[-51.297305,-26.41897],[-51.242771,-26.32357],[-51.08267,-26.227889],[-50.899509,-26.288632],[-50.718005,-26.244286],[-50.571305,-26.0033],[-50.323111,-26.134443],[-50.25103,-26.029735],[-50.182038,-26.078477],[-49.941727,-26.008382],[-49.554595,-26.236831],[-49.174795,-26.001348],[-48.642921,-25.955779],[-48.492428,-26.218684],[-48.679779,-26.726406],[-48.584956,-26.783022],[-48.642705,-26.901482],[-48.566901,-27.007435],[-48.602145,-27.124613],[-48.465152,-27.14468],[-48.616132,-27.250717],[-48.52382,-27.333604],[-48.646663,-27.482517],[-48.567224,-27.595407],[-48.643485,-27.642734],[-48.573511,-27.889596],[-48.742512,-28.507569],[-49.290609,-28.882493],[-49.711305,-29.325448],[-49.962461,-29.198392],[-50.114169,-29.258757],[-50.064516,-29.340854],[-50.151448,-29.202579],[-50.093363,-29.23721],[-50.098947,-29.163249],[-49.962354,-29.117466],[-49.934882,-28.727607],[-49.691757,-28.624663],[-49.764685,-28.45966],[-50.099554,-28.484785],[-50.126295,-28.428853],[-50.156501,-28.4972],[-50.624625,-28.390978],[-51.081595,-27.834384],[-51.631122,-27.488751],[-51.889038,-27.519828],[-52.007322,-27.401605],[-51.950503,-27.380848],[-52.166017,-27.273406],[-52.374868,-27.303786],[-52.445402,-27.217168],[-52.698552,-27.281981],[-52.951253,-27.161602],[-52.977166,-27.220689],[-53.028462,-27.080097],[-53.071752,-27.15709],[-53.309484,-27.216853],[-53.294053,-27.133937],[-53.371984,-27.090481],[-53.506027,-27.137903],[-53.491541,-27.201654],[-53.833833,-27.16934],[-53.670212,-26.94138],[-53.753823,-26.713571],[-53.720454,-26.559912]]],[[[-48.41035,-27.38943],[-48.359389,-27.44819],[-48.475446,-27.769205],[-48.569631,-27.835713],[-48.547171,-27.458378],[-48.41035,-27.38943]]],[[[-48.565368,-27.477238],[-48.565368,-27.477238]]]]}},{"type":"Feature","properties":{"name":"Sergipe","uf":"SE","region":"Nordeste","diabeticos":"220 mil","prevalencia":"9,8%","amputacoes":"1.100","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-37.960063,-9.532816],[-36.991601,-9.976776],[-36.910464,-10.137513],[-36.623312,-10.25773],[-36.56376,-10.415908],[-36.455743,-10.407212],[-36.393427,-10.498067],[-36.85376,-10.743138],[-37.329535,-11.44466],[-37.517548,-11.547579],[-37.699565,-11.562016],[-37.977461,-11.39315],[-37.973964,-11.194839],[-38.240408,-10.876258],[-38.211549,-10.708731],[-37.999466,-10.763949],[-37.813529,-10.690617],[-37.858716,-10.426042],[-37.736156,-10.331607],[-37.831385,-10.0005],[-37.99726,-9.916292],[-38.040017,-9.572666],[-37.960063,-9.532816]]]]}},{"type":"Feature","properties":{"name":"São Paulo","uf":"SP","region":"Sudeste","diabeticos":"3.200 mil","prevalencia":"11,5%","amputacoes":"16.000","color":"#ef476f"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-46.137723,-23.858882],[-46.181376,-23.990014],[-46.287026,-24.043965],[-46.384232,-23.969873],[-46.940406,-24.280038],[-47.009244,-24.413565],[-47.841466,-24.974503],[-47.912517,-25.158046],[-48.09852,-25.310889],[-48.02308,-25.230467],[-48.186718,-25.198397],[-48.251197,-24.978246],[-48.333188,-25.070067],[-48.410589,-24.979624],[-48.528101,-25.10029],[-48.582178,-25.051061],[-48.498829,-24.73846],[-48.581366,-24.671118],[-49.304824,-24.672141],[-49.200279,-24.343974],[-49.610245,-23.851198],[-49.549358,-23.703227],[-49.628701,-23.51174],[-49.566613,-23.426741],[-49.67783,-23.164573],[-49.911112,-23.050628],[-49.985672,-22.897021],[-50.182844,-22.95327],[-50.661794,-22.895208],[-50.741095,-22.960908],[-50.890392,-22.795326],[-51.263287,-22.66857],[-51.717664,-22.668533],[-52.107133,-22.516211],[-52.222989,-22.673825],[-52.586219,-22.56604],[-52.701168,-22.626991],[-52.971909,-22.570007],[-53.087301,-22.657924],[-53.107751,-22.596822],[-52.407678,-22.141158],[-52.075978,-21.714378],[-52.077285,-21.514747],[-51.967399,-21.501288],[-51.867191,-21.351186],[-51.875362,-21.135676],[-51.61849,-20.93195],[-51.586467,-20.63433],[-51.342903,-20.355342],[-51.068671,-20.249579],[-50.965972,-20.034059],[-50.575501,-19.815551],[-50.471424,-19.779185],[-49.890804,-19.94325],[-49.264697,-19.961567],[-49.308059,-20.101506],[-49.238354,-20.286567],[-48.991778,-20.164918],[-48.968425,-20.393266],[-48.898861,-20.440723],[-48.822743,-20.161432],[-48.24591,-20.140474],[-48.240484,-20.028873],[-48.111617,-20.143418],[-47.975508,-20.034894],[-47.893921,-20.123355],[-47.859325,-19.992516],[-47.703779,-19.979426],[-47.635516,-20.047902],[-47.473251,-19.961547],[-47.230652,-20.218623],[-47.291328,-20.448829],[-47.153918,-20.519245],[-47.096057,-20.658585],[-47.239588,-20.884798],[-47.143268,-20.981899],[-47.010779,-21.421805],[-46.665248,-21.36116],[-46.508802,-21.469408],[-46.517102,-21.611396],[-46.690506,-21.836456],[-46.613023,-22.009113],[-46.722808,-22.07652],[-46.600063,-22.134254],[-46.722804,-22.306125],[-46.666102,-22.413897],[-46.406688,-22.540048],[-46.392603,-22.662476],[-46.477479,-22.698898],[-46.334763,-22.759699],[-46.359178,-22.895635],[-45.790825,-22.857636],[-45.713135,-22.814285],[-45.72783,-22.72317],[-45.819423,-22.722059],[-45.693546,-22.651209],[-45.716467,-22.5781],[-45.664559,-22.650157],[-45.471344,-22.590023],[-45.399546,-22.65263],[-44.808797,-22.404772],[-44.633017,-22.60873],[-44.383979,-22.573224],[-44.161749,-22.674135],[-44.269527,-22.829798],[-44.792039,-22.981663],[-44.888492,-23.223999],[-44.723999,-23.367601],[-44.907363,-23.333195],[-45.060924,-23.419648],[-45.081623,-23.521264],[-45.171243,-23.493092],[-45.211059,-23.582531],[-45.406128,-23.622848],[-45.404629,-23.819589],[-45.844005,-23.757598],[-46.137723,-23.858882]]],[[[-45.320935,-23.914938],[-45.461657,-23.887757],[-45.328825,-23.720992],[-45.229593,-23.77629],[-45.289743,-23.865889],[-45.226769,-23.940793],[-45.320935,-23.914938]]],[[[-45.077848,-23.535286],[-45.077848,-23.535286]]],[[[-45.139775,-23.799866],[-45.139775,-23.799866]]],[[[-45.163376,-23.566709],[-45.163376,-23.566709]]],[[[-45.01966,-23.758692],[-45.01966,-23.758692]]],[[[-45.779012,-23.867611],[-45.779012,-23.867611]]],[[[-45.293576,-23.596097],[-45.293576,-23.596097]]],[[[-45.018595,-23.754241],[-45.018595,-23.754241]]],[[[-45.725934,-23.800637],[-45.725934,-23.800637]]],[[[-45.526033,-23.849328],[-45.526033,-23.849328]]],[[[-46.906652,-24.389684],[-46.906652,-24.389684]]],[[[-46.909409,-24.373831],[-46.909409,-24.373831]]],[[[-45.033318,-23.548712],[-45.033318,-23.548712]]],[[[-44.851379,-23.399177],[-44.851379,-23.399177]]],[[[-44.948537,-23.38621],[-44.948537,-23.38621]]],[[[-46.979876,-24.37096],[-46.979876,-24.37096]]],[[[-47.913506,-25.166847],[-47.913506,-25.166847]]],[[[-45.228607,-23.813211],[-45.228607,-23.813211]]],[[[-45.325172,-23.915907],[-45.325172,-23.915907]]],[[[-45.714043,-23.790181],[-45.714043,-23.790181]]],[[[-45.276823,-23.853116],[-45.276823,-23.853116]]],[[[-45.297189,-23.920585],[-45.297189,-23.920585]]],[[[-45.156356,-23.830774],[-45.156356,-23.830774]]],[[[-45.671725,-23.804677],[-45.671725,-23.804677]]]]}},{"type":"Feature","properties":{"name":"Tocantins","uf":"TO","region":"Norte","diabeticos":"140 mil","prevalencia":"8,0%","amputacoes":"700","color":"#52b788"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-47.032958,-8.982325],[-47.068303,-9.063475],[-46.92223,-9.0663],[-46.762939,-9.40855],[-46.560548,-9.483629],[-46.646991,-9.729945],[-46.49322,-9.827016],[-46.367463,-10.168403],[-45.793325,-10.267263],[-45.698859,-10.16644],[-45.827299,-10.435545],[-46.210548,-10.649255],[-46.282995,-10.906335],[-46.616668,-11.289032],[-46.478886,-11.515971],[-46.08625,-11.621714],[-46.314531,-11.631832],[-46.374156,-11.868178],[-46.170841,-11.900564],[-46.397437,-12.039917],[-46.351964,-12.336976],[-46.254333,-12.492756],[-46.153544,-12.482796],[-46.279515,-12.584471],[-46.304358,-12.949443],[-46.119495,-12.925407],[-46.363444,-12.990788],[-46.417186,-12.823042],[-46.45422,-12.970722],[-46.750177,-12.968724],[-47.426534,-13.289007],[-47.63434,-13.104065],[-47.678542,-13.46728],[-47.823547,-13.311435],[-48.062013,-13.234968],[-48.164957,-13.305356],[-48.173492,-13.147675],[-48.441266,-13.291938],[-48.508419,-13.128422],[-48.58596,-13.317182],[-48.601652,-13.059894],[-48.857053,-12.804994],[-48.975176,-12.956771],[-49.118631,-12.789931],[-49.236963,-12.883541],[-49.369037,-13.274169],[-50.292184,-12.839493],[-50.299642,-12.680466],[-50.142216,-12.39551],[-50.36546,-12.545645],[-50.510606,-12.860278],[-50.622263,-12.819312],[-50.706022,-12.609279],[-50.617789,-12.428571],[-50.686406,-12.201735],[-50.638822,-11.884152],[-50.721575,-11.739285],[-50.65606,-11.600417],[-50.741594,-11.454492],[-50.608993,-11.067047],[-50.602989,-10.660528],[-50.417827,-10.355864],[-50.391687,-10.133627],[-50.106911,-9.593879],[-50.03733,-9.289006],[-49.744634,-8.905768],[-49.591958,-8.839096],[-49.282871,-8.379166],[-49.150136,-7.80181],[-49.383604,-7.543108],[-49.184836,-7.234789],[-49.20905,-6.92502],[-48.664412,-6.662383],[-48.645825,-6.50851],[-48.507179,-6.354583],[-48.382239,-6.379232],[-48.431498,-6.176918],[-48.291684,-6.103692],[-48.334277,-6.003902],[-48.231193,-5.945764],[-48.294112,-5.756302],[-48.131813,-5.617758],[-48.384303,-5.393838],[-48.745052,-5.369352],[-48.605691,-5.336132],[-48.519021,-5.191768],[-47.933553,-5.240579],[-47.843325,-5.37584],[-47.49969,-5.525235],[-47.378389,-6.270479],[-47.529477,-6.976146],[-47.745785,-7.200837],[-47.648084,-7.302969],[-47.499355,-7.293472],[-47.485444,-7.366716],[-47.590437,-7.439154],[-47.504277,-7.436249],[-47.043074,-8.053196],[-46.604246,-7.895787],[-46.476536,-8.011824],[-46.507164,-8.270375],[-46.806408,-8.398576],[-46.915971,-8.595382],[-46.913022,-8.847427],[-47.032958,-8.982325]]]]}},{"type":"Feature","properties":{"name":"Distrito Federal","uf":"DF","region":"Centro-Oeste","diabeticos":"320 mil","prevalencia":"8,9%","amputacoes":"1.600","color":"#ffd60a"},"geometry":{"type":"MultiPolygon","coordinates":[[[[-47.308609,-16.035491],[-48.278674,-16.051101],[-48.197192,-15.500511],[-47.416906,-15.499863],[-47.31543,-15.593974],[-47.37645,-15.977942],[-47.308609,-16.035491]]]]}}]};

// ===================== MAPA INTERATIVO — Leaflet.js =====================

let leafletMap = null; // instância global do mapa Leaflet
let leafletGeoLayer = null; // layer do GeoJSON

// Cores por região (igual à legenda do painel lateral)
const REGION_COLORS = {
  'Norte':        '#52b788',
  'Nordeste':     '#ef476f',
  'Centro-Oeste': '#ffd60a',
  'Sudeste':      '#e87820',
  'Sul':          '#d62828'
};

function renderMapBrasil() {
  const container = document.getElementById('leaflet-map');
  if (!container) return;

  // Evita reinicializar se já existe
  if (leafletMap) {
    setTimeout(() => leafletMap.invalidateSize(), 100);
    return;
  }

  // Garante que o container tem altura antes de criar o mapa
  if (!container.clientHeight || container.clientHeight < 100) {
    container.style.height = '520px';
  }

  // Cria o mapa Leaflet centralizado no Brasil, sem tiles (fundo limpo)
  leafletMap = L.map('leaflet-map', {
    center: [-14.5, -53],
    zoom: 4,
    zoomControl: true,
    attributionControl: false,
    scrollWheelZoom: false,
  });

  // Fundo sólido (sem tile externo, mantém privacidade e funciona offline)
  leafletMap.getContainer().style.background = '#dce8f5';

  // Creditos mínimos
  L.control.attribution({ prefix: 'Leaflet' }).addTo(leafletMap);

  // Renderiza GeoJSON
  _buildGeoLayer();
}

function _buildGeoLayer() {
  if (!leafletMap || !BRASIL_GEOJSON) return;

  if (leafletGeoLayer) {
    leafletGeoLayer.removeFrom(leafletMap);
  }

  leafletGeoLayer = L.geoJSON(BRASIL_GEOJSON, {
    style: _stateStyle,
    onEachFeature: _onEachState
  }).addTo(leafletMap);

  // Ajusta bounds ao Brasil
  try { leafletMap.fitBounds(leafletGeoLayer.getBounds(), { padding: [20, 20] }); }
  catch(e) {}
}

function _stateStyle(feature) {
  const region = feature.properties.region;
  const color  = REGION_COLORS[region] || '#aaa';
  return {
    fillColor:   color,
    fillOpacity: 0.78,
    color:       '#ffffff',
    weight:      1.4,
    opacity:     1
  };
}

function _onEachState(feature, layer) {
  const p = feature.properties;

  // Tooltip flutuante ao passar o mouse
  layer.bindTooltip(`
    <div style="font-family:Outfit,sans-serif;font-size:.78rem;line-height:1.5;padding:.1rem .2rem">
      <strong style="font-size:.85rem">${p.name} (${p.uf})</strong><br>
      <span style="color:#666">${p.region}</span><br>
      🩺 <b>${p.diabeticos}</b> diabéticos<br>
      📊 Prevalência: <b>${p.prevalencia}</b><br>
      🔪 ~${p.amputacoes} amputações/ano
    </div>
  `, { sticky: true, opacity: 0.97, className: 'leaflet-bemcicatri-tooltip' });

  // Hover — ilumina o estado
  layer.on('mouseover', function() {
    this.setStyle({ fillOpacity: 1, weight: 2.5, color: '#222' });
    this.bringToFront();
  });
  layer.on('mouseout', function() {
    leafletGeoLayer.resetStyle(this);
  });

  // Click — atualiza painel lateral
  layer.on('click', function() {
    // Reset todos
    leafletGeoLayer.eachLayer(l => leafletGeoLayer.resetStyle(l));
    // Destaca selecionado
    this.setStyle({ fillOpacity: 1, weight: 3, color: '#1a1a2e' });
    this.bringToFront();

    // Painel lateral
    const panel = document.getElementById('map-selected-info');
    if (panel) {
      const regionColor = REGION_COLORS[p.region] || '#aaa';
      panel.innerHTML = `
        <div class="msi-region-badge" style="background:${regionColor}20;color:${regionColor};border:1.5px solid ${regionColor}40">${p.region}</div>
        <div class="msi-state-name">${p.name} <span style="opacity:.5">(${p.uf})</span></div>
        <div class="msi-data-grid">
          <div class="msi-data-item">
            <div class="msi-data-val">${p.diabeticos}</div>
            <div class="msi-data-lbl">Diabéticos</div>
          </div>
          <div class="msi-data-item">
            <div class="msi-data-val">${p.prevalencia}</div>
            <div class="msi-data-lbl">Prevalência</div>
          </div>
          <div class="msi-data-item">
            <div class="msi-data-val">${p.amputacoes}</div>
            <div class="msi-data-lbl">Amputações/ano</div>
          </div>
        </div>
        <div style="margin-top:.6rem;font-size:.74rem;color:var(--gray400);text-align:center">
          Clique em outro estado para comparar
        </div>
      `;
    }
  });
}

// Chamada quando a view do mapa é exibida (showView)
function initMapInteraction() {
  // Pequeno delay para garantir que o container está visível
  setTimeout(() => {
    renderMapBrasil();
    if (leafletMap) leafletMap.invalidateSize();
  }, 120);
}

// ===================== INIT =====================
async function init() {
  // Seed demo user desativado para não criar contas padrão automaticamente.
  // Se precisar habilitar novamente, adicione apenas informações genéricas e seguras.
}

document.addEventListener('DOMContentLoaded', () => {
  init();

  // Enter nos campos de login dispara o login
  ['login-email','login-pass'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  });

  // Enter no cadastro
  const reg2 = document.getElementById('reg-pass2');
  if (reg2) reg2.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

  // Mapa interativo — será chamado quando o user navegar para 'view-mapa'
  // initMapInteraction();

  // Seletor de paciente do simulador
  renderSimPatientSelector();

  // Inicializar simulador
  updateSimulator(1);
  
  // Listener delegado para clicks em patient cards
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.patient-card-v2');
    if (card) {
      const id = card.dataset.patientId;
      console.log('🎯 Clique detectado no card:', id);
      if (id) {
        openPatientDetail(id);
      }
    }
  });

  // Sessão persistente
  const savedEmail = sessionStorage.getItem('bemc_session');
  if (savedEmail) {
    apiGetUser(savedEmail).then(user => {
      if (user) {
        currentUser = user;
        apiGetPatients(user.email).then(p => { patients = p; enterDashboard(); });
      }
    });
  }
});