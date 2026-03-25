#!/usr/bin/env node

/**
 * CLI utility to trigger a page reload in the connected browser tab.
 * Usage: node reload.js
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://127.0.0.1:5678';

console.log('Connecting to Local CRO Daemon...');
const socket = new WebSocket(WS_URL);

socket.on('open', () => {
  console.log('Connected. Sending reload command...');
  socket.send(JSON.stringify({ 
    event: 'reload_page' 
  }));
  
  // Wait a moment for delivery then exit
  setTimeout(() => {
    socket.close();
    console.log('✅ Reload command sent.');
    process.exit(0);
  }, 200);
});

socket.on('error', (err) => {
  console.error('❌ Failed to connect to daemon. Is it running?');
  process.exit(1);
});
