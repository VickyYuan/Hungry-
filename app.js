/**
 * 吃什麼？(What To Eat?) - 核心業務邏輯與 Google Maps 整合模組
 */

// 應用程式狀態管理
const AppState = {
  restaurants: [],
  history: [],
  customLists: ['全部', '想吃', '聚餐', '平價'],
  currentTab: 'home',
  activeFavList: '全部',
  historyFilter: '全部',
  isSpinning: false,
  soundEnabled: true,
  currentWinner: null,
  
  // 使用者偏好設定
  settings: {
    googleApiKey: '',
    excludeRule: '7', // '7' | '30' | 'forever' | 'none'
    avoidConsecutivePicks: true, // 避免連續抽中同一家
    includeUnratedPlaces: true,  // 未評分店家納入抽籤
    unknownMealTimeRule: 'include', // 未知用餐時段之店家是否納入常規時段 (include / exclude)
    dislikes: ['內臟', '生食'],
    cuisineWeights: {
      '日式': 5,
      '中式': 5,
      '韓式': 4,
      '義式': 4,
      '美式': 3,
      '泰式': 4,
      '飲品・輕食': 3,
      '小吃': 5
    },
    budgetMin: 150,
    budgetMax: 250,
    theme: 'cream'
  },
  
  // 首頁抽籤條件
  homeFilter: {
    source: 'cloud', // 'cloud' (全部店家名冊) | 'favs' (我的口袋名單)
    excludeEaten: true,
    area: '全部',
    selectedDistricts: new Set(['全部']), // 多選行政區 Set
    budget: '150-250',
    category: '全部',
    payment: '全部',
    mealTime: '午餐',
    minRating: 4.0
  },

  // 探索搜尋條件
  exploreFilter: {
    query: '',
    source: 'all', // 'all' | 'myList'
    tag: '全部'
  }
};

// ==========================================================
// 簡易 Web Audio API 音效合成器 (免外部音效檔，穩定且零延遲)
// ==========================================================
const SoundEngine = {
  ctx: null,
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  playPop() {
    if (!AppState.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.08); // A5
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  },
  playTick() {
    if (!AppState.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(350 + Math.random() * 200, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.04);
  },
  playFanfare() {
    if (!AppState.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C E G C (清脆和弦)
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.09);
      gain.gain.setValueAtTime(0.2, this.ctx.currentTime + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + idx * 0.09 + 0.4);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + idx * 0.09);
      osc.stop(this.ctx.currentTime + idx * 0.09 + 0.4);
    });
  }
};

// ==========================================================
// 初始化與資料載入 (使用 IndexedDB 作為主要儲存，並支援安全遷移)
// ==========================================================
async function initApp() {
  try {
    // 1. 初始化資料庫並檢查/執行從 localStorage 的安全遷移
    await initDatabaseAndMigrate();

    // 2. 從 IndexedDB 載入狀態
    await loadDataFromIndexedDB();
  } catch (err) {
    console.error("初始化 IndexedDB 失敗，改用 localStorage 降級模式:", err);
    loadDataFromStorageFallback();
  }

  applyTheme(AppState.settings.theme);
  bindNavigationEvents();
  bindHomeEvents();
  bindExploreEvents();
  bindFavoritesEvents();
  bindHistoryEvents();
  bindSettingsEvents();
  bindModals();

  // 初始化地區多選選單與即時候選計數
  initDistrictSelector();
  updateCandidateCountUI();

  // 初始命定卡片設為引導未抽選狀態 (不再寫死指定第一家)
  renderHomeDestinyCard(null);

  // 更新遷移與備份狀態 UI
  await updateMigrationUI();

  console.log("吃什麼？App 初始化完成 (儲存引擎: IndexedDB)！");
}

// 初始化 IndexedDB 並自動檢查執行安全遷移
async function initDatabaseAndMigrate() {
  if (typeof DB === 'undefined') return;
  await DB.open();
  const status = await DB.getMigrationStatus();
  if (!status.migrated) {
    console.log("偵測到尚未遷移至 IndexedDB，開始執行安全遷移與備份...");
    const result = await DB.migrateFromLocalStorage();
    if (result.success) {
      console.log("安全遷移完成！原 localStorage 原始資料已完整保留。");
    } else {
      console.error("遷移過程發生異常:", result.error);
    }
  }
}

// 從 IndexedDB 讀取最新資料 (Single Source of Truth 唯一真實資料來源)
async function loadDataFromIndexedDB() {
  if (typeof DB === 'undefined') return loadDataFromStorageFallback();

  // 檢查資料庫是否已完成初始化標記
  const initRecord = await DB.get('settings', 'initialized');
  const isInitialized = initRecord && initRecord.value === true;

  const places = await DB.getAll('places');
  const hist = await DB.getAll('history');
  const lists = await DB.getAll('lists');
  const settingsRecord = await DB.get('settings', 'preferences');

  if (isInitialized) {
    // 已經初始化過：即使 places 為空，也是使用者的合法狀態（手動刪除），絕不誤判復活預設示範資料！
    AppState.restaurants = places || [];
    AppState.history = hist || [];
    if (lists && lists.length > 0) {
      AppState.customLists = lists.map(l => l.name);
    }
    if (settingsRecord && settingsRecord.value) {
      AppState.settings = Object.assign(AppState.settings, settingsRecord.value);
    }
  } else {
    // 尚未初始化 (全新環境首次啟動)
    if (places && places.length > 0) {
      AppState.restaurants = places;
    } else if (window.DEFAULT_RESTAURANTS) {
      AppState.restaurants = JSON.parse(JSON.stringify(window.DEFAULT_RESTAURANTS));
    }

    if (hist && hist.length > 0) {
      AppState.history = hist;
    } else if (window.DEFAULT_HISTORY) {
      AppState.history = JSON.parse(JSON.stringify(window.DEFAULT_HISTORY));
    }

    if (lists && lists.length > 0) {
      AppState.customLists = lists.map(l => l.name);
    }

    if (settingsRecord && settingsRecord.value) {
      AppState.settings = Object.assign(AppState.settings, settingsRecord.value);
    }
  }
}

// 降級載入 (僅在 IndexedDB 完全無法啟動時才作唯讀 fallback 讀取)
function loadDataFromStorageFallback() {
  try {
    const savedRest = localStorage.getItem('WTE_restaurants');
    if (savedRest) AppState.restaurants = JSON.parse(savedRest);
    else if (window.DEFAULT_RESTAURANTS) AppState.restaurants = JSON.parse(JSON.stringify(window.DEFAULT_RESTAURANTS));

    const savedHist = localStorage.getItem('WTE_history');
    if (savedHist) AppState.history = JSON.parse(savedHist);
    else if (window.DEFAULT_HISTORY) AppState.history = JSON.parse(JSON.stringify(window.DEFAULT_HISTORY));

    const savedLists = localStorage.getItem('WTE_customLists');
    if (savedLists) AppState.customLists = JSON.parse(savedLists);

    const savedSettings = localStorage.getItem('WTE_settings');
    if (savedSettings) AppState.settings = Object.assign(AppState.settings, JSON.parse(savedSettings));
  } catch (err) {
    console.error("載入本機 localStorage 備用資料失敗:", err);
  }
}

// 儲存資料回 IndexedDB (唯一正式資料來源；localStorage 已凍結為唯讀遷移備份，絕不再持續雙軌寫入)
async function saveDataToStorage() {
  if (typeof DB === 'undefined') {
    throw new Error('IndexedDB 模組未載入，無法儲存！');
  }

  try {
    await DB.bulkPut('places', AppState.restaurants);
    await DB.bulkPut('history', AppState.history);
    await DB.put('settings', { key: 'preferences', value: AppState.settings });
  } catch (err) {
    console.error("寫入 IndexedDB 失敗:", err);
    alert("⚠️ 本機資料庫儲存發生異常：" + err.message + "\n請確認儲存空間是否足夠！");
    throw err;
  }
}

// 主題切換
function applyTheme(themeName) {
  AppState.settings.theme = themeName;
  document.body.setAttribute('data-theme', themeName);
  
  // 更新設定面板中圓圈 active 狀態
  document.querySelectorAll('.theme-color-circle').forEach(circle => {
    if (circle.dataset.theme === themeName) {
      circle.classList.add('active');
    } else {
      circle.classList.remove('active');
    }
  });
  saveDataToStorage();
}

// ==========================================================
// 導覽列與分頁切換
// ==========================================================
function bindNavigationEvents() {
  // 電腦版頂部 Tab 與 手機版底部 Nav 聯動
  const switchTab = (tabId) => {
    SoundEngine.playPop();
    AppState.currentTab = tabId;
    
    // 更新頁籤樣式
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.mobile-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    // 顯示對應內容面板
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });

    // 若切換到探索或收藏，重新整理視圖
    if (tabId === 'explore') {
      renderExploreList();
    } else if (tabId === 'favorites') {
      renderFavoritesView();
    } else if (tabId === 'history') {
      renderHistoryView();
    } else if (tabId === 'settings') {
      syncSettingsView();
    }
  };

  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 手機模擬外框切換
  const deviceToggleBtn = document.getElementById('btnToggleDeviceFrame');
  if (deviceToggleBtn) {
    deviceToggleBtn.addEventListener('click', () => {
      SoundEngine.playPop();
      document.body.classList.toggle('mode-mobile-frame');
      const isMobile = document.body.classList.contains('mode-mobile-frame');
      deviceToggleBtn.innerHTML = isMobile ? '💻 切換電腦全螢幕模式' : '📱 切換手機外框預覽';
    });
  }

  // 音效靜音切換
  const soundToggleBtn = document.getElementById('btnToggleSound');
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      AppState.soundEnabled = !AppState.soundEnabled;
      soundToggleBtn.innerHTML = AppState.soundEnabled ? '🔔 音效：開' : '🔕 音效：關';
      if (AppState.soundEnabled) SoundEngine.playPop();
    });
  }
}

