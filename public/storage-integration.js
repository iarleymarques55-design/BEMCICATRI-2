/**
 * =====================================================
 * Integration Module - Storage & Offline
 * =====================================================
 * Integra storage-manager.js e offline-manager.js
 * com a aplicação existente do BemCicatri
 * 
 * Uso:
 * - Adicione antes do app.js no HTML
 * - Usa automaticamente o melhor storage disponível
 */

// ===================== ENHANCED STORAGE API =====================

/**
 * Salvar usuário com priorização de storage
 */
async function saveUserToStorage(email, userData) {
  const key = email.toLowerCase();
  
  // Tentar IndexedDB
  if (storage && storage.idbReady) {
    await storage.set(storage.STORES.users, key, userData);
    console.log(`✅ Usuário ${email} salvo em IndexedDB`);
  } else {
    // Fallback para localStorage
    lsSet('bemc_users', { ...lsGet('bemc_users') || {}, [key]: userData });
    console.log(`✅ Usuário ${email} salvo em localStorage`);
  }

  // Se offline, adicionar à fila de sincronização
  if (!offlineManager.isOnline) {
    await offlineManager.queueOperation({
      type: 'user_update',
      method: 'POST',
      url: `${getApiUrl()}/users`,
      data: userData,
      headers: {}
    });
  }
}

/**
 * Recuperar usuário de storage otimizado
 */
async function getUserFromStorage(email) {
  const key = email.toLowerCase();
  
  // Tentar IndexedDB primeiro (mais rápido para grandes dados)
  if (storage && storage.idbReady) {
    const user = await storage.get(storage.STORES.users, key);
    if (user) return user;
  }
  
  // Fallback para localStorage
  const user = lsGet('bemc_users')?.[key];
  return user || null;
}

/**
 * Salvar paciente com priorização de storage
 */
async function savePatientToStorage(patientData) {
  const id = patientData.id || Date.now();
  
  // Tentar IndexedDB
  if (storage && storage.idbReady) {
    await storage.set(storage.STORES.patients, id, { ...patientData, id });
    console.log(`✅ Paciente ${id} salvo em IndexedDB`);
  } else {
    // Fallback para localStorage
    const all = lsGet('bemc_patients') || [];
    const idx = all.findIndex(p => p.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...patientData, id };
    } else {
      all.push({ ...patientData, id });
    }
    lsSet('bemc_patients', all);
    console.log(`✅ Paciente ${id} salvo em localStorage`);
  }

  // Se offline, adicionar à fila de sincronização
  if (!offlineManager.isOnline) {
    await offlineManager.queueOperation({
      type: 'patient_save',
      method: 'POST',
      url: `${getApiUrl()}/patients`,
      data: { ...patientData, id },
      headers: {}
    });
  }

  return { ...patientData, id };
}

/**
 * Recuperar pacientes com cache otimizado
 */
async function getPatientsFromStorage(userEmail) {
  const email = userEmail.toLowerCase();
  const patients = [];

  // Tentar IndexedDB primeiro
  if (storage && storage.idbReady) {
    // Aqui deveria fazer uma query por índice, mas vamos fazer iteração simples
    try {
      return await new Promise((resolve) => {
        const tx = storage.idb.transaction([storage.STORES.patients], 'readonly');
        const store = tx.objectStore(storage.STORES.patients);
        const request = store.getAll();
        
        request.onsuccess = () => {
          resolve(request.result.filter(p => p.userEmail === email));
        };
        request.onerror = () => resolve([]);
      });
    } catch (e) {
      console.warn('⚠️ Erro ao buscar pacientes do IndexedDB:', e);
    }
  }

  // Fallback para localStorage
  const all = lsGet('bemc_patients') || [];
  return all.filter(p => p.userEmail === email);
}

/**
 * Deletar paciente de storage
 */
async function deletePatientFromStorage(id) {
  // IndexedDB
  if (storage && storage.idbReady) {
    try {
      return await new Promise((resolve) => {
        const tx = storage.idb.transaction([storage.STORES.patients], 'readwrite');
        const request = tx.objectStore(storage.STORES.patients).delete(id);
        request.onsuccess = () => {
          console.log(`✅ Paciente ${id} deletado do IndexedDB`);
          resolve(true);
        };
        request.onerror = () => resolve(false);
      });
    } catch (e) {
      console.warn('⚠️ Erro ao deletar do IndexedDB:', e);
    }
  }

  // localStorage
  const all = lsGet('bemc_patients') || [];
  lsSet('bemc_patients', all.filter(p => String(p.id) !== String(id)));
  console.log(`✅ Paciente ${id} deletado do localStorage`);

  // Fila de sincronização
  if (!offlineManager.isOnline) {
    await offlineManager.queueOperation({
      type: 'patient_delete',
      method: 'DELETE',
      url: `${getApiUrl()}/patients/${id}`,
      data: { id },
      headers: {}
    });
  }

  return true;
}

