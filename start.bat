@echo off
chcp 65001 >nul
echo.
echo  ========================================
echo       AI-VN System - 无限武库
echo  ========================================
echo.

cd /d "%~dp0"

:: 检查 Node.js 是否安装
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未检测到 Node.js！
    echo.
    echo  请先安装 Node.js：
    echo    1. 打开浏览器访问 https://nodejs.org
    echo    2. 下载 LTS 版本并安装
    echo    3. 安装完成后重新双击本脚本
    echo.
    pause
    exit /b 1
)

:: 检查依赖是否安装
if not exist "node_modules" (
    echo  [提示] 首次运行，正在安装依赖，请稍候...
    echo.
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo  [错误] 依赖安装失败，请检查网络连接后重试。
        pause
        exit /b 1
    )
    echo.
)

echo  服务器启动中...
echo  启动成功后，请打开浏览器访问：http://localhost:3000
echo.
echo  ※ 请勿关闭本窗口，关闭后游戏将停止运行
echo  ※ 按 Ctrl+C 可停止服务器
echo.
echo ----------------------------------------

node server.js

echo.
echo  服务器已停止。
pause