// ==========================================================
// PAGE 1: 首頁隨機抽籤邏輯
// ==========================================================
function bindHomeEvents() {
  // 來源切換 (全部店家名冊 vs 口袋名單)
  const sourcePills = document.querySelectorAll('.home-source-pill');
  sourcePills.forEach(pill => {
    pill.addEventListener('click', () => {
      SoundEngine.playPop();
      sourcePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      AppState.homeFilter.source = pill.dataset.source;
      updateCandidateCountUI();
    });
  });

  // 排除吃過開關
  const excludePill = document.getElementById('pillExcludeEaten');
  if (excludePill) {
    excludePill.addEventListener('click', () => {
      SoundEngine.playPop();
      AppState.homeFilter.excludeEaten = !AppState.homeFilter.excludeEaten;
      excludePill.classList.toggle('active', AppState.homeFilter.excludeEaten);
      updateCandidateCountUI();
    });
  }

  // 篩選下拉選單事件
  const bindFilter = (id, field) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        AppState.homeFilter[field] = e.target.value;
        updateCandidateCountUI();
      });
    }
  };
  bindFilter('filterBudget', 'budget');
  bindFilter('filterCategory', 'category');
  bindFilter('filterPayment', 'payment');
  bindFilter('filterMealTime', 'mealTime');
  bindFilter('filterRating', 'minRating');

  // 大按鈕：幫我抽一家！
  const drawBtn = document.getElementById('btnDrawFood');
  if (drawBtn) {
    drawBtn.addEventListener('click', () => {
      startDrawFood();
    });
  }

  // 命定卡片操作按鈕
  const btnDetail = document.getElementById('btnDestinyDetail');
  if (btnDetail) {
    btnDetail.addEventListener('click', () => {
      if (AppState.currentWinner) {
        showRestaurantDetailModal(AppState.currentWinner);
      }
    });
  }

  const btnFavToggle = document.getElementById('btnDestinyFavToggle');
  if (btnFavToggle) {
    btnFavToggle.addEventListener('click', async () => {
      if (AppState.currentWinner) {
        await toggleFavorite(AppState.currentWinner.id);
        renderHomeDestinyCard(AppState.currentWinner);
      }
    });
  }

  const btnRecordEat = document.getElementById('btnDestinyRecordEat');
  if (btnRecordEat) {
    btnRecordEat.addEventListener('click', () => {
      if (AppState.currentWinner) {
        openAddHistoryModal(AppState.currentWinner);
      }
    });
  }
}

// ==========================================================
// 地區多選元件邏輯 (支援台中 29 區 + 全選 + 常用區)
// ==========================================================
function initDistrictSelector() {
  const container = document.getElementById('districtChipsContainer');
  if (!container) return;

  const districts = window.TAICHUNG_DISTRICTS || [];
  container.innerHTML = '';

  districts.forEach(d => {
    const chip = document.createElement('div');
    chip.className = 'district-chip';
    chip.dataset.district = d;
    chip.textContent = d;
    chip.addEventListener('click', () => toggleDistrict(d));
    container.appendChild(chip);
  });

  // 加入其他/待確認選項
  const otherChip = document.createElement('div');
  otherChip.className = 'district-chip';
  otherChip.dataset.district = '待確認';
  otherChip.textContent = '待確認/其他';
  otherChip.addEventListener('click', () => toggleDistrict('待確認'));
  container.appendChild(otherChip);

  // 綁定下拉面板開關
  const toggleBtn = document.getElementById('btnDistrictToggle');
  const panel = document.getElementById('districtDropdownPanel');
  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
      if (!toggleBtn.contains(e.target) && !panel.contains(e.target)) {
        panel.style.display = 'none';
      }
    });
  }

  const btnAll = document.getElementById('btnDistrictSelectAll');
  if (btnAll) btnAll.addEventListener('click', () => selectAllDistricts());

  const btnClear = document.getElementById('btnDistrictClear');
  if (btnClear) btnClear.addEventListener('click', () => clearDistricts());

  const btnPopular = document.getElementById('btnDistrictPopular');
  if (btnPopular) btnPopular.addEventListener('click', () => selectPopularDistricts());

  renderDistrictSelectorUI();
}

function renderDistrictSelectorUI() {
  const textEl = document.getElementById('districtSelectorText');
  const s = AppState.homeFilter.selectedDistricts;
  const allDistricts = window.TAICHUNG_DISTRICTS || [];

  document.querySelectorAll('.district-chip').forEach(chip => {
    const d = chip.dataset.district;
    chip.classList.toggle('selected', s.has('全部') || s.has(d));
  });

  if (s.has('全部') || s.size >= allDistricts.length) {
    if (textEl) textEl.textContent = '全部地區 (29區)';
  } else if (s.size === 0) {
    if (textEl) textEl.textContent = '未選擇地區 (點擊選取)';
  } else if (s.size <= 2) {
    if (textEl) textEl.textContent = Array.from(s).join(', ');
  } else {
    const firstTwo = Array.from(s).slice(0, 2).join(', ');
    if (textEl) textEl.textContent = `${firstTwo} 等 ${s.size} 區`;
  }
}

function selectAllDistricts() {
  AppState.homeFilter.selectedDistricts = new Set(['全部']);
  renderDistrictSelectorUI();
  updateCandidateCountUI();
}

function clearDistricts() {
  AppState.homeFilter.selectedDistricts = new Set();
  renderDistrictSelectorUI();
  updateCandidateCountUI();
}

function selectPopularDistricts() {
  AppState.homeFilter.selectedDistricts = new Set(['西屯區', '西區', '北區', '南屯區', '北屯區']);
  renderDistrictSelectorUI();
  updateCandidateCountUI();
}

function toggleDistrict(d) {
  const s = AppState.homeFilter.selectedDistricts;
  if (s.has('全部')) {
    s.clear();
    s.add(d);
  } else {
    if (s.has(d)) s.delete(d);
    else s.add(d);
  }
  renderDistrictSelectorUI();
  updateCandidateCountUI();
}

// ==========================================================
// 即時候選池數量計算與條件嚴苛診斷提示
// ==========================================================
function updateCandidateCountUI() {
  const countEl = document.getElementById('candidateCountNumber');
  const hintEl = document.getElementById('candidateStatusHint');
  const diagEl = document.getElementById('candidateDiagnosticText');
  const barEl = document.getElementById('candidatePoolBar');
  if (!countEl) return;

  const candidates = getEligibleCandidates();
  const count = candidates.length;
  countEl.textContent = count;

  if (count === 0) {
    if (barEl) barEl.classList.add('warning');
    if (hintEl) hintEl.textContent = '⚠️ 無符合店家';
    if (diagEl) {
      diagEl.style.display = 'block';
      diagEl.textContent = getDiagnosticSuggestions();
    }
  } else if (count === 1) {
    if (barEl) barEl.classList.remove('warning');
    if (hintEl) hintEl.textContent = '💡 唯一符合 (點擊直選)';
    if (diagEl) diagEl.style.display = 'none';
  } else {
    if (barEl) barEl.classList.remove('warning');
    if (hintEl) hintEl.textContent = '🎲 輪盤加權隨機';
    if (diagEl) diagEl.style.display = 'none';
  }
}

// 分析過嚴條件並給予具體放寬建議
function getDiagnosticSuggestions() {
  const f = AppState.homeFilter;
  const suggestions = [];

  if (f.source === 'favs') suggestions.push('目前為「我的口袋名單」，名單內店家較少');
  if (!f.selectedDistricts.has('全部')) suggestions.push(`地區限制在 [${Array.from(f.selectedDistricts).join('/')}]`);
  if (f.category !== '全部') suggestions.push(`料理類別限制為「${f.category}」`);
  if (f.budget !== '不限') suggestions.push(`預算區間設為「${f.budget}」`);
  if (Number(f.minRating) > 0) suggestions.push(`品質限制在 ${f.minRating} 星以上`);
  if (f.payment !== '全部') suggestions.push(`付款方式限制為「${f.payment}」`);
  if (f.mealTime && f.mealTime !== '午餐') suggestions.push(`時段選在「${f.mealTime}」`);

  if (suggestions.length === 0) return '建議新增更多口袋店家或放寬偏好設定！';
  return '可能過嚴的條件：' + suggestions.join('、') + '。建議放寬條件再試一次！';
}

// 執行抽籤演算法
function startDrawFood() {
  if (AppState.isSpinning) return;

  const drawBtn = document.getElementById('btnDrawFood');
  const destinyCard = document.getElementById('destinyCardDisplay');
  const rollingBox = document.getElementById('destinyRollingBox');
  const rollingTicker = document.getElementById('rollingTickerText');
  const emptyBox = document.getElementById('destinyEmptyDisplay');

  // 1. 取得合格候選名單
  const candidates = getEligibleCandidates();

  if (candidates.length === 0) {
    alert("嗚～找不到符合所有篩選條件的餐廳！\n\n" + getDiagnosticSuggestions());
    return;
  }

  // 候選名單只有 1 間時：直接公佈並明確提示
  if (candidates.length === 1) {
    const singleWinner = candidates[0];
    AppState.currentWinner = singleWinner;
    SoundEngine.playFanfare();
    triggerConfetti();
    renderHomeDestinyCard(singleWinner);
    if (emptyBox) emptyBox.style.display = 'none';
    if (rollingBox) rollingBox.style.display = 'none';
    if (destinyCard) destinyCard.style.display = 'flex';
    alert(`🎯 目前符合您所有設定條件的店家剛好只有 1 間：\n\n【${singleWinner.name}】！\n\n若希望有更多選擇，建議放寬預算或地區條件唷！`);
    return;
  }

  AppState.isSpinning = true;
  drawBtn.classList.add('spinning');
  drawBtn.innerHTML = '<span class="dice-icon">🎲</span> 命運輪盤轉動中...';

  if (emptyBox) emptyBox.style.display = 'none';
  if (destinyCard) destinyCard.style.display = 'none';
  if (rollingBox) rollingBox.style.display = 'flex';

  // 2. 模擬拉霸滾動動畫 (1.8秒)
  let spinCount = 0;
  const maxSpins = 18;
  const interval = setInterval(() => {
    spinCount++;
    const randomPick = candidates[Math.floor(Math.random() * candidates.length)];
    rollingTicker.textContent = `🐱 尋找中：${randomPick.name}`;
    SoundEngine.playTick();

    if (spinCount >= maxSpins) {
      clearInterval(interval);
      // 加權抽籤計算勝出者 (支援避免連續抽中同一家)
      const winner = pickWeightedWinner(candidates);
      AppState.currentWinner = winner;

      setTimeout(() => {
        SoundEngine.playFanfare();
        triggerConfetti();
        renderHomeDestinyCard(winner);
        
        rollingBox.style.display = 'none';
        destinyCard.style.display = 'flex';
        drawBtn.classList.remove('spinning');
        drawBtn.innerHTML = '<span class="dice-icon">🎲</span> 再抽一家試試！';
        AppState.isSpinning = false;
      }, 300);
    }
  }, 90);
}

