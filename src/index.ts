#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { main } from './game.js';

const terminal = createInterface({ input: stdin, output: stdout });
const io = {
  ask: (prompt: string): Promise<string> => terminal.question(prompt),
  print: (message: string): void => {
    stdout.write(`${message}\n`);
  },
};

main(io)
  .catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_USE_AFTER_CLOSE') return;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nGame stopped: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => terminal.close());
