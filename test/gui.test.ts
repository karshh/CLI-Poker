import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable, Readable } from 'node:stream';
import type http from 'node:http';
import { ALL_OPPONENT_PROFILES, PokerGameEngine, type SerializedGameState } from '../src/gui/engine.js';
import { createPokerRequestHandler, findPublicDir } from '../src/gui/server.js';

class MockResponse extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = '';

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.body += chunk.toString();
    callback();
  }

  setHeader(name: string, val: string): void {
    this.headers[name.toLowerCase()] = val;
  }

  writeHead(code: number, headers?: Record<string, string>): this {
    this.statusCode = code;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        this.headers[k.toLowerCase()] = v;
      }
    }
    return this;
  }
}

function simulateRequest(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  options: { method: string; url: string; body?: string; headers?: Record<string, string> },
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve) => {
    const req = new Readable({
      read() {
        if (options.body) {
          this.push(options.body);
        }
        this.push(null);
      },
    }) as unknown as http.IncomingMessage;

    req.method = options.method;
    req.url = options.url;
    const defaultHeaders: Record<string, string> = { host: '127.0.0.1:3000' };
    if (options.method === 'POST') {
      defaultHeaders['origin'] = 'http://127.0.0.1:3000';
      defaultHeaders['content-type'] = 'application/json';
    }
    req.headers = { ...defaultHeaders, ...(options.headers ?? {}) };

    const res = new MockResponse();
    res.on('finish', () => {
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: res.body,
      });
    });

    handler(req, res as unknown as http.ServerResponse);
  });
}

test('findPublicDir resolves existing public assets directory', () => {
  const dir = findPublicDir();
  assert.ok(dir.length > 0);
});

test('PokerGameEngine initializes in select_opponents stage with all 8 available opponents', () => {
  const engine = new PokerGameEngine();
  const state = engine.getState();
  assert.equal(state.stage, 'select_opponents');
  assert.equal(state.mode, null);
  assert.equal(state.availableOpponents.length, 8);
  assert.ok(state.prompt);
  assert.equal(state.prompt?.type, 'select_opponents');

  // Selecting 4 specific opponents moves to select_mode
  const selectedState = engine.act('select_opponents:reginald,buck,elon,tariq');
  assert.equal(selectedState.stage, 'select_mode');
  assert.deepEqual(
    selectedState.opponents.map((o) => o.id),
    ['reginald', 'buck', 'elon', 'tariq'],
  );
  assert.equal(selectedState.prompt?.type, 'select_mode');
  assert.equal(selectedState.prompt?.choices.length, 3);
});

test('PokerGameEngine handles mode selection and seats 4 unique opponents from the 8 VIP characters', () => {
  assert.equal(ALL_OPPONENT_PROFILES.length, 8);
  const validIds = new Set(ALL_OPPONENT_PROFILES.map((p) => p.id));
  assert.deepEqual([...validIds].sort(), ['bruce', 'buck', 'elon', 'meiling', 'reginald', 'tariq', 'tony', 'viktor']);

  const engine = new PokerGameEngine();
  engine.act('random_opponents');
  const state = engine.act('easy');
  assert.equal(state.mode, 'easy');
  assert.equal(state.stage, 'player_action');
  assert.equal(state.streetIndex, 0);
  assert.equal(state.streetName, 'Pre-flop');
  assert.equal(state.playerCards.length, 2);
  assert.equal(state.opponentCards.length, 2);
  assert.equal(state.opponentCardsHidden, true);
  assert.equal(state.opponents.length, 4);
  const seatedIds = new Set(state.opponents.map((o) => o.id));
  assert.equal(seatedIds.size, 4);
  assert.deepEqual(
    state.opponents.map((o) => o.seat),
    ['far-left', 'top-left', 'top-right', 'far-right'],
  );
  for (const opp of state.opponents) {
    assert.ok(validIds.has(opp.id));
    assert.equal(opp.chips, 500);
    assert.equal(opp.handContribution, 0);
    assert.equal(opp.totalPotWon, 0);
    assert.equal(opp.cards.length, 2);
    assert.equal(opp.cardsHidden, true);
    assert.equal(opp.cards[0]?.str, '??');
    assert.equal(opp.folded, false);
  }
  assert.equal(state.board.length, 0);
  assert.equal(state.pot, 0);
});

test('PokerGameEngine handles player fold keeping all 4 opponents’ cards hidden', () => {
  const engine = new PokerGameEngine();
  engine.act('medium');
  const state = engine.act('fold');
  assert.equal(state.stage, 'hand_over');
  assert.equal(state.outcome?.result, 'fold');
  // All opponents' cards stay hidden when player folds
  assert.equal(state.opponentCardsHidden, true);
  assert.equal(state.opponentCards[0]?.str, '??');
  for (const opp of state.opponents) {
    assert.equal(opp.cardsHidden, true);
    assert.equal(opp.cards[0]?.str, '??');
  }
  assert.equal(state.board.length, 5);
});

