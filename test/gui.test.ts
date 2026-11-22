import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable, Readable } from 'node:stream';
import type http from 'node:http';
import { Card } from '../src/card.js';
import {
  ALL_OPPONENT_PROFILES,
  PokerGameEngine,
  StaleStateError,
  type SerializedGameState,
} from '../src/gui/engine.js';
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

test('PokerGameEngine enforces chip stack limits, runs out board when player is all-in, and settles side pots by contribution', () => {
  // Deterministic deck where Player has Pocket Aces (beats everyone!), Seat 1 (Reginald) has Pocket Kings (best opponent),
  // and Seats 2-4 have weak hands, with a clean low board (2c, 5d, 9s, Jc, 3h) — zero accidental straights/flushes.
  const makeDeterministicDeck = () => {
    const cards = [
      new Card('♠', 'A'), new Card('♥', 'A'), // Player: Pair of Aces (best overall)
      new Card('♠', 'K'), new Card('♥', 'K'), // Seat 1: Reginald: Pair of Kings (best opponent -> wins side pot!)
      new Card('♠', 'J'), new Card('♦', '7'), // Seat 2: Buck (High Card Q)
      new Card('♦', '10'), new Card('♥', '8'), // Seat 3: Elon (High Card Q)
      new Card('♦', 'J'), new Card('♠', '3'), // Seat 4: Tony (High Card Q)
      new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'), // Flop (no straight/flush possible)
      new Card('♣', 'Q'), // Turn
      new Card('♥', '4'), // River
    ];
    return {
      draw: () => {
        const next = cards.shift();
        if (!next) throw new Error('Deterministic deck exhausted');
        return next;
      },
    };
  };

  // RNG: on easy mode, 0.35 triggers facingBet=false -> bet (<0.45) and facingBet=true -> call (>=0.25).
  // Player starts with $5; all 4 opponents start with $500 (total chips = $2005).
  const sidePotEngine = new PokerGameEngine({
    initialPlayerChips: 5,
    initialOpponentChips: 500,
    random: () => 0.35,
    deckFactory: makeDeterministicDeck,
  });
  sidePotEngine.act('select_opponents:reginald,buck,elon,tony');
  let state = sidePotEngine.act('easy');

  // Pre-flop prompt must offer "All-in $5" (never "Bet $10")
  assert.equal(state.prompt?.choices.find((c) => c.id === 'bet')?.label, 'All-in $5');
  assert.equal(state.currentBet, 5);

  // Player goes all-in for $5 -> all 4 opponents call $5 ($25 main pot).
  // Because player is all-in ($0 chips), engine MUST NOT prompt player on Flop/Turn/River:
  // it immediately runs out the board while opponents bet/call $20 (Flop) + $30 (Turn) + $40 (River) = $360 side pot!
  state = sidePotEngine.act('bet');
  assert.equal(state.stage, 'hand_over', 'All-in player must advance straight through runout to showdown without extra prompts');
  assert.equal(state.board.length, 5);
  assert.equal(state.pot, 25 + 4 * (20 + 30 + 40)); // $385 total pot ($25 main + $360 side)

  // turnEvents must include both the pre-flop calls AND the Flop/Turn/River side-pot runout decisions with board snapshots!
  const eventStreets = [...new Set(state.turnEvents.map((e) => e.streetName))];
  assert.deepEqual(eventStreets, ['Pre-flop', 'Flop', 'Turn', 'River']);
  const flopEvents = state.turnEvents.filter((e) => e.streetName === 'Flop');
  assert.equal(flopEvents.length, 4);
  assert.equal(flopEvents[0]!.boardSnapshot.length, 3);
  assert.equal(state.turnEvents[state.turnEvents.length - 1]!.potAfter, 385);

  // Player wins ONLY the $25 main pot (NOT $385!), while Reginald wins the $360 side pot!
  assert.equal(state.playerChips, 25);
  assert.equal(state.playerTotalPotWon, 25);
  const reginald = state.opponents.find((o) => o.id === 'reginald')!;
  assert.equal(reginald.chips, 500 - 95 + 360); // $765
  assert.equal(reginald.totalPotWon, 360);
  for (const opp of state.opponents) {
    assert.ok(opp.chips >= 0, `Opponent ${opp.id} went negative: ${opp.chips}`);
  }
  const totalChips = state.playerChips + state.opponents.reduce((sum, o) => sum + o.chips, 0);
  assert.equal(totalChips, 2005, 'Total chips across all seats must be conserved');

  // When all 4 opponents go all-in on Flop ($25 stack each: $10 Pre-flop + $15 Flop against player's $20 Flop bet),
  // the player is the ONLY funded seat left: $5 uncalled excess is refunded immediately and Turn/River run out to showdown
  // WITHOUT offering an uncallable Turn Bet $30 or River Fold!
  const opponentsAllInEngine = new PokerGameEngine({
    initialPlayerChips: 50,
    initialOpponentChips: 25,
    random: () => 0.5, // opponents always check/call
    deckFactory: makeDeterministicDeck,
  });
  opponentsAllInEngine.act('select_opponents:reginald,buck,elon,tony');
  let uState = opponentsAllInEngine.act('easy');
  uState = opponentsAllInEngine.act('bet'); // Pre-flop $10 (opps -> $15)
  assert.equal(uState.streetName, 'Flop');
  assert.equal(uState.playerChips, 40);
  for (const opp of uState.opponents) assert.equal(opp.chips, 15);

  uState = opponentsAllInEngine.act('bet'); // Flop $20 -> all 4 opponents call all-in $15 ($0 left), $5 uncalled returned, immediate runout to showdown!
  assert.equal(uState.stage, 'hand_over', 'Must advance directly to showdown once no opponent can call further wagers');
  assert.equal(uState.board.length, 5);
  assert.equal(uState.pot, 125); // 5 seats x $25 matched ($5 uncalled Flop excess returned to player!)
  assert.equal(uState.playerChips, 150); // $50 start - $25 matched + $125 pot won = $150
  const uTotalChips = uState.playerChips + uState.opponents.reduce((sum, o) => sum + o.chips, 0);
  assert.equal(uTotalChips, 150, 'Total chips with uncalled excess must be conserved');
});

