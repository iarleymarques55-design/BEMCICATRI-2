/**
 * =====================================================
 * Storage Manager - BemCicatri
 * =====================================================
 * Gerencia armazenamento de dados no cliente (localStorage/IndexedDB)
 * com sincronização automática com servidor
 * 
 * Suporta:
 * - localStorage: Dados simples e rápido
 * - IndexedDB: Grandes volumes de dados
 * - Sincronização com API quando disponível
 * - Offline-first mode
 */

class StorageManager {
  constructor() {
    this.DB_NAME = 'bemcicatri_db';
    this.DB_VERSION = 1;
    this.STORES = {
      users: 'users',
      patients: 'patients',
      sessions: 'sessions',
      daily_records: 'daily_records',
      sync_queue: 'sync_queue'  // Fila de operações pendentes
    };
    this.idbReady = false;
    this.idb = null;
    this.initIndexedDB();
  }

  /**
   * Inicializar IndexedDB
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        console.warn('⚠️ IndexedDB falhou, usando localStorage apenas');
        this.idbReady = false;
        resolve(false);
      };

      request.onsuccess = (event) => {
        this.idb = event.target.result;
        this.idbReady = true;
        console.log('✅ IndexedDB inicializado');
        resolve(true);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Criar object stores
        if (!db.objectStoreNames.contains(this.STORES.users)) {
          const userStore = db.createObjectStore(this.STORES.users, { keyPath: 'email' });
          userStore.createIndex('tipo', 'tipo', { unique: false });
          userStore.createIndex('created_at', 'created_at', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.STORES.patients)) {
          const patientStore = db.createObjectStore(this.STORES.patients, { keyPath: 'id', autoIncrement: true });
          patientStore.createIndex('user_id', 'user_id', { unique: false });
          patientStore.createIndex('nome', 'nome', { unique: false });
          patientStore.createIndex('created_at', 'created_at', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.STORES.sessions)) {
          const sessionStore = db.createObjectStore(this.STORES.sessions, { keyPath: 'id', autoIncrement: true });
          sessionStore.createIndex('patient_id', 'patient_id', { unique: false });
          sessionStore.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.STORES.daily_records)) {
          const recordStore = db.createObjectStore(this.STORES.daily_records, { keyPath: 'id', autoIncrement: true });
          recordStore.createIndex('session_id', 'session_id', { unique: false });
          recordStore.createIndex('day_number', 'day_number', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.STORES.sync_queue)) {
          db.createObjectStore(this.STORES.sync_queue, { keyPath: 'id', autoIncrement: true });
        }

        console.log('✅ IndexedDB stores criados');
      };
    });
  }

  /**
   * Armazenar dados com fallback automático
   * Tenta IndexedDB primeiro, depois localStorage
   */
  async set(store, key, data) {
    try {
      // Tentar IndexedDB
      if (this.idbReady && this.idb) {
        return await this.setIndexedDB(store, key, data);
      }
    } catch (e) {
      console.warn(`⚠️ IndexedDB falhou para ${store}:`, e);
    }

    // Fallback: localStorage
    try {
      localStorage.setItem(`${store}:${key}`, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error(`❌ Storage falhou para ${store}:${key}`, e);
      return false;
    }
  }

  /**
   * Recuperar dados com fallback automático
   */
  async get(store, key) {
    try {
      // Tentar IndexedDB
      if (this.idbReady && this.idb) {
        return await this.getIndexedDB(store, key);
      }
    } catch (e) {
      console.warn(`⚠️ IndexedDB falhou para ${store}:`, e);
    }

    // Fallback: localStorage
    try {
      const data = localStorage.getItem(`${store}:${key}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error(`❌ Storage falhou para ${store}:${key}`, e);
      return null;
    }
  }

  /**
   * Operações IndexedDB
   */
  async setIndexedDB(store, key, data) {
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction([store], 'readwrite');
      const objectStore = tx.objectStore(store);
      const request = objectStore.put({ ...data, [objectStore.keyPath]: key });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async getIndexedDB(store, key) {
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction([store], 'readonly');
      const objectStore = tx.objectStore(store);
      const request = objectStore.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  /**
   * Limpar tudo
   */
  async clearAll() {
    // Limpar localStorage
    Object.values(this.STORES).forEach(store => {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(`${store}:`)) {
          localStorage.removeItem(key);
        }
      });
    });

    // Limpar IndexedDB
    if (this.idbReady && this.idb) {
      return new Promise((resolve) => {
        const tx = this.idb.transaction(Object.values(this.STORES), 'readwrite');
        Object.values(this.STORES).forEach(store => {
          const request = tx.objectStore(store).clear();
          request.onerror = () => console.error(`Erro ao limpar ${store}`);
        });
        tx.oncomplete = () => {
          console.log('✅ Todos os dados foram limpos');
          resolve(true);
        };
      });
    }

    console.log('✅ localStorage limpo');
    return true;
  }

  /**
   * Exportar dados (para backup)
   */
  async exportData() {
    const backup = {
      timestamp: new Date().toISOString(),
      users: [],
      patients: [],
      sessions: [],
      daily_records: []
    };

    // Exportar de localStorage primeiro
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('users:')) {
        backup.users.push(JSON.parse(localStorage.getItem(key)));
      } else if (key.startsWith('patients:')) {
        backup.patients.push(JSON.parse(localStorage.getItem(key)));
      } else if (key.startsWith('sessions:')) {
        backup.sessions.push(JSON.parse(localStorage.getItem(key)));
      }
    });

    return backup;
  }

  /**
   * Importar dados (restaurar backup)
   */
  async importData(backup) {
    try {
      (backup.users || []).forEach(user => {
        this.set(this.STORES.users, user.email, user);
      });

      (backup.patients || []).forEach(patient => {
        this.set(this.STORES.patients, patient.id, patient);
      });

      (backup.sessions || []).forEach(session => {
        this.set(this.STORES.sessions, session.id, session);
      });

      console.log('✅ Dados importados com sucesso');
      return true;
    } catch (e) {
      console.error('❌ Erro ao importar dados:', e);
      return false;
    }
  }

  /**
   * Sincronizar com servidor quando voltar online
   */
  async syncWithServer(apiUrl) {
    if (!this.idbReady || !this.idb) return;

    try {
      // Recuperar fila de sincronização
      const tx = this.idb.transaction([this.STORES.sync_queue], 'readonly');
      const store = tx.objectStore(this.STORES.sync_queue);
      
      return new Promise((resolve) => {
        const request = store.getAll();
        request.onsuccess = async () => {
          const queue = request.result;
          let synced = 0;

          for (const item of queue) {
            try {
              // Enviar para servidor
              const response = await fetch(`${apiUrl}/${item.endpoint}`, {
                method: item.method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item.data)
              });

              if (response.ok) {
                // Remover da fila
                const delTx = this.idb.transaction([this.STORES.sync_queue], 'readwrite');
                delTx.objectStore(this.STORES.sync_queue).delete(item.id);
                synced++;
              }
            } catch (e) {
              console.warn(`⚠️ Erro ao sincronizar item ${item.id}:`, e);
            }
          }

          console.log(`✅ ${synced}/${queue.length} itens sincronizados`);
          resolve(synced);
        };
      });
    } catch (e) {
      console.error('❌ Erro ao sincronizar com servidor:', e);
      return 0;
    }
  }
}

// Instância global
const storage = new StorageManager();