/**
 * Salvar estado do simulador
 */
async function saveSimulatorState(patientId, state) {
  const stateData = {
    patientId,
    state,
    timestamp: new Date().toISOString()
  };

  // localStorage rápido para estado do simulador
  const key = `simulator_state:${patientId}`;
  lsSet(key, stateData);

  // Também em IndexedDB se disponível
  if (storage && storage.idbReady) {
    await storage.set('simulator_state', patientId, stateData);
  }

  console.log(`✅ Estado do simulador ${patientId} salvo`);

  // Sincronizar se possível
  if (offlineManager.isOnline) {
    try {
      await fetch(`${getApiUrl()}/patients/${patientId}/simulator-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
    } catch (e) {
      console.warn('⚠️ Erro ao sincronizar estado:', e);
    }
  } else {
    await offlineManager.queueOperation({
      type: 'simulator_state',
      method: 'POST',
      url: `${getApiUrl()}/patients/${patientId}/simulator-state`,
      data: state,
      headers: {}
    });
  }
}

/**
 * Recuperar estado do simulador
 */
async function getSimulatorState(patientId) {
  // localStorage primeiro (mais rápido)
  const key = `simulator_state:${patientId}`;
  const cached = lsGet(key);
  if (cached) return cached.state;

  // IndexedDB
  if (storage && storage.idbReady) {
    const data = await storage.get('simulator_state', patientId);
    if (data) return data.state;
  }

  return null;
}

// ===================== STORAGE INFO PANEL =====================

/**
 * Criar painel de informações de armazenamento
 */
function createStorageInfoPanel() {
  const panel = document.createElement('div');
  panel.id = 'storage-info-panel';
  panel.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px;
    max-width: 300px;
    font-size: 12px;
    font-family: monospace;
    z-index: 9998;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    display: none;
  `;

  const button = document.createElement('button');
  button.textContent = '💾 Storage';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 8px 12px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    z-index: 9998;
  `;

  button.onclick = () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };

  // Atualizar informações
  const updateInfo = () => {
    const storageUsed = JSON.stringify(localStorage).length / 1024; // KB
    const status = offlineManager.getStatus();
    
    panel.innerHTML = `
      <div style="margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;">
        <strong>📊 Storage Status</strong>
      </div>
      <div>Storage Usado: ~${storageUsed.toFixed(2)} KB</div>
      <div>Connection: ${status.isOnline ? '🟢 Online' : '🔴 Offline'}</div>
      <div>Operações Pendentes: ${status.pendingOperations}</div>
      <div>Sincronizando: ${status.isSyncing ? 'Sim ✓' : 'Não'}</div>
      <div style="margin-top: 8px; border-top: 1px solid #e5e7eb; padding-top: 8px;">
        <button onclick="exportStorageData()" style="width: 100%; padding: 4px; margin-bottom: 4px; cursor: pointer; background: #10b981; color: white; border: none; border-radius: 4px; font-size: 11px;">
          📥 Exportar Dados
        </button>
        <button onclick="clearStorageData()" style="width: 100%; padding: 4px; cursor: pointer; background: #ef4444; color: white; border: none; border-radius: 4px; font-size: 11px;">
          🗑️ Limpar Dados
        </button>
      </div>
    `;
  };

  updateInfo();
  setInterval(updateInfo, 2000);

  document.body.appendChild(button);
  document.body.appendChild(panel);
}

/**
 * Exportar dados para backup
 */
async function exportStorageData() {
  const backup = await storage.exportData();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bemcicatri-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  console.log('✅ Dados exportados para arquivo');
}

/**
 * Limpar dados local
 */
async function clearStorageData() {
  if (confirm('⚠️ Tem certeza? Isso vai deletar TODOS os dados locais!\n\nNão será possível recuperar.')) {
    await storage.clearAll();
    alert('✅ Dados locais foram limpos');
    location.reload();
  }
}

// ===================== INICIALIZAÇÃO =====================

// Criar painel de storage quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  createStorageInfoPanel();
  console.log('✅ Storage Integration inicializado');
});

// Log de sincronização
console.log(`
🗄️ ===================== STORAGE INFO =====================
📊 localStorage disponível: ${!!localStorage}
🗃️ IndexedDB disponível: ${!!window.indexedDB}
🟢 Online Status: ${offlineManager.isOnline ? 'Sim' : 'Não'}
📋 Pendentes: ${offlineManager.syncQueue.length}
════════════════════════════════════════════════════════
`);
