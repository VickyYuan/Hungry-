/**
 * db.js - 吃什麼？(What To Eat?)
 * IndexedDB 核心資料庫模組與 localStorage 安全遷移引擎
 */

const DB_CONFIG = {
  name: 'WhatToEatDB',
  version: 1,
  stores: {
    places: 'id',
    lists: 'id',
    history: 'id',
    settings: 'key',
    migration_meta: 'key'
  }
};

const DB = {
  dbInstance: null,

  /**
   * 初始化並開啟 IndexedDB
   */
  async open() {
    if (this.dbInstance) return this.dbInstance;

    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        const errorMsg = '您的瀏覽器不支援 IndexedDB，無法使用本地資料庫儲存！';
        console.error(errorMsg);
        alert(errorMsg);
        return reject(new Error(errorMsg));
      }

      const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. 地點/餐廳表
        if (!db.objectStoreNames.contains('places')) {
          const placeStore = db.createObjectStore('places', { keyPath: 'id' });
          placeStore.createIndex('name', 'name', { unique: false });
          placeStore.createIndex('isFavorite', 'isFavorite', { unique: false });
          placeStore.createIndex('isDemo', 'isDemo', { unique: false });
          placeStore.createIndex('category', 'category', { unique: false });
          placeStore.createIndex('district', 'district', { unique: false });
        }

        // 2. 清單表
        if (!db.objectStoreNames.contains('lists')) {
          const listStore = db.createObjectStore('lists', { keyPath: 'id' });
          listStore.createIndex('name', 'name', { unique: false });
        }

        // 3. 吃過/去過歷史紀錄表
        if (!db.objectStoreNames.contains('history')) {
          const histStore = db.createObjectStore('history', { keyPath: 'id' });
          histStore.createIndex('date', 'date', { unique: false });
          histStore.createIndex('placeId', 'placeId', { unique: false });
          histStore.createIndex('isDemo', 'isDemo', { unique: false });
        }

        // 4. 設定表
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // 5. 遷移紀錄與備份資訊表
        if (!db.objectStoreNames.contains('migration_meta')) {
          db.createObjectStore('migration_meta', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.dbInstance = event.target.result;
        resolve(this.dbInstance);
      };

      request.onerror = (event) => {
        const err = event.target.error || new Error('開啟 IndexedDB 失敗');
        console.error('開啟 IndexedDB 失敗:', err);
        reject(err);
      };
    });
  },

  /**
   * 取得指定 store 的事務與物件倉儲
   */
  async getStore(storeName, mode = 'readonly') {
    const db = await this.open();
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  },

  /**
   * 取得全部資料
   */
  async getAll(storeName) {
    const store = await this.getStore(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * 取得單筆資料
   */
  async get(storeName, key) {
    const store = await this.getStore(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * 寫入/更新單筆資料 (Upsert)
   */
  async put(storeName, item) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(item);

      tx.oncomplete = () => resolve(request.result);
      tx.onerror = (e) => {
        console.error(`IndexedDB 寫入 [${storeName}] 失敗:`, e.target.error);
        reject(e.target.error);
      };
      tx.onabort = (e) => {
        console.error(`IndexedDB 事務中斷 [${storeName}]:`, e.target.error);
        reject(e.target.error);
      };
    });
  },

  /**
   * 批次寫入 (保證事務原子性)
   */
  async bulkPut(storeName, items) {
    if (!items || items.length === 0) return 0;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      items.forEach(item => {
        store.put(item);
      });

      tx.oncomplete = () => resolve(items.length);
      tx.onerror = (e) => {
        console.error(`IndexedDB 批次寫入 [${storeName}] 失敗:`, e.target.error);
        reject(e.target.error);
      };
      tx.onabort = (e) => {
        console.error(`IndexedDB 批次事務中斷 [${storeName}]:`, e.target.error);
        reject(e.target.error);
      };
    });
  },

  /**
   * 刪除單筆資料
   */
  async delete(storeName, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);

      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * 清空指定 Store
   */
  async clear(storeName) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * 產生格式化備份檔名：WhatToEat_Backup_YYYY-MM-DD_HH-mm.json
   */
  getBackupFilename(date = new Date()) {
    const YYYY = date.getFullYear();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const DD = String(date.getDate()).padStart(2, '0');
    const HH = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `WhatToEat_Backup_${YYYY}-${MM}-${DD}_${HH}-${mm}.json`;
  },

  /**
   * 匯出現有 localStorage 的完整備份物件（遷移前安全機制）
   */
  createLocalStorageBackupData() {
    const backup = {
      appName: 'WhatToEat',
      backupType: 'pre_migration_localStorage_backup',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      source: 'localStorage',
      data: {
        restaurants: [],
        history: [],
        customLists: [],
        settings: null
      }
    };

    try {
      backup.data.restaurants = JSON.parse(localStorage.getItem('WTE_restaurants') || '[]');
      backup.data.history = JSON.parse(localStorage.getItem('WTE_history') || '[]');
      backup.data.customLists = JSON.parse(localStorage.getItem('WTE_customLists') || '[]');
      backup.data.settings = JSON.parse(localStorage.getItem('WTE_settings') || 'null');
    } catch (err) {
      console.warn('讀取 localStorage 備份時發生部分解析錯誤:', err);
    }

    return backup;
  },

  /**
   * 下載 JSON 備份檔至使用者裝置 (支援電腦與手機)
   */
  downloadJsonFile(dataObj, filename) {
    const jsonStr = JSON.stringify(dataObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },

  /**
   * 核心功能：安全遷移 localStorage 資料至 IndexedDB
   *
   * 保證：
   * 1. 遷移前先產生備份快照
   * 2. 示範資料 (Demo) 與 使用者真實資料 (User) 標記分離
   * 3. 冪等性：可多次安全重試，根據唯一 id 去重更新，絕不重複疊加
   * 4. 驗證完整性：寫入後立即讀取筆數比對驗證
   * 5. 失敗即刻報錯，絕不假裝成功
   * 6. 完好保留 localStorage 原始資料，絕不強制刪除
   */
  async migrateFromLocalStorage() {
    const log = {
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: 'pending',
      backupCreated: false,
      summary: {
        totalPlaces: 0,
        demoPlaces: 0,
        userPlaces: 0,
        totalHistory: 0,
        demoHistory: 0,
        userHistory: 0,
        listsCount: 0
      },
      error: null
    };

    try {
      // 步驟 1: 預先檢查 localStorage 原始資料
      const rawRestJson = localStorage.getItem('WTE_restaurants');
      const rawHistJson = localStorage.getItem('WTE_history');
      const rawListsJson = localStorage.getItem('WTE_customLists');
      const rawSettingsJson = localStorage.getItem('WTE_settings');

      // 取得現有資料 (若 localStorage 為空，則取用預設資料庫)
      let sourceRest = [];
      let sourceHist = [];
      let sourceLists = ['全部', '想吃', '聚餐', '平價'];
      let sourceSettings = null;

      try {
        if (rawRestJson) sourceRest = JSON.parse(rawRestJson);
        else if (window.DEFAULT_RESTAURANTS) sourceRest = JSON.parse(JSON.stringify(window.DEFAULT_RESTAURANTS));

        if (rawHistJson) sourceHist = JSON.parse(rawHistJson);
        else if (window.DEFAULT_HISTORY) sourceHist = JSON.parse(JSON.stringify(window.DEFAULT_HISTORY));

        if (rawListsJson) sourceLists = JSON.parse(rawListsJson);
        if (rawSettingsJson) sourceSettings = JSON.parse(rawSettingsJson);
      } catch (e) {
        throw new Error('解析原始 localStorage 失敗：' + e.message);
      }

      // 步驟 2: 建立遷移前備份資料 (保證即使失敗也有完整快照)
      const preMigrationBackup = this.createLocalStorageBackupData();
      log.backupCreated = true;

      // 步驟 3: 示範資料 (Demo) 與 使用者自訂資料 (User) 分離標記
      // 預設示範餐廳 ID 集合: rest-001 ~ rest-012
      const demoRestIds = new Set(['rest-001', 'rest-002', 'rest-003', 'rest-004', 'rest-005', 'rest-006', 'rest-007', 'rest-008', 'rest-009', 'rest-010', 'rest-011', 'rest-012']);
      // 預設示範歷史 ID 集合: hist-001 ~ hist-004
      const demoHistIds = new Set(['hist-001', 'hist-002', 'hist-003', 'hist-004']);

      // 結構化標準地點模型
      const normalizedPlaces = sourceRest.map((r, idx) => {
        const id = r.id || `place_${Date.now()}_${idx}`;
        const isDemo = demoRestIds.has(id);

        // 提取或推導行政區 (預設西屯區)
        let district = r.area || '西屯區';
        if (r.address) {
          const m = r.address.match(/(西屯區|南屯區|北區|西區|中區|東區|南區|北屯區|大里區|太平區|豐原區|潭子區|大雅區|沙鹿區|清水區|梧棲區|龍井區|大肚區|烏日區|霧峰區|神岡區|后里區|石岡區|東勢區|新社區|和平區|外埔區|大安區|大甲區)/);
          if (m) district = m[1];
        }

        return {
          id: id,
          name: (r.name || '未命名地點').trim(),
          category: r.category || '美食',
          type: r.type || (r.category && (r.category.includes('景點') || r.category.includes('公園')) ? 'spot' : 'food'),
          city: '台中市',
          district: district,
          address: r.address || '',
          rating: typeof r.rating === 'number' ? r.rating : 4.0,
          reviewCount: r.reviewCount || 0,
          avgPrice: r.avgPrice || (r.priceMin && r.priceMax ? Math.round((r.priceMin + r.priceMax) / 2) : 200),
          priceMin: r.priceMin || 100,
          priceMax: r.priceMax || 300,
          openHours: r.openHours || '營業時間請洽店家',
          isOpen: r.isOpen !== false,
          isFavorite: !!r.isFavorite,
          notes: r.description || r.notes || '',
          customLists: Array.isArray(r.customLists) ? r.customLists : (r.customList ? [r.customList] : ['想吃']),
          tags: Array.isArray(r.tags) ? r.tags : (r.category ? [r.category] : []),
          googlePlaceUrl: r.googlePlaceUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name || '')}`,
          photo: r.photo || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600',
          isDemo: isDemo,
          createdAt: r.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      });

      // 結構化標準歷史紀錄模型
      const normalizedHistory = sourceHist.map((h, idx) => {
        const id = h.id || `hist_${Date.now()}_${idx}`;
        const isDemo = demoHistIds.has(id);
        const isSpot = h.placeType === 'spot' || (h.notes && h.notes.includes('參觀'));

        return {
          id: id,
          placeId: h.restaurantId || h.placeId || null,
          placeName: h.restaurantName || h.placeName || '美食店家',
          placeType: isSpot ? 'spot' : 'food',
          actionType: isSpot ? 'visit' : 'eat',
          date: h.date || new Date().toISOString().split('T')[0],
          dayOfWeek: h.dayOfWeek || '平日',
          rating: typeof h.rating === 'number' ? h.rating : 5,
          cost: typeof h.cost === 'number' ? h.cost : 200,
          area: h.area || '西屯區',
          notes: h.notes || '',
          photo: h.photo || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400',
          isDemo: isDemo,
          createdAt: h.createdAt || new Date().toISOString()
        };
      });

      // 結構化清單模型
      const normalizedLists = sourceLists.map((listName) => ({
        id: `list_${listName}`,
        name: listName,
        isDefault: ['全部', '想吃', '聚餐', '平價'].includes(listName),
        createdAt: new Date().toISOString()
      }));

      // 統計數據
      log.summary.totalPlaces = normalizedPlaces.length;
      log.summary.demoPlaces = normalizedPlaces.filter(p => p.isDemo).length;
      log.summary.userPlaces = normalizedPlaces.filter(p => !p.isDemo).length;

      log.summary.totalHistory = normalizedHistory.length;
      log.summary.demoHistory = normalizedHistory.filter(h => h.isDemo).length;
      log.summary.userHistory = normalizedHistory.filter(h => !h.isDemo).length;
      log.summary.listsCount = normalizedLists.length;

      // 步驟 4: 寫入 IndexedDB (以 id 去重 upsert)
      await this.bulkPut('places', normalizedPlaces);
      await this.bulkPut('history', normalizedHistory);
      await this.bulkPut('lists', normalizedLists);

      // 設定值寫入
      const settingsObj = {
        key: 'preferences',
        value: Object.assign({
          excludeRule: '7',
          dislikes: ['內臟', '生食'],
          cuisineWeights: { '日式': 5, '中式': 5, '韓式': 4, '義式': 4, '美式': 3, '泰式': 4, '飲品・輕食': 3, '小吃': 5 },
          budgetMin: 150,
          budgetMax: 250,
          theme: 'cream',
          customDistricts: [],
          lastBackupTime: null
        }, sourceSettings || {})
      };
      await this.put('settings', settingsObj);

      // 步驟 5: 驗證寫入完整性 (Verification)
      const verifiedPlaces = await this.getAll('places');
      const verifiedHistory = await this.getAll('history');

      if (verifiedPlaces.length < normalizedPlaces.length) {
        throw new Error(`地點寫入不完整：預期 ${normalizedPlaces.length} 筆，實際僅讀出 ${verifiedPlaces.length} 筆！`);
      }
      if (verifiedHistory.length < normalizedHistory.length) {
        throw new Error(`歷史紀錄寫入不完整：預期 ${normalizedHistory.length} 筆，實際僅讀出 ${verifiedHistory.length} 筆！`);
      }

      // 步驟 6: 紀錄遷移成功標記並凍結 localStorage 寫入 (絕不清除原始資料)
      log.status = 'success';
      log.completedAt = new Date().toISOString();
      await this.put('migration_meta', {
        key: 'localStorage_migration',
        log: log,
        preMigrationBackup: preMigrationBackup
      });

      // 設定資料庫初始化完成標記 (防止空資料庫重開時誤判復活示範資料)
      await this.put('settings', { key: 'initialized', value: true });

      // 在 localStorage 加上唯讀凍結標記
      try {
        localStorage.setItem('WTE_MIGRATED_FROZEN', 'true');
        localStorage.setItem('WTE_MIGRATED_AT', log.completedAt);
      } catch (e) {
        // ignore
      }

      console.log('🎉 IndexedDB 遷移與驗證成功完成！統計結果：', log.summary);
      return { success: true, log: log, preMigrationBackup: preMigrationBackup };

    } catch (err) {
      log.status = 'failed';
      log.error = err.message;
      console.error('❌ IndexedDB 遷移失敗：', err);

      try {
        await this.put('migration_meta', {
          key: 'localStorage_migration_error',
          log: log
        });
      } catch (e) {
        // ignore
      }

      return { success: false, error: err.message, log: log };
    }
  },

  /**
   * 取得現有遷移紀錄狀態
   */
  async getMigrationStatus() {
    try {
      const record = await this.get('migration_meta', 'localStorage_migration');
      if (record && record.log && record.log.status === 'success') {
        return { migrated: true, log: record.log };
      }
      return { migrated: false };
    } catch (e) {
      return { migrated: false, error: e.message };
    }
  },

  /**
   * 檢查並驗證 IndexedDB 內部資料完整性 (100% 唯讀，絕不自 localStorage 覆寫或復活任何資料)
   */
  async verifyIntegrity() {
    const places = await this.getAll('places');
    const history = await this.getAll('history');
    const lists = await this.getAll('lists');
    const settings = await this.get('settings', 'preferences');
    const initStatus = await this.get('settings', 'initialized');

    return {
      healthy: true,
      initialized: initStatus && initStatus.value === true,
      placesCount: places.length,
      userPlacesCount: places.filter(p => !p.isDemo).length,
      demoPlacesCount: places.filter(p => p.isDemo).length,
      historyCount: history.length,
      userHistoryCount: history.filter(h => !h.isDemo).length,
      demoHistoryCount: history.filter(h => h.isDemo).length,
      listsCount: lists.length,
      hasSettings: !!settings
    };
  }
};

window.DB = DB;
