import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = resolve(__dirname, '../src/index.js');

const INTERACTIVE_PROMPT_PATTERN =
  /(?:^|\n)(Choose a difficulty \(easy, medium, hard\): |Your action \(check, bet \$\d+, fold\): |Your response \(call \$\d+, fold\): |Play another hand\? \(yes\/no\): )$/;

export function matchInteractivePrompt(output: string): string | undefined {
  const match = INTERACTIVE_PROMPT_PATTERN.exec(output);
  return match?.[1];
}

interface RunInteractiveSessionOptions {
  readonly onPrompt: (promptText: string, fullOutput: string) => string | null | undefined;
  readonly randomValues?: readonly number[];
  readonly fragmentAtColonSpace?: boolean;
  readonly timeoutMs?: number;
}

interface RunInteractiveResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly prompts: readonly string[];
}

function buildSpawnArgs(randomValues?: readonly number[]): readonly string[] {
  if (!randomValues || randomValues.length === 0) {
    return [CLI_PATH];
  }
  const preloadScript = [
    `const values = ${JSON.stringify(randomValues)};`,
    'let index = 0;',
    'Math.random = () => values[index++ % values.length] ?? 0;',
    `await import(${JSON.stringify(pathToFileURL(CLI_PATH).href)});`,
  ].join(' ');
  return ['--input-type=module', '-e', preloadScript];
}

function runInteractiveSession({
  onPrompt,
  randomValues,
  fragmentAtColonSpace = false,
  timeoutMs = 5000,
}: RunInteractiveSessionOptions): Promise<RunInteractiveResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, buildSpawnArgs(randomValues), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let lastPromptOffset = -1;
    const prompts: string[] = [];

    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`CLI session timed out after ${timeoutMs}ms.\nOutput so far:\n${stdout}`));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      settled = true;
    };

    const processPiece = (piece: string): void => {
      stdout += piece;
      if (settled) return;

      const promptText = matchInteractivePrompt(stdout);
      if (promptText !== undefined && stdout.length > lastPromptOffset) {
        lastPromptOffset = stdout.length;
        prompts.push(promptText);
        const answer = onPrompt(promptText, stdout);
        if (answer === null) {
          child.stdin.end();
        } else if (answer !== undefined) {
          child.stdin.write(`${answer}\n`);
        }
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const pieces = fragmentAtColonSpace ? text.split(/(?<=: )/g) : [text];
      for (const piece of pieces) {
        processPiece(piece);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (exitCode) => {
      cleanup();
      resolveResult({ exitCode, stdout, stderr, prompts });
    });

    child.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

function runScriptedSession(
  inputs: readonly string[],
  options?: {
    readonly randomValues?: readonly number[];
    readonly fragmentAtColonSpace?: boolean;
    readonly timeoutMs?: number;
  },
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
    ...(options?.randomValues !== undefined ? { randomValues: options.randomValues } : {}),
    ...(options?.fragmentAtColonSpace !== undefined
      ? { fragmentAtColonSpace: options.fragmentAtColonSpace }
      : {}),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}

test('e2e: splitting non-prompt output at ": " does not prematurely consume scripted inputs', async () => {
  for (const nonPromptPrefix of [
    'Your cards: ',
    'Opponent difficulty: ',
    'Machine cards: ',
    'Completed board: ',
    'Board: ',
    'Lesson: ',
    'Flop — board: ',
  ]) {
    assert.equal(matchInteractivePrompt(nonPromptPrefix), undefined);
  }

  const { exitCode, stdout, stderr, prompts } = await runScriptedSession(['easy', 'fold', 'no'], {
    fragmentAtColonSpace: true,
  });

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.deepEqual(prompts, [
    'Choose a difficulty (easy, medium, hard): ',
    'Your action (check, bet $10, fold): ',
    'Play another hand? (yes/no): ',
  ]);
  assert.match(stdout, /Your cards: \S+\s+\S+/);
  assert.match(stdout, /You folded; the machine wins the pot\./);
  assert.match(stdout, /Machine cards: \S+\s+\S+/);
  assert.match(stdout, /Completed board: (?:\S+\s+){4}\S+/);
  assert.match(stdout, /Lesson: use this only to review the result/);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

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
    randomValues: [0.9],
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
    randomValues: [0.9],
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
  // In easy mode with facingBet=false, roll < 0.45 causes the machine to bet deterministically on Pre-flop.
  const { exitCode, stdout, stderr } = await runScriptedSession(
    ['easy', 'check', 'raise', 'fold', 'no'],
    { randomValues: [0.1] },
  );

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /The machine bets \$10\./);
  assert.match(stdout, /Your response \(call \$10, fold\): /);
  assert.match(stdout, /Please enter one of: call, fold\./);
  assert.match(stdout, /You folded; the machine wins the pot\./);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: aggressive betting reaches showdown when opponent calls every street', async () => {
  // In easy mode with facingBet=true, roll >= 0.25 causes the machine to call deterministically on every street.
  const { exitCode, stdout, stderr } = await runScriptedSession(
    ['easy', 'bet', 'bet', 'bet', 'bet', 'no'],
    { randomValues: [0.8] },
  );

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Playing on EASY mode\./);
  assert.match(stdout, /The machine calls \$10\./);
  assert.match(stdout, /The machine calls \$20\./);
  assert.match(stdout, /The machine calls \$30\./);
  assert.match(stdout, /The machine calls \$40\./);
  assert.match(stdout, /Showdown/);
  assert.match(stdout, /Thanks for playing!/);
  assert.equal(stderr, '');
});

test('e2e: aggressive betting wins immediately when opponent folds', async () => {
  // In easy mode with facingBet=true, roll < 0.25 causes the machine to fold deterministically on Pre-flop.
  const { exitCode, stdout, stderr } = await runScriptedSession(
    ['easy', 'bet', 'no'],
    { randomValues: [0.1] },
  );

  assert.equal(exitCode, 0, `Process failed with stderr: ${stderr}`);
  assert.match(stdout, /Playing on EASY mode\./);
  assert.match(stdout, /The machine folds\. You win the hand\./);
  assert.doesNotMatch(stdout, /Flop — board:/);
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
