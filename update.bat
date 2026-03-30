@echo off
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════╗
echo  ║       AI-VN System · 更新程序        ║
echo  ╚══════════════════════════════════════╝
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