// 根據條件篩選合適餐廳
function getEligibleCandidates() {
  const f = AppState.homeFilter;
  const settings = AppState.settings;
  const now = new Date();

  return AppState.restaurants.filter(r => {
    // 來源過濾
    if (f.source === 'favs' && !r.isFavorite) return false;

    // 地區多選過濾 (支援台中 29 區 + 全選)
    if (f.selectedDistricts && !f.selectedDistricts.has('全部')) {
      const d = r.district || r.area || '待確認';
      if (!f.selectedDistricts.has(d)) return false;
    }

    // 料理類別過濾
    if (f.category !== '全部' && !r.category.includes(f.category)) return false;

    // 評分過濾 (支援未評分店家設定)
    if (Number(f.minRating) > 0) {
      if (r.rating === null || r.rating === undefined) {
        if (!settings.includeUnratedPlaces) return false;
      } else if (r.rating < Number(f.minRating)) {
        return false;
      }
    }

    // 預算過濾 (安全比對 avgPrice 或 priceMin~priceMax)
    if (f.budget !== '不限') {
      const price = r.avgPrice != null ? r.avgPrice : (r.priceMin && r.priceMax ? Math.round((r.priceMin + r.priceMax) / 2) : null);
      if (price !== null) {
        if (f.budget === '100-200' && (price < 80 || price > 200)) return false;
        if (f.budget === '150-250' && (price < 120 || price > 280)) return false;
        if (f.budget === '300-500' && (price < 250 || price > 550)) return false;
        if (f.budget === '500以上' && price < 500) return false;
      }
    }

    // 付款方式過濾
    if (f.payment !== '全部' && r.paymentMethods && !r.paymentMethods.includes(f.payment)) return false;

    // 用餐時段實質過濾 (早餐 / 午餐 / 晚餐 / 宵夜)
    if (f.mealTime && f.mealTime !== '不限') {
      const targetTime = f.mealTime;
      if (Array.isArray(r.mealTimes) && r.mealTimes.length > 0) {
        if (!r.mealTimes.includes(targetTime)) return false;
      } else if (r.openHours) {
        const hours = r.openHours.toLowerCase();
        let match = false;
        if (targetTime === '早餐') {
          match = hours.includes('早') || hours.includes('06:') || hours.includes('07:') || hours.includes('08:') || hours.includes('09:');
        } else if (targetTime === '午餐') {
          match = hours.includes('午') || hours.includes('11:') || hours.includes('12:') || hours.includes('13:') || hours.includes('14:') || hours.includes('10:');
        } else if (targetTime === '晚餐') {
          match = hours.includes('晚') || hours.includes('17:') || hours.includes('18:') || hours.includes('19:') || hours.includes('20:') || hours.includes('21:');
        } else if (targetTime === '宵夜') {
          match = hours.includes('宵夜') || hours.includes('22:') || hours.includes('23:') || hours.includes('24:') || hours.includes('00:') || hours.includes('01:') || hours.includes('02:') || hours.includes('03:');
        }
        if (!match) {
          if (settings.unknownMealTimeRule === 'exclude') return false;
          if (targetTime === '早餐' || targetTime === '宵夜') return false;
        }
      } else {
        // 未有時段資料者：依設定規則處理
        if (settings.unknownMealTimeRule === 'exclude') return false;
        if (targetTime === '早餐' || targetTime === '宵夜') return false;
      }
    }

    // 排除不吃的料理/食材
    if (settings.dislikes && settings.dislikes.length > 0) {
      const hasDislike = settings.dislikes.some(dis => 
        (r.tags && r.tags.some(t => t.includes(dis))) || (r.name && r.name.includes(dis)) || (r.category && r.category.includes(dis))
      );
      if (hasDislike) return false;
    }

    // 排除最近吃過的規則 (依該店家最新一次用餐日期判斷)
    if (f.excludeEaten && settings.excludeRule !== 'none') {
      const rId = r.id;
      const rName = r.name ? r.name.trim() : '';
      const matchHistories = AppState.history.filter(h => 
        (h.restaurantId && h.restaurantId === rId) ||
        (h.placeId && h.placeId === rId) ||
        (h.restaurantName && h.restaurantName.trim() === rName) ||
        (h.placeName && h.placeName.trim() === rName)
      );

      if (matchHistories.length > 0) {
        if (settings.excludeRule === 'forever') return false;
        const timestamps = matchHistories
          .map(h => new Date(h.date).getTime())
          .filter(t => !isNaN(t));
        if (timestamps.length > 0) {
          const latestTime = Math.max(...timestamps);
          const diffDays = Math.floor((now.getTime() - latestTime) / (1000 * 60 * 60 * 24));
          const limitDays = parseInt(settings.excludeRule, 10);
          if (diffDays <= limitDays) return false;
        }
      }
    }

    return true;
  });
}

// 根據設定中各類別權重進行加權抽取 (支援避免連續抽中同一家)
function pickWeightedWinner(candidates) {
  const weights = AppState.settings.cuisineWeights || {};
  
  // 若啟用「避免連續抽中同一家」且候選店家 > 1，過濾掉上一輪中獎者
  let activeCandidates = candidates;
  if (AppState.settings.avoidConsecutivePicks && AppState.currentWinner && candidates.length > 1) {
    const withoutPrevious = candidates.filter(c => c.id !== AppState.currentWinner.id);
    if (withoutPrevious.length > 0) {
      activeCandidates = withoutPrevious;
    }
  }

  let totalWeight = 0;
  const pool = [];

  activeCandidates.forEach(c => {
    let w = 4;
    for (let key in weights) {
      if ((c.category && c.category.includes(key)) || (c.tags && c.tags.some(t => t.includes(key)))) {
        w = weights[key];
        break;
      }
    }
    totalWeight += w;
    pool.push({ item: c, weight: w });
  });

  let rand = Math.random() * totalWeight;
  for (let entry of pool) {
    if (rand < entry.weight) {
      return entry.item;
    }
    rand -= entry.weight;
  }
  return activeCandidates[0];
}

