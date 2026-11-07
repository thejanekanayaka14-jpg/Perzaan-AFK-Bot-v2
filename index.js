'use strict';

const dns = require('dns');
// Force IPv4 lookup globally to prevent ENETUNREACH errors on cloud hosting
dns.setDefaultResultOrder('ipv4first');

const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const http = require('http');
const https = require('https');

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

// Bot state tracking
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false
};

// Health check endpoint for monitoring
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} Dashboard</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
          
          :root {
            --bg: #0f172a;
            --container-bg: #111827;
            --card-bg: #1f2937;
            --accent: #2dd4bf;
            --text-main: #f8fafc;
            --text-dim: #94a3b8;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--bg);
            color: var(--text-main);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
          }

          .container {
            background: var(--container-bg);
            padding: 3rem 2rem;
            border-radius: 2rem;
            width: 420px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            border: 1px solid #1f2937;
            text-align: center;
          }

          h1 {
            font-size: 1.875rem;
            font-weight: 700;
            margin-bottom: 2.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            color: #f1f5f9;
          }

          .card {
            background: var(--card-bg);
            border-radius: 1rem;
            padding: 1.25rem 1.75rem;
            margin-bottom: 1rem;
            text-align: left;
            border-left: 4px solid var(--accent);
            position: relative;
            overflow: hidden;
            transition: transform 0.2s;
          }
          
          .card:hover { transform: translateX(5px); }

          .label {
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-dim);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
          }

          .value {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--accent);
            display: flex;
            align-items: center;
            gap: 0.5rem;
            text-shadow: 0 0 15px rgba(45, 212, 191, 0.3);
          }

          .dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #4ade80;
            box-shadow: 0 0 10px #4ade80;
            display: inline-block;
          }

          .dot.offline {
            background: #f87171;
            box-shadow: 0 0 10px #f87171;
          }

          .pulse {
            animation: pulse-animation 2s infinite;
          }

          @keyframes pulse-animation {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(74, 222, 128, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
          }
          
          .offline.pulse {
            animation: pulse-offline 2s infinite;
          }
          
          @keyframes pulse-offline {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(248, 113, 113, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(248, 113, 113, 0); }
          }

          .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            background: var(--accent);
            color: #0f172a;
            padding: 1rem 2rem;
            border-radius: 1rem;
            font-weight: 700;
            text-decoration: none;
            margin-top: 1.5rem;
            transition: all 0.2s;
            box-shadow: 0 0 20px rgba(45, 212, 191, 0.4);
            width: 100%;
            box-sizing: border-box;
          }

          .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 0 30px rgba(45, 212, 191, 0.6);
            filter: brightness(1.1);
          }

          .footer {
            margin-top: 1.5rem;
            font-size: 0.8125rem;
            color: #4b5563;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 ${config.name}</h1>
          
          <div class="card">
            <div class="label">Status</div>
            <div class="value">
              <span id="status-dot" class="dot pulse"></span>
              <span id="status-text">Connecting...</span>
            </div>
          </div>

          <div class="card">
            <div class="label">Uptime</div>
            <div class="value" id="uptime-text">0h 0m 0s</div>
          </div>

          <div class="card">
            <div class="label">Coordinates</div>
            <div class="value">
              📍 <span id="coords-text">Searching...</span>
            </div>
          </div>

          <div class="card">
            <div class="label">Server</div>
            <div class="value" style="font-size: 1.1rem; color: #5eead4;">${config.server.ip}</div>
          </div>

          <a href="/tutorial" class="btn">📘 View Setup Guide</a>
          
          <div class="footer">Auto-refreshing every 5s</div>
        </div>

        <script>
          const statusText = document.getElementById('status-text');
          const statusDot = document.getElementById('status-dot');
          const uptimeText = document.getElementById('uptime-text');
          const coordsText = document.getElementById('coords-text');

          function formatUptime(s) {
            const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
            return h + 'h ' + m + 'm ' + sec + 's';
          }

          async function update() {
            try {
              const r = await fetch('/health');
              const data = await r.json();
              
              if (data.status === 'connected') {
                statusText.innerText = 'Online & Running';
                statusDot.className = 'dot pulse';
              } else {
                statusText.innerText = 'Reconnecting...';
                statusDot.className = 'dot offline pulse';
              }

              uptimeText.innerText = formatUptime(data.uptime);
              
              if (data.coords) {
                coordsText.innerText = Math.floor(data.coords.x) + ', ' + Math.floor(data.coords.y) + ', ' + Math.floor(data.coords.z);
              } else {
                coordsText.innerText = 'Searching Position...';
              }
            } catch (e) {
              statusText.innerText = 'System Offline';
              statusDot.className = 'dot offline';
            }
          }

          setInterval(update, 5000);
          update();
        </script>
      </body>
    </html>
  `);
});

app.get('/tutorial', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>${config.name} - Setup Guide</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #cbd5e1; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
          h1, h2 { color: #2dd4bf; }
          h1 { border-bottom: 2px solid #334155; padding-bottom: 10px; }
          .card { background: #1e293b; padding: 25px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #334155; }
          a { color: #38bdf8; text-decoration: none; }
          code { background: #334155; padding: 2px 6px; border-radius: 4px; color: #e2e8f0; font-family: monospace; }
          .btn-home { display: inline-block; margin-bottom: 20px; padding: 8px 16px; background: #334155; color: white; border-radius: 6px; text-decoration: none; }
        </style>
      </head>
      <body>
        <a href="/" class="btn-home">Back to Dashboard</a>
        <h1>Setup Guide (Under 15 Minutes)</h1>
        <div class="card">
          <h2>Step 1: Configure Aternos</h2>
          <ol>
            <li>Go to <strong>Aternos</strong>.</li>
            <li>Install <strong>Paper/Bukkit</strong> software.</li>
            <li>Enable <strong>Cracked</strong> mode (Green Switch).</li>
            <li>Install Plugins: <code>ViaVersion</code>, <code>ViaBackwards</code>, <code>ViaRewind</code>.</li>
          </ol>
        </div>
        <div class="card">
          <h2>Step 2: GitHub Setup</h2>
          <ol>
            <li>Download this code as ZIP and extract.</li>
            <li>Edit <code>settings.json</code> with your IP/Port.</li>
            <li>Upload all files to a new <strong>GitHub Repository</strong>.</li>
          </ol>
        </div>
        <div class="card">
          <h2>Step 3: Render (Free 24/7 Hosting)</h2>
          <ol>
            <li>Go to <a href="https://render.com" target="_blank">Render.com</a> and create a Web Service.</li>
            <li>Connect your GitHub.</li>
            <li>Build Command: <code>npm install</code></li>
            <li>Start Command: <code>npm start</code></li>
            <li><strong>Magic:</strong> The bot automatically pings itself to stay awake!</li>
          </ol>
        </div>
        <p style="text-align: center; margin-top: 40px; color: #64748b;">AFK Bot Dashboard</p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: (bot && bot.entity) ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024
  });
});

app.get('/ping', (req, res) => res.send('pong'));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] HTTP server started on port ${server.address().port}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const fallbackPort = PORT + 1;
    console.log(`[Server] Port ${PORT} in use - trying port ${fallbackPort}`);
    server.listen(fallbackPort, '0.0.0.0');
  } else {
    console.log(`[Server] HTTP server error: ${err.message}`);
  }
});

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

// ============================================================
// SELF-PING - Prevent Render from sleeping
// ============================================================
const SELF_PING_INTERVAL = 10 * 60 * 1000;

function startSelfPing() {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (!renderUrl) {
    console.log('[KeepAlive] No RENDER_EXTERNAL_URL set - self-ping disabled (running locally)');
    return;
  }
  setInterval(() => {
    const protocol = renderUrl.startsWith('https') ? https : http;
    protocol.get(`${renderUrl}/ping`, (res) => {
      // Silent success
    }).on('error', (err) => {
      console.log(`[KeepAlive] Self-ping failed: ${err.message}`);
    });
  }, SELF_PING_INTERVAL);
  console.log('[KeepAlive] Self-ping system started (every 10 min)');
}

startSelfPing();

// ============================================================
// MEMORY MONITORING
// ============================================================
setInterval(() => {
  const mem = process.memoryUsage();
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
  console.log(`[Memory] Heap: ${heapMB} MB`);
}, 5 * 60 * 1000);

// ============================================================
// BOT CREATION & RECONNECTION MANAGEMENT
// ============================================================
let bot = null;
let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let isReconnecting = false;

function clearBotTimeouts() {
  if (
