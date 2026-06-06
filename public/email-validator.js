// =====================================================
// email-validator.js — Validação de Email
// Verifica se o email realmente existe usando MX e SMTP
// =====================================================

const dns = require('dns').promises;
const net = require('net');

/**
 * Valida o formato básico do email
 */
function validateEmailFormat(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Resolve registros MX do domínio e retorna-os ordenados por prioridade
 */
async function getMXRecords(domain) {
  try {
    const mxRecords = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MX lookup timeout')), 8000))
    ]);

    if (Array.isArray(mxRecords) && mxRecords.length > 0) {
      return mxRecords.sort((a, b) => a.priority - b.priority);
    }
  } catch (error) {
    if (error.code && ['ETIMEOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'ENOTIMP'].includes(error.code)) {
      if (error.code === 'ETIMEOUT' || error.code === 'ECONNREFUSED' || error.code === 'EAI_AGAIN') {
        throw error;
      }
      // Domain not found / no MX records, continue to A/AAAA fallback
    } else if (error.message === 'MX lookup timeout') {
      throw error;
    } else {
      throw error;
    }
  }

  const aRecords = [];
  const ipv4 = await dns.resolve4(domain).catch(() => []);
  const ipv6 = await dns.resolve6(domain).catch(() => []);
  aRecords.push(...ipv4, ...ipv6);

  if (aRecords.length > 0) {
    return [{ exchange: domain, priority: 0 }];
  }

  return [];
}

/**
 * Valida o domínio do email com timeout e tratamento de erro
 */
async function validateMXRecords(domain) {
  try {
    const mxRecords = await getMXRecords(domain);

    if (!mxRecords || mxRecords.length === 0) {
      console.warn(`✗ Nenhum MX record encontrado para ${domain}`);
      return {
        valid: false,
        reason: 'no_mx_records',
        message: '✗ Domínio não existe ou não tem serviço de e-mail',
        canContinue: false,
        mxRecords: []
      };
    }

    console.log(`✓ MX records encontrados para ${domain}`);
    return {
      valid: true,
      mxRecords
    };
  } catch (error) {
    console.warn(`⚠️ Erro ao validar MX para ${domain}: ${error.message}`);
    return {
      valid: false,
      reason: 'dns_unreachable',
      message: '⚠️ Não foi possível consultar o domínio. Tente novamente mais tarde.',
      canContinue: true,
      mxRecords: []
    };
  }
}

function parseSMTPResponseLine(line) {
  const code = parseInt(line.slice(0, 3), 10);
  return Number.isNaN(code) ? null : code;
}

function sendSMTPCommand(socket, command) {
  socket.write(command + '\r\n');
}

function createSMTPProbe(mxHost, email, port) {
  return new Promise((resolve) => {
    let resolved = false;
    let stage = 0;
    let buffer = '';
    const socket = net.createConnection({ host: mxHost, port, timeout: 7000 });

    const cleanup = (result) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    const processLine = (line) => {
      const code = parseSMTPResponseLine(line);
      if (!code) return;

      if (stage === 0 && code === 220) {
        stage = 1;
        sendSMTPCommand(socket, 'EHLO example.com');
        return;
      }

      if (stage === 1 && code >= 250 && code < 400) {
        stage = 2;
        sendSMTPCommand(socket, 'MAIL FROM:<verify@example.com>');
        return;
      }

      if (stage === 2 && code >= 250 && code < 400) {
        stage = 3;
        sendSMTPCommand(socket, `RCPT TO:<${email}>`);
        return;
      }

      if (stage === 3) {
        if (code >= 200 && code < 300) {
          sendSMTPCommand(socket, 'QUIT');
          cleanup(true);
          return;
        }

        if ([550, 551, 553, 554].includes(code)) {
          sendSMTPCommand(socket, 'QUIT');
          cleanup(false);
          return;
        }

        if (code >= 400) {
          sendSMTPCommand(socket, 'QUIT');
          cleanup(null);
          return;
        }
      }
    };

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split(/\r\n/);
      buffer = lines.pop();
      lines.forEach(processLine);
    });

    socket.on('error', () => cleanup(null));
    socket.on('timeout', () => cleanup(null));
    socket.on('end', () => cleanup(null));
    socket.on('close', () => cleanup(null));

    setTimeout(() => cleanup(null), 9000);
  });
}

async function validateSMTP(email, mxRecords) {
  let sawIndeterminate = false;
  let sawDefinitiveFalse = false;

  for (const mx of mxRecords) {
    for (const port of [25, 587]) {
      try {
        const result = await createSMTPProbe(mx.exchange, email, port);
        if (result === true) {
          return true;
        }

        if (result === null) {
          sawIndeterminate = true;
          continue;
        }

        if (result === false) {
          sawDefinitiveFalse = true;
          continue;
        }
      } catch (error) {
        sawIndeterminate = true;
      }
    }
  }

  if (sawIndeterminate) {
    return null;
  }

  if (sawDefinitiveFalse) {
    return false;
  }

  return null;
}

/**
 * Validação completa do email
 * @param {string} email - Email a validar
 */
async function validateEmail(email) {
  try {
    if (!validateEmailFormat(email)) {
      return {
        valid: false,
        reason: 'invalid_format',
        message: '✗ Formato de e-mail inválido'
      };
    }

    const domain = email.split('@')[1].toLowerCase();
    console.log(`🔍 Validando email: ${email}`);
    console.log(`   Domínio: ${domain}`);

    const mxResult = await validateMXRecords(domain);

    // Se não há MX, o e-mail é muito provavelmente inválido
    if (!mxResult.valid && mxResult.reason === 'no_mx_records') {
      return { valid: false, reason: 'no_mx_records', message: '✗ E-mail não existe' };
    }

    // Se não foi possível consultar DNS por questões de rede, assumimos existência
    // para evitar falsos negativos quando provedores bloqueiam checagens
    if (!mxResult.valid && mxResult.reason === 'dns_unreachable') {
      return { valid: true, reason: 'assume_exists_dns_unreachable', message: '✓ E-mail existe' };
    }

    // Tentar checagem SMTP quando houver MX/A disponível
    const smtpResult = await validateSMTP(email, mxResult.mxRecords || []);

    if (smtpResult === true) {
      return { valid: true, reason: 'smtp_ok', message: '✓ E-mail existe' };
    }

    if (smtpResult === false) {
      return { valid: false, reason: 'smtp_invalid', message: '✗ E-mail não existe' };
    }

    // Resultado indeterminado (timeout/filtragem): optar por assumir que existe
    return { valid: true, reason: 'assume_exists_smtp_indeterminate', message: '✓ E-mail existe' };
  } catch (error) {
    console.error('❌ Erro geral na validação de email:', error);
    // Em caso de erro inesperado, assumir existência para evitar bloquear usuários reais
    return { valid: true, reason: 'assume_exists_error', message: '✓ E-mail existe' };
  }
}

module.exports = {
  validateEmail,
  validateEmailFormat,
  validateMXRecords,
  validateSMTP
};