// 渲染命定美食卡片
function renderHomeDestinyCard(restaurant) {
  const emptyBox = document.getElementById('destinyEmptyDisplay');
  const cardBox = document.getElementById('destinyCardDisplay');

  if (!restaurant) {
    AppState.currentWinner = null;
    if (emptyBox) emptyBox.style.display = 'flex';
    if (cardBox) cardBox.style.display = 'none';
    return;
  }

  if (emptyBox) emptyBox.style.display = 'none';
  if (cardBox) cardBox.style.display = 'flex';
  AppState.currentWinner = restaurant;

  const imgEl = document.getElementById('destinyImg');
  if (imgEl) imgEl.src = restaurant.photo || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=700';
  document.getElementById('destinyName').textContent = restaurant.name;

  // 評分顯示 (無資料時顯示待評分，不塞假星等)
  const ratingEl = document.getElementById('destinyRating');
  if (restaurant.rating != null) {
    ratingEl.innerHTML = `★ ${restaurant.rating}`;
  } else {
    ratingEl.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">★ 待評分</span>`;
  }

  // 評論數顯示
  const reviewEl = document.getElementById('destinyReviewCount');
  if (restaurant.reviewCount != null) {
    reviewEl.textContent = `(${restaurant.reviewCount.toLocaleString()} 則評論)`;
  } else {
    reviewEl.textContent = `(暫無評論)`;
  }

  // 預算顯示 (無資料時顯示未註記，不塞假價格)
  const priceEl = document.getElementById('destinyPrice');
  if (restaurant.avgPrice != null) {
    priceEl.textContent = `約 $${restaurant.avgPrice}/人`;
  } else if (restaurant.priceMin && restaurant.priceMax) {
    priceEl.textContent = `$${restaurant.priceMin} ~ $${restaurant.priceMax}`;
  } else {
    priceEl.textContent = `預算未註記`;
  }

  document.getElementById('destinyArea').textContent = restaurant.district || restaurant.area || '待確認地區';
  document.getElementById('destinyDesc').textContent = restaurant.description || '暫無描述';

  // 標籤渲染 (包含資料來源標籤)
  const tagBox = document.getElementById('destinyTags');
  tagBox.innerHTML = '';
  
  // 來源徽章
  const sourceBadge = document.createElement('span');
  const isDemo = restaurant.source === 'demo' || restaurant.isDemo;
  sourceBadge.className = `badge-source ${isDemo ? 'badge-source-demo' : (restaurant.source === 'csv' ? 'badge-source-csv' : (restaurant.source === 'google_takeout' ? 'badge-source-google' : 'badge-source-manual'))}`;
  sourceBadge.textContent = isDemo ? '示範資料 (未驗證)' : (restaurant.source === 'csv' ? 'CSV 匯入' : (restaurant.source === 'google_takeout' ? 'Google 匯出' : '自訂建立'));
  tagBox.appendChild(sourceBadge);

  if (Array.isArray(restaurant.tags)) {
    restaurant.tags.forEach(t => {
      const span = document.createElement('span');
      span.className = 'meta-tag';
      span.textContent = `#${t}`;
      tagBox.appendChild(span);
    });
  }

  // 收藏狀態
  const favBtn = document.getElementById('btnDestinyFavToggle');
  favBtn.innerHTML = restaurant.isFavorite ? '❤️ 已在口袋名單' : '🤍 加入收藏名單';

  // Google Maps 真實導航按鈕連結
  const googleBtn = document.getElementById('btnDestinyGoogleNav');
  const googleSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.name + ' ' + (restaurant.address || ''))}`;
  googleBtn.href = restaurant.googlePlaceUrl || googleSearchUrl;
}

// ==========================================================
// PAGE 2: 探索 (搜尋餐廳 + 真實 Google Maps 整合)
// ==========================================================
function bindExploreEvents() {
  const searchInput = document.getElementById('exploreSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      AppState.exploreFilter.query = e.target.value.trim().toLowerCase();
      renderExploreList();
    });
  }

  // 來源切換 (Google Maps / 我的清單)
  const sourceBtns = document.querySelectorAll('.explore-source-btn');
  sourceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      SoundEngine.playPop();
      sourceBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.exploreFilter.source = btn.dataset.source;
      renderExploreList();
    });
  });

  // 快速過濾 Chips
  const filterChips = document.querySelectorAll('.pill-filter-chip');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      SoundEngine.playPop();
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      AppState.exploreFilter.tag = chip.dataset.filter;
      renderExploreList();
    });
  });

}

// 渲染探索列表 (響應式卡片網格：電腦版兩欄，手機版單欄)
function renderExploreList() {
  const container = document.getElementById('exploreRestaurantList');
  if (!container) return;
  container.innerHTML = '';

  const { query, source, tag } = AppState.exploreFilter;

  const filtered = AppState.restaurants.filter(r => {
    // 來源篩選 (全部名冊 vs 我的口袋清單)
    if (source === 'myList' && !r.isFavorite) return false;

    // 關鍵字搜尋 (店名、地區、標籤、菜系)
    if (query) {
      const q = query.toLowerCase();
      const match = (r.name && r.name.toLowerCase().includes(q)) ||
                    ((r.district || r.area) && (r.district || r.area).toLowerCase().includes(q)) ||
                    (r.category && r.category.toLowerCase().includes(q)) ||
                    (Array.isArray(r.tags) && r.tags.some(t => t.toLowerCase().includes(q)));
      if (!match) return false;
    }

    // 標籤篩選 (不使用虛構距離)
    if (tag === 'rating' && (r.rating == null || r.rating < 4.5)) return false;
    if (tag === 'price' && (r.avgPrice == null || r.avgPrice > 250)) return false;
    if (tag !== '全部' && tag !== 'rating' && tag !== 'price') {
      if ((!r.category || !r.category.includes(tag)) && (!r.tags || !r.tags.includes(tag))) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: var(--text-muted);">
        <p style="font-size: 2.2rem; margin-bottom: 8px;">🐱🍲</p>
        <p style="font-weight: 700; font-size: 1.05rem; color: var(--text-main);">找不到符合條件的餐廳</p>
        <p style="font-size: 0.85rem; margin-top: 4px;">試試更換搜尋關鍵字，或點擊上方「全部餐廳」標籤！</p>
      </div>
    `;
    return;
  }

  filtered.forEach(r => {
    const card = document.createElement('div');
    card.className = 'explore-card';
    card.id = `explore-card-${r.id}`;

    const isDemo = r.source === 'demo' || r.isDemo;
    const sourceClass = isDemo ? 'badge-source-demo' : (r.source === 'csv' ? 'badge-source-csv' : (r.source === 'google_takeout' ? 'badge-source-google' : 'badge-source-manual'));
    const sourceLabel = isDemo ? '示範資料' : (r.source === 'csv' ? 'CSV 匯入' : (r.source === 'google_takeout' ? 'Google 匯出' : '自訂建立'));

    const googleSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' ' + (r.address || r.district || ''))}`;
    const targetMapUrl = r.googlePlaceUrl || googleSearchUrl;

    const ratingText = r.rating != null ? `★ ${r.rating}` : '★ 待評分';
    const reviewText = r.reviewCount != null ? `(${r.reviewCount.toLocaleString()})` : '(無評論)';
    const priceText = r.avgPrice != null ? `$${r.avgPrice}/人` : (r.priceMin && r.priceMax ? `$${r.priceMin}~${r.priceMax}` : '預算未註記');
    const districtText = r.district || r.area || '待確認地區';

    card.innerHTML = `
      <div class="explore-card-thumb-wrap">
        <img class="explore-card-thumb" src="${r.photo || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=700'}" alt="${r.name}" loading="lazy">
        <span class="explore-card-cat-pill">${r.category || '美味料理'}</span>
        <button class="btn-heart-favorite ${r.isFavorite ? 'active' : ''}" data-id="${r.id}" title="收藏到口袋名單">
          ${r.isFavorite ? '❤️' : '🤍'}
        </button>
      </div>
      <div class="explore-card-content">
        <div class="explore-card-title-row">
          <h4 class="explore-card-name" title="${r.name}">${r.name}</h4>
          <span class="badge-source ${sourceClass}">${sourceLabel}</span>
        </div>
        
        <div class="explore-card-meta-row">
          <span style="color: var(--star-color); font-weight: 700;">${ratingText}</span>
          <span style="color: var(--text-muted); font-size: 0.8rem;">${reviewText}</span>
          <span>•</span>
          <span style="color: var(--accent-color); font-weight: 700;">${priceText}</span>
          <span>•</span>
          <span>📍 ${districtText}</span>
          ${r.isOpen != null ? `<span>•</span><span style="color: ${r.isOpen ? 'var(--success-color)' : '#999'}; font-weight: 700;">${r.isOpen ? '營業中' : '休息中'}</span>` : ''}
        </div>

        <p class="explore-card-desc">
          ${r.description ? (r.description.length > 55 ? r.description.slice(0, 55) + '...' : r.description) : (r.address || '暫無詳細備註')}
        </p>

        <div class="explore-card-tags">
          ${(r.tags || []).slice(0, 3).map(t => `<span class="meta-tag" style="font-size: 0.74rem; padding: 2px 7px;">#${t}</span>`).join('')}
        </div>

        <div class="explore-card-actions">
          <a href="${targetMapUrl}" target="_blank" rel="noopener noreferrer" class="btn-card-action" style="flex: 1; text-align: center; font-size: 0.82rem; background: #E8F0FE; color: #1967D2; border-color: #D2E3FC; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 4px;">
            🧭 在 Google Maps 查看
          </a>
          <button class="btn-card-action btn-accent btn-explore-pick-now" data-id="${r.id}" style="flex: 1; font-size: 0.82rem;">
            🍽️ 抽這家吃！
          </button>
        </div>
      </div>
    `;

    // 抽這家吃按鈕
    card.querySelector('.btn-explore-pick-now').addEventListener('click', () => {
      SoundEngine.playPop();
      renderHomeDestinyCard(r);
      const homeTabBtn = document.querySelector('.nav-tab-btn[data-tab="home"]') || document.querySelector('.mobile-nav-item[data-tab="home"]');
      if (homeTabBtn) homeTabBtn.click();
    });

    // 收藏按鈕點擊
    const favBtn = card.querySelector('.btn-heart-favorite');
    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleFavorite(r.id);
      favBtn.classList.toggle('active', r.isFavorite);
      favBtn.innerHTML = r.isFavorite ? '❤️' : '🤍';
    });

    container.appendChild(card);
  });
}

// ==========================================================
// PAGE 3: 收藏 (我的口袋名單)
// ==========================================================
function bindFavoritesEvents() {
  // 分類標籤切換
  const favTabContainer = document.getElementById('favCategoriesRow');
  if (favTabContainer) {
    favTabContainer.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.btn-fav-tab');
      if (tabBtn) {
        SoundEngine.playPop();
        AppState.activeFavList = tabBtn.dataset.list;
        renderFavoritesView();
      }
    });
  }

  // 新增自訂清單按鈕
  const btnAddList = document.getElementById('btnAddCustomList');
  if (btnAddList) {
    btnAddList.addEventListener('click', () => {
      const name = prompt("請輸入新分類清單名稱（例如：深夜甜點、情侶約會、口袋名單）：");
      if (name && name.trim()) {
        const cleanName = name.trim();
        if (!AppState.customLists.includes(cleanName)) {
          AppState.customLists.push(cleanName);
          saveDataToStorage();
          renderFavoritesView();
          alert(`🎉 成功新增「${cleanName}」清單！`);
        }
      }
    });
  }

  // Google 匯入精靈橫幅按鈕
  const btnOpenGoogleWizard = document.getElementById('btnBannerGoogleImport');
  if (btnOpenGoogleWizard) {
    btnOpenGoogleWizard.addEventListener('click', () => {
      openGoogleImportModal();
    });
  }
}

// 渲染收藏頁面
function renderFavoritesView() {
  const container = document.getElementById('favCardsGrid');
  const catRow = document.getElementById('favCategoriesRow');
  if (!container || !catRow) return;

  // 1. 渲染分類按鈕列 (計算各清單項目數)
  catRow.innerHTML = '';
  AppState.customLists.forEach(cat => {
    const count = cat === '全部' 
      ? AppState.restaurants.filter(r => r.isFavorite).length
      : AppState.restaurants.filter(r => r.isFavorite && (r.customList === cat || r.tags.includes(cat))).length;

    const btn = document.createElement('button');
    btn.className = `btn-fav-tab ${AppState.activeFavList === cat ? 'active' : ''}`;
    btn.dataset.list = cat;
    btn.textContent = `${cat} (${count})`;
    catRow.appendChild(btn);
  });

  // 加上「+ 新增自訂清單」按鈕
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-custom-list';
  addBtn.id = 'btnAddCustomList';
  addBtn.textContent = '＋ 新增清單';
  addBtn.addEventListener('click', () => {
    const name = prompt("請輸入新分類清單名稱：");
    if (name && name.trim() && !AppState.customLists.includes(name.trim())) {
      AppState.customLists.push(name.trim());
      saveDataToStorage();
      renderFavoritesView();
    }
  });
  catRow.appendChild(addBtn);

  // 2. 渲染收藏卡片
  container.innerHTML = '';
  const favRestaurants = AppState.restaurants.filter(r => {
    if (!r.isFavorite) return false;
    if (AppState.activeFavList === '全部') return true;
    return r.customList === AppState.activeFavList || r.tags.includes(AppState.activeFavList);
  });

  if (favRestaurants.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 50px 20px; color: var(--text-muted);">
        <p style="font-size: 2.5rem; margin-bottom: 8px;">🤍</p>
        <p style="font-weight: 800; font-size: 1.1rem;">目前此清單內還沒有收藏的餐廳</p>
        <p style="font-size: 0.85rem; margin-top: 4px;">你可以從探索搜尋、首頁抽籤、或匯入 Google Maps 收藏加入！</p>
      </div>
    `;
    return;
  }

  favRestaurants.forEach(r => {
    const card = document.createElement('div');
    card.className = 'fav-card';
    const googleNavUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' ' + (r.address || ''))}`;
    
    card.innerHTML = `
      <div class="fav-card-img-wrap">
        <img class="fav-card-img" src="${r.photo}" alt="${r.name}" loading="lazy">
        <span class="meta-tag" style="position: absolute; bottom: 10px; left: 10px; background: rgba(255,255,255,0.9);">${r.category}</span>
      </div>
      <div class="fav-card-body">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <h4 style="font-size: 1.1rem; font-weight: 800; color: var(--text-main);">${r.name}</h4>
          <button class="btn-heart-favorite active" data-id="${r.id}" title="取消收藏">❤️</button>
        </div>
        <div style="display: flex; gap: 8px; font-size: 0.82rem; color: var(--text-muted); align-items: center; flex-wrap: wrap;">
          <span style="color: var(--star-color); font-weight: 700;">★ ${r.rating != null ? r.rating : '待評分'}</span>
          <span>•</span>
          <span>${r.avgPrice != null ? '$' + r.avgPrice + '/人' : (r.priceMin && r.priceMax ? '$' + r.priceMin + '~' + r.priceMax : '預算未註記')}</span>
          <span>•</span>
          <span>${r.district || r.area || '待確認地區'}</span>
          <span class="badge-source ${r.source === 'demo' || r.isDemo ? 'badge-source-demo' : (r.source === 'csv' ? 'badge-source-csv' : (r.source === 'google_takeout' ? 'badge-source-google' : 'badge-source-manual'))}" style="font-size: 0.72rem; padding: 2px 6px;">${r.source === 'demo' || r.isDemo ? '示範資料' : (r.source === 'csv' ? 'CSV' : (r.source === 'google_takeout' ? 'Takeout' : '自訂'))}</span>
        </div>
        <p style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.5; margin: 4px 0 10px;">
          ${r.description ? r.description.slice(0, 48) + '...' : '暫無詳細描述'}
        </p>
        <div style="display: flex; gap: 8px; margin-top: auto;">
          <a href="${r.googlePlaceUrl || googleNavUrl}" target="_blank" class="btn-card-action" style="flex: 1; text-align: center; font-size: 0.8rem; background: #E8F0FE; color: #1967D2; border-color: #D2E3FC;">
            🧭 Google 地圖
          </a>
          <button class="btn-card-action btn-accent btn-fav-pick-now" data-id="${r.id}" style="flex: 1; font-size: 0.8rem;">
            🍽️ 抽這家吃！
          </button>
        </div>
      </div>
    `;

    // 抽這家吃按鈕
    card.querySelector('.btn-fav-pick-now').addEventListener('click', () => {
      SoundEngine.playPop();
      renderHomeDestinyCard(r);
      // 切換回首頁
      document.querySelector('.nav-tab-btn[data-tab="home"]').click();
    });

    // 取消收藏按鈕
    card.querySelector('.btn-heart-favorite').addEventListener('click', async () => {
      await toggleFavorite(r.id);
      renderFavoritesView();
    });

    container.appendChild(card);
  });
}

// 切換餐廳收藏狀態 (事務優先：先寫入 IndexedDB，確認成功後才修改記憶體與畫面)
async function toggleFavorite(id) {
  SoundEngine.playPop();
  const rest = AppState.restaurants.find(r => r.id === id);
  if (!rest) return;

  const previousState = rest.isFavorite;
  const newState = !previousState;
  const updatedPlace = Object.assign({}, rest, {
    isFavorite: newState,
    updatedAt: new Date().toISOString()
  });

  try {
    if (typeof DB !== 'undefined') {
      await DB.put('places', updatedPlace);
    }
    // 只有資料庫成功落盤後才更新記憶體
    rest.isFavorite = newState;
    rest.updatedAt = updatedPlace.updatedAt;
  } catch (err) {
    console.error("更新收藏狀態失敗:", err);
    alert(`❌ 收藏變更失敗：${err.message}\n資料未變更！`);
    rest.isFavorite = previousState;
    throw err;
  }
}

// ==========================================================
// PAGE 4: 紀錄 (吃過的餐廳美味日記)
// ==========================================================
function bindHistoryEvents() {
  // 時間區間過濾 (全部, 本月, 本季, 今年)
  const filterPills = document.querySelectorAll('.hist-filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      SoundEngine.playPop();
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      AppState.historyFilter = pill.dataset.filter;
      renderHistoryView();
    });
  });

  // 記下一筆按鈕
  const addBtn = document.getElementById('btnAddHistoryEntry');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      openAddHistoryModal();
    });
  }
}

// 渲染吃過的紀錄時間軸
function renderHistoryView() {
  const container = document.getElementById('historyTimelineList');
  if (!container) return;
  container.innerHTML = '';

  const { historyFilter } = AppState;
  const now = new Date();

  const filtered = AppState.history.filter(h => {
    const entryDate = new Date(h.date);
    if (historyFilter === 'month') {
      return entryDate.getFullYear() === now.getFullYear() && entryDate.getMonth() === now.getMonth();
    }
    if (historyFilter === 'quarter') {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const entryQuarter = Math.floor(entryDate.getMonth() / 3);
      return entryDate.getFullYear() === now.getFullYear() && currentQuarter === entryQuarter;
    }
    if (historyFilter === 'year') {
      return entryDate.getFullYear() === now.getFullYear();
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; color: var(--text-muted);">
        <p style="font-size: 2.5rem; margin-bottom: 8px;">📖🍜</p>
        <p style="font-weight: 800;">目前這段時間還沒有用餐日記</p>
        <p style="font-size: 0.85rem;">點擊右上角「＋ 記下一筆」寫下你今天吃的美味餐廳吧！</p>
      </div>
    `;
    return;
  }

  // 依日期由新到舊排序
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  filtered.forEach(h => {
    const card = document.createElement('div');
    card.className = 'history-entry-card';

    const d = new Date(h.date);
    const dateFormatted = `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
    const dayOfWeek = h.dayOfWeek || '平日';

    card.innerHTML = `
      <div class="history-date-col">
        <div class="history-date-day">${dateFormatted}</div>
        <div class="history-date-week">${dayOfWeek}</div>
      </div>
      <div class="history-photo-col">
        <img src="${h.photo || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200'}" alt="${h.restaurantName}" loading="lazy">
      </div>
      <div class="history-info-col">
        <h4 class="history-restaurant-name">${h.restaurantName}</h4>
        <div class="history-rating-stars">
          ★ ${h.rating} <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">• $${h.cost || '200'} • ${h.area || '在地'}</span>
        </div>
        <p class="history-notes">${h.notes || '美味的一餐！'}</p>
      </div>
      <div>
        <button class="btn-card-action btn-delete-history" data-id="${h.id}" style="padding: 6px 10px; font-size: 0.78rem; border-color: transparent;">
          🗑️
        </button>
      </div>
    `;

    card.querySelector('.btn-delete-history').addEventListener('click', async () => {
      if (confirm(`確定要刪除這筆「${h.restaurantName}」的紀錄嗎？`)) {
        try {
          if (typeof DB !== 'undefined') {
            await DB.delete('history', h.id);
          }
          // 資料庫刪除成功後，才從記憶體中移除並重繪 UI
          AppState.history = AppState.history.filter(item => item.id !== h.id);
          renderHistoryView();
        } catch (err) {
          console.error("刪除歷史紀錄失敗:", err);
          alert(`❌ 刪除紀錄失敗：${err.message}\n資料未變更！`);
        }
      }
    });

    container.appendChild(card);
  });
}

// 打開新增歷史用餐紀錄彈窗
function openAddHistoryModal(prefillRestaurant = null) {
  const modal = document.getElementById('modalAddHistory');
  if (!modal) return;

  const selectRest = document.getElementById('addHistRestSelect');
  const dateInput = document.getElementById('addHistDate');
  const costInput = document.getElementById('addHistCost');
  const ratingInput = document.getElementById('addHistRating');
  const notesInput = document.getElementById('addHistNotes');

  // 填入餐廳選單
  selectRest.innerHTML = '<option value="">-- 手動輸入或其他餐廳 --</option>';
  AppState.restaurants.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.name} (${r.area})`;
    if (prefillRestaurant && prefillRestaurant.id === r.id) {
      opt.selected = true;
    }
    selectRest.appendChild(opt);
  });

  // 預設今天日期
  const today = new Date().toISOString().split('T')[0];
  dateInput.value = today;
  costInput.value = prefillRestaurant ? prefillRestaurant.avgPrice : 220;
  ratingInput.value = 5;
  notesInput.value = '';

  modal.classList.add('active');
}

