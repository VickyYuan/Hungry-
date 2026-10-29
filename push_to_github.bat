@echo off
chcp 65001 >nul
echo ========================================================
echo  🍜 吃什麼？ (What To Eat?) - 一鍵推送至 GitHub 倉庫
echo  目標倉庫：https://github.com/VickyYuan/Hungry-.git
echo ========================================================
echo.

:: 檢查是否有安裝 git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [錯誤] 系統未找到 git 指令，請確認已安裝 Git 並加入 PATH！
    echo 官方下載：https://git-scm.com/
    pause
    exit /b 1
)

echo [1/5] 初始化 Git 儲存庫...
if not exist .git (
    git init
)

echo [2/5] 設定遠端分支 origin...
git remote remove origin 2>nul
git remote add origin https://github.com/VickyYuan/Hungry-.git

echo [3/5] 切換至 main 分支...
git branch -M main

echo [4/5] 加入所有專案檔案並建立 Commit...
git add .
git commit -m "feat: 吃什麼？奶油系可愛美食抽籤與 Google Maps 探索網頁 (支援 Vercel 一鍵部署)"

echo [5/5] 推送至 GitHub...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo  🎉 推送成功！
    echo  GitHub 網址：https://github.com/VickyYuan/Hungry-
    echo.
    echo  接下來只需前往 Vercel (https://vercel.com/new)
    echo  選擇匯入 VickyYuan/Hungry- 即可獲得專屬在線網址！
    echo ========================================================
) else (
    echo.
    echo [提示] 推送時若出現驗證錯誤，請確認 GitHub 帳號權限或使用 Personal Access Token。
)

echo.
pause
