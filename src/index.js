#!/usr/bin/env node

const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { main } = require('./game');

const terminal = readline.createInterface({ input: stdin, output: stdout });
const io = {
  ask: (prompt) => terminal.question(prompt),
  print: (message) => stdout.write(`${message}\n`),
};

main(io)
  .catch((error) => {
    if (error.code !== 'ERR_USE_AFTER_CLOSE') {
      console.error(`\nGame stopped: ${error.message}`);
      process.exitCode = 1;
    }
  })
  .finally(() => terminal.close());