// ==========================================================
// PAGE 5: 設定 (個人化偏好 & Google 串接)
// ==========================================================
function bindSettingsEvents() {
  // 排除規則 Radio
  document.querySelectorAll('input[name="excludeRule"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      AppState.settings.excludeRule = e.target.value;
      saveDataToStorage();
    });
  });

  // 不喜歡的料理 Tags
  document.querySelectorAll('.dislike-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      SoundEngine.playPop();
      const val = tag.dataset.value;
      if (AppState.settings.dislikes.includes(val)) {
        AppState.settings.dislikes = AppState.settings.dislikes.filter(d => d !== val);
        tag.classList.remove('selected');
      } else {
        AppState.settings.dislikes.push(val);
        tag.classList.add('selected');
      }
      saveDataToStorage();
    });
  });

  // 料理權重滑桿
  document.querySelectorAll('.cuisine-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const cuisine = slider.dataset.cuisine;
      const val = parseInt(e.target.value, 10);
      AppState.settings.cuisineWeights[cuisine] = val;
      const badge = document.getElementById(`val-${cuisine}`);
      if (badge) badge.textContent = `${val}x`;
      saveDataToStorage();
    });
  });

  // 預算範圍滑桿
  const budgetSlider = document.getElementById('budgetRangeSlider');
  if (budgetSlider) {
    budgetSlider.addEventListener('input', (e) => {
      const maxB = parseInt(e.target.value, 10);
      AppState.settings.budgetMax = maxB;
      document.getElementById('budgetRangeDisplay').textContent = `$100 - $${maxB}`;
      saveDataToStorage();
    });
  }

  // 距離按鈕
  document.querySelectorAll('.btn-dist-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      SoundEngine.playPop();
      document.querySelectorAll('.btn-dist-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.settings.maxDistanceKm = parseFloat(btn.dataset.dist);
      saveDataToStorage();
    });
  });

  // 主題顏色切換
  document.querySelectorAll('.theme-color-circle').forEach(circle => {
    circle.addEventListener('click', () => {
      SoundEngine.playPop();
      applyTheme(circle.dataset.theme);
    });
  });

  // 資料管理按鈕 (匯出、匯入、清除)
  const btnExport = document.getElementById('btnExportData');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      exportAllDataAsJson();
    });
  }

  // 下載遷移前 localStorage 完整備份
  const btnDownloadPreBackup = document.getElementById('btnDownloadPreBackup');
  if (btnDownloadPreBackup) {
    btnDownloadPreBackup.addEventListener('click', async () => {
      SoundEngine.playPop();
      if (typeof DB !== 'undefined') {
        const backup = DB.createLocalStorageBackupData();
        const filename = DB.getBackupFilename();
        DB.downloadJsonFile(backup, filename);
        alert(`📥 已下載遷移前 localStorage 完整備份：\n${filename}\n\n您可以將此檔案安全備份至 Google Drive！`);
      } else {
        alert("資料庫模組尚未載入");
      }
    });
  }

  // 檢查 IndexedDB 健康度 (純唯讀，絕不覆寫或復活已刪除資料)
  const btnVerifyDbIntegrity = document.getElementById('btnVerifyDbIntegrity');
  if (btnVerifyDbIntegrity) {
    btnVerifyDbIntegrity.addEventListener('click', async () => {
      SoundEngine.playPop();
      if (typeof DB === 'undefined') return alert("資料庫模組尚未載入");

      btnVerifyDbIntegrity.disabled = true;
      btnVerifyDbIntegrity.textContent = '🔍 正在檢查資料庫中...';

      try {
        const v = await DB.verifyIntegrity();
        await updateMigrationUI();
        SoundEngine.playFanfare();
        alert(`✅ IndexedDB 資料庫健康度檢查通過！\n\n• 儲存狀態：正常健康 (已初始化: ${v.initialized ? '是' : '否'})\n• 地點總數：${v.placesCount} 間 (自訂: ${v.userPlacesCount} / 示範: ${v.demoPlacesCount})\n• 歷史紀錄：${v.historyCount} 筆 (自訂: ${v.userHistoryCount} / 示範: ${v.demoHistoryCount})\n• 分類清單：${v.listsCount} 組\n\n此檢查為純唯讀驗證，未自 localStorage 覆蓋任何資料！`);
      } catch (err) {
        alert("❌ 資料庫檢查失敗：" + err.message);
      } finally {
        btnVerifyDbIntegrity.disabled = false;
        btnVerifyDbIntegrity.textContent = '🔍 檢查 IndexedDB 資料庫健康度 (唯讀安全，不覆蓋資料)';
      }
    });
  }

  // 從舊 localStorage 強制重新遷移 - 暫時停用（安全防線：完整備份還原機制完成前不開放）
  const btnForceReimportLocalStorage = document.getElementById('btnForceReimportLocalStorage');
  if (btnForceReimportLocalStorage) {
    btnForceReimportLocalStorage.disabled = true;
    btnForceReimportLocalStorage.style.opacity = '0.5';
    btnForceReimportLocalStorage.style.cursor = 'not-allowed';
    btnForceReimportLocalStorage.title = '暫時停用：防止覆蓋您遷移後修改或刪除的最新資料';
    btnForceReimportLocalStorage.addEventListener('click', (e) => {
      e.preventDefault();
      alert('⚠️ 此功能目前依安全考量暫時鎖定。\n\n原因：在完整的 JSON 備份還原機制完成前，強制重新遷移會以舊資料覆蓋您在遷移後刪除或修改的項目。\n\n請使用「匯出 JSON 備份」儲存最新資料。');
    });
  }

  const btnImport = document.getElementById('btnImportData');
  const fileInputImport = document.getElementById('fileInputImportData');
  if (btnImport && fileInputImport) {
    btnImport.addEventListener('click', () => fileInputImport.click());
    fileInputImport.addEventListener('change', (e) => handleImportFile(e));
  }

  const btnClear = document.getElementById('btnClearAllData');
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      if (!confirm("⚠️ 確定要清除所有資料嗎？\n\n此操作無法復原！所有自訂的收藏與紀錄將被清除。")) return;

      // 安全防線：清除前自動備份現有資料
      if (!confirm("📥 第二步確認：清除前將自動下載 IndexedDB 現有資料的 JSON 備份檔。是否繼續？")) return;

      // 先下載 IndexedDB 完整備份（保留 migration_meta 中的遷移前快照）
      try {
        await exportAllDataAsJson();
      } catch (e) {
        if (!confirm('⚠️ 備份下載失敗。您確定不保留任何備份，直接清除嗎？')) return;
      }

      if (typeof DB !== 'undefined') {
        // 清空業務資料表
        await DB.clear('places');
        await DB.clear('history');
        await DB.clear('lists');
        // 只清除偏好設定，保留 initialized 與 migration_meta
        await DB.delete('settings', 'preferences');
        await DB.delete('settings', 'initialized');
        // 不刪除 migration_meta — 此表保存遷移前完整 localStorage 快照，是最後一道安全防線！
      }
      // localStorage 中的凍結標記也一併清除（重開後可重新遷移）
      localStorage.removeItem('WTE_MIGRATED_FROZEN');
      localStorage.removeItem('WTE_MIGRATED_AT');
      location.reload();
    });
  }

  // 避免連續抽中同一家設定切換
  const chkAvoid = document.getElementById('chkAvoidConsecutive');
  if (chkAvoid) {
    chkAvoid.addEventListener('change', (e) => {
      AppState.settings.avoidConsecutivePicks = e.target.checked;
      saveDataToStorage();
    });
  }

  // 未評分店家納入抽籤設定切換
  const chkUnrated = document.getElementById('chkIncludeUnrated');
  if (chkUnrated) {
    chkUnrated.addEventListener('change', (e) => {
      AppState.settings.includeUnratedPlaces = e.target.checked;
      saveDataToStorage();
      updateCandidateCountUI();
    });
  }

  // 檢查並清理現有異常錯位店家資料
  const btnInspectAnomalies = document.getElementById('btnInspectAnomalies');
  if (btnInspectAnomalies) {
    btnInspectAnomalies.addEventListener('click', () => {
      inspectAnomalousPlaces();
    });
  }

  // Google Takeout / CSV 檔案上傳解析器
  const takeoutDropzone = document.getElementById('takeoutDropzone');
  const fileInputTakeout = document.getElementById('fileInputTakeout');
  if (takeoutDropzone && fileInputTakeout) {
    takeoutDropzone.addEventListener('click', () => fileInputTakeout.click());
    fileInputTakeout.addEventListener('change', (e) => handleGoogleTakeoutUpload(e));
  }

  // Google Demo 檔案一鍵匯入
  const btnLoadDemoGoogle = document.getElementById('btnLoadDemoGooglePlaces');
  if (btnLoadDemoGoogle) {
    btnLoadDemoGoogle.addEventListener('click', () => {
      loadDemoGoogleTakeout();
    });
  }
}

