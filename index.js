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
