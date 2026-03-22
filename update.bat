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
git pull
if %errorlevel% neq 0 (
    echo.
    echo  [错误] 代码更新失败！
    echo  可能原因：
    echo    - 网络连接问题
    echo    - 本地有未提交的修改（如手动改过代码）
    echo.
    echo  如果你修改过本地文件，可以尝试先运行：
    echo    git stash
    echo  然后再双击本脚本重试。
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