// 同步設定值到 UI
function syncSettingsView() {
  const { settings } = AppState;

  // 排除規則
  const radio = document.querySelector(`input[name="excludeRule"][value="${settings.excludeRule}"]`);
  if (radio) radio.checked = true;

  // 避免連續抽中同一家
  const chkAvoid = document.getElementById('chkAvoidConsecutive');
  if (chkAvoid) chkAvoid.checked = settings.avoidConsecutivePicks !== false;

  // 未評分店家納入抽籤
  const chkUnrated = document.getElementById('chkIncludeUnrated');
  if (chkUnrated) chkUnrated.checked = settings.includeUnratedPlaces !== false;

  // 不喜歡料理
  document.querySelectorAll('.dislike-tag').forEach(tag => {
    tag.classList.toggle('selected', settings.dislikes.includes(tag.dataset.value));
  });

  // 權重滑桿
  for (let c in settings.cuisineWeights) {
    const slider = document.querySelector(`.cuisine-slider[data-cuisine="${c}"]`);
    if (slider) {
      slider.value = settings.cuisineWeights[c];
      const badge = document.getElementById(`val-${c}`);
      if (badge) badge.textContent = `${settings.cuisineWeights[c]}x`;
    }
  }

  // 距離
  document.querySelectorAll('.btn-dist-chip').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.dist) === settings.maxDistanceKm);
  });
}

// ==========================================================
// CSV & Google Takeout 安全匯入引擎 (RFC 4180 標準解析 + 預覽對應)
// ==========================================================

// RFC 4180 標準 CSV 解析器 (支援 UTF-8 BOM、跳脫引號、引號內逗號與換行)
function parseRFC4180Csv(text) {
  if (!text) return { headers: [], rows: [] };
  // 清理 UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentCell += '"';
          i++; // 跳過連續雙引號
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
  }

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.replace(/^["']|["']$/g, '').trim());
  return { headers, rows: rows.slice(1) };
}

// 行政區識別推導 (支援台中 29 區與已知縣市主要行政區)
function extractDistrictFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/(西屯區|南屯區|北區|西區|中區|東區|南區|北屯區|大里區|太平區|豐原區|潭子區|大雅區|沙鹿區|清水區|梧棲區|龍井區|大肚區|烏日區|霧峰區|神岡區|后里區|石岡區|東勢區|新社區|和平區|外埔區|大安區|大甲區|仁德區|東區|安平區|中西區|新營區|板橋區|信義區|大安區|中山區)/);
  return m ? m[1] : null;
}

// 匯入預覽暫存 Context
const CsvPreviewContext = {
  fileName: '',
  headers: [],
  rows: [],
  isGoogleTakeout: false,
  mapColName: -1,
  mapColAddress: -1,
  mapColNote: -1,
  mapColUrl: -1,
  validPlaces: [],
  duplicateCount: 0,
  invalidCount: 0,
  invalidSamples: []
};

// 處理檔案上傳入口
function handleGoogleTakeoutUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const content = evt.target.result;
      if (file.name.endsWith('.csv')) {
        const { headers, rows } = parseRFC4180Csv(content);
        if (rows.length === 0) {
          alert("⚠️ 檔案中未發現有效資料列！請確認 CSV 檔案內容是否完整。");
          return;
        }
        openCsvPreviewModal({ headers, rows, isJson: false }, file);
      } else if (file.name.endsWith('.json') || file.name.endsWith('.geojson')) {
        const jsonData = JSON.parse(content);
        const { headers, rows } = convertGeoJsonToTable(jsonData);
        if (rows.length === 0) {
          alert("⚠️ 檔案中未發現有效地點！請確認為 Google Takeout JSON/GeoJSON 檔案。");
          return;
        }
        openCsvPreviewModal({ headers, rows, isJson: true }, file);
      } else {
        alert("不支援的檔案格式，請上傳 Google 匯出的 .json、.geojson 或 .csv 檔案！");
      }
    } catch (err) {
      console.error("解析匯入檔案失敗:", err);
      alert("解析檔案失敗：" + err.message);
    }
  };
  reader.readAsText(file);
}

// 將 GeoJSON / JSON 轉為統一表格結構以利共用預覽與驗證
function convertGeoJsonToTable(data) {
  const features = data.features || (Array.isArray(data) ? data : []);
  const headers = ['Title', 'Address', 'Comment', 'Google Maps URL'];
  const rows = [];

  features.forEach(feat => {
    const props = feat.properties || feat;
    const name = props.Title || props.name || props["Business Name"] || "";
    const address = (props.Location && props.Location.Address) || props.address || props["Formatted Address"] || "";
    const note = props.Comment || props.note || "";
    const url = props["Google Maps URL"] || props.url || "";
    if (name) {
      rows.push([name, address, note, url]);
    }
  });

  return { headers, rows };
}

// 開啟預覽與欄位對應視窗
function openCsvPreviewModal({ headers, rows, isJson }, file) {
  CsvPreviewContext.fileName = file.name;
  CsvPreviewContext.headers = headers;
  CsvPreviewContext.rows = rows;

  // 自動辨識欄位
  let isGoogleTakeout = isJson;
  let nameIdx = -1;
  let addrIdx = -1;
  let noteIdx = -1;
  let urlIdx = -1;

  headers.forEach((h, idx) => {
    const lower = h.toLowerCase().trim();
    if (lower === 'title' || lower === 'business name') {
      nameIdx = idx;
      isGoogleTakeout = true;
    } else if (nameIdx === -1 && (lower.includes('店名') || lower.includes('餐廳') || lower.includes('名稱') || lower === 'name')) {
      nameIdx = idx;
    }

    if (lower === 'address' || lower === 'formatted address' || lower.includes('地址')) {
      addrIdx = idx;
    }
    if (lower === 'note' || lower === 'comment' || lower.includes('備註') || lower.includes('描述') || lower.includes('心得')) {
      noteIdx = idx;
    }
    if (lower === 'url' || lower === 'google maps url' || lower.includes('網址') || lower.includes('連結')) {
      urlIdx = idx;
    }
  });

  // 如果未匹配到店名，預設取第 0 欄
  if (nameIdx === -1 && headers.length > 0) nameIdx = 0;

  CsvPreviewContext.isGoogleTakeout = isGoogleTakeout;
  CsvPreviewContext.mapColName = nameIdx;
  CsvPreviewContext.mapColAddress = addrIdx;
  CsvPreviewContext.mapColNote = noteIdx;
  CsvPreviewContext.mapColUrl = urlIdx;

  // 填入 UI 標籤與下拉選單
  const fileNameEl = document.getElementById('csvFileNameText');
  const typeBadgeEl = document.getElementById('csvFileTypeBadge');
  if (fileNameEl) fileNameEl.textContent = `檔案名稱：${file.name} (共 ${rows.length} 列資料)`;
  if (typeBadgeEl) {
    typeBadgeEl.textContent = isGoogleTakeout ? 'Google Takeout 格式' : '自訂 CSV 格式';
    typeBadgeEl.style.background = isGoogleTakeout ? '#F3E5F5' : '#E3F2FD';
    typeBadgeEl.style.color = isGoogleTakeout ? '#7B1FA2' : '#1565C0';
  }

  // 填充欄位對應下拉選單
  populateMappingDropdown('mapColName', headers, nameIdx, true);
  populateMappingDropdown('mapColAddress', headers, addrIdx, false);
  populateMappingDropdown('mapColNote', headers, noteIdx, false);
  populateMappingDropdown('mapColUrl', headers, urlIdx, false);

  // 綁定欄位變更即時重整預覽
  bindCsvMappingChangeEvents();

  // 重新計算並渲染預覽表格
  renderCsvPreviewUI();

  // 顯示 Modal
  const modal = document.getElementById('modalCsvPreview');
  if (modal) modal.classList.add('active');
}