test('PokerGameEngine plays multi-opponent hand through to showdown revealing only active opponents', () => {
  const engine = new PokerGameEngine();
  engine.act('hard');

  let state = engine.getState();
  let maxSteps = 20;

  while (state.stage !== 'hand_over' && maxSteps > 0) {
    maxSteps -= 1;
    if (state.stage === 'player_action') {
      state = engine.act('check');
    } else if (state.stage === 'player_response') {
      state = engine.act('call');
    } else {
      break;
    }
  }

  assert.equal(state.stage, 'hand_over');
  assert.ok(state.outcome !== null);
  const activeOpps = state.opponents.filter((o) => !o.folded);
  const foldedOpps = state.opponents.filter((o) => o.folded);

  if (activeOpps.length > 0) {
    assert.equal(state.opponentCardsHidden, false);
    for (const opp of activeOpps) {
      assert.equal(opp.cardsHidden, false);
      assert.notEqual(opp.cards[0]?.str, '??');
    }
  }
  for (const opp of foldedOpps) {
    assert.equal(opp.cardsHidden, true);
    assert.equal(opp.cards[0]?.str, '??');
  }
  // Outcome message and prompt clearly explain the result
  assert.ok(state.outcome.message.length > 0);
  assert.ok(state.prompt?.message.includes(state.outcome.message));
});

test('PokerGameEngine resets and re-hides all 4 opponents’ cards on subsequent hand', () => {
  const engine = new PokerGameEngine();
  engine.act('hard');
  let state = engine.getState();
  while (state.stage !== 'hand_over') {
    if (state.stage === 'player_action') state = engine.act('check');
    else if (state.stage === 'player_response') state = engine.act('call');
    else break;
  }

  const nextHandState = engine.act('yes'); // Play Again
  assert.equal(nextHandState.stage, 'player_action');
  assert.equal(nextHandState.streetName, 'Pre-flop');
  assert.equal(nextHandState.opponentCardsHidden, true);
  assert.equal(nextHandState.opponentCards[0]?.str, '??');
  assert.equal(nextHandState.handCount, 2);
  for (const opp of nextHandState.opponents) {
    assert.equal(opp.cardsHidden, true);
    assert.equal(opp.cards[0]?.str, '??');
    assert.equal(opp.folded, false);
  }
});

test('PokerGameEngine emits sequential turnEvents with thinking and decision speeches for each active opponent', () => {
  const engine = new PokerGameEngine();
  const startState = engine.act('medium');
  const expectedOrder = startState.opponents.map((o) => o.id);

  const betState = engine.act('bet');
  assert.equal(betState.turnEvents.length, 4);
  assert.deepEqual(
    betState.turnEvents.map((e) => e.opponentId),
    expectedOrder,
  );
  assert.equal(betState.turnStartPot, 10);
  for (const event of betState.turnEvents) {
    assert.ok(event.thinkingSpeech.length > 0);
    assert.ok(event.decisionSpeech.length > 0);
    assert.ok(event.actionBadge.length > 0);
    assert.ok(['call', 'fold'].includes(event.action));
  }

  // Subsequent non-opponent-turn action (fold) should clear turnEvents
  if (betState.stage === 'player_action') {
    const foldState = engine.act('fold');
    assert.equal(foldState.turnEvents.length, 0);
  }

  // Shuffling a new table seats 4 unique opponents from the 7-character pool
  const newTableState = engine.act('new_table');
  assert.equal(newTableState.opponents.length, 4);
  assert.equal(new Set(newTableState.opponents.map((o) => o.id)).size, 4);

  // Verify per-opponent handContribution & totalPotWon tracking and bubble clearing on new street/hand
  const potCheckEngine = new PokerGameEngine();
  potCheckEngine.act('select_opponents:reginald,buck,elon,tony');
  const handStart = potCheckEngine.act('easy');
  for (const opp of handStart.opponents) {
    assert.equal(opp.speech, '');
  }
  const afterBet = potCheckEngine.act('bet');
  assert.equal(afterBet.playerHandContribution, 10);
  const totalOppInPot = afterBet.opponents.reduce((sum, o) => sum + o.handContribution, 0);
  assert.equal(totalOppInPot + afterBet.playerHandContribution, afterBet.pot);
  if (afterBet.stage === 'player_action') {
    // Advanced to Flop: all opponent chat bubbles must be cleared for the new round
    for (const opp of afterBet.opponents) {
      assert.equal(opp.speech, '');
    }
  }
});

