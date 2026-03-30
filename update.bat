@echo off
chcp 65001 >nul
echo.
echo  ========================================
echo       AI-VN System - 更新程序
echo  ========================================
echo.

cd /d "%~dp0"

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未检测到 Node.js，请先运行 start.bat 查看提示。
    pause
    exit /b 1
)

:: 检查 Git
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未检测到 Git！
    echo.
    echo  请先安装 Git：
    echo    1. 打开浏览器访问 https://git-scm.com
    echo    2. 下载安装（一路默认即可）
    echo    3. 安装完成后重新双击本脚本
    echo.
    pause
    exit /b 1
)

:: 若单独拷贝过 scripts\update-pull.js（未 git add），git pull 会报「未跟踪文件将被覆盖」；
:: 脚本逻辑又在 update-pull.js 里，形成死锁。先备份移除，再拉取仓库里的正式版本。
git ls-files --error-unmatch scripts/update-pull.js >nul 2>&1
if errorlevel 1 (
  if exist "scripts\update-pull.js" (
    echo.
    echo  [提示] 检测到未入库的 scripts\update-pull.js（例如他人单独发来的更新脚本）。
    echo        已备份为 scripts\update-pull.js.ai-vn-untracked-backup 并移除，随后仅从远程检出该文件。
    echo.
    copy /Y "scripts\update-pull.js" "scripts\update-pull.js.ai-vn-untracked-backup" >nul
    if errorlevel 1 (
      echo  [错误] 无法备份，请手动移走或重命名 scripts\update-pull.js 后再运行。
      pause
      exit /b 1
    )
    del "scripts\update-pull.js"
  )
)
if not exist "scripts\update-pull.js" (
  echo  [引导] 正在 fetch 并仅从远程检出 scripts\update-pull.js …
  echo        （不执行整库 pull/merge，避免与你其他已修改文件冲突；完整更新仍由下一步 Node 脚本处理。）
  echo.
  git fetch origin
  if %errorlevel% neq 0 (
    echo.
    echo  [错误] git fetch 失败，请检查网络与远程 origin。
    pause
    exit /b 1
  )
  git checkout FETCH_HEAD -- scripts/update-pull.js
  if %errorlevel% neq 0 (
    echo.
    echo  [错误] 无法检出该文件。可手动在项目根目录执行：
    echo    git fetch origin
    echo    git checkout FETCH_HEAD -- scripts/update-pull.js
    pause
    exit /b 1
  )
  echo.
)

echo  [1/3] 正在拉取最新代码...
echo.
echo  （若有本地修改：可按「脚本 / JSON / 代码 / 其他」分别选择覆盖或保留）
echo.
node scripts/update-pull.js
if %errorlevel% neq 0 (
    echo.
    echo  [错误] 代码更新未完成。
    echo  若因本地有修改：请在 CMD 中运行本目录下的 update.bat 以便选择选项，
    echo  或先自行用 git stash / git commit 处理后再试。
    echo.
    pause
    exit /b 1
)

echo.
echo  [2/3] 正在更新依赖...
echo.
npm install
if %errorlevel% neq 0 (
    echo.
    echo  [错误] 依赖更新失败，请检查网络后重试。
    pause
    exit /b 1
)

echo.
echo  [3/3] 更新完成！
echo.
echo  ----------------------------------------
echo  现在可以双击 start.bat 启动游戏了。
echo  ----------------------------------------
echo.
pause