// 填充單個欄位對應下拉選單
function populateMappingDropdown(selectId, headers, selectedIdx, isRequired) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '';

  if (!isRequired) {
    const optNone = document.createElement('option');
    optNone.value = '-1';
    optNone.textContent = '（無對應此欄位）';
    select.appendChild(optNone);
  }

  headers.forEach((h, idx) => {
    const opt = document.createElement('option');
    opt.value = idx.toString();
    opt.textContent = `第 ${idx + 1} 欄: ${h || '(未命名標頭)'}`;
    if (idx === selectedIdx) opt.selected = true;
    select.appendChild(opt);
  });
}

// 綁定欄位變更事件
function bindCsvMappingChangeEvents() {
  ['mapColName', 'mapColAddress', 'mapColNote', 'mapColUrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.bound) {
      el.dataset.bound = 'true';
      el.addEventListener('change', () => {
        CsvPreviewContext[id] = parseInt(el.value, 10);
        renderCsvPreviewUI();
      });
    }
  });

  const btnCancel = document.getElementById('btnCancelCsvImport');
  if (btnCancel && !btnCancel.dataset.bound) {
    btnCancel.dataset.bound = 'true';
    btnCancel.addEventListener('click', () => closeModals());
  }

  const btnConfirm = document.getElementById('btnConfirmCsvImport');
  if (btnConfirm && !btnConfirm.dataset.bound) {
    btnConfirm.dataset.bound = 'true';
    btnConfirm.addEventListener('click', () => confirmCsvImportToDatabase());
  }
}

// 執行驗證並渲染預覽表格與統計
function renderCsvPreviewUI() {
  const { rows, mapColName, mapColAddress, mapColNote, mapColUrl, isGoogleTakeout } = CsvPreviewContext;
  const existingNamesSet = new Set(AppState.restaurants.map(r => (r.name || '').trim().toLowerCase()));

  const validPlaces = [];
  let duplicateCount = 0;
  let invalidCount = 0;
  const invalidSamples = [];
  const previewRowsData = [];

  rows.forEach((row, rowIdx) => {
    const rawName = mapColName >= 0 && row[mapColName] ? row[mapColName].trim() : '';
    const rawAddress = mapColAddress >= 0 && row[mapColAddress] ? row[mapColAddress].trim() : '';
    const rawNote = mapColNote >= 0 && row[mapColNote] ? row[mapColNote].trim() : '';
    const rawUrl = mapColUrl >= 0 && row[mapColUrl] ? row[mapColUrl].trim() : '';

    // 嚴格店名驗證：非空、不可為純數字、不可為純浮點數座標
    if (!rawName) {
      invalidCount++;
      if (invalidSamples.length < 3) invalidSamples.push(`第 ${rowIdx + 1} 列：店名為空`);
      return;
    }
    if (/^\d+$/.test(rawName)) {
      invalidCount++;
      if (invalidSamples.length < 3) invalidSamples.push(`第 ${rowIdx + 1} 列：店名不可為純數字 ID (值為「${rawName}」)`);
      return;
    }
    if (/^-?\d+(\.\d+)?$/.test(rawName)) {
      invalidCount++;
      if (invalidSamples.length < 3) invalidSamples.push(`第 ${rowIdx + 1} 列：店名不可為座標或數字浮點數 (值為「${rawName}」)`);
      return;
    }

    // 重複檢查
    const normName = rawName.toLowerCase();
    const isDup = existingNamesSet.has(normName);
    if (isDup) {
      duplicateCount++;
      if (previewRowsData.length < 8) {
        previewRowsData.push({ status: '⚠️ 已存在 (跳過)', name: rawName, district: '重複', address: rawAddress, source: '已存在' });
      }
      return;
    }

    // 地區推導：唯有從地址或店名成功辨識時才填入，否則為「待確認」，絕不硬塞西屯區！
    const inferredDistrict = extractDistrictFromText(rawAddress) || extractDistrictFromText(rawName) || '待確認';

    const newPlace = {
      id: `imp-${Date.now()}-${rowIdx}-${Math.random().toString(36).substring(2, 6)}`,
      name: rawName,
      category: isGoogleTakeout ? "Google收藏" : "自訂匯入",
      tags: isGoogleTakeout ? ["Google收藏", "想吃"] : ["CSV匯入", "想吃"],
      rating: null,          // 絕無假評分！
      reviewCount: null,     // 絕無假評論數！
      priceMin: null,
      priceMax: null,
      avgPrice: null,        // 絕無假預算！
      area: inferredDistrict,
      district: inferredDistrict,
      address: rawAddress || '',
      lat: 24.1632,
      lng: 120.6445,
      distanceKm: null,
      isOpen: null,          // 絕無假營業狀態！
      openHours: '',
      paymentMethods: ["現金"],
      photo: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=700&auto=format&fit=crop&q=80",
      description: rawNote || (isGoogleTakeout ? "從 Google Maps 收藏匯入" : "從自訂 CSV 匯入"),
      isFavorite: true,
      customList: "想吃",
      googlePlaceUrl: rawUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rawName + (rawAddress ? ' ' + rawAddress : ''))}`,
      source: isGoogleTakeout ? 'google_takeout' : 'csv',
      isDemo: false,
      createdAt: new Date().toISOString()
    };

    validPlaces.push(newPlace);
    existingNamesSet.add(normName); // 避免檔案內同批重複

    if (previewRowsData.length < 8) {
      previewRowsData.push({ status: '✅ 可匯入', name: rawName, district: inferredDistrict, address: rawAddress, source: isGoogleTakeout ? 'Google' : 'CSV' });
    }
  });

  CsvPreviewContext.validPlaces = validPlaces;
  CsvPreviewContext.duplicateCount = duplicateCount;
  CsvPreviewContext.invalidCount = invalidCount;

  // 渲染統計資訊
  const statsEl = document.getElementById('csvSummaryStats');
  if (statsEl) {
    statsEl.innerHTML = `
      <span style="background: #E8F5E9; color: #2E7D32; padding: 4px 10px; border-radius: var(--radius-sm); font-weight: 700;">✅ 可匯入：${validPlaces.length} 筆</span>
      <span style="background: #FFF3E0; color: #E65100; padding: 4px 10px; border-radius: var(--radius-sm); font-weight: 700;">⚠️ 重複跳過：${duplicateCount} 筆</span>
      <span style="background: ${invalidCount > 0 ? '#FFEBEE' : '#F5F5F5'}; color: ${invalidCount > 0 ? '#C62828' : '#757575'}; padding: 4px 10px; border-radius: var(--radius-sm); font-weight: 700;">❌ 格式不符：${invalidCount} 筆</span>
    `;
  }

  // 渲染錯誤提示框
  const errorBox = document.getElementById('csvErrorNotice');
  if (errorBox) {
    if (invalidCount > 0) {
      errorBox.style.display = 'block';
      errorBox.innerHTML = `<strong>⚠️ 發現 ${invalidCount} 筆資料未通過檢驗（已自動排除）：</strong><br>${invalidSamples.join('<br>')}${invalidCount > 3 ? `<br>...其餘 ${invalidCount - 3} 筆亦被略過。` : ''}`;
    } else {
      errorBox.style.display = 'none';
    }
  }

  // 渲染表格內容
  const tbody = document.getElementById('csvPreviewTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    if (previewRowsData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: #999;">未找到任何可讀取的資料列</td></tr>`;
    } else {
      previewRowsData.forEach(p => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #EEE';
        tr.innerHTML = `
          <td style="padding: 6px 8px;">${p.status}</td>
          <td style="padding: 6px 8px; font-weight: 700; color: #2C3E50;">${p.name}</td>
          <td style="padding: 6px 8px; color: ${p.district === '待確認' ? '#E65100' : '#27AE60'}; font-weight: 600;">${p.district}</td>
          <td style="padding: 6px 8px; color: #7F8C8D; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.address || '（未註記）'}</td>
          <td style="padding: 6px 8px; font-size: 0.75rem; color: #888;">${p.source}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  // 更新確認按鈕文字
  const btnConfirm = document.getElementById('btnConfirmCsvImport');
  if (btnConfirm) {
    btnConfirm.disabled = validPlaces.length === 0;
    btnConfirm.textContent = validPlaces.length > 0 ? `💾 確認寫入資料庫 (${validPlaces.length} 筆有效店家)` : `無有效店家可匯入`;
  }
}

// 使用者確認匯入：安全事務寫入 IndexedDB
async function confirmCsvImportToDatabase() {
  const { validPlaces, fileName } = CsvPreviewContext;
  if (!validPlaces || validPlaces.length === 0) {
    alert("目前沒有可匯入的有效店家資料！");
    return;
  }

  const btnConfirm = document.getElementById('btnConfirmCsvImport');
  if (btnConfirm) {
    btnConfirm.disabled = true;
    btnConfirm.textContent = '正在寫入資料庫中...';
  }

  try {
    // 嚴格以 IndexedDB 事務原子性批次寫入
    if (typeof DB !== 'undefined') {
      await DB.bulkPut('places', validPlaces);
    }
    
    // 成功後加入全域狀態記憶體
    AppState.restaurants.push(...validPlaces);
    
    SoundEngine.playFanfare();
    closeModals();
    updateCandidateCountUI();
    renderFavoritesView();
    renderExploreList();

    alert(`🎉 匯入成功！\n\n已成功將 ${validPlaces.length} 家店家安全存入 IndexedDB 本地資料庫！\n檔案：${fileName}\n來源已標記為正規來源，無任何假評分或寫死行政區。`);
    
    // 切換到收藏清單檢視
    const favTabBtn = document.querySelector('.nav-tab-btn[data-tab="favorites"]');
    if (favTabBtn) favTabBtn.click();
  } catch (err) {
    console.error("寫入 IndexedDB 失敗:", err);
    alert(`❌ 匯入資料庫失敗：${err.message}\n系統已中斷交易，未留下部分錯誤資料！`);
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.textContent = '💾 確認寫入資料庫';
    }
  }
}

// 一鍵載入示範 Google Takeout 資料 (乾淨正規格式，不塞假數據)
function loadDemoGoogleTakeout() {
  fetch('./sample_google_maps_saved_places.json')
    .then(res => res.json())
    .then(data => {
      openCsvPreviewModal(convertGeoJsonToTable(data), { name: 'sample_google_maps_saved_places.json' });
    })
    .catch(err => {
      console.warn("讀取本機示範檔失敗:", err);
      alert("讀取示範檔案失敗：" + err.message);
    });
}

// 檢查並清理現有異常店家資料 (如純數字店名、錯位浮點數描述)
function inspectAnomalousPlaces() {
  const anomalies = AppState.restaurants.filter(r => {
    if (!r.name) return true;
    const name = r.name.trim();
    if (/^\d+$/.test(name)) return true; // 純數字店名 (如 17)
    if (/^-?\d+(\.\d+)?$/.test(name)) return true; // 座標數字店名
    if (r.reviewCount === 888 && r.rating === 4.4 && r.id && r.id.startsWith('csv-imp-')) return true; // 舊版 Bug 特徵
    if (r.description && /^-?\d+\.\d+$/.test(r.description.trim())) return true; // 浮點數當描述 (如 227.3956549)
    return false;
  });

  if (anomalies.length === 0) {
    alert("✅ 檢查完成！您的資料庫非常乾淨，未發現任何純數字店名、錯位浮點數等異常資料。");
    return;
  }

  const summary = anomalies.map(a => `• 【${a.name}】 (地區: ${a.area || '未知'}, 描述: ${a.description || '無'})`).join('\n');
  const confirmed = confirm(`⚠️ 檢查發現 ${anomalies.length} 筆先前錯誤匯入的異常店家資料：\n\n${summary}\n\n是否要自 IndexedDB 中安全移除這些異常資料？\n（此操作只清理上述異常項目，不會影響您的其他合法店家）`);

  if (!confirmed) return;

  (async () => {
    try {
      if (typeof DB !== 'undefined') {
        for (let a of anomalies) {
          await DB.delete('places', a.id);
        }
      }
      const anomalyIds = new Set(anomalies.map(a => a.id));
      AppState.restaurants = AppState.restaurants.filter(r => !anomalyIds.has(r.id));
      updateCandidateCountUI();
      renderFavoritesView();
      renderExploreList();
      alert(`🎉 已成功自 IndexedDB 清除 ${anomalies.length} 筆異常店家！`);
    } catch (e) {
      alert("清除異常資料失敗：" + e.message);
    }
  })();
}

// 更新設定頁面的 IndexedDB 遷移狀態與即時統計
async function updateMigrationUI() {
  const detailEl = document.getElementById('migrationDetailText');
  const badgeEl = document.getElementById('badgeStorageEngine');
  if (!detailEl) return;

  if (typeof DB === 'undefined') {
    detailEl.textContent = '未啟用 IndexedDB 模組，使用 localStorage 暫存。';
    if (badgeEl) badgeEl.textContent = 'localStorage 模式';
    return;
  }

  try {
    const v = await DB.verifyIntegrity();
    const status = await DB.getMigrationStatus();
    if (v.healthy && status.migrated) {
      detailEl.innerHTML = `
        <span style="color: #2E7D32; font-weight: 700;">✅ 資料已安全託管於 IndexedDB 本地資料庫 (Single Source of Truth)</span><br>
        • 地點總數：<strong>${v.placesCount}</strong> 筆 (使用者真實資料: ${v.userPlacesCount} 筆 / 預設示範: ${v.demoPlacesCount} 筆)<br>
        • 歷史紀錄：<strong>${v.historyCount}</strong> 筆 (使用者紀錄: ${v.userHistoryCount} 筆 / 示範: ${v.demoHistoryCount} 筆)<br>
        • 分類清單：<strong>${v.listsCount}</strong> 組清單<br>
        • 首次遷移：${status.log && status.log.completedAt ? new Date(status.log.completedAt).toLocaleString() : '已完成'}
      `;
      if (badgeEl) {
        badgeEl.textContent = 'IndexedDB 運作中';
        badgeEl.style.background = '#E8F5E9';
        badgeEl.style.color = '#2E7D32';
      }
    } else {
      detailEl.textContent = '尚未執行遷移或遷移未完成，點擊下方按鈕可檢查或安全遷移。';
      if (badgeEl) {
        badgeEl.textContent = '待遷移';
        badgeEl.style.background = '#FFF3E0';
        badgeEl.style.color = '#E65100';
      }
    }
  } catch (e) {
    detailEl.textContent = '讀取資料庫狀態異常：' + e.message;
  }
}

// 匯出全部資料為標準 JSON 備份檔 (WhatToEat_Backup_YYYY-MM-DD_HH-mm.json)
async function exportAllDataAsJson() {
  let places = AppState.restaurants;
  let history = AppState.history;
  let lists = AppState.customLists;
  let settings = AppState.settings;

  if (typeof DB !== 'undefined') {
    try {
      places = await DB.getAll('places');
      history = await DB.getAll('history');
      const listObjs = await DB.getAll('lists');
      if (listObjs && listObjs.length > 0) lists = listObjs.map(l => l.name);
      const settingsObj = await DB.get('settings', 'preferences');
      if (settingsObj && settingsObj.value) settings = settingsObj.value;
    } catch (e) {
      console.warn("從 IndexedDB 取得最新備份資料失敗，改用記憶體快取:", e);
    }
  }

  const exportPayload = {
    appName: "WhatToEat",
    version: "2.0.0",
    exportDate: new Date().toISOString(),
    summary: {
      placesCount: places.length,
      userPlacesCount: places.filter(p => !p.isDemo).length,
      demoPlacesCount: places.filter(p => p.isDemo).length,
      historyCount: history.length,
      listsCount: lists.length
    },
    data: {
      places: places,
      history: history,
      lists: lists,
      settings: settings
    }
  };

  const filename = typeof DB !== 'undefined' ? DB.getBackupFilename() : `WhatToEat_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  if (typeof DB !== 'undefined') {
    DB.downloadJsonFile(exportPayload, filename);
  } else {
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// 匯入備份 JSON
function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.restaurants) AppState.restaurants = data.restaurants;
      if (data.history) AppState.history = data.history;
      if (data.customLists) AppState.customLists = data.customLists;
      if (data.settings) AppState.settings = Object.assign(AppState.settings, data.settings);
      
      saveDataToStorage();
      alert("🎉 備份資料匯入成功！");
      location.reload();
    } catch (err) {
      alert("匯入失敗，請確認檔案格式是否正確：" + err.message);
    }
  };
  reader.readAsText(file);
}

