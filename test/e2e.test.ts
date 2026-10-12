import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = resolve(__dirname, '../src/index.js');

interface RunInteractiveSessionOptions {
  readonly onPrompt: (promptText: string, fullOutput: string) => string | undefined;
  readonly timeoutMs?: number;
}

interface RunInteractiveResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runInteractiveSession({
  onPrompt,
  timeoutMs = 5000,
}: RunInteractiveSessionOptions): Promise<RunInteractiveResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [CLI_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`CLI session timed out after ${timeoutMs}ms.\nOutput so far:\n${stdout}`));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      settled = true;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (settled) return;

      // Match prompt text ending with ": " or ":"
      const match = /(?:^|\n)([^\n]+:\s*)$/.exec(stdout);
      if (match) {
        const promptText = match[1] ?? '';
        const answer = onPrompt(promptText, stdout);
        if (answer !== undefined) {
          child.stdin.write(`${answer}\n`);
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (exitCode) => {
      cleanup();
      resolveResult({ exitCode, stdout, stderr });
    });

    child.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

function runScriptedSession(
  inputs: readonly string[],
  timeoutMs = 5000,
): Promise<RunInteractiveResult> {
  let index = 0;
  let lastPromptOffset = -1;
  return runInteractiveSession({
    onPrompt: (_promptText, fullOutput) => {
      if (fullOutput.length <= lastPromptOffset) return undefined;
      if (index < inputs.length) {
        const nextInput = inputs[index];
        index += 1;
        lastPromptOffset = fullOutput.length;
        return nextInput;
      }
      return undefined;
    },
    timeoutMs,
  });
}

test('e2e: immediate fold on pre-flop exits cleanly after one hand', async () => {
  const { exitCode, stdout, stderr } = await runScriptedSession(['easy', 'fold', 'no']);

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Welcome to CLI Poker — heads-up Texas Hold’em\./);
  assert.match(stdout, /Playing on EASY mode\./);
  assert.match(stdout, /Pre-flop/);
  assert.match(stdout, /You folded; the machine wins the pot\./);
  assert.match(stdout, /Hindsight only/);
  assert.match(stdout, /Lesson:/);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: input validation reprompts on invalid difficulty, action, and repeat choice', async () => {
  const { exitCode, stdout, stderr } = await runScriptedSession([
    'invalid-mode',
    'medium',
    'invalid-action',
    'fold',
    'invalid-again',
    'n',
  ]);

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Please enter one of: easy, medium, hard\./);
  assert.match(stdout, /Playing on MEDIUM mode\./);
  assert.match(stdout, /Please enter one of: check, bet, fold\./);
  assert.match(stdout, /You folded; the machine wins the pot\./);
  assert.match(stdout, /Please enter one of: yes, no, y, n\./);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: play multiple consecutive hands before quitting', async () => {
  let handCount = 0;
  const { exitCode, stdout, stderr } = await runInteractiveSession({
    onPrompt: (promptText) => {
      if (promptText.includes('Choose a difficulty')) return 'easy';
      if (promptText.includes('Your action')) return 'fold';
      if (promptText.includes('Play another hand?')) {
        handCount += 1;
        if (handCount === 1) return 'yes'; // Hand 1 ends -> continue
        return 'no'; // Hand 2 ends -> quit
      }
      return undefined;
    },
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  const foldCount = (stdout.match(/You folded; the machine wins the pot/g) ?? []).length;
  assert.equal(foldCount, 2);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: complete full hand through showdown by passively checking or calling', async () => {
  const { exitCode, stdout, stderr } = await runInteractiveSession({
    onPrompt: (promptText) => {
      if (promptText.includes('Choose a difficulty')) return 'hard';
      if (promptText.includes('Your action (check, bet $')) return 'check';
      if (promptText.includes('Your response (call $')) return 'call';
      if (promptText.includes('Play another hand?')) return 'no';
      return undefined;
    },
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Welcome to CLI Poker/);
  assert.match(stdout, /Playing on HARD mode\./);
  assert.match(stdout, /Pre-flop/);
  // Reached showdown or machine folded earlier
  assert.ok(stdout.includes('Showdown') || stdout.includes('folds'));
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: aggressive betting sequence until showdown or opponent folds', async () => {
  const { exitCode, stdout, stderr } = await runInteractiveSession({
    onPrompt: (promptText) => {
      if (promptText.includes('Choose a difficulty')) return 'easy';
      if (promptText.includes('Your action (check, bet $')) return 'bet';
      if (promptText.includes('Your response (call $')) return 'call';
      if (promptText.includes('Play another hand?')) return 'no';
      return undefined;
    },
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Playing on EASY mode\./);
  assert.ok(
    stdout.includes('The machine folds. You win the hand.') ||
    stdout.includes('The machine calls') ||
    stdout.includes('Showdown'),
  );
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: all four streets are experienced when both players check down', async () => {
  // On easy mode, machine checks back when facing check on almost all hand strengths.
  // We check every street, reaching showdown through Pre-flop, Flop, Turn, and River.
  const { exitCode, stdout, stderr } = await runInteractiveSession({
    onPrompt: (promptText) => {
      if (promptText.includes('Choose a difficulty')) return 'easy';
      if (promptText.includes('Your action (check, bet $')) return 'check';
      if (promptText.includes('Your response (call $')) return 'call';
      if (promptText.includes('Play another hand?')) return 'no';
      return undefined;
    },
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Pre-flop/);
  assert.match(stdout, /Flop/);
  assert.match(stdout, /Turn/);
  assert.match(stdout, /River/);
  assert.match(stdout, /Showdown/);
  assert.match(stdout, /Board:/);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});
