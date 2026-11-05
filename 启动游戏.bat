@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  正在启动 青梧大学 · 校园生活 ...
echo  浏览器会自动打开；关闭本窗口即结束游戏服务。
echo.
node scripts\serve.js
goto end
:nonode
echo.
echo  [错误] 没有检测到 Node.js。
echo.
echo  这个游戏需要 Node.js 才能跑起来。
echo  请打开 https://nodejs.org 下载 LTS 版本，安装时一路点下一步，
echo  装好之后再双击本文件即可。
echo.
pause
:end