// ==========================================================
// 彈窗 Modal 邏輯與詳細資訊
// ==========================================================
function bindModals() {
  // 關閉所有彈窗按鈕
  document.querySelectorAll('.modal-close-btn, .modal-close-trigger').forEach(btn => {
    btn.addEventListener('click', () => closeModals());
  });

  // 點擊遮罩關閉
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModals();
    });
  });

  // 新增紀錄表單送出
  const formAddHist = document.getElementById('formAddHistory');
  if (formAddHist) {
    formAddHist.addEventListener('submit', async (e) => {
      e.preventDefault();
      const selectRest = document.getElementById('addHistRestSelect');
      const dateVal = document.getElementById('addHistDate').value;
      const costVal = parseInt(document.getElementById('addHistCost').value, 10) || 200;
      const ratingVal = parseFloat(document.getElementById('addHistRating').value) || 5;
      const notesVal = document.getElementById('addHistNotes').value;

      let rName = "自訂餐廳";
      let rPhoto = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
      let rArea = "在地";

      const matchedRest = AppState.restaurants.find(r => r.id === selectRest.value);
      if (matchedRest) {
        rName = matchedRest.name;
        rPhoto = matchedRest.photo;
        rArea = matchedRest.area;
      }

      const isSpot = matchedRest && matchedRest.type === 'spot';
      const newEntry = {
        id: `hist-${Date.now()}`,
        placeId: matchedRest ? matchedRest.id : null,
        placeName: rName,
        restaurantId: matchedRest ? matchedRest.id : null,
        restaurantName: rName,
        placeType: isSpot ? 'spot' : 'food',
        actionType: isSpot ? 'visit' : 'eat',
        date: dateVal,
        dayOfWeek: getDayOfWeek(dateVal),
        rating: ratingVal,
        cost: costVal,
        area: rArea,
        notes: notesVal || "美味的一餐！",
        photo: rPhoto,
        isDemo: false,
        createdAt: new Date().toISOString()
      };

      try {
        if (typeof DB !== 'undefined') {
          await DB.put('history', newEntry);
        }
        // 只有資料庫成功儲存後才加入記憶體並重繪畫面
        AppState.history.unshift(newEntry);
        SoundEngine.playFanfare();
        closeModals();
        renderHistoryView();
        alert("🎉 成功新增美味紀錄！");
      } catch (err) {
        console.error("新增歷史紀錄失敗:", err);
        alert(`❌ 新增紀錄失敗：${err.message}\n資料未儲存！`);
      }
    });
  }
}

function openGoogleImportModal() {
  const modal = document.getElementById('modalGoogleImport');
  if (modal) modal.classList.add('active');
}

function showRestaurantDetailModal(r) {
  const modal = document.getElementById('modalRestDetail');
  if (!modal) return;

  document.getElementById('detailModalImg').src = r.photo || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=700';
  document.getElementById('detailModalTitle').textContent = r.name;
  document.getElementById('detailModalRating').textContent = r.rating != null 
    ? `★ ${r.rating} (${r.reviewCount != null ? r.reviewCount.toLocaleString() : 0} 則評論)` 
    : '★ 暫無評分與評論';
  document.getElementById('detailModalPrice').textContent = r.avgPrice != null 
    ? `預算：約 $${r.avgPrice}/人` 
    : (r.priceMin && r.priceMax ? `預算：$${r.priceMin} ~ $${r.priceMax}` : '預算：未註記');
  document.getElementById('detailModalAddress').textContent = r.address || (r.district ? `台中市${r.district}` : '地址待確認');
  document.getElementById('detailModalHours').textContent = `營業時間：${r.openHours || '暫無營業時間資料'}`;
  document.getElementById('detailModalDesc').textContent = r.description || '暫無詳細描述';

  const googleBtn = document.getElementById('detailModalGoogleLink');
  googleBtn.href = r.googlePlaceUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' ' + (r.address || ''))}`;

  modal.classList.add('active');
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function getDayOfWeek(dateString) {
  const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const d = new Date(dateString);
  return days[d.getDay()] || '平日';
}

// ==========================================================
// 慶祝彩帶 (Confetti Canvas)
// ==========================================================
function triggerConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = [];
  const colors = ['#E28743', '#F4A261', '#E76F51', '#58B368', '#F8B838', '#E9C46A'];

  for (let i = 0; i < 90; i++) {
    pieces.push({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.7) * 16,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35; // 重力
      p.rotation += p.rotSpeed;

      if (p.y < canvas.height) {
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    });

    frame++;
    if (alive && frame < 120) {
      requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  animate();
}

// 頁面載入完成後啟動
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});
