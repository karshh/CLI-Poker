#!/usr/bin/env node

import { exec } from 'node:child_process';
import process from 'node:process';
import { startServer } from './server.js';

async function main(): Promise<void> {
  const envPort = process.env['PORT'];
  const preferredPort = envPort ? parseInt(envPort, 10) : 3000;
  const instance = await startServer(preferredPort);
  const url = `http://${instance.host}:${instance.port}/`;

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║      ♠ ♥ ♦ ♣  HIGH ROLLER HOLD'EM — VIP POKER GAME  ♣ ♦ ♥ ♠  ║
╚═══════════════════════════════════════════════════════════════╝
  🎰  Casino GUI Video Game is running!
  👉  URL: ${url}

  🤵  Dealer: Vincent
  🎲  VIP Cast (choose 4 of 8): Lord Reginald, "Big Oil" Buck, "Croc" Bruce,
      Elon Musk, Comrade Viktor, Madame Mei-Ling, Don "Big Tony", Sheikh Tariq
  👁️   Perspective: First-Person POV at the 5-Seat VIP Table
  📜  Bottom Log: Live dialogue and action options

  Opening your browser now...
  (Press Ctrl+C in this terminal to exit)
═════════════════════════════════════════════════════════════════
`);

  // Auto-open browser based on OS
  const openCmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
      ? `start "${url}"`
      : `xdg-open "${url}"`;

  exec(openCmd, (err) => {
    if (err) {
      console.log(`Note: Browser could not be opened automatically. Please visit ${url} manually.`);
    }
  });

  const cleanup = async () => {
    console.log('\nClosing game server. Thanks for playing!');
    await instance.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('Failed to start Poker GUI:', err);
  process.exit(1);
});