test('PokerGameEngine enforces chip stack limits on short-stack player and opponents (no negative stacks)', () => {
  // Deterministic RNG that makes opponents always check/call (never fold) on easy mode (roll = 0.5 >= 0.45 and >= 0.25)
  const engine = new PokerGameEngine({
    initialPlayerChips: 50,
    initialOpponentChips: 25,
    random: () => 0.5,
  });
  engine.act('select_opponents:reginald,buck,elon,tony');
  let state = engine.act('easy');

  // Pre-flop ($10): player bets $10 (stack 50 -> 40), all 4 opponents call $10 (stacks 25 -> 15)
  state = engine.act('bet');
  assert.equal(state.streetName, 'Flop');
  assert.equal(state.playerChips, 40);
  for (const opp of state.opponents) {
    assert.equal(opp.chips, 15);
  }

  // Flop ($20): player bets $20 (stack 40 -> 20), opponents only have $15 so each goes all-in for $15 (stack -> 0, never negative!)
  state = engine.act('bet');
  assert.equal(state.streetName, 'Turn');
  assert.equal(state.playerChips, 20);
  for (const opp of state.opponents) {
    assert.equal(opp.chips, 0);
    assert.ok(opp.chips >= 0);
  }

  // Turn ($30): player only has $20 left -> prompt must offer "All-in $20" (not "Bet $30"!)
  const betChoice = state.prompt?.choices.find((c) => c.id === 'bet');
  assert.equal(betChoice?.label, 'All-in $20');
  assert.equal(state.currentBet, 20);
  const potBeforeTurnBet = state.pot;

  state = engine.act('bet');
  assert.equal(state.streetName, 'River');
  assert.equal(state.playerChips, 0);
  assert.equal(state.pot, potBeforeTurnBet + 20);

  // River ($40): player has $0 chips -> Bet option must NOT be offered and betting must throw
  assert.equal(state.prompt?.choices.some((c) => c.id === 'bet'), false);
  assert.throws(() => engine.act('bet'), /Insufficient chips/);
  for (const opp of state.opponents) {
    assert.ok(opp.chips >= 0);
  }
});

test('PokerGameEngine keeps multiway hands going after player fold and ends immediately if 1 contender remains', () => {
  // Deterministic RNG: roll = 0.05 -> on easy mode facingBet=false (< 0.45 => bet), facingBet=true (< 0.25 => fold)!
  // So after player folds on pre-flop, seat 1 bets $10 and seats 2, 3, 4 all fold -> hand ends immediately on Pre-flop!
  const uncontestedEngine = new PokerGameEngine({ random: () => 0.05 });
  uncontestedEngine.act('select_opponents:reginald,buck,elon,tony');
  uncontestedEngine.act('easy');
  const foldedEarly = uncontestedEngine.act('fold');
  assert.equal(foldedEarly.stage, 'hand_over');
  assert.equal(foldedEarly.playerFolded, true);
  assert.equal(foldedEarly.outcome?.result, 'fold');
  // Ended immediately when only 1 opponent remained (no unnecessary Flop/Turn/River cards dealt!)
  assert.equal(foldedEarly.board.length, 0);
  assert.equal(foldedEarly.opponents.filter((o) => !o.folded).length, 1);
  assert.ok(foldedEarly.dealerSpeech.includes('last player standing'));

  // Deterministic RNG: roll = 0.35 -> on easy mode facingBet=false (< 0.45 => bet), facingBet=true (>= 0.25 => call)!
  // So all 4 opponents bet & call across Pre-flop ($10), Flop ($20), Turn ($30), and River ($40) = $400 total pot!
  const multiwayEngine = new PokerGameEngine({ random: () => 0.35 });
  multiwayEngine.act('select_opponents:reginald,buck,elon,tony');
  multiwayEngine.act('easy');
  const foldedMultiway = multiwayEngine.act('fold');
  assert.equal(foldedMultiway.stage, 'hand_over');
  assert.equal(foldedMultiway.board.length, 5);
  assert.equal(foldedMultiway.pot, 400);
  for (const opp of foldedMultiway.opponents) {
    assert.equal(opp.cardsHidden, true);
    assert.equal(opp.cards[0]?.str, '??');
  }
});

