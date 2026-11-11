/**
 * cloud-sync.js - 吃什麼？雲端同步 (Firebase Auth + Firestore，Spark 免費方案)
 *
 * 設計原則
 * - 本機 IndexedDB 仍是 App 的主要資料來源，離線照常可用；登入後才與雲端雙向同步。
 * - 不登入時完全不影響原本功能。
 * - 只上傳「內容有變動」的資料，避免浪費免費額度。
 * - 刪除以「刪除標記 (tombstone)」同步，其他裝置才知道要一併刪除。
 * - 雲端路徑：users/{uid}/places/{id}、users/{uid}/history/{id}、users/{uid}/meta/profile
 *   安全規則只允許本人讀寫自己的 users/{uid}。
 *
 * 合併規則 (每次登入或重新整理時)
 * - 只有雲端有 → 下載到本機
 * - 只有本機有 → 上傳到雲端 (若雲端已有同名同地址的店家，視為同一家，不重複上傳)
 * - 兩邊都有 → 以雲端為準 (雲端是各裝置共用的版本)
 * - 雲端標記為已刪除 → 本機也刪除
 */
(function () {
  const SYNCED_STORES = ['places', 'history'];
  const BATCH_LIMIT = 400;

  // 依 key 排序的穩定 JSON，用來判斷內容是否真的有變動
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort()
      .filter(k => value[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }

  // 移除 undefined / function 等 Firestore 不接受的值
  function clean(obj) {
    return JSON.parse(JSON.stringify(obj == null ? null : obj));
  }

  function docIdOf(id) {
    return encodeURIComponent(String(id));
  }

  function normalizeKey(r) {
    const name = String((r && r.name) || '').replace(/\s+/g, '').toLowerCase();
    const addr = String((r && r.address) || '').replace(/\s+/g, '').replace(/^台灣|^臺灣/, '').replace(/臺/g, '台');
    return name ? `${name}|${addr}` : null;
  }

  const CloudSync = {
    available: false,
    user: null,
    status: 'off',        // off | signing-in | syncing | synced | offline | error
    lastSyncedAt: null,
    lastError: null,
    fb: null,
    auth: null,
    firestore: null,
    unsubscribers: [],
    remoteJson: { places: new Map(), history: new Map() },
    profileJson: null,
    pending: { places: new Map(), history: new Map() },
    profileDirty: false,
    flushTimer: null,
    rerenderTimer: null,
    raw: null,

    // ---------- 包裝 DB 寫入：本機寫入成功後，自動排入雲端上傳 ----------
    wrapDB() {
      if (typeof DB === 'undefined' || this.raw) return;
      const raw = {
        put: DB.put.bind(DB),
        bulkPut: DB.bulkPut.bind(DB),
        delete: DB.delete.bind(DB)
      };
      this.raw = raw;
      const self = this;
      DB.put = async function (storeName, item) {
        const r = await raw.put(storeName, item);
        self.onLocalPut(storeName, [item]);
        return r;
      };
      DB.bulkPut = async function (storeName, items) {
        const r = await raw.bulkPut(storeName, items);
        self.onLocalPut(storeName, items || []);
        return r;
      };
      DB.delete = async function (storeName, key) {
        const r = await raw.delete(storeName, key);
        self.onLocalDelete(storeName, key);
        return r;
      };
    },

    onLocalPut(storeName, items) {
      if (!this.user) return;
      if (SYNCED_STORES.includes(storeName)) {
        items.forEach(item => {
          if (!item || item.id == null) return;
          const json = stableStringify(clean(item));
          if (this.remoteJson[storeName].get(String(item.id)) === json) return; // 內容沒變，不上傳
          this.pending[storeName].set(String(item.id), { data: clean(item), json });
        });
        this.scheduleFlush();
      } else if (storeName === 'settings' || storeName === 'lists') {
        const key = items[0] && items[0].key;
        if (storeName === 'lists' || key === 'preferences' || key === 'customLists') {
          this.profileDirty = true;
          this.scheduleFlush();
        }
      }
    },

    onLocalDelete(storeName, key) {
      if (!this.user || !SYNCED_STORES.includes(storeName)) return;
      this.pending[storeName].set(String(key), { deleted: true });
      this.scheduleFlush();
    },

    scheduleFlush() {
      clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => this.flush(), 500);
    },

    userDoc() {
      return this.firestore.collection('users').doc(this.user.uid);
    },

    currentProfile() {
      return {
        settings: clean(AppState.settings),
        customLists: Array.from(new Set(AppState.customLists || []))
      };
    },

    // 把排隊中的變更寫上雲端 (分批，每批 ≤ 400 筆)
    async flush() {
      if (!this.user) return;
      const ops = [];
      SYNCED_STORES.forEach(storeName => {
        this.pending[storeName].forEach((entry, id) => ops.push({ storeName, id, entry }));
        this.pending[storeName].clear();
      });
      let profile = null;
      if (this.profileDirty) {
        profile = this.currentProfile();
        this.profileDirty = false;
        const json = stableStringify(profile);
        if (json === this.profileJson) profile = null;
        else this.profileJson = json;
      }
      if (ops.length === 0 && !profile) return;

      this.setStatus('syncing');
      try {
        const base = this.userDoc();
        const now = Date.now();
        const chunks = [];
        for (let i = 0; i < ops.length; i += BATCH_LIMIT) chunks.push(ops.slice(i, i + BATCH_LIMIT));
        if (chunks.length === 0) chunks.push([]); // 只有個人設定要上傳
        for (let ci = 0; ci < chunks.length; ci++) {
          const batch = this.firestore.batch();
          chunks[ci].forEach(({ storeName, id, entry }) => {
            const ref = base.collection(storeName).doc(docIdOf(id));
            if (entry.deleted) {
              batch.set(ref, { id, deleted: true, data: null, updatedAt: now });
              this.remoteJson[storeName].delete(id);
            } else {
              batch.set(ref, { id, deleted: false, data: entry.data, updatedAt: now });
              this.remoteJson[storeName].set(id, entry.json);
            }
          });
          if (ci === 0 && profile) {
            batch.set(base.collection('meta').doc('profile'), Object.assign({ updatedAt: now }, profile));
          }
          await batch.commit();
        }
        this.lastSyncedAt = new Date();
        this.setStatus(navigator.onLine === false ? 'offline' : 'synced');
      } catch (err) {
        console.error('雲端同步上傳失敗：', err);
        this.lastError = err;
        // 失敗的項目放回佇列，下次再試
        ops.forEach(({ storeName, id, entry }) => {
          if (!this.pending[storeName].has(id)) this.pending[storeName].set(id, entry);
          this.remoteJson[storeName].delete(id);
        });
        if (profile) { this.profileDirty = true; this.profileJson = null; }
        this.setStatus('error');
      }
    },

    // ---------- 啟動：由 app.js 在本機資料載入完成後呼叫 ----------
    start() {
      this.renderButton();
      if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG) {
        console.warn('Firebase SDK 未載入，雲端同步停用（App 仍可離線使用）。');
        this.available = false;
        this.renderButton();
        return;
      }
      try {
        this.fb = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
        this.auth = firebase.auth();
        this.firestore = firebase.firestore();
        try {
          this.firestore.enablePersistence({ synchronizeTabs: true }).catch(() => {});
        } catch (e) { /* 部分瀏覽器不支援離線快取，忽略 */ }
        this.available = true;
      } catch (err) {
        console.error('Firebase 初始化失敗：', err);
        this.available = false;
        this.renderButton();
        return;
      }

      // 從 redirect 登入回來時，取得可能的錯誤
      this.auth.getRedirectResult().catch(err => this.handleAuthError(err));

      this.auth.onAuthStateChanged(async (user) => {
        this.detachListeners();
        this.user = user || null;
        if (user) {
          await this.initialSync();
        } else {
          this.setStatus('off');
        }
      });

      window.addEventListener('online', () => { if (this.user) { this.setStatus('syncing'); this.flush().then(() => this.setStatus('synced')); } });
      window.addEventListener('offline', () => { if (this.user) this.setStatus('offline'); });
    },

    async signIn() {
      if (!this.available) {
        alert('雲端同步目前無法使用（可能是網路未連線）。App 仍可在本機正常使用。');
        return;
      }
      this.setStatus('signing-in');
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await this.auth.signInWithPopup(provider);
      } catch (err) {
        if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
          await this.auth.signInWithRedirect(provider);
          return;
        }
        this.handleAuthError(err);
        this.setStatus(this.user ? 'synced' : 'off');
      }
    },

    async signOut() {
      if (!this.auth) return;
      await this.flush().catch(() => {});
      this.detachListeners();
      await this.auth.signOut();
      this.user = null;
      this.remoteJson = { places: new Map(), history: new Map() };
      this.profileJson = null;
      this.setStatus('off');
    },

    handleAuthError(err) {
      if (!err) return;
      const code = err.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      console.error('登入失敗：', err);
      let msg = '登入失敗：' + (err.message || code);
      if (code === 'auth/unauthorized-domain') {
        msg = '登入失敗：這個網址尚未加入 Firebase「已授權網域」。\n請到 Firebase → Authentication → 設定 → 已授權網域，加入：\n' + location.hostname;
      } else if (code === 'auth/network-request-failed') {
        msg = '登入失敗：網路連線異常，請稍後再試。';
      }
      alert(msg);
    },

    // ---------- 登入後第一次同步：合併本機與雲端 ----------
    async initialSync() {
      this.setStatus('syncing');
      try {
        const base = this.userDoc();
        const [placeSnap, histSnap, profileSnap] = await Promise.all([
          base.collection('places').get(),
          base.collection('history').get(),
          base.collection('meta').doc('profile').get()
        ]);

        this.remoteJson = { places: new Map(), history: new Map() };
        const placeIdRemap = await this.mergeStore('places', placeSnap, AppState.restaurants);
        await this.mergeStore('history', histSnap, AppState.history, placeIdRemap);
        await this.mergeProfile(profileSnap);

        // 已有使用者資料，避免下次開啟時又被示範資料覆蓋
        await this.raw.put('settings', { key: 'initialized', value: true });

        await this.flush();
        this.attachListeners();
        this.lastSyncedAt = new Date();
        this.setStatus(navigator.onLine === false ? 'offline' : 'synced');
        this.rerender();
      } catch (err) {
        console.error('雲端同步失敗：', err);
        this.lastError = err;
        this.setStatus('error');
        if (err && err.code === 'permission-denied') {
          alert('雲端同步被拒絕：請確認 Firestore 安全規則已正確設定。\n你的資料仍安全地保存在這台裝置上。');
        }
      }
    },

    async mergeStore(storeName, snap, localArr, placeIdRemap) {
      const remoteMap = new Map();
      snap.forEach(doc => {
        const d = doc.data();
        if (d && d.id != null) remoteMap.set(String(d.id), d);
      });
      const localMap = new Map(localArr.map(item => [String(item.id), item]));

      // 1. 雲端資料覆蓋/新增到本機；雲端刪除標記同步刪除本機
      for (const [id, d] of remoteMap) {
        if (d.deleted) {
          if (localMap.has(id)) {
            await this.raw.delete(storeName, localMap.get(id).id);
            this.removeFromArray(localArr, id);
          }
          continue;
        }
        const data = d.data;
        const json = stableStringify(clean(data));
        this.remoteJson[storeName].set(id, json);
        const local = localMap.get(id);
        if (!local || stableStringify(clean(local)) !== json) {
          await this.raw.put(storeName, data);
          this.upsertArray(localArr, data);
        }
      }

      // 2. 只有本機有的 → 上傳 (店家若與雲端同名同地址則視為同一家)
      const remap = new Map();
      const remoteKeys = new Map();
      if (storeName === 'places') {
        remoteMap.forEach((d, id) => {
          if (!d.deleted && d.data) {
            const k = normalizeKey(d.data);
            if (k) remoteKeys.set(k, id);
          }
        });
      }
      for (const [id, item] of localMap) {
        if (remoteMap.has(id)) continue;
        if (storeName === 'places') {
          const k = normalizeKey(item);
          const dupId = k && remoteKeys.get(k);
          if (dupId) {
            remap.set(id, dupId);
            await this.raw.delete('places', item.id);
            this.removeFromArray(localArr, id);
            continue;
          }
        }
        let data = item;
        if (placeIdRemap && placeIdRemap.size > 0) {
          const pid = item.placeId != null ? placeIdRemap.get(String(item.placeId)) : null;
          const rid = item.restaurantId != null ? placeIdRemap.get(String(item.restaurantId)) : null;
          if (pid || rid) {
            data = Object.assign({}, item, pid ? { placeId: pid } : {}, rid ? { restaurantId: rid } : {});
            await this.raw.put(storeName, data);
            this.upsertArray(localArr, data);
          }
        }
        this.pending[storeName].set(id, { data: clean(data), json: stableStringify(clean(data)) });
      }
      return remap;
    },

    async mergeProfile(profileSnap) {
      if (profileSnap.exists) {
        const p = profileSnap.data() || {};
        if (p.settings) AppState.settings = Object.assign(AppState.settings, p.settings);
        const merged = Array.from(new Set([...(p.customLists || []), ...(AppState.customLists || [])]));
        AppState.customLists = merged;
        this.profileJson = stableStringify({ settings: clean(p.settings || {}), customLists: p.customLists || [] });
        await this.raw.put('settings', { key: 'preferences', value: AppState.settings });
        await this.raw.put('settings', { key: 'customLists', value: AppState.customLists });
      }
      // 若本機有雲端沒有的清單，或雲端還沒有個人設定，就上傳
      this.profileDirty = true;
    },

    // ---------- 即時監聽：其他裝置的變更會自動同步過來 ----------
    attachListeners() {
      const base = this.userDoc();
      SYNCED_STORES.forEach(storeName => {
        const unsub = base.collection(storeName).onSnapshot(snap => {
          let changed = false;
          snap.docChanges().forEach(change => {
            if (change.doc.metadata.hasPendingWrites || change.type === 'removed') return;
            const d = change.doc.data();
            if (!d || d.id == null) return;
            if (this.applyRemote(storeName, d)) changed = true;
          });
          if (changed) this.rerender();
        }, err => {
          console.error('雲端即時同步中斷：', err);
          this.setStatus('error');
        });
        this.unsubscribers.push(unsub);
      });
      const unsubProfile = base.collection('meta').doc('profile').onSnapshot(doc => {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        const p = doc.data() || {};
        const json = stableStringify({ settings: clean(p.settings || {}), customLists: p.customLists || [] });
        if (json === this.profileJson) return;
        this.profileJson = json;
        if (p.settings) AppState.settings = Object.assign(AppState.settings, p.settings);
        if (Array.isArray(p.customLists)) AppState.customLists = p.customLists.slice();
        this.raw.put('settings', { key: 'preferences', value: AppState.settings });
        this.raw.put('settings', { key: 'customLists', value: AppState.customLists });
        this.rerender(true);
      });
      this.unsubscribers.push(unsubProfile);
    },

    applyRemote(storeName, d) {
      const id = String(d.id);
      const arr = storeName === 'places' ? AppState.restaurants : AppState.history;
      if (d.deleted) {
        this.remoteJson[storeName].delete(id);
        const exists = arr.some(x => String(x.id) === id);
        if (exists) {
          this.raw.delete(storeName, arr.find(x => String(x.id) === id).id);
          this.removeFromArray(arr, id);
          return true;
        }
        return false;
      }
      const json = stableStringify(clean(d.data));
      if (this.remoteJson[storeName].get(id) === json) return false;
      this.remoteJson[storeName].set(id, json);
      this.raw.put(storeName, d.data);
      this.upsertArray(arr, d.data);
      return true;
    },

    detachListeners() {
      this.unsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
      this.unsubscribers = [];
    },

    upsertArray(arr, item) {
      const idx = arr.findIndex(x => String(x.id) === String(item.id));
      if (idx === -1) arr.push(item);
      else arr[idx] = item;
      if (AppState.currentWinner && String(AppState.currentWinner.id) === String(item.id)) {
        AppState.currentWinner = item;
      }
    },

    removeFromArray(arr, id) {
      const idx = arr.findIndex(x => String(x.id) === String(id));
      if (idx !== -1) arr.splice(idx, 1);
    },

    rerender(settingsChanged = false) {
      clearTimeout(this.rerenderTimer);
      this.rerenderTimer = setTimeout(() => {
        try {
          if (settingsChanged && typeof applyTheme === 'function' && AppState.settings.theme) applyTheme(AppState.settings.theme);
          if (typeof updateCandidateCountUI === 'function') updateCandidateCountUI();
          if (typeof renderExploreList === 'function') renderExploreList();
          if (typeof renderFavoritesView === 'function') renderFavoritesView();
          if (typeof renderHistoryView === 'function') renderHistoryView();
          if (typeof syncSettingsView === 'function') syncSettingsView();
        } catch (e) {
          console.warn('同步後重新繪製畫面時發生錯誤：', e);
        }
      }, 150);
    },

    // ---------- 頂部「雲端同步」按鈕 ----------
    setStatus(status) {
      this.status = status;
      this.renderButton();
    },

    renderButton() {
      const btn = document.getElementById('btnCloudSync');
      if (!btn) return;
      if (!btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => this.onButtonClick());
      }
      const name = this.user ? (this.user.displayName || this.user.email || '已登入') : '';
      const labels = {
        'off': '☁️ 登入雲端同步',
        'signing-in': '⏳ 登入中…',
        'syncing': '🔄 同步中…',
        'synced': '☁️ 已同步',
        'offline': '📴 離線中（稍後同步）',
        'error': '⚠️ 同步異常'
      };
      btn.textContent = labels[this.status] || labels.off;
      btn.classList.toggle('active', this.status === 'synced');
      btn.title = this.user ? `已登入：${name}` : '用 Google 帳號登入，讓電腦和手機共用同一份資料';
      if (!this.available && this.status === 'off') {
        btn.textContent = '☁️ 雲端同步（未連線）';
      }
    },

    async onButtonClick() {
      if (typeof SoundEngine !== 'undefined') SoundEngine.playPop();
      if (!this.user) {
        await this.signIn();
        return;
      }
      if (this.status === 'error') {
        if (confirm('上次同步發生問題，要立即重新同步嗎？\n（你的資料仍保存在這台裝置上）')) {
          await this.initialSync();
        }
        return;
      }
      const who = this.user.email || this.user.displayName || '';
      const when = this.lastSyncedAt ? this.lastSyncedAt.toLocaleString('zh-TW') : '尚未同步';
      if (confirm(`☁️ 雲端同步已開啟\n帳號：${who}\n最後同步：${when}\n\n要登出嗎？\n（登出後這台裝置上的資料會保留，只是不再同步）`)) {
        await this.signOut();
      }
    }
  };

  window.CloudSync = CloudSync;
  CloudSync.wrapDB();
})();
