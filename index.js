'use strict';

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 5000;

let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false
};

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
          }
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
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 ${config.name}</h1>
          <div class="card">
            <div class="label">Status</div>
            <div class="value">
              <span id="status-dot" class="dot"></span>
              <span id="status-text">Connecting...</span>
            </div>
          </div>
          <div class="card">
            <div class="label">Server</div>
            <div class="value" style="font-size: 1.1rem; color: #5eead4;">${config.server.ip}</div>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: (bot && bot.entity) ? bot.entity.position : null
  });
});

app.get('/ping', (req, res) => res.send('pong'));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] HTTP server started on port ${server.address().port}`);
});

let bot = null;
let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let isReconnecting = false;

function clearBotTimeouts() {
  if (reconnectTimeoutId) { clearTimeout(reconnectTimeoutId); reconnectTimeoutId = null; }
  if (connectionTimeoutId) { clearTimeout(connectionTimeoutId); connectionTimeoutId = null; }
}

function clearAllIntervals() {
  activeIntervals.forEach(id => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function createBot() {
  if (isReconnecting) return;

  if (bot) {
    clearAllIntervals();
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {}
    bot = null;
  }

  console.log(`[Bot] Creating bot instance...`);
  console.log(`[Bot] Connecting to ${config.server.ip}:${config.server.port}`);

  try {
    const botVersion = config.server.version && config.server.version.trim() !== '' ? config.server.version : false;
    bot = mineflayer.createBot({
      username: config['bot-account'].username,
      password: config['bot-account'].password || undefined,
      auth: config['bot-account'].type,
      host: config.server.ip,
      port: config.server.port,
      version: botVersion,
      hideErrors: false
    });

    bot.loadPlugin(pathfinder);

    clearBotTimeouts();
    connectionTimeoutId = setTimeout(() => {
      if (!botState.connected) {
        console.log('[Bot] Connection timeout - reconnecting');
        try { bot.end(); } catch (e) {}
        bot = null;
        scheduleReconnect();
      }
    }, 120000);

    bot.once('spawn', () => {
      clearBotTimeouts();
      botState.connected = true;
      botState.reconnectAttempts = 0;
      isReconnecting = false;
      console.log(`[Bot] [+] Successfully spawned on server!`);

      const mcData = require('minecraft-data')(bot.version);
      const defaultMove = new Movements(bot, mcData);
      defaultMove.allowFreeMotion = false;
      defaultMove.canDig = false;

      if (config.utils['auto-auth'] && config.utils['auto-auth'].enabled) {
        setTimeout(() => {
          bot.chat(`/login ${config.utils['auto-auth'].password}`);
        }, 2000);
      }
    });

    bot.on('end', (reason) => {
      console.log(`[Bot] Disconnected: ${reason || 'Unknown reason'}`);
      botState.connected = false;
      clearAllIntervals();
      if (config.utils['auto-reconnect']) {
        scheduleReconnect();
      }
    });

    bot.on('error', (err) => {
      console.log(`[Bot] Error: ${err.message}`);
    });

  } catch (err) {
    console.log(`[Bot] Failed to create bot: ${err.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearBotTimeouts();
  if (isReconnecting) return;
  isReconnecting = true;
  botState.reconnectAttempts++;

  const delay = Math.min(3000 * Math.pow(2, botState.reconnectAttempts), 30000);
  console.log(`[Bot] Reconnecting in ${delay / 1000}s (attempt #${botState.reconnectAttempts})`);

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    isReconnecting = false;
    createBot();
  }, delay);
}

createBot();
