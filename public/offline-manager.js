/**
 * =====================================================
 * Offline-First Manager - BemCicatri
 * =====================================================
 * Gerencia operações offline e sincronização automática
 * quando a conexão for restaurada
 */

class OfflineFirstManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.syncQueue = [];
    this.maxRetries = 3;
    this.retryDelay = 2000; // 2 segundos
    this.isSync = false;
    
    // Listeners de eventos
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  /**
   * Quando voltar online
   */
  async handleOnline() {
    if (this.isOnline) return; // Já estava online
    
    this.isOnline = true;
    console.log('🌐 Conexão restaurada!');
    
    this.showNotification('✅ Conexão Restaurada', 'Sincronizando dados salvos...', 'success');
    
    // Aguardar um pouco antes de sincronizar
    await new Promise(r => setTimeout(r, 1000));
    
    // Sincronizar dados pendentes
    await this.syncPendingOperations();
  }

  /**
   * Quando ficar offline
   */
  handleOffline() {
    this.isOnline = false;
    console.log('📵 Modo Offline Ativado');
    this.showNotification('📵 Modo Offline', 'Seus dados serão salvos localmente', 'warning');
  }

  /**
   * Adicionar operação à fila de sincronização
   */
  async queueOperation(operation) {
    this.syncQueue.push({
      ...operation,
      timestamp: Date.now(),
      retries: 0
    });

    console.log(`📋 Operação enfileirada: ${operation.type}`);

    // Se online, sincronizar imediatamente
    if (this.isOnline && !this.isSync) {
      await this.syncPendingOperations();
    }
  }

  /**
   * Sincronizar operações pendentes
   */
  async syncPendingOperations() {
    if (this.isSync || this.syncQueue.length === 0) return;
    
    this.isSync = true;
    console.log(`🔄 Sincronizando ${this.syncQueue.length} operações...`);

    const failed = [];

    for (const op of this.syncQueue) {
      const success = await this.executeOperation(op);
      if (!success) {
        failed.push(op);
      }
    }

    // Manter apenas as que falharam
    this.syncQueue = failed;
    this.isSync = false;

    if (failed.length === 0) {
      console.log('✅ Todas as operações foram sincronizadas');
      this.showNotification('✅ Sincronizado', 'Todos os dados foram sincronizados com sucesso', 'success');
    } else {
      console.warn(`⚠️ ${failed.length} operações falharam`);
      this.showNotification('⚠️ Sincronização Parcial', `${failed.length} itens pendentes`, 'warning');
    }
  }

  /**
   * Executar operação com retry
   */
  async executeOperation(op, attempt = 1) {
    try {
      const response = await fetch(op.url, {
        method: op.method,
        headers: {
          'Content-Type': 'application/json',
          ...op.headers
        },
        body: JSON.stringify(op.data)
      });

      if (response.ok) {
        console.log(`✅ Operação sincronizada: ${op.type}`);
        return true;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (e) {
      console.warn(`⚠️ Erro ao sincronizar ${op.type} (tentativa ${attempt}):`, e.message);

      // Tentar novamente se não atingiu limite
      if (attempt < this.maxRetries) {
        await new Promise(r => setTimeout(r, this.retryDelay * attempt));
        return await this.executeOperation(op, attempt + 1);
      }

      return false;
    }
  }

  /**
   * Mostrar notificação visual
   */
  showNotification(title, message, type = 'info') {
    const notif = document.createElement('div');
    notif.className = `offline-notification offline-notification-${type}`;
    notif.innerHTML = `
      <div class="offline-notification-content">
        <strong>${title}</strong>
        <p>${message}</p>
      </div>
    `;

    document.body.appendChild(notif);

    // Auto-remover após 5 segundos
    setTimeout(() => {
      notif.classList.add('offline-notification-hide');
      setTimeout(() => notif.remove(), 300);
    }, 5000);
  }

  /**
   * Status atual
   */
  getStatus() {
    return {
      isOnline: this.isOnline,
      pendingOperations: this.syncQueue.length,
      isSyncing: this.isSync
    };
  }
}

// Estilos das notificações
const offlineStyles = document.createElement('style');
offlineStyles.innerHTML = `
  .offline-notification {
    position: fixed;
    top: 20px;
    right: 20px;
    max-width: 400px;
    padding: 16px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .offline-notification-content {
    margin: 0;
  }

  .offline-notification-content strong {
    display: block;
    margin-bottom: 4px;
    font-size: 14px;
    font-weight: 600;
  }

  .offline-notification-content p {
    margin: 0;
    font-size: 13px;
    opacity: 0.8;
  }

  .offline-notification-success {
    background: #d1fae5;
    color: #065f46;
    border-left: 4px solid #10b981;
  }

  .offline-notification-warning {
    background: #fef3c7;
    color: #92400e;
    border-left: 4px solid #f59e0b;
  }

  .offline-notification-error {
    background: #fee2e2;
    color: #b91c1c;
    border-left: 4px solid #ef4444;
  }

  .offline-notification-info {
    background: #dbeafe;
    color: #0c4a6e;
    border-left: 4px solid #3b82f6;
  }

  .offline-notification-hide {
    animation: slideOut 0.3s ease-in;
  }

  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }

  @media (max-width: 640px) {
    .offline-notification {
      top: 10px;
      right: 10px;
      left: 10px;
      max-width: none;
    }
  }
`;
document.head.appendChild(offlineStyles);

// Instância global
const offlineManager = new OfflineFirstManager();