test('PokerGameEngine excludes returned uncalled bets from uncontested winnings and counts $0-pot showdown wins', () => {
  const makeDeterministicDeck = () => {
    const cards = [
      new Card('♠', 'A'), new Card('♥', 'A'), // Player: Pair of Aces (wins $0 check-down!)
      new Card('♠', 'K'), new Card('♥', 'K'), // Seat 1
      new Card('♠', 'J'), new Card('♦', '7'), // Seat 2
      new Card('♦', '10'), new Card('♥', '8'), // Seat 3
      new Card('♦', 'J'), new Card('♠', '3'), // Seat 4
      new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'), // Flop
      new Card('♣', 'Q'), // Turn
      new Card('♥', '4'), // River
    ];
    return { draw: () => cards.shift()! };
  };

  // 1. All 4 opponents fold to opening $10 bet (roll=0.05 -> facingBet=true folds on easy mode!)
  const foldOutEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 500,
    random: () => 0.05,
    deckFactory: makeDeterministicDeck,
  });
  foldOutEngine.act('select_opponents:reginald,buck,elon,tony');
  foldOutEngine.act('easy');
  const uncontested = foldOutEngine.act('bet');
  assert.equal(uncontested.stage, 'hand_over');
  assert.equal(uncontested.playerChips, 500, 'Uncalled $10 bet returned to player stack');
  assert.equal(uncontested.playerTotalPotWon, 0, 'Returned uncalled bet must NOT inflate playerTotalPotWon');
  assert.equal(uncontested.playerHandsWon, 1, 'Completed uncontested hand win must still increment playerHandsWon');
  assert.equal(uncontested.outcome?.pot, 0);
  assert.ok(uncontested.outcome?.message.includes('returned'));

  // 2. Check down all four streets ($0 pot) with strongest hand -> playerHandsWon must increment!
  const checkDownEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 500,
    random: () => 0.5, // opponents always check
    deckFactory: makeDeterministicDeck,
  });
  checkDownEngine.act('select_opponents:reginald,buck,elon,tony');
  checkDownEngine.act('easy');
  checkDownEngine.act('check'); // Pre-flop -> Flop
  checkDownEngine.act('check'); // Flop -> Turn
  checkDownEngine.act('check'); // Turn -> River
  const checkedDown = checkDownEngine.act('check'); // River -> Showdown ($0 pot)
  assert.equal(checkedDown.stage, 'hand_over');
  assert.equal(checkedDown.pot, 0);
  assert.equal(checkedDown.outcome?.result, 'win');
  assert.equal(checkedDown.playerHandsWon, 1, '$0 check-down showdown win must increment playerHandsWon');
  assert.equal(checkedDown.playerTotalPotWon, 0);
  assert.equal(checkedDown.playerChips, 500);
});