test('PokerGameEngine restricts roster changes during active hand and clears all state on restart', () => {
  const engine = new PokerGameEngine({ random: () => 0.5 });
  engine.act('select_opponents:reginald,buck,elon,tony');
  engine.act('easy');
  engine.act('bet'); // active hand on Flop with $50 in pot

  // Attempting to open or change opponents mid-hand must throw and preserve pot/chips
  const beforePot = engine.getState().pot;
  assert.throws(() => engine.act('open_opponent_select'), /active hand/);
  assert.throws(() => engine.act('select_opponents:bruce,viktor,meiling,tariq'), /active hand/);
  assert.equal(engine.getState().pot, beforePot);

  // Finish hand, cash out, restart -> ALL table state, pots, opponent totals, and narrative must reset cleanly
  engine.act('fold');
  engine.act('no');
  const restarted = engine.act('restart');
  assert.equal(restarted.stage, 'select_opponents');
  assert.equal(restarted.pot, 0);
  assert.equal(restarted.board.length, 0);
  assert.equal(restarted.playerChips, 500);
  assert.equal(restarted.playerTotalPotWon, 0);
  assert.equal(restarted.handCount, 0);
  assert.equal(restarted.narrative.length, 1);
  for (const opp of restarted.opponents) {
    assert.equal(opp.chips, 500);
    assert.equal(opp.totalPotWon, 0);
    assert.equal(opp.handContribution, 0);
    assert.equal(opp.cards.length, 0);
  }
});

test('HTTP request handler serves state, static files, and handles actions', async () => {
  const engine = new PokerGameEngine();
  const handler = createPokerRequestHandler(engine);

  // 1. GET /api/state
  const stateRes = await simulateRequest(handler, { method: 'GET', url: '/api/state' });
  assert.equal(stateRes.statusCode, 200);
  const state = JSON.parse(stateRes.body) as SerializedGameState;
  assert.equal(state.stage, 'select_opponents');
  assert.equal(state.availableOpponents.length, 8);

  // 2. POST /api/action with opponent selection & difficulty
  const selectRes = await simulateRequest(handler, {
    method: 'POST',
    url: '/api/action',
    body: JSON.stringify({ action: 'select_opponents:reginald,buck,elon,meiling' }),
  });
  assert.equal(selectRes.statusCode, 200);
  const selectState = JSON.parse(selectRes.body) as SerializedGameState;
  assert.equal(selectState.stage, 'select_mode');

  const actRes = await simulateRequest(handler, {
    method: 'POST',
    url: '/api/action',
    body: JSON.stringify({ action: 'easy' }),
  });
  assert.equal(actRes.statusCode, 200);
  const actState = JSON.parse(actRes.body) as SerializedGameState;
  assert.equal(actState.mode, 'easy');
  assert.equal(actState.stage, 'player_action');

  // 3. GET / (index.html) with frame-ancestors CSP
  const htmlRes = await simulateRequest(handler, { method: 'GET', url: '/' });
  assert.equal(htmlRes.statusCode, 200);
  assert.equal(htmlRes.headers['content-security-policy'], "frame-ancestors 'none'");
  assert.ok(htmlRes.body.includes("VIP Texas Hold'em"));
  assert.ok(htmlRes.body.includes('Vincent'));
  assert.ok(htmlRes.body.includes('seat-far-left'));
  assert.ok(htmlRes.body.includes('opponent-modal-overlay'));
  assert.ok(htmlRes.body.includes('pots-window'));

  // 4. Malformed URL & bad Host are handled safely without throwing
  const badHostRes = await simulateRequest(handler, {
    method: 'GET',
    url: '/',
    headers: { host: 'evil.example:3000' },
  });
  assert.equal(badHostRes.statusCode, 403);

  const badUrlRes = await simulateRequest(handler, {
    method: 'GET',
    url: '//evil.example/steal',
  });
  assert.equal(badUrlRes.statusCode, 400);

  // 5. Unknown static path returns 404 (strict bundled-asset allowlist)
  const unknownAssetRes = await simulateRequest(handler, { method: 'GET', url: '/unknown.txt' });
  assert.equal(unknownAssetRes.statusCode, 404);

  // 4. GET /style.css
  const cssRes = await simulateRequest(handler, { method: 'GET', url: '/style.css' });
  assert.equal(cssRes.statusCode, 200);
  assert.ok(cssRes.body.includes('poker-table-surface'));

  // 5. GET /game.js
  const jsRes = await simulateRequest(handler, { method: 'GET', url: '/game.js' });
  assert.equal(jsRes.statusCode, 200);
  assert.ok(jsRes.body.includes('SoundFX'));
  assert.ok(jsRes.body.includes('CHARACTER_ART'));
  assert.ok(jsRes.body.includes('reginald'));
  assert.ok(jsRes.body.includes('buck'));
  assert.ok(jsRes.body.includes('bruce'));
  assert.ok(jsRes.body.includes('elon'));
  assert.ok(jsRes.body.includes('viktor'));
  assert.ok(jsRes.body.includes('meiling'));
  assert.ok(jsRes.body.includes('tony'));
  assert.ok(jsRes.body.includes('tariq'));
});

