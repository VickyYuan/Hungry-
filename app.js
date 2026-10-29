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
  
  // 地圖相關
  mapProvider: 'leaflet', // 'leaflet' | 'google'
  mapInstance: null,
  mapMarkers: [],
  
  // 使用者偏好設定
  settings: {
    googleApiKey: '',
    excludeRule: '7', // '7' | '30' | 'forever' | 'none'
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
    maxDistanceKm: 3,
    theme: 'cream'
  },
  
  // 首頁抽籤條件
  homeFilter: {
    source: 'cloud', // 'cloud' (全部雲端) | 'favs' (我的口袋名單)
    excludeEaten: true,
    area: '全部',
    budget: '150-250',
    category: '全部',
    payment: '全部',
    mealTime: '午餐',
    minRating: 4.0
  },

  // 探索搜尋條件
  exploreFilter: {
    query: '',
    source: 'google', // 'google' | 'myList'
    tag: '全部',
    sortBy: 'distance'
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
// 初始化與資料載入
// ==========================================================
function initApp() {
  loadDataFromStorage();
  applyTheme(AppState.settings.theme);
  bindNavigationEvents();
  bindHomeEvents();
  bindExploreEvents();
  bindFavoritesEvents();
  bindHistoryEvents();
  bindSettingsEvents();
  bindModals();
  
  // 渲染首頁與預設命定美食
  renderHomeDestinyCard(AppState.restaurants[0] || null);
  
  // 初始化地圖
  setTimeout(() => {
    initMap();
  }, 400);

  console.log("吃什麼？App 初始化完成！");
}

// 從 LocalStorage 載入資料或預設值
function loadDataFromStorage() {
  try {
    const savedRest = localStorage.getItem('WTE_restaurants');
    if (savedRest) {
      AppState.restaurants = JSON.parse(savedRest);
    } else if (window.DEFAULT_RESTAURANTS) {
      AppState.restaurants = JSON.parse(JSON.stringify(window.DEFAULT_RESTAURANTS));
    }

    const savedHist = localStorage.getItem('WTE_history');
    if (savedHist) {
      AppState.history = JSON.parse(savedHist);
    } else if (window.DEFAULT_HISTORY) {
      AppState.history = JSON.parse(JSON.stringify(window.DEFAULT_HISTORY));
    }

    const savedLists = localStorage.getItem('WTE_customLists');
    if (savedLists) {
      AppState.customLists = JSON.parse(savedLists);
    }

    const savedSettings = localStorage.getItem('WTE_settings');
    if (savedSettings) {
      AppState.settings = Object.assign(AppState.settings, JSON.parse(savedSettings));
    }
  } catch (err) {
    console.error("載入本機資料時發生錯誤：", err);
  }
}

// 儲存資料回 LocalStorage
function saveDataToStorage() {
  try {
    localStorage.setItem('WTE_restaurants', JSON.stringify(AppState.restaurants));
    localStorage.setItem('WTE_history', JSON.stringify(AppState.history));
    localStorage.setItem('WTE_customLists', JSON.stringify(AppState.customLists));
    localStorage.setItem('WTE_settings', JSON.stringify(AppState.settings));
  } catch (err) {
    console.error("寫入本機資料失敗：", err);
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
      if (AppState.mapInstance && AppState.mapInstance.invalidateSize) {
        setTimeout(() => AppState.mapInstance.invalidateSize(), 200);
      }
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
      if (AppState.mapInstance && AppState.mapInstance.invalidateSize) {
        setTimeout(() => AppState.mapInstance.invalidateSize(), 300);
      }
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
  // 來源切換 (雲端店家 vs 口袋名單)
  const sourcePills = document.querySelectorAll('.home-source-pill');
  sourcePills.forEach(pill => {
    pill.addEventListener('click', () => {
      SoundEngine.playPop();
      sourcePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      AppState.homeFilter.source = pill.dataset.source;
    });
  });

  // 排除吃過開關
  const excludePill = document.getElementById('pillExcludeEaten');
  if (excludePill) {
    excludePill.addEventListener('click', () => {
      SoundEngine.playPop();
      AppState.homeFilter.excludeEaten = !AppState.homeFilter.excludeEaten;
      excludePill.classList.toggle('active', AppState.homeFilter.excludeEaten);
    });
  }

  // 篩選下拉選單事件
  const bindFilter = (id, field) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        AppState.homeFilter[field] = e.target.value;
      });
    }
  };
  bindFilter('filterArea', 'area');
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
    btnFavToggle.addEventListener('click', () => {
      if (AppState.currentWinner) {
        toggleFavorite(AppState.currentWinner.id);
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

// 執行抽籤演算法
function startDrawFood() {
  if (AppState.isSpinning) return;
  AppState.isSpinning = true;

  const drawBtn = document.getElementById('btnDrawFood');
  const destinyCard = document.getElementById('destinyCardDisplay');
  const rollingBox = document.getElementById('destinyRollingBox');
  const rollingTicker = document.getElementById('rollingTickerText');

  drawBtn.classList.add('spinning');
  drawBtn.innerHTML = '<span class="dice-icon">🎲</span> 命運輪盤轉動中...';

  destinyCard.style.display = 'none';
  rollingBox.style.display = 'flex';

  // 1. 取得合格候選名單
  const candidates = getEligibleCandidates();

  if (candidates.length === 0) {
    setTimeout(() => {
      alert("嗚～找不到符合所有篩選條件的餐廳！建議放寬預算、地區或料理類別條件再試一次唷！");
      drawBtn.classList.remove('spinning');
      drawBtn.innerHTML = '<span class="dice-icon">🎲</span> 幫我抽一家！';
      rollingBox.style.display = 'none';
      destinyCard.style.display = 'flex';
      AppState.isSpinning = false;
    }, 400);
    return;
  }

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
      // 加權抽籤計算勝出者
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

    // 地區過濾
    if (f.area !== '全部' && r.area !== f.area) return false;

    // 料理類別過濾
    if (f.category !== '全部' && !r.category.includes(f.category)) return false;

    // 評分過濾
    if (Number(f.minRating) > 0 && r.rating < Number(f.minRating)) return false;

    // 預算過濾
    if (f.budget === '100-200' && (r.avgPrice < 80 || r.avgPrice > 200)) return false;
    if (f.budget === '150-250' && (r.avgPrice < 120 || r.avgPrice > 280)) return false;
    if (f.budget === '300-500' && (r.avgPrice < 250 || r.avgPrice > 550)) return false;
    if (f.budget === '500以上' && r.avgPrice < 500) return false;

    // 付款方式過濾
    if (f.payment !== '全部' && r.paymentMethods && !r.paymentMethods.includes(f.payment)) return false;

    // 排除不吃的料理/食材
    if (settings.dislikes && settings.dislikes.length > 0) {
      const hasDislike = settings.dislikes.some(dis => 
        r.tags.some(t => t.includes(dis)) || r.name.includes(dis) || r.category.includes(dis)
      );
      if (hasDislike) return false;
    }

    // 排除最近吃過的規則
    if (f.excludeEaten && settings.excludeRule !== 'none') {
      const recentEaten = AppState.history.find(h => h.restaurantName === r.name || h.restaurantId === r.id);
      if (recentEaten) {
        if (settings.excludeRule === 'forever') return false;
        const eatenDate = new Date(recentEaten.date);
        const diffDays = Math.floor((now - eatenDate) / (1000 * 60 * 60 * 24));
        const limitDays = parseInt(settings.excludeRule, 10);
        if (diffDays <= limitDays) return false;
      }
    }

    return true;
  });
}

// 根據設定中各類別權重進行加權抽取
function pickWeightedWinner(candidates) {
  const weights = AppState.settings.cuisineWeights || {};
  let totalWeight = 0;
  const pool = [];

  candidates.forEach(c => {
    // 找出對應料理權重 (預設 4)
    let w = 4;
    for (let key in weights) {
      if (c.category.includes(key) || c.tags.some(t => t.includes(key))) {
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
  return candidates[0];
}

// 渲染命定美食卡片
function renderHomeDestinyCard(restaurant) {
  if (!restaurant) return;
  AppState.currentWinner = restaurant;

  document.getElementById('destinyImg').src = restaurant.photo;
  document.getElementById('destinyName').textContent = restaurant.name;
  document.getElementById('destinyRating').innerHTML = `★ ${restaurant.rating}`;
  document.getElementById('destinyReviewCount').textContent = `(${restaurant.reviewCount.toLocaleString()} 則評論)`;
  document.getElementById('destinyPrice').textContent = `約 $${restaurant.avgPrice}/人`;
  document.getElementById('destinyArea').textContent = restaurant.area;
  document.getElementById('destinyDesc').textContent = restaurant.description;

  // 標籤渲染
  const tagBox = document.getElementById('destinyTags');
  tagBox.innerHTML = '';
  restaurant.tags.forEach(t => {
    const span = document.createElement('span');
    span.className = 'meta-tag';
    span.textContent = `#${t}`;
    tagBox.appendChild(span);
  });

  // 收藏愛心狀態
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

  // 重查此地圖範圍按鈕
  const refreshMapBtn = document.getElementById('btnRefreshMapArea');
  if (refreshMapBtn) {
    refreshMapBtn.addEventListener('click', () => {
      SoundEngine.playPop();
      refreshMapBtn.innerHTML = '🔄 搜尋中...';
      setTimeout(() => {
        refreshMapBtn.innerHTML = '📍 重查此地圖範圍';
        renderExploreList();
      }, 500);
    });
  }
}

// 渲染探索列表
function renderExploreList() {
  const container = document.getElementById('exploreRestaurantList');
  if (!container) return;
  container.innerHTML = '';

  const { query, source, tag } = AppState.exploreFilter;

  const filtered = AppState.restaurants.filter(r => {
    // 來源篩選
    if (source === 'myList' && !r.isFavorite) return false;

    // 關鍵字搜尋 (店名、地區、標籤、菜系)
    if (query) {
      const match = r.name.toLowerCase().includes(query) ||
                    r.area.toLowerCase().includes(query) ||
                    r.category.toLowerCase().includes(query) ||
                    r.tags.some(t => t.toLowerCase().includes(query));
      if (!match) return false;
    }

    // 標籤篩選
    if (tag === 'rating' && r.rating < 4.5) return false;
    if (tag === 'price' && r.avgPrice > 250) return false;
    if (tag === 'distance' && r.distanceKm > 2.0) return false;
    if (tag !== '全部' && tag !== 'rating' && tag !== 'price' && tag !== 'distance') {
      if (!r.category.includes(tag) && !r.tags.includes(tag)) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 10px; color: var(--text-muted);">
        <p style="font-size: 2rem; margin-bottom: 8px;">🐱🍲</p>
        <p style="font-weight: 700;">找不到相關的美食店家</p>
        <p style="font-size: 0.82rem;">試試更換搜尋關鍵字或放寬篩選標籤！</p>
      </div>
    `;
    updateMapMarkers([]);
    return;
  }

  filtered.forEach(r => {
    const card = document.createElement('div');
    card.className = 'restaurant-row-card';
    card.id = `rest-row-${r.id}`;
    
    card.innerHTML = `
      <div class="rest-thumb-box">
        <img class="rest-thumb-img" src="${r.photo}" alt="${r.name}" loading="lazy">
      </div>
      <div class="rest-info-box">
        <div class="rest-name-row">
          <h4 class="rest-card-name">${r.name}</h4>
          <button class="btn-heart-favorite ${r.isFavorite ? 'active' : ''}" data-id="${r.id}" title="收藏到口袋名單">
            ${r.isFavorite ? '❤️' : '🤍'}
          </button>
        </div>
        <div class="rest-card-meta">
          <span style="color: var(--star-color); font-weight: 700;">★ ${r.rating}</span>
          <span>(${r.reviewCount})</span>
          <span>•</span>
          <span>$${r.priceMin}~${r.priceMax}</span>
          <span>•</span>
          <span>${r.category}</span>
        </div>
        <div class="rest-card-meta">
          <span>📍 ${r.distanceKm} km</span>
          <span>•</span>
          <span style="color: ${r.isOpen ? 'var(--success-color)' : '#999'}; font-weight: 700;">
            ${r.isOpen ? '營業中' : '休息中'}
          </span>
        </div>
        <div class="rest-card-tags">
          ${r.tags.slice(0, 3).map(t => `<span class="meta-tag" style="font-size: 0.75rem; padding: 2px 8px;">#${t}</span>`).join('')}
        </div>
      </div>
    `;

    // 點擊卡片與地圖同步定位
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-heart-favorite')) return;
      focusRestaurantOnMap(r);
      highlightCard(r.id);
    });

    // 收藏按鈕點擊
    const favBtn = card.querySelector('.btn-heart-favorite');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(r.id);
      favBtn.classList.toggle('active', r.isFavorite);
      favBtn.innerHTML = r.isFavorite ? '❤️' : '🤍';
    });

    container.appendChild(card);
  });

  // 更新地圖標記
  updateMapMarkers(filtered);
}

// 高亮列表卡片
function highlightCard(id) {
  document.querySelectorAll('.restaurant-row-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`rest-row-${id}`);
  if (card) {
    card.classList.add('selected');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ==========================================================
// 地圖模組 (支援 Leaflet 開源真實地圖 + Google Maps API)
// ==========================================================
function initMap() {
  const mapElement = document.getElementById('leafletMapContainer');
  if (!mapElement) return;

  // 預設以台中西屯為核心座標 (24.1632, 120.6445)
  if (typeof L !== 'undefined') {
    AppState.mapInstance = L.map('leafletMapContainer', {
      zoomControl: true,
      attributionControl: false
    }).setView([24.1632, 120.6445], 13);

    // 採用溫柔奶油暖色 CartoDB Positron 圖資
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(AppState.mapInstance);

    updateMapMarkers(AppState.restaurants);
  } else {
    console.warn("Leaflet 尚未載入，稍後重試");
  }
}

// 更新地圖標記 Pins
function updateMapMarkers(restaurants) {
  if (!AppState.mapInstance || typeof L === 'undefined') return;

  // 清除舊標記
  AppState.mapMarkers.forEach(m => AppState.mapInstance.removeLayer(m));
  AppState.mapMarkers = [];

  const bounds = [];

  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;

    // 自訂奶油可愛風地圖圓標 Pin
    const customIcon = L.divIcon({
      className: 'custom-map-pin',
      html: `
        <div style="background: white; border: 2.5px solid var(--accent-color); border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
          🍲
        </div>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    const marker = L.marker([r.lat, r.lng], { icon: customIcon }).addTo(AppState.mapInstance);

    const googleNavUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' ' + (r.address || ''))}`;
    
    // 點擊標記跳出氣泡
    marker.bindPopup(`
      <div style="font-family: inherit; width: 200px;">
        <img src="${r.photo}" style="width: 100%; height: 90px; object-fit: cover; border-radius: 8px; margin-bottom: 6px;">
        <h4 style="font-size: 1rem; margin: 0 0 4px 0; font-weight: 800; color: #3A322D;">${r.name}</h4>
        <p style="font-size: 0.8rem; margin: 0 0 6px 0; color: #82756C;">★ ${r.rating} • ${r.category} • $${r.avgPrice}/人</p>
        <a href="${googleNavUrl}" target="_blank" style="display: block; text-align: center; background: #4285F4; color: white; padding: 6px 10px; border-radius: 20px; font-size: 0.8rem; text-decoration: none; font-weight: 700;">
          🧭 在 Google Maps 中開啟導航
        </a>
      </div>
    `);

    marker.on('click', () => {
      highlightCard(r.id);
    });

    AppState.mapMarkers.push(marker);
    bounds.push([r.lat, r.lng]);
  });

  if (bounds.length > 0 && AppState.mapInstance) {
    AppState.mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
}

// 地圖聚焦到特定餐廳
function focusRestaurantOnMap(restaurant) {
  if (!AppState.mapInstance || !restaurant.lat || !restaurant.lng) return;
  AppState.mapInstance.flyTo([restaurant.lat, restaurant.lng], 15, { duration: 1.2 });
  
  // 觸發該標記的 popup
  const marker = AppState.mapMarkers.find(m => {
    const pos = m.getLatLng();
    return Math.abs(pos.lat - restaurant.lat) < 0.0001 && Math.abs(pos.lng - restaurant.lng) < 0.0001;
  });
  if (marker) {
    setTimeout(() => marker.openPopup(), 600);
  }
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
        <div style="display: flex; gap: 8px; font-size: 0.82rem; color: var(--text-muted); align-items: center;">
          <span style="color: var(--star-color); font-weight: 700;">★ ${r.rating}</span>
          <span>•</span>
          <span>$${r.avgPrice}/人</span>
          <span>•</span>
          <span>${r.area}</span>
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
    card.querySelector('.btn-heart-favorite').addEventListener('click', () => {
      toggleFavorite(r.id);
      renderFavoritesView();
    });

    container.appendChild(card);
  });
}

// 切換餐廳收藏狀態
function toggleFavorite(id) {
  SoundEngine.playPop();
  const rest = AppState.restaurants.find(r => r.id === id);
  if (rest) {
    rest.isFavorite = !rest.isFavorite;
    saveDataToStorage();
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

    card.querySelector('.btn-delete-history').addEventListener('click', () => {
      if (confirm(`確定要刪除這筆「${h.restaurantName}」的紀錄嗎？`)) {
        AppState.history = AppState.history.filter(item => item.id !== h.id);
        saveDataToStorage();
        renderHistoryView();
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

  const btnImport = document.getElementById('btnImportData');
  const fileInputImport = document.getElementById('fileInputImportData');
  if (btnImport && fileInputImport) {
    btnImport.addEventListener('click', () => fileInputImport.click());
    fileInputImport.addEventListener('change', (e) => handleImportFile(e));
  }

  const btnClear = document.getElementById('btnClearAllData');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (confirm("確定要重設所有資料回預設值嗎？自訂的收藏與紀錄將會被重置！")) {
        localStorage.clear();
        location.reload();
      }
    });
  }

  // Google Takeout 檔案上傳解析器
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
// Google Maps 匯入引擎 (核心需求支援)
// ==========================================================
function handleGoogleTakeoutUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const content = evt.target.result;
      let importedCount = 0;

      if (file.name.endsWith('.json') || file.name.endsWith('.geojson')) {
        const jsonData = JSON.parse(content);
        importedCount = parseGoogleTakeoutJson(jsonData);
      } else if (file.name.endsWith('.csv')) {
        importedCount = parseGoogleTakeoutCsv(content);
      } else {
        alert("不支援的檔案格式，請上傳 Google 匯出的 .json、.geojson 或 .csv 檔案！");
        return;
      }

      if (importedCount > 0) {
        SoundEngine.playFanfare();
        saveDataToStorage();
        alert(`🎉 恭喜！成功從 Google Maps 匯入 ${importedCount} 家口袋名單餐廳！已加入你的收藏並可立即抽籤！`);
        // 關閉 Modal
        closeModals();
        // 切換到收藏頁
        document.querySelector('.nav-tab-btn[data-tab="favorites"]').click();
      } else {
        alert("未在此檔案中找到有效的餐廳地點資料，請確認檔案為 Google Takeout 匯出的已儲存地點。");
      }
    } catch (err) {
      console.error("解析 Google 檔案出錯：", err);
      alert("解析檔案失敗，格式可能不符：" + err.message);
    }
  };
  reader.readAsText(file);
}

// 解析 Google Takeout GeoJSON / JSON 格式
function parseGoogleTakeoutJson(data) {
  let count = 0;
  const features = data.features || (Array.isArray(data) ? data : []);

  features.forEach(feat => {
    const props = feat.properties || feat;
    const name = props.Title || props.name || props["Business Name"] || "未命名地點";
    const address = (props.Location && props.Location.Address) || props.address || props["Formatted Address"] || "";
    
    // 經緯度解析
    let lng = 120.6445;
    let lat = 24.1632;
    if (feat.geometry && feat.geometry.coordinates) {
      lng = feat.geometry.coordinates[0];
      lat = feat.geometry.coordinates[1];
    } else if (props.Location && props.Location["Geo Coordinates"]) {
      lat = props.Location["Geo Coordinates"].Latitude || lat;
      lng = props.Location["Geo Coordinates"].Longitude || lng;
    }

    const note = props.Comment || props.note || "從 Google Maps 收藏匯入";
    const googleUrl = props["Google Maps URL"] || props.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;

    // 檢查是否已存在
    const exists = AppState.restaurants.find(r => r.name === name);
    if (!exists) {
      AppState.restaurants.push({
        id: `google-imp-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        name: name,
        category: "精選美食",
        tags: ["Google收藏", "想吃"],
        rating: 4.5,
        reviewCount: 999,
        priceMin: 150,
        priceMax: 350,
        avgPrice: 240,
        area: "台中/台北",
        address: address,
        lat: lat,
        lng: lng,
        distanceKm: 1.5,
        isOpen: true,
        openHours: "營業中",
        paymentMethods: ["現金", "Line Pay"],
        photo: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=700&auto=format&fit=crop&q=80",
        description: note,
        isFavorite: true,
        customList: "想吃",
        googlePlaceUrl: googleUrl
      });
      count++;
    }
  });

  return count;
}

// 解析 Google CSV 格式
function parseGoogleTakeoutCsv(csvText) {
  const lines = csvText.split('\n');
  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    const title = parts[0]?.replace(/"/g, '').trim();
    if (title && !AppState.restaurants.find(r => r.name === title)) {
      AppState.restaurants.push({
        id: `csv-imp-${Date.now()}-${i}`,
        name: title,
        category: "在地美食",
        tags: ["Google收藏", "想吃"],
        rating: 4.4,
        reviewCount: 888,
        priceMin: 120,
        priceMax: 300,
        avgPrice: 200,
        area: "西屯區",
        address: parts[4] || "",
        lat: 24.1632,
        lng: 120.6445,
        distanceKm: 1.2,
        isOpen: true,
        openHours: "營業中",
        paymentMethods: ["現金"],
        photo: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=700&auto=format&fit=crop&q=80",
        description: parts[1] || "Google 地圖收藏店家",
        isFavorite: true,
        customList: "想吃",
        googlePlaceUrl: parts[2] || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`
      });
      count++;
    }
  }
  return count;
}

// 一鍵載入示範 Google Takeout 資料 (讓使用者秒驗收功能)
function loadDemoGoogleTakeout() {
  fetch('./sample_google_maps_saved_places.json')
    .then(res => res.json())
    .then(data => {
      const added = parseGoogleTakeoutJson(data);
      SoundEngine.playFanfare();
      saveDataToStorage();
      alert(`🎉 成功載入示範 Google Maps 收藏清單！已新增 ${added} 家人氣推薦美食！`);
      closeModals();
      document.querySelector('.nav-tab-btn[data-tab="favorites"]').click();
    })
    .catch(err => {
      console.warn("讀取本機示範檔失敗，採用內建模擬：", err);
      // 內建備用
      const demoList = [
        { name: "刁民酸菜魚 逢甲店", area: "西屯區", rating: 4.5, lat: 24.1788, lng: 120.6456 },
        { name: "阿裕牛肉涮涮鍋", area: "仁德區", rating: 4.6, lat: 22.9567, lng: 120.2541 },
        { name: "屋馬燒肉 國安店", area: "西屯區", rating: 4.5, lat: 24.1914, lng: 120.6072 }
      ];
      demoList.forEach(d => {
        const item = AppState.restaurants.find(r => r.name.includes(d.name));
        if (item) item.isFavorite = true;
      });
      saveDataToStorage();
      alert("🎉 已成功將示範 Google 收藏清單標記為收藏！");
      closeModals();
      document.querySelector('.nav-tab-btn[data-tab="favorites"]').click();
    });
}

// 匯出全部資料為 JSON
function exportAllDataAsJson() {
  const exportPayload = {
    appName: "WhatToEat",
    version: "2.0",
    exportDate: new Date().toISOString(),
    restaurants: AppState.restaurants,
    history: AppState.history,
    customLists: AppState.customLists,
    settings: AppState.settings
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `吃什麼_資料備份_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
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
    formAddHist.addEventListener('submit', (e) => {
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

      AppState.history.unshift({
        id: `hist-${Date.now()}`,
        restaurantId: matchedRest ? matchedRest.id : null,
        restaurantName: rName,
        date: dateVal,
        dayOfWeek: getDayOfWeek(dateVal),
        rating: ratingVal,
        cost: costVal,
        area: rArea,
        notes: notesVal || "美味的一餐！",
        photo: rPhoto
      });

      saveDataToStorage();
      SoundEngine.playFanfare();
      closeModals();
      renderHistoryView();
      alert("🎉 成功新增美味紀錄！");
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

  document.getElementById('detailModalImg').src = r.photo;
  document.getElementById('detailModalTitle').textContent = r.name;
  document.getElementById('detailModalRating').textContent = `★ ${r.rating} (${r.reviewCount.toLocaleString()} 則評論)`;
  document.getElementById('detailModalPrice').textContent = `預算：約 $${r.avgPrice}/人 ($${r.priceMin} ~ $${r.priceMax})`;
  document.getElementById('detailModalAddress').textContent = r.address || '在地人氣名店';
  document.getElementById('detailModalHours').textContent = `營業時間：${r.openHours || '11:00 - 21:00'}`;
  document.getElementById('detailModalDesc').textContent = r.description || '';

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
