@echo off
title Akaza Blast v3.0 - Real WhatsApp Blast Engine
color 0A

echo ==========================================================
echo  Akaza Blast v3.0 - Real WhatsApp Blast Platform
echo  Real QR Codes ^| Real WhatsApp Sessions ^| Real Komisi
echo ==========================================================
echo.

:: Kill any process on port 3000
echo [*] Membersihkan port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Find Node.js
set NODE_PATH=
if exist ".bin\node-v20.18.0-win-x64\node.exe" (
    set NODE_PATH=.bin\node-v20.18.0-win-x64\node.exe
    echo [+] Node.js ditemukan di .bin
) else (
    where node >nul 2>&1
    if not errorlevel 1 (
        set NODE_PATH=node
        echo [+] Node.js ditemukan di PATH system
    ) else (
        echo [!] ERROR: Node.js tidak ditemukan!
        echo     Download dari https://nodejs.org
        pause
        exit /b 1
    )
)

echo.
echo [*] Menjalankan server...
echo [*] Buka browser ke: http://localhost:3000
echo.
echo  Tekan CTRL+C untuk menghentikan server
echo ==========================================================

cd server
%NODE_PATH% server.js

pause