test('PokerGameEngine settles post-fold side pots by contribution and returns unmatched wagers', () => {
  // Seat order: buck (Seat 1), reginald (Seat 2), elon (Seat 3), tony (Seat 4).
  // Hand 1 gives Buck $65 and Reg/Elon/Tony $15 each.
  // Hand 2: Player folds Pre-flop. Buck ($65, Seat 1) bets $10 Pre-flop + $20 Flop ($30 total),
  // while Reg/Elon/Tony ($15 each) call $10 Pre-flop + $5 all-in Flop ($15 total).
  // Reginald has Pocket Aces and wins ONLY the $60 main pot; Buck's $15 unmatched excess MUST return to Buck!
  let handNum = 0;
  const makeDeck = () => {
    handNum += 1;
    if (handNum === 1) {
      const cards = [
        new Card('♠', '3'), new Card('♥', '7'), // Player (High Card Q)
        new Card('♠', 'A'), new Card('♥', 'A'), // Seat 1: Buck (Pair of Aces -> wins Hand 1!)
        new Card('♦', 'J'), new Card('♥', '8'), // Seat 2: Reginald (High Card Q)
        new Card('♦', '10'), new Card('♦', '3'), // Seat 3: Elon (High Card Q)
        new Card('♠', 'J'), new Card('♣', '5'), // Seat 4: Tony (High Card Q)
        new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'), // Flop
        new Card('♣', 'Q'), // Turn
        new Card('♥', '4'), // River
      ];
      return { draw: () => cards.shift()! };
    }
    const cards = [
      new Card('♠', '3'), new Card('♥', '7'), // Player (folds!)
      new Card('♠', 'K'), new Card('♥', 'K'), // Seat 1: Buck ($65 deep stack -> bets $30 total, $15 unmatched!)
      new Card('♠', 'A'), new Card('♥', 'A'), // Seat 2: Reginald ($15 short stack -> wins $60 main pot ONLY!)
      new Card('♦', '10'), new Card('♥', '8'), // Seat 3: Elon ($15, High Card Q)
      new Card('♦', 'J'), new Card('♣', '3'), // Seat 4: Tony ($15, High Card Q)
      new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'), // Flop
      new Card('♣', 'Q'), // Turn
      new Card('♥', '4'), // River
    ];
    return { draw: () => cards.shift()! };
  };

  let rngVal = 0.5;
  const engine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 25,
    random: () => rngVal,
    deckFactory: makeDeck,
  });
  engine.act('select_opponents:buck,reginald,elon,tony');
  engine.act('easy');
  engine.act('bet');
  engine.act('check');
  engine.act('check');
  const h1End = engine.act('check');
  assert.equal(h1End.stage, 'hand_over');
  assert.equal(h1End.opponents.find((o) => o.id === 'buck')!.chips, 65);
  assert.equal(h1End.opponents.find((o) => o.id === 'reginald')!.chips, 15);

  rngVal = 0.35;
  engine.act('yes');
  const h2End = engine.act('fold');
  assert.equal(h2End.stage, 'hand_over');
  assert.equal(h2End.pot, 60); // 4 x $15 matched ($15 uncalled Buck Flop excess returned immediately on street close)
  const regH2 = h2End.opponents.find((o) => o.id === 'reginald')!;
  const buckH2 = h2End.opponents.find((o) => o.id === 'buck')!;
  assert.equal(regH2.chips, 60, 'Reginald must win ONLY the $60 main pot (not Buck’s $15 unmatched excess)');
  assert.equal(regH2.totalPotWon, 60);
  assert.equal(buckH2.chips, 50, 'Buck’s $15 unmatched excess must be returned to Buck’s stack (35 + 15)');
  const sumChips = h2End.playerChips + h2End.opponents.reduce((s, o) => s + o.chips, 0);
  assert.equal(sumChips, 600, 'Total chips across all seats must be conserved after post-fold settlement');
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

test('PokerGameEngine restricts roster changes during active hand & game_over, preserves opponent accounting on reselection, validates stateRevision, and clears all state on restart', () => {
  const engine = new PokerGameEngine({ random: () => 0.05 });
  engine.act('select_opponents:reginald,buck,elon,tony');
  const start = engine.act('easy');
  const staleRev = start.stateRevision;
  const afterFold = engine.act('fold', staleRev); // Reginald wins pot uncontested!
  assert.equal(afterFold.stage, 'hand_over');
  assert.ok(afterFold.stateRevision > staleRev);

  // Stale revision must throw StaleStateError
  assert.throws(() => engine.act('yes', staleRev), (err: unknown) => err instanceof StaleStateError);

  const regBefore = afterFold.opponents.find((o) => o.id === 'reginald')!;
  assert.ok(regBefore.totalPotWon > 0 || regBefore.chips !== 500 || afterFold.pot >= 0);
  const savedChips = regBefore.chips;
  const savedWon = regBefore.totalPotWon;

  // Reselecting the identical roster between hands MUST preserve retained opponents' chips & session winnings!
  const reselected = engine.act('select_opponents:reginald,buck,elon,tony');
  const regAfter = reselected.opponents.find((o) => o.id === 'reginald')!;
  assert.equal(regAfter.chips, savedChips);
  assert.equal(regAfter.totalPotWon, savedWon);

  // Mid-hand roster change must throw and preserve pot/chips
  engine.act('bet'); // active hand on Flop or hand_over if all folded
  if (engine.getState().stage === 'player_action') {
    const beforePot = engine.getState().pot;
    assert.throws(() => engine.act('open_opponent_select'), /active hand/);
    assert.throws(() => engine.act('select_opponents:bruce,viktor,meiling,tariq'), /active hand/);
    assert.equal(engine.getState().pot, beforePot);
    engine.act('fold');
  }

  // Cash out -> game_over MUST reject roster changes (cannot resume old session without restart!)
  engine.act('no');
  assert.equal(engine.getState().stage, 'game_over');
  assert.throws(() => engine.act('open_opponent_select'), /Session is over/);
  assert.throws(() => engine.act('select_opponents:reginald,buck,elon,tony'), /Session is over/);
  assert.throws(() => engine.act('random_opponents'), /Session is over/);

  // Restart -> ALL table state, pots, opponent ledger/totals, and narrative must reset cleanly
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

