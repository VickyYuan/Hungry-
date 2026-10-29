# 🍜 吃什麼？ (What To Eat?)
### 奶油系簡約可愛風 — 連結真實 Google Maps 與個人口袋名單的美食抽選網頁

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FVickyYuan%2FHungry-)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/Vanilla_CSS3-1572B6?logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

專為選擇障礙吃貨打造的美食探索與命定抽籤 Web App！以溫柔細緻的「**A. 奶油系簡約可愛**」視覺風格呈現，整合**真實 Google Maps 導航**與**個人 Google 帳號收藏清單匯入**功能，隨時隨地只要點開網址就能立刻互動！

---

## 🚀 線上即時體驗 (Live Demo)

- **Vercel 部署網址**：點擊上方 **Deploy with Vercel** 或於 [Vercel](https://vercel.com/new) 匯入本倉庫即可獲得專屬網址！
- **GitHub Pages 網址**：`https://vickyyuan.github.io/Hungry-/` （於倉庫 Settings > Pages 啟用）

---

## ✨ 核心特色與 Google Maps 深度整合

### 1. 連結 Google Maps 帳號收藏名單 (Google Takeout 整合精靈)
* **官方隱私機制**：Google 官方出於隱私規範，未對外提供第三方網頁直接存取使用者 Google Maps App 內部私密「已儲存地點」的即時 OAuth API。
* **完美落地解法**：
  1. 前往 [Google Takeout 匯出頁面](https://takeout.google.com/)。
  2. 僅勾選「**地圖 (已儲存的地點)**」，匯出為 JSON、GeoJSON 或 CSV。
  3. 在本網頁「設定」或「收藏」分頁，點選「**上傳 Google 匯出的收藏檔案**」，系統自動解析店名、經緯度座標、備註、評分與 Google 地圖短網址，一秒匯入口袋名單！
  4. 內建 **「⚡ 一鍵載入示範 Google 收藏清單」**，無需任何檔案即可立刻測試一蘭拉麵、屋馬燒肉、阿裕牛肉湯、春水堂、鼎泰豐等名店！

### 2. 真實 Google Maps 官方深度導航
* 每個餐廳卡片與抽籤結果皆內建 **「🧭 在 Google Maps 中開啟導航與查看地標」** 按鈕。
* 手機裝置點擊自動喚醒 **Google Maps 官方 App** 啟動導航；電腦裝置則直接開啟 Google 地圖官方頁面。
* 探索分頁內建**真實互動圖台**，支援縮放、標記點選與餐廳列表卡片即時雙向連動！

---

## 📱 五大功能頁面完整說明 (對應設計稿)

| 分頁 | 核心功能 | 亮點設計 |
| :--- | :--- | :--- |
| **⌂ 1. 首頁：隨機抽選** | 條件篩選（地區、每人預算、料理類別、付款方式、用餐時間、店家評分） | 🎲 **「幫我抽一家！」** 老虎機滾動音效與旋轉動畫、命定美食大卡片、慶祝彩帶特效 |
| **🔍 2. 探索：按尋餐廳** | 關鍵字搜尋、來源切換（Google Maps / 我的清單）、快速篩選 Chips | **真實互動地圖** 與餐廳列表並排，點擊地圖標記同步聚焦卡片 |
| **🤍 3. 收藏：我的口袋名單** | 口袋名單分類（全部、想吃、聚餐、平價、＋新增自訂清單） | 支援手動收藏、清單管理、快速「🍽️ 抽這家吃！」 |
| **📋 4. 紀錄：吃過的餐廳** | 美味時光日記時間軸、按月份/季度/年份篩選 | 記錄日期、星級評分、花費金額與手札筆記，**自動連動抽籤排除演算** |
| **⚙️ 5. 設定：個人化偏好** | 排除規則（7天/30天/永久/不排除）、不想吃的食材、料理機率加權滑桿 | **Google Takeout 匯入區**、搜尋距離切換、**4 種奶油色系主題切換**、JSON 資料備份匯出 |

---

## 🎨 奶油系簡約可愛視覺美學

1. **療癒色調**：卡士達暖白 (`#FDF9F2`)、燕麥奶茶 (`#F6EFE4`)、暖杏陶土橘 (`#E28743`)、柔和圓角與立體微陰影。
2. **多主題支援**：可於設定頁隨時切換「奶油柔 (預設)」、「草莓牛奶」、「薄荷蘇打」、「暖心可可」。
3. **原生 Web Audio API 音效引擎**：免加載外部 mp3 檔案，具備清脆按鈕啵啵聲、拉霸滾動音效與中獎和弦（右上角提供一鍵靜音）。
4. **雙版型切換**：右上角提供 **「📱 切換手機外框預覽」** 與 **「💻 電腦全螢幕模式」**，完美呈現手機與電腦雙模式！

---

## 🛠️ 如何推送到 GitHub 倉庫？

### 方法一：直接點擊 Windows 批次腳本 (最簡單)
專案內已準備好一鍵推送腳本：
1. 進入專案資料夾：`what-to-eat/`
2. 滑鼠連點兩下執行 **`push_to_github.bat`**
3. 腳本會自動完成 `git init`、加入檔案、設定遠端倉庫 `https://github.com/VickyYuan/Hungry-.git` 並推送至 `main` 分支！

### 方法二：使用終端機或命令提示字元 (Command Prompt)
```bash
# 1. 進入專案目錄
cd C:\Users\huang\.gemini\antigravity-ide\scratch\what-to-eat

# 2. 初始化 Git 倉庫
git init

# 3. 設定遠端倉庫網址
git remote add origin https://github.com/VickyYuan/Hungry-.git

# 4. 切換為 main 分支
git branch -M main

# 5. 加入所有檔案並提交
git add .
git commit -m "feat: 吃什麼？奶油系可愛美食抽籤與 Google Maps 探索網頁 (支援 Vercel 一鍵部署)"

# 6. 推送至 GitHub
git push -u origin main
```

---

## 🌐 如何發布至 Vercel (點開網址即可互動)

本專案已內建 `vercel.json` 靜態部署配置，只要將專案推送到 GitHub 後：

1. 前往 **[Vercel 官網](https://vercel.com/)**，點擊右上角 **Log In**（建議直接使用 GitHub 登入）。
2. 點擊 **Add New...** ➔ **Project**（或直接打開 [vercel.com/new](https://vercel.com/new)）。
3. 在 **Import Git Repository** 列表中找到 **`VickyYuan/Hungry-`**，點擊 **Import**。
4. **Framework Preset** 保持為 *Other* 或預設，點擊 **Deploy**。
5. 稍等約 10~20 秒，Vercel 就會生成一個公開的在線網址（例如：`https://hungry-vickyyuan.vercel.app`）！
6. 任何人在手機或電腦瀏覽器打開該網址，都能立刻獲得完整的互動抽籤與地圖體驗！

---

## 📂 檔案目錄結構

```text
what-to-eat/
├── index.html                           # 核心 HTML 入口 (包含 5 大分頁、彈窗與導覽組件)
├── style.css                            # 奶油系樣式庫 (主題、RWD 響應式、動畫與陰影)
├── app.js                              # 應用邏輯 (抽籤演算法、Google 收藏解析器、Web Audio 音效)
├── data.js                             # 在地美食預設資料庫與歷史紀錄
├── sample_google_maps_saved_places.json # 供測試的 Google Takeout 收藏示範檔案
├── vercel.json                         # Vercel 雲端部署路由設定
├── package.json                        # 專案資訊配置
├── push_to_github.bat                  # Windows 一鍵推送 GitHub 腳本
├── .gitignore                          # Git 忽略檔案設定
└── README.md                           # 專案詳細說明手冊
```

---

## 📄 開源授權
本專案基於 [MIT License](LICENSE) 條款開源。歡迎自由客製化與分享！
