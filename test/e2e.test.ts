import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = resolve(__dirname, '../src/index.js');

interface RunInteractiveSessionOptions {
  readonly onPrompt: (promptText: string, fullOutput: string) => string | null | undefined;
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
    let lastPromptOffset = -1;

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

      // Match interactive prompt text ending with ": " (without a trailing newline)
      const match = /(?:^|\n)([^\n]+: )$/.exec(stdout);
      if (match && stdout.length > lastPromptOffset) {
        const promptText = match[1] ?? '';
        lastPromptOffset = stdout.length;
        const answer = onPrompt(promptText, stdout);
        if (answer === null) {
          child.stdin.end();
        } else if (answer !== undefined) {
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
  return runInteractiveSession({
    onPrompt: () => {
      if (index < inputs.length) {
        const nextInput = inputs[index];
        index += 1;
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
  assert.match(stdout, /Your cards: \S+\s+\S+/);
  assert.match(stdout, /Opponent difficulty: easy/);
  assert.match(stdout, /Pre-flop/);
  assert.match(stdout, /Your action \(check, bet \$10, fold\): /);
  assert.match(stdout, /You folded; the machine wins the pot\./);
  assert.match(stdout, /Hindsight only — these remaining community cards were not visible when you folded\./);
  assert.match(stdout, /Machine cards: \S+\s+\S+/);
  assert.match(stdout, /Completed board: (?:\S+\s+){4}\S+/);
  assert.match(stdout, /With all cards visible, your best hand was .+?; the machine made .+?\./);
  assert.match(stdout, /Lesson: use this only to review the result/);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: input validation reprompts on invalid difficulty, action, and repeat choice, and normalizes case/whitespace', async () => {
  const { exitCode, stdout, stderr } = await runScriptedSession([
    'invalid-mode',
    '  MEDIUM  ',
    'invalid-action',
    '  FOLD ',
    'invalid-again',
    ' N ',
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

test('e2e: play multiple consecutive hands using yes and y before quitting', async () => {
  let handCount = 0;
  const { exitCode, stdout, stderr } = await runInteractiveSession({
    onPrompt: (promptText) => {
      if (promptText.includes('Choose a difficulty')) return 'easy';
      if (promptText.includes('Your action')) return 'fold';
      if (promptText.includes('Play another hand?')) {
        handCount += 1;
        if (handCount === 1) return 'yes';
        if (handCount === 2) return 'y';
        return 'no';
      }
      return undefined;
    },
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  const foldCount = (stdout.match(/You folded; the machine wins the pot\./g) ?? []).length;
  assert.equal(foldCount, 3);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: all four streets and bet sizes ($10, $20, $30, $40) are experienced through showdown', async () => {
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
  assert.match(stdout, /Pre-flop\nYour action \(check, bet \$10, fold\): /);
  assert.match(stdout, /Flop — board: (?:\S+\s+){2}\S+\nYour action \(check, bet \$20, fold\): /);
  assert.match(stdout, /Turn — board: (?:\S+\s+){3}\S+\nYour action \(check, bet \$30, fold\): /);
  assert.match(stdout, /River — board: (?:\S+\s+){4}\S+\nYour action \(check, bet \$40, fold\): /);
  assert.match(stdout, /Showdown/);
  assert.match(stdout, /Board: (?:\S+\s+){4}\S+/);
  assert.ok(
    /You win with .+? Pot: \$\d+\./.test(stdout) ||
    /It's a tie: both players have .+?\./.test(stdout) ||
    (/The machine wins with .+? your best hand was .+?\./.test(stdout) && /Lesson: your .+? lost to .+?\./.test(stdout)),
  );
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: folding on turn after flop reveals full 5-card board in hindsight', async () => {
  const { exitCode, stdout, stderr } = await runInteractiveSession({
    onPrompt: (promptText) => {
      if (promptText.includes('Choose a difficulty')) return 'medium';
      if (promptText.includes('Your action (check, bet $10')) return 'check';
      if (promptText.includes('Your action (check, bet $20')) return 'check';
      if (promptText.includes('Your action (check, bet $30')) return 'fold';
      if (promptText.includes('Your response (call $')) return 'call';
      if (promptText.includes('Play another hand?')) return 'no';
      return undefined;
    },
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Flop — board: (?:\S+\s+){2}\S+/);
  assert.match(stdout, /Turn — board: (?:\S+\s+){3}\S+/);
  assert.doesNotMatch(stdout, /River — board:/);
  assert.match(stdout, /You folded; the machine wins the pot\./);
  assert.match(stdout, /Completed board: (?:\S+\s+){4}\S+/);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: facing a machine bet validates invalid response and supports folding to a bet', async () => {
  let sentInvalidResponse = false;
  let foldedToBet = false;
  let handsPlayed = 0;

  const { exitCode, stdout, stderr } = await runInteractiveSession({
    onPrompt: (promptText) => {
      if (promptText.includes('Choose a difficulty')) return 'easy';
      if (promptText.includes('Your action (check, bet $')) return 'check';
      if (promptText.includes('Your response (call $')) {
        if (!sentInvalidResponse) {
          sentInvalidResponse = true;
          return 'raise';
        }
        foldedToBet = true;
        return 'fold';
      }
      if (promptText.includes('Play another hand?')) {
        handsPlayed += 1;
        if (!foldedToBet && handsPlayed < 15) return 'y';
        return 'no';
      }
      return undefined;
    },
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.ok(foldedToBet, 'Expected machine to bet at least once across hands in easy mode');
  assert.match(stdout, /The machine bets \$\d+\./);
  assert.match(stdout, /Please enter one of: call, fold\./);
  assert.match(stdout, /You folded; the machine wins the pot\./);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: aggressive betting sequence handles opponent calls, folds, and showdown', async () => {
  let handsPlayed = 0;
  const { exitCode, stdout, stderr } = await runInteractiveSession({
    onPrompt: (promptText, fullOutput) => {
      if (promptText.includes('Choose a difficulty')) return 'easy';
      if (promptText.includes('Your action (check, bet $')) return 'bet';
      if (promptText.includes('Your response (call $')) return 'call';
      if (promptText.includes('Play another hand?')) {
        handsPlayed += 1;
        const sawFold = fullOutput.includes('The machine folds. You win the hand.');
        const sawCall = fullOutput.includes('The machine calls $');
        if ((!sawFold || !sawCall) && handsPlayed < 15) return 'y';
        return 'no';
      }
      return undefined;
    },
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Playing on EASY mode\./);
  assert.match(stdout, /The machine calls \$\d+\./);
  assert.match(stdout, /The machine folds\. You win the hand\./);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: closing stdin early exits cleanly without unhandled error', async () => {
  const { exitCode, stdout, stderr } = await runInteractiveSession({
    onPrompt: (promptText) => {
      if (promptText.includes('Choose a difficulty')) return null;
      return undefined;
    },
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Welcome to CLI Poker — heads-up Texas Hold’em\./);
  assert.equal(stderr, '');
});
