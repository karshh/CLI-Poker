import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Writable, Readable } from 'node:stream';
import type http from 'node:http';
import { Card } from '../src/card.js';
import {
  ALL_OPPONENT_PROFILES,
  cardToData,
  PokerGameEngine,
  StaleStateError,
  type CardData,
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

test('PokerGameEngine handles mode selection, seats 4 unique opponents, assigns table positions, and posts blinds', () => {
  assert.equal(ALL_OPPONENT_PROFILES.length, 8);
  const validIds = new Set(ALL_OPPONENT_PROFILES.map((p) => p.id));
  assert.deepEqual([...validIds].sort(), ['bruce', 'buck', 'elon', 'meiling', 'reginald', 'tariq', 'tony', 'viktor']);

  const engine = new PokerGameEngine({ random: () => 0.5 });
  engine.act('random_opponents');
  const state = engine.act('easy');
  assert.equal(state.mode, 'easy');
  assert.equal(state.stage, 'player_response'); // On Hand #1 You are BTN facing the $10 Big Blind
  assert.equal(state.streetIndex, 0);
  assert.equal(state.streetName, 'Pre-flop');
  assert.equal(state.buttonSeatIndex, 0);
  assert.equal(state.playerPosition, 'BTN');
  assert.equal(state.smallBlind, 5);
  assert.equal(state.bigBlind, 10);
  assert.deepEqual(
    state.opponents.map((o) => o.position),
    ['SB', 'BB', 'UTG', 'CO'],
  );
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
  // SB posted $5, BB posted $10, UTG & CO called $10 (roll = 0.5)
  assert.equal(state.opponents[0]!.handContribution, 5);
  assert.equal(state.opponents[1]!.handContribution, 10);
  for (const opp of state.opponents) {
    assert.ok(validIds.has(opp.id));
    assert.equal(opp.totalPotWon, 0);
    assert.equal(opp.cards.length, 2);
    assert.equal(opp.cardsHidden, true);
    assert.equal(opp.cards[0]?.str, '??');
  }
  assert.equal(state.board.length, 0);
  assert.ok(state.pot >= 15);
});

test('PokerGameEngine rotates BTN/SB/BB/UTG/CO clockwise every new hand and acts UTG-first pre-flop / SB-first post-flop', () => {
  const engine = new PokerGameEngine({ random: () => 0.5 }); // opponents always call/check
  engine.act('select_opponents:reginald,buck,elon,tony');

  const expectedPlayerPositions = ['BTN', 'CO', 'UTG', 'BB', 'SB', 'BTN'] as const;
  const expectedOppPositions = [
    ['SB', 'BB', 'UTG', 'CO'],
    ['BTN', 'SB', 'BB', 'UTG'],
    ['CO', 'BTN', 'SB', 'BB'],
    ['UTG', 'CO', 'BTN', 'SB'],
    ['BB', 'UTG', 'CO', 'BTN'],
    ['SB', 'BB', 'UTG', 'CO'],
  ];

  let state = engine.act('easy');
  for (let hand = 0; hand < 6; hand += 1) {
    assert.equal(state.handCount, hand + 1);
    assert.equal(state.buttonSeatIndex, hand % 5);
    assert.equal(state.playerPosition, expectedPlayerPositions[hand]);
    assert.deepEqual(
      state.opponents.map((o) => o.position),
      expectedOppPositions[hand],
    );

    // Check pre-flop UTG-first order on Hand #1 (BTN = You -> UTG = elon, CO = tony act BEFORE You!)
    if (hand === 0) {
      assert.deepEqual(
        state.turnEvents.map((e) => e.opponentId),
        ['elon', 'tony'],
      );
      // Calling as BTN lets SB (reginald) & BB (buck) finish Pre-flop, then SB (reginald) starts Flop!
      const afterCall = engine.act('call');
      assert.equal(afterCall.streetName, 'Flop');
      const flopTurnOrder = afterCall.turnEvents
        .filter((e) => e.streetName === 'Flop')
        .map((e) => e.opponentId);
      assert.deepEqual(flopTurnOrder, ['reginald', 'buck', 'elon', 'tony']);
      state = afterCall;
    }

    // Check Hand #3 (You = UTG -> You act FIRST pre-flop, zero opponent turnEvents ahead of you!)
    if (hand === 2) {
      assert.equal(state.playerPosition, 'UTG');
      assert.equal(state.turnEvents.length, 0);
      assert.equal(state.pot, 15); // SB ($5) + BB ($10)
    }

    // Check Hand #4 (You = BB -> You posted $10 BB and have Check option pre-flop!)
    if (hand === 3) {
      assert.equal(state.playerPosition, 'BB');
      assert.equal(state.playerHandContribution, 10);
      assert.equal(state.stage, 'player_action');
      assert.ok(state.prompt?.choices.some((c) => c.id === 'check'));
    }

    // Check Hand #5 (You = SB -> You posted $5 SB and face $5 to complete!)
    if (hand === 4) {
      assert.equal(state.playerPosition, 'SB');
      assert.equal(state.playerHandContribution, 5);
      assert.equal(state.stage, 'player_response');
      assert.equal(state.currentBet, 5);
    }

    // Fold to finish current hand and deal next hand
    if (state.stage !== 'hand_over') {
      state = engine.act('fold');
    }
    assert.equal(state.stage, 'hand_over');
    if (hand < 5) {
      state = engine.act('yes');
    }
  }
});

test('PokerGameEngine preserves full $10 pre-flop bring-in when BB posts short all-in and awards odd split-pot chip clockwise after BTN', () => {
  // 1. Short-stacked BB ($5 left at a $5/$10 table) while other seats have chips:
  //    Hand 1 starts with initialOpponentChips=15 (Player=500, initialButtonSeatIndex=0 -> BTN=You, SB=reginald, BB=buck).
  //    On Hand 1: You fold, UTG/CO/SB/BB play out. Even simpler: Seat 2 (buck) starts with $15, loses $10 on Hand 1 -> $5 left,
  //    OR Seat 2 (elon) has $5 left on Hand 2 when elon is BB!
  //    Cleanest deterministic setup: initialOpponentChips=5, initialPlayerChips=500, initialButtonSeatIndex=1
  //    Wait: if ALL opponents start at $5, only 1 funded seat remains after blinds -> need 2+ funded seats!
  //    So run 1 quick hand where Player (500) + Buck (500) stay deep while Seat 3 (elon) drops to $5:
  //    Actually: start with initialOpponentChips=15, Player=500, initialButtonSeatIndex=1 (BTN=reg, SB=buck, BB=elon, UTG=tony, CO=You).
  //    Hand 1 (smallBlind=5, bigBlind=10): Hand 1 SB (buck) posts $5, BB (elon) posts $10, You fold, buck wins -> elon has $5 left!
  //    Hand 2 rotates BTN -> buck, SB -> elon ($5), BB -> tony ($5)? Wait: Hand 2 has initialButtonSeatIndex=0 on Hand 1:
  //    Let's do it with exact deterministic deck: Hand 1 (initialButtonSeatIndex=0, initialOpponentChips=15, Player=500):
  //      BTN=You(500), SB=reginald(15), BB=buck(15), UTG=elon(15), CO=tony(15).
  //      UTG(elon) calls $10 (5 left), CO(tony) calls $10 (5 left), BTN(You) calls $10, SB(reg) calls $5 (5 left), BB(buck) checks (5 left).
  //      Check down Flop/Turn/River -> Buck wins $50 pot (Buck=55, Reg/Elon/Tony=5 each, Player=490)!
  //    Hand 2 rotates BTN -> reginald(5), SB -> buck(55), BB -> elon(5!!), UTG -> tony(5), CO -> You(490)!
  //      Now BB (elon) posts $5 all-in, while SB (buck=50) and CO (You=490) are BOTH funded -> 2+ funded seats!
  //      Nominal bring-in MUST remain $10: CO (You) MUST be offered Call $10 and Raise to $20 (NOT Call $5 / Raise to $15)!
  let handIdx = 0;
  const makeShortBbDeck = () => {
    handIdx += 1;
    if (handIdx === 1) {
      const cards = [
        new Card('♠', '3'), new Card('♥', '7'), // Player
        new Card('♦', 'J'), new Card('♥', '8'), // Seat 1: Reginald
        new Card('♠', 'A'), new Card('♥', 'A'), // Seat 2: Buck (wins Hand 1 -> $55!)
        new Card('♦', '10'), new Card('♦', '3'), // Seat 3: Elon ($5 left -> short BB on Hand 2!)
        new Card('♠', 'J'), new Card('♣', '5'), // Seat 4: Tony ($5 left)
        new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'),
        new Card('♣', 'Q'),
        new Card('♥', '4'),
      ];
      return { draw: () => cards.shift()! };
    }
    const cards = [
      new Card('♠', 'K'), new Card('♥', 'K'), // Player
      new Card('♦', 'J'), new Card('♥', '8'), // Seat 1
      new Card('♠', 'Q'), new Card('♥', 'Q'), // Seat 2
      new Card('♠', 'A'), new Card('♥', 'A'), // Seat 3: Elon (short BB $5 all-in)
      new Card('♠', 'J'), new Card('♣', '5'), // Seat 4
      new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'),
      new Card('♣', '3'),
      new Card('♥', '4'),
    ];
    return { draw: () => cards.shift()! };
  };

  const shortBbEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 15,
    initialButtonSeatIndex: 0,
    random: () => 0.5, // always call/check
    deckFactory: makeShortBbDeck,
  });
  shortBbEngine.act('select_opponents:reginald,buck,elon,tony');
  shortBbEngine.act('easy'); // Hand 1: BTN=You
  shortBbEngine.act('call'); // Pre-flop -> Flop
  shortBbEngine.act('check'); // Flop -> Turn
  shortBbEngine.act('check'); // Turn -> River
  const h1 = shortBbEngine.act('check'); // River -> Showdown: Buck wins $50 (Buck=55, Elon=5)
  assert.equal(h1.opponents.find((o) => o.id === 'buck')!.chips, 55);
  assert.equal(h1.opponents.find((o) => o.id === 'elon')!.chips, 5);

  const h2 = shortBbEngine.act('yes'); // Hand 2: BTN=reg, SB=buck(55), BB=elon(5 -> posts $5 all-in!), UTG=tony(5), CO=You(490)
  assert.equal(h2.playerPosition, 'CO');
  const elonH2 = h2.opponents.find((o) => o.id === 'elon')!;
  assert.equal(elonH2.position, 'BB');
  assert.equal(elonH2.handContribution, 5, 'Short-stacked BB keeps its actual $5 contribution');
  assert.equal(h2.stage, 'player_response');
  assert.equal(h2.prompt?.choices.find((c) => c.id === 'call')?.label, 'Call $10');
  assert.equal(h2.prompt?.choices.find((c) => c.id === 'bet')?.label, 'Raise to $20');

  // 2. Poker TDA Rule 21: Odd chip in a $25 two-way tie between BTN (Player, seat 0) and BB (Buck, seat 2)
  //    after SB (Reginald, seat 1) folded MUST go to BB ($13), NOT BTN ($12)!
  //    Using hard mode with random=() => 0.99:
  //    - UTG/CO/SB hold weak offsuit 2-5 (strength 0.25 < 0.32) so they deterministically fold facing $10.
  //    - BB holds 4♦ 8♠ (strength 0.50 < 0.58) so BB deterministically checks pre-flop/Flop/Turn/River.
  //    - Board A♠ K♦ Q♣ J♥ 9♠ plays for both Player (4♥ 8♣) and BB (4♦ 8♠) -> exact $25 tie!
  const makeBoardTieDeck = () => {
    const cards = [
      new Card('♥', '4'), new Card('♣', '8'), // Player (BTN)
      new Card('♣', '2'), new Card('♦', '5'), // Seat 1: Reginald (SB -> folds $5!)
      new Card('♦', '4'), new Card('♠', '8'), // Seat 2: Buck (BB -> checks down & ties on board!)
      new Card('♥', '2'), new Card('♣', '5'), // Seat 3: Elon (UTG -> folds)
      new Card('♦', '2'), new Card('♠', '5'), // Seat 4: Tony (CO -> folds)
      new Card('♠', 'A'), new Card('♦', 'K'), new Card('♣', 'Q'), // Flop
      new Card('♥', 'J'), // Turn
      new Card('♠', '9'), // River (A-K-Q-J-9 high-card board plays for both!)
    ];
    return { draw: () => cards.shift()! };
  };

  const oddChipEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 500,
    initialButtonSeatIndex: 0,
    random: () => 0.99,
    deckFactory: makeBoardTieDeck,
  });
  oddChipEngine.act('select_opponents:reginald,buck,elon,tony');
  oddChipEngine.act('hard'); // UTG & CO fold -> prompts BTN (You)
  oddChipEngine.act('call'); // BTN calls $10 -> SB folds ($5 dead) -> BB checks -> Flop (pot = $25)
  oddChipEngine.act('check'); // Flop
  oddChipEngine.act('check'); // Turn
  const tieEnd = oddChipEngine.act('check'); // River -> Showdown tie ($25 pot)!
  assert.equal(tieEnd.stage, 'hand_over');
  assert.equal(tieEnd.pot, 25);
  assert.equal(tieEnd.outcome?.result, 'tie');
  const buckTie = tieEnd.opponents.find((o) => o.id === 'buck')!;
  assert.equal(buckTie.totalPotWon, 13, 'BB (first clockwise after BTN) must receive the odd chip ($13)');
  assert.equal(tieEnd.playerTotalPotWon, 12, 'BTN must receive $12 (not $13)');
  assert.equal(buckTie.chips, 503);
  assert.equal(tieEnd.playerChips, 502);
});

test('PokerGameEngine combines folded layers before splitting a tied $60 pot and drops short-blind call to $5 for sole funded seat', () => {
  // 1. Even $60 pot with folded contributions at $5 (SB), $10 (BB), $15 (UTG) and two tied active seats at $15 each (CO=You, BTN=Reginald):
  //    Merging layers with identical eligible seats must pay $30 each (not $31 and $29 from splitting $25/$20/$15 separately).
  let mergeHandIdx = 0;
  let mergeRng = 0.99;
  const makeMergedPotDeck = () => {
    mergeHandIdx += 1;
    if (mergeHandIdx === 1) {
      // Hand 1 (initialButtonSeatIndex=0, oppChips=25): everyone calls $10 & checks down; Tony (4♠ 4♥) wins $50 -> Tony=$65, Reg/Buck/Elon=$15.
      const cards = [
        new Card('♥', '5'), new Card('♣', '9'), // Player (BTN)
        new Card('♦', '5'), new Card('♠', '9'), // Seat 1: Reginald (SB -> ends $15)
        new Card('♣', '6'), new Card('♦', '9'), // Seat 2: Buck (BB -> ends $15)
        new Card('♥', '6'), new Card('♠', '8'), // Seat 3: Elon (UTG -> ends $15)
        new Card('♠', '4'), new Card('♥', '4'), // Seat 4: Tony (CO -> wins $50 -> $65)
        new Card('♣', '2'), new Card('♦', '3'), new Card('♠', 'J'),
        new Card('♥', 'Q'),
        new Card('♣', 'K'),
      ];
      return { draw: () => cards.shift()! };
    }
    // Hand 2 (rotates BTN=Reginald($15), SB=Buck($15), BB=Elon($15), UTG=Tony($65), CO=You($490)):
    //   Pre-flop (mergeRng=0.20): Tony (0.25) calls $10, You call $10, Reginald (0.996) raises all-in to $15,
    //   Buck (0.163) folds ($5), Elon (0.163) folds ($10), Tony calls $5 ($15), You call $5 ($15).
    //   Flop (mergeRng=0.90): Tony checks, You bet $20, Tony folds ($15), $20 refunded to You ($15).
    //   Showdown tie on A♠ 10♦ 8♣ 6♥ 4♠ between You (K♣ Q♦) and Reginald (K♦ Q♥) for a $60 pot!
    const cards = [
      new Card('♣', 'K'), new Card('♦', 'Q'), // Player (CO) -> ties A-K-Q-10-8
      new Card('♦', 'K'), new Card('♥', 'Q'), // Seat 1: Reginald (BTN, $15) -> raises all-in $15, ties!
      new Card('♣', '2'), new Card('♦', '3'), // Seat 2: Buck (SB, $15) -> folds $5
      new Card('♥', '2'), new Card('♣', '3'), // Seat 3: Elon (BB, $15) -> folds $10
      new Card('♦', '2'), new Card('♠', '5'), // Seat 4: Tony (UTG, $65) -> calls $15 pre-flop, folds Flop
      new Card('♠', 'A'), new Card('♦', '10'), new Card('♣', '8'), // Flop
      new Card('♥', '6'), // Turn
      new Card('♠', '4'), // River
    ];
    return { draw: () => cards.shift()! };
  };

  const mergeEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 25,
    initialButtonSeatIndex: 0,
    random: () => mergeRng,
    deckFactory: makeMergedPotDeck,
  });
  mergeEngine.act('select_opponents:reginald,buck,elon,tony');
  mergeEngine.act('hard'); // Hand 1: BTN=You
  mergeEngine.act('call');
  mergeEngine.act('check');
  mergeEngine.act('check');
  const mh1 = mergeEngine.act('check');
  assert.equal(mh1.opponents.find((o) => o.id === 'tony')!.chips, 65);
  assert.equal(mh1.opponents.find((o) => o.id === 'reginald')!.chips, 15);
  assert.equal(mh1.playerChips, 490);

  // Hand 2 pre-flop: Tony calls $10, You call $10 -> Reginald raises all-in to $15 -> Buck ($5) & Elon ($10) fold -> Tony calls $15 -> prompts You for $5
  mergeRng = 0.2;
  mergeEngine.act('yes');
  const afterRegRaise = mergeEngine.act('call');
  assert.equal(afterRegRaise.stage, 'player_response');
  assert.equal(afterRegRaise.currentBet, 5);
  // Enter Flop with mergeRng=0.90 so Tony folds to our $20 Flop bet
  mergeRng = 0.9;
  const flopState = mergeEngine.act('call');
  assert.equal(flopState.streetName, 'Flop');
  assert.equal(flopState.pot, 60);
  const mh2 = mergeEngine.act('bet'); // Tony folds ($15), $20 uncalled refunded to You -> Turn/River runout -> $60 tie!
  assert.equal(mh2.stage, 'hand_over');
  assert.equal(mh2.pot, 60);
  assert.equal(mh2.outcome?.result, 'tie');
  const regH2 = mh2.opponents.find((o) => o.id === 'reginald')!;
  assert.equal(regH2.totalPotWon, 30, 'Tied $60 pot must pay BTN exactly $30 (not $29)');
  assert.equal(mh2.playerTotalPotWon, 30, 'Tied $60 pot must pay CO exactly $30 (not $31)');
  assert.equal(regH2.chips, 30);
  assert.equal(mh2.playerChips, 505); // 490 - 15 + 30 = 505

  // 2. Sole remaining funded seat facing two $5 all-in blinds after funded UTG & CO fold:
  //    Must be quoted Call $5 (not Call $10) in both prompt and action handler, with zero uncalled refund!
  let shortCallHandIdx = 0;
  let shortCallRng = 0.99;
  const makeSoleFundedDeck = () => {
    shortCallHandIdx += 1;
    if (shortCallHandIdx === 1) {
      // Hand 1 (initialButtonSeatIndex=4 -> BTN=Tony, SB=You($500), BB=Reginald($15), UTG=Buck($15), CO=Elon($15)):
      //   Buck (4♠ 8♣, 0.50) calls $10; Elon (2♣ 5♦, 0.25) folds ($15 left); Tony (2♥ 5♣, 0.25) folds ($15 left);
      //   You (SB, A♠ A♥) call $5; Reginald (BB, 4♦ 8♠, 0.50) checks -> check down -> You win $30!
      //   End stacks: You=$520, Reginald=$5, Buck=$5, Elon=$15, Tony=$15.
      const cards = [
        new Card('♠', 'A'), new Card('♥', 'A'), // Player (SB -> wins $30 -> $520)
        new Card('♦', '4'), new Card('♠', '8'), // Seat 1: Reginald (BB -> ends $5)
        new Card('♠', '4'), new Card('♣', '8'), // Seat 2: Buck (UTG -> ends $5)
        new Card('♣', '2'), new Card('♦', '5'), // Seat 3: Elon (CO -> folds -> $15)
        new Card('♥', '2'), new Card('♣', '5'), // Seat 4: Tony (BTN -> folds -> $15)
        new Card('♣', '3'), new Card('♦', '7'), new Card('♠', 'J'),
        new Card('♥', '9'),
        new Card('♣', 'K'),
      ];
      return { draw: () => cards.shift()! };
    }
    // Hand 2 (rotates BTN=You($520), SB=Reginald($5 all-in), BB=Buck($5 all-in), UTG=Elon($15), CO=Tony($15)):
    //   Start has 3 funded seats -> bring-in begins at $10; Elon & Tony both fold -> You are sole funded seat!
    const cards = [
      new Card('♠', 'K'), new Card('♥', 'K'), // Player (BTN, $520 -> wins $15 pot)
      new Card('♦', '4'), new Card('♠', '8'), // Seat 1: Reginald (SB $5 all-in)
      new Card('♠', '4'), new Card('♣', '8'), // Seat 2: Buck (BB $5 all-in)
      new Card('♣', '2'), new Card('♦', '5'), // Seat 3: Elon (UTG $15 -> folds!)
      new Card('♥', '2'), new Card('♣', '5'), // Seat 4: Tony (CO $15 -> folds!)
      new Card('♣', '3'), new Card('♦', '7'), new Card('♠', 'J'),
      new Card('♥', '9'),
      new Card('♣', 'Q'),
    ];
    return { draw: () => cards.shift()! };
  };

  const soleEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 15,
    initialButtonSeatIndex: 4,
    random: () => shortCallRng,
    deckFactory: makeSoleFundedDeck,
  });
  soleEngine.act('select_opponents:reginald,buck,elon,tony');
  soleEngine.act('hard'); // Hand 1: SB=You
  soleEngine.act('call'); // Pre-flop $5
  soleEngine.act('check'); // Flop
  soleEngine.act('check'); // Turn
  const sh1 = soleEngine.act('check'); // River -> You win $30
  assert.equal(sh1.opponents.find((o) => o.id === 'reginald')!.chips, 5);
  assert.equal(sh1.opponents.find((o) => o.id === 'buck')!.chips, 5);
  assert.equal(sh1.opponents.find((o) => o.id === 'elon')!.chips, 15);
  assert.equal(sh1.opponents.find((o) => o.id === 'tony')!.chips, 15);

  const sh2Prompt = soleEngine.act('yes'); // Hand 2: SB & BB post $5 all-in; Elon & Tony fold -> prompts BTN (You)
  assert.equal(sh2Prompt.playerPosition, 'BTN');
  assert.equal(sh2Prompt.stage, 'player_response');
  assert.equal(sh2Prompt.currentBet, 5, 'Effective call must drop from $10 to $5 when player is sole funded seat');
  assert.equal(sh2Prompt.prompt?.choices.find((c) => c.id === 'call')?.label, 'Call $5');
  assert.equal(sh2Prompt.prompt?.choices.find((c) => c.id === 'bet'), undefined, 'No raise option when no other funded seat remains');
  assert.match(sh2Prompt.dealerSpeech, /\$5 to call/);

  const sh2End = soleEngine.act('call');
  assert.equal(sh2End.stage, 'hand_over');
  assert.equal(sh2End.playerHandContribution, 5, 'Action handler must wager $5, not $10');
  assert.equal(sh2End.pot, 15);
  assert.equal(sh2End.playerChips, 530); // 520 - 5 + 15
  assert.ok(
    !sh2End.narrative.slice(-8).some((entry) => entry.text.includes('Uncalled bet')),
    'No uncalled excess should be wagered or refunded when calling $5',
  );
});

test('PokerGameEngine reports main- and side-pot awards separately and emits mixed result when player wins side pot only', () => {
  const runTwoPotFixture = (playerWinsMain: boolean) => {
    let handIdx = 0;
    const deckFactory = () => {
      handIdx += 1;
      if (handIdx === 1) {
        // Hand 1 (initialButtonSeatIndex=0, oppChips=25): everyone calls $10 and checks down -> Tony wins $50 -> Tony=$65, Reg/Buck/Elon=$15, You=$490.
        const cards = [
          new Card('♠', '3'), new Card('♥', '7'), // Player
          new Card('♦', 'J'), new Card('♥', '8'), // Seat 1: Reginald ($15)
          new Card('♣', '10'), new Card('♦', '4'), // Seat 2: Buck ($15)
          new Card('♥', '10'), new Card('♣', '5'), // Seat 3: Elon ($15)
          new Card('♠', 'A'), new Card('♥', 'A'), // Seat 4: Tony ($65)
          new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'),
          new Card('♣', 'Q'),
          new Card('♥', '4'),
        ];
        return { draw: () => cards.shift()! };
      }
      // Hand 2 (BTN=Reginald($15), SB=Buck($15), BB=Elon($15), UTG=Tony($65), CO=You($490)):
      //   Pre-flop: all 5 put in $10. Flop: You bet $20 -> Reg/Buck/Elon call $5 all-in ($15 each), Tony calls $20 ($30).
      //   Main pot = $75 (all 5 eligible); Side pot = $30 (You & Tony eligible). Total pot = $105.
      const cards = [
        ...(playerWinsMain
          ? [new Card('♠', 'A'), new Card('♥', 'A')] // Player wins BOTH main ($75) & side ($30)
          : [new Card('♠', 'K'), new Card('♥', 'K')]), // Player wins SIDE pot ($30) only
        ...(playerWinsMain
          ? [new Card('♠', 'K'), new Card('♥', 'K')] // Seat 1: Reginald (short $15)
          : [new Card('♠', 'A'), new Card('♥', 'A')]), // Seat 1: Reginald wins MAIN pot ($75)!
        new Card('♣', '7'), new Card('♦', '8'), // Seat 2: Buck ($15)
        new Card('♥', '7'), new Card('♠', '8'), // Seat 3: Elon ($15)
        new Card('♠', 'Q'), new Card('♥', 'Q'), // Seat 4: Tony ($65 -> loses side pot to Player!)
        new Card('♣', '2'), new Card('♦', '4'), new Card('♠', '6'),
        new Card('♣', '9'),
        new Card('♥', 'J'),
      ];
      return { draw: () => cards.shift()! };
    };

    const engine = new PokerGameEngine({
      initialPlayerChips: 500,
      initialOpponentChips: 25,
      initialButtonSeatIndex: 0,
      random: () => 0.5, // easy mode: always call/check
      deckFactory,
    });
    engine.act('select_opponents:reginald,buck,elon,tony');
    engine.act('easy');
    engine.act('call');
    engine.act('check');
    engine.act('check');
    engine.act('check'); // End Hand 1

    engine.act('yes'); // Start Hand 2
    engine.act('call'); // Pre-flop $10 -> Flop
    engine.act('bet'); // Flop $20 -> creates $75 main pot + $30 side pot -> Turn
    engine.act('check'); // Turn -> River
    return engine.act('check'); // River -> Showdown
  };

  // A. Player wins BOTH $75 main pot and $30 side pot ($105 total):
  const sweep = runTwoPotFixture(true);
  assert.equal(sweep.outcome?.result, 'win');
  assert.equal(sweep.outcome?.pot, 105);
  assert.equal(sweep.outcome?.playerPayout, 105);
  assert.deepEqual(sweep.outcome?.pots, [
    { label: 'Main pot', amount: 75, winners: [{ id: 'player', name: 'You', amount: 75 }] },
    { label: 'Side pot', amount: 30, winners: [{ id: 'player', name: 'You', amount: 30 }] },
  ]);
  assert.match(sweep.outcome?.message ?? '', /Main pot \(\$75\): You; Side pot \(\$30\): You/);
  assert.doesNotMatch(sweep.outcome?.message ?? '', /\$105 \(main pot\)/);
  assert.doesNotMatch(sweep.dealerSpeech, /Side pots: You won \$105/);

  // B. Short-stack Reginald wins $75 main pot while Player wins $30 side pot:
  const mixed = runTwoPotFixture(false);
  assert.equal(mixed.outcome?.result, 'mixed', 'Winning a side pot while another seat wins main pot must report mixed, not loss');
  assert.equal(mixed.outcome?.pot, 105);
  assert.equal(mixed.outcome?.playerPayout, 30);
  assert.deepEqual(mixed.outcome?.pots, [
    { label: 'Main pot', amount: 75, winners: [{ id: 'reginald', name: 'Lord Reginald', amount: 75 }] },
    { label: 'Side pot', amount: 30, winners: [{ id: 'player', name: 'You', amount: 30 }] },
  ]);
  assert.match(mixed.outcome?.message ?? '', /Mixed result \(you won \$30\): Main pot \(\$75\): Lord Reginald; Side pot \(\$30\): You/);
  assert.match(mixed.dealerSpeech, /Main pot \(\$75\): Lord Reginald; Side pot \(\$30\): You/);
  const mixedLog = mixed.narrative[mixed.narrative.length - 1]?.text ?? '';
  assert.equal(mixedLog.match(/Lord Reginald:/g)?.length, 1, 'Opponent rank list must appear once in side-pot-win log');

  // C. Short-stack Player ($5) wins $25 main pot while Reginald wins $80 side pot -> rank list appears ONCE in log:
  const shortPlayerDeck = () => {
    const cards = [
      new Card('♠', 'A'), new Card('♥', 'A'), // Player ($5 all-in -> wins $25 main pot)
      new Card('♠', 'K'), new Card('♥', 'K'), // Seat 1: Reginald ($500 -> wins side pot)
      new Card('♣', '7'), new Card('♦', '8'), // Seat 2: Buck ($500)
      new Card('♥', '7'), new Card('♠', '8'), // Seat 3: Elon ($500)
      new Card('♠', 'Q'), new Card('♥', 'Q'), // Seat 4: Tony ($500)
      new Card('♣', '2'), new Card('♦', '4'), new Card('♠', '6'),
      new Card('♣', '9'),
      new Card('♥', 'J'),
    ];
    return { draw: () => cards.shift()! };
  };
  const shortPlayerEngine = new PokerGameEngine({
    initialPlayerChips: 5,
    initialOpponentChips: 500,
    initialButtonSeatIndex: 0,
    random: () => 0.5,
    deckFactory: shortPlayerDeck,
  });
  shortPlayerEngine.act('select_opponents:reginald,buck,elon,tony');
  shortPlayerEngine.act('easy');
  const mainOnlyMixed = shortPlayerEngine.act('call'); // Player calls $5 all-in -> opponents build side pot -> Showdown
  assert.equal(mainOnlyMixed.outcome?.result, 'mixed');
  assert.equal(mainOnlyMixed.outcome?.playerPayout, 25);
  const mainMixedLog = mainOnlyMixed.narrative[mainOnlyMixed.narrative.length - 1]?.text ?? '';
  assert.equal(
    mainMixedLog.match(/Lord Reginald:/g)?.length,
    1,
    'Opponent rank list must appear once (not twice) when player wins main pot and opponent wins side pot',
  );
  assert.equal(mainOnlyMixed.dealerSpeech, mainMixedLog);
});

test('PokerGameEngine reveals folded opponents’ cards and reveals all players’ cards when player folds and hand ends', () => {
  const engine = new PokerGameEngine({ random: () => 0.5 });
  engine.act('select_opponents:reginald,buck,elon,tony');
  const startState = engine.act('medium');
  // Active (non-folded) opponents keep cards strictly hidden during play
  for (const opp of startState.opponents) {
    if (!opp.folded) {
      assert.equal(opp.cardsHidden, true);
      assert.equal(opp.cards[0]?.str, '??');
    } else {
      assert.equal(opp.cardsHidden, false);
      assert.notEqual(opp.cards[0]?.str, '??');
    }
  }

  // Player folds -> hand plays out to a winner and reveals all players' cards!
  const state = engine.act('fold');
  assert.equal(state.stage, 'hand_over');
  assert.equal(state.outcome?.result, 'fold');
  assert.equal(state.opponentCardsHidden, false);
  for (const opp of state.opponents) {
    assert.equal(opp.cardsHidden, false);
    assert.notEqual(opp.cards[0]?.str, '??');
  }
  assert.equal(state.board.length, 5);
});

test('PokerGameEngine plays multi-opponent hand through to showdown revealing folded and showdown hands', () => {
  const engine = new PokerGameEngine();
  engine.act('hard');

  let state = engine.getState();
  let maxSteps = 20;

  while (state.stage !== 'hand_over' && maxSteps > 0) {
    // During play, non-folded opponents MUST remain hidden while folded opponents ARE revealed!
    for (const opp of state.opponents) {
      if (opp.folded) {
        assert.equal(opp.cardsHidden, false);
        assert.notEqual(opp.cards[0]?.str, '??');
      } else {
        assert.equal(opp.cardsHidden, true);
        assert.equal(opp.cards[0]?.str, '??');
      }
    }
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
  assert.equal(state.opponentCardsHidden, false);
  for (const opp of state.opponents) {
    assert.equal(opp.cardsHidden, false);
    assert.notEqual(opp.cards[0]?.str, '??');
  }
  // Outcome message and prompt clearly explain the result
  assert.ok(state.outcome.message.length > 0);
  assert.ok(state.prompt?.message.includes(state.outcome.message));
});

test('PokerGameEngine resets and re-hides active opponents’ cards on subsequent hand', () => {
  const engine = new PokerGameEngine({ random: () => 0.5 });
  engine.act('hard');
  let state = engine.getState();
  while (state.stage !== 'hand_over') {
    if (state.stage === 'player_action') state = engine.act('check');
    else if (state.stage === 'player_response') state = engine.act('call');
    else break;
  }

  const nextHandState = engine.act('yes'); // Play Again (Hand #2: You rotate from BTN -> CO)
  assert.ok(
    nextHandState.stage === 'player_action' || nextHandState.stage === 'player_response',
    `Expected active player prompt, got ${nextHandState.stage}`,
  );
  assert.equal(nextHandState.streetName, 'Pre-flop');
  assert.equal(nextHandState.playerPosition, 'CO');
  assert.equal(nextHandState.handCount, 2);
  for (const opp of nextHandState.opponents) {
    if (opp.folded) {
      assert.equal(opp.cardsHidden, false);
    } else {
      assert.equal(opp.cardsHidden, true);
      assert.equal(opp.cards[0]?.str, '??');
    }
  }
});

test('PokerGameEngine emits sequential turnEvents with thinking and decision speeches for each active opponent', () => {
  // Deterministic RNG (0.5 -> opponents call/check, no pre-flop raise) so You as BTN can raise to $20 and trigger all 4 opponents clockwise!
  const engine = new PokerGameEngine({ random: () => 0.5 });
  engine.act('select_opponents:reginald,buck,elon,tony');
  const startState = engine.act('easy');
  // UTG (elon) and CO (tony) acted ahead of BTN (You)
  assert.deepEqual(
    startState.turnEvents.map((e) => e.opponentId),
    ['elon', 'tony'],
  );

  const raiseState = engine.act('bet'); // Raise to $20 -> re-queues all 4 opponents clockwise [reginald, buck, elon, tony]!
  const preFlopEvents = raiseState.turnEvents.filter((e) => e.streetName === 'Pre-flop');
  assert.equal(preFlopEvents.length, 4);
  assert.deepEqual(
    preFlopEvents.map((e) => e.opponentId),
    ['reginald', 'buck', 'elon', 'tony'],
  );
  for (const event of preFlopEvents) {
    assert.ok(event.thinkingSpeech.length > 0);
    assert.ok(event.decisionSpeech.length > 0);
    assert.ok(event.actionBadge.length > 0);
    assert.ok(['call', 'fold'].includes(event.action));
  }

  // Subsequent fold should clear turnEvents
  if (raiseState.stage === 'player_action' || raiseState.stage === 'player_response') {
    const foldState = engine.act('fold');
    assert.equal(foldState.turnEvents.length, 0);
  }

  // Shuffling a new table seats 4 unique opponents from the 8-character pool
  const newTableState = engine.act('new_table');
  assert.equal(newTableState.opponents.length, 4);
  assert.equal(new Set(newTableState.opponents.map((o) => o.id)).size, 4);

  // Verify per-opponent handContribution & totalPotWon tracking and bubble clearing on new street/hand
  const potCheckEngine = new PokerGameEngine({ random: () => 0.5 });
  potCheckEngine.act('select_opponents:reginald,buck,elon,tony');
  potCheckEngine.act('easy');
  const afterCall = potCheckEngine.act('call');
  assert.equal(afterCall.playerHandContribution, 10);
  const totalOppInPot = afterCall.opponents.reduce((sum, o) => sum + o.handContribution, 0);
  assert.equal(totalOppInPot + afterCall.playerHandContribution, afterCall.pot);
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
  // Use smallBlind/bigBlind = 0 here to reproduce the exact $5 opening all-in -> $25 main + $360 side pot scenario,
  // with player starting at UTG (initialButtonSeatIndex: 2) so player acts first pre-flop!
  const sidePotEngine = new PokerGameEngine({
    initialPlayerChips: 5,
    initialOpponentChips: 500,
    initialButtonSeatIndex: 2,
    smallBlind: 0,
    bigBlind: 0,
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
    initialButtonSeatIndex: 2,
    smallBlind: 0,
    bigBlind: 0,
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

  // 1a. With $0 blinds, all 4 opponents fold to opening $10 bet -> uncalled $10 returned, $0 won, handsWon=1
  const foldOutEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 500,
    initialButtonSeatIndex: 2,
    smallBlind: 0,
    bigBlind: 0,
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

  // 1b. With real $5/$10 blinds, player raises to $20 and everyone folds -> $10 uncalled excess returned,
  //     player wins ONLY the $15 blinds ($515 stack, $25 contested pot = $10 matched + $15 blinds, NOT $35!)
  const blindFoldEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 500,
    initialButtonSeatIndex: 2, // You = UTG
    random: () => 0.05,
    deckFactory: makeDeterministicDeck,
  });
  blindFoldEngine.act('select_opponents:reginald,buck,elon,tony');
  blindFoldEngine.act('easy');
  const wonBlinds = blindFoldEngine.act('bet'); // Raise to $20 -> everyone folds!
  assert.equal(wonBlinds.stage, 'hand_over');
  assert.equal(wonBlinds.playerChips, 515); // +$15 net from SB ($5) + BB ($10)
  assert.equal(wonBlinds.playerTotalPotWon, 25); // Matched $10 + $10 BB + $5 SB (uncalled $10 excess excluded!)
  assert.equal(wonBlinds.playerHandsWon, 1);

  // 2. Check down all four streets ($0 pot) with strongest hand -> playerHandsWon must increment!
  const checkDownEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 500,
    initialButtonSeatIndex: 2,
    smallBlind: 0,
    bigBlind: 0,
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
  // Use $0 blinds here for clean deterministic $65 vs $15 stack setup across Hand 1 -> Hand 2.
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
    initialButtonSeatIndex: 2,
    smallBlind: 0,
    bigBlind: 0,
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
  // Start with You = UTG (initialButtonSeatIndex: 2, smallBlind/bigBlind = 0):
  // Player folds Pre-flop -> Seat 1 bets $10 and Seats 2, 3, 4 all fold -> hand ends immediately on Pre-flop!
  const uncontestedEngine = new PokerGameEngine({
    initialButtonSeatIndex: 2,
    smallBlind: 0,
    bigBlind: 0,
    random: () => 0.05,
  });
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
  // With $5/$10 blinds: Pre-flop raises to $20 (4 x $20 = $80) + Flop ($80) + Turn ($120) + River ($160) = $440 pot!
  const multiwayEngine = new PokerGameEngine({ initialButtonSeatIndex: 2, random: () => 0.35 });
  multiwayEngine.act('select_opponents:reginald,buck,elon,tony');
  multiwayEngine.act('easy');
  const foldedMultiway = multiwayEngine.act('fold');
  assert.equal(foldedMultiway.stage, 'hand_over');
  assert.equal(foldedMultiway.board.length, 5);
  assert.equal(foldedMultiway.pot, 440);
  // Once the hand finishes after player folds, all opponents' cards are revealed so the player sees the winner's hand
  for (const opp of foldedMultiway.opponents) {
    assert.equal(opp.cardsHidden, false);
    assert.notEqual(opp.cards[0]?.str, '??');
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

test('PokerGameEngine labels and logs big-blind pre-flop raises as raises while keeping post-flop opening bets as bets', () => {
  // 1. Player in BB pre-flop with toCall === 0 after limps: button reads "Raise to $20 (+$10)", log says "You raise to $20 (+$10)."
  const bbEngine = new PokerGameEngine({
    initialButtonSeatIndex: 3, // BTN=elon, SB=tony, BB=You, UTG=reginald, CO=buck
    random: () => 0.5, // opponents limp/check/call
  });
  bbEngine.act('select_opponents:reginald,buck,elon,tony');
  const bbPrompt = bbEngine.act('easy');
  assert.equal(bbPrompt.playerPosition, 'BB');
  assert.equal(bbPrompt.stage, 'player_action');
  assert.equal(bbPrompt.playerHandContribution, 10);
  assert.equal(bbPrompt.currentBet, 10);
  assert.equal(bbPrompt.prompt?.choices.find((c) => c.id === 'check')?.label, 'Check');
  assert.equal(bbPrompt.prompt?.choices.find((c) => c.id === 'bet')?.label, 'Raise to $20 (+$10)');
  assert.equal(bbPrompt.prompt?.choices.find((c) => c.id === 'fold')?.label, 'Fold');

  const afterBbRaise = bbEngine.act('bet');
  assert.ok(
    afterBbRaise.narrative.some((e) => e.speaker === 'You' && e.text === 'You raise to $20 (+$10).'),
    'BB pre-flop raise must log "You raise to $20 (+$10)."',
  );
  assert.ok(
    !afterBbRaise.narrative.some((e) => e.speaker === 'You' && e.text === 'You bet $10.'),
    'BB pre-flop raise must not log "You bet $10."',
  );
  const preFlopResponses = afterBbRaise.turnEvents.filter((e) => e.streetName === 'Pre-flop');
  assert.equal(preFlopResponses.length, 4);
  for (const ev of preFlopResponses) {
    assert.equal(ev.action, 'call');
    assert.equal(ev.amount, 10, `Each opponent should face $10 more after BB raises to $20, saw $${ev.amount}`);
  }
  assert.equal(afterBbRaise.streetName, 'Flop');
  assert.equal(afterBbRaise.playerHandContribution, 20);
  assert.equal(afterBbRaise.pot, 100);

  // 2. Normal post-flop opening bet (currentStreetHighBet === 0) must still read "Bet $20" and log "You bet $20."
  assert.equal(afterBbRaise.stage, 'player_action');
  assert.equal(afterBbRaise.prompt?.choices.find((c) => c.id === 'bet')?.label, 'Bet $20');
  const afterFlopBet = bbEngine.act('bet');
  assert.ok(
    afterFlopBet.narrative.some((e) => e.speaker === 'You' && e.text === 'You bet $20.'),
    'Normal post-flop opening bet must still log "You bet $20."',
  );

  // 3. Short-stacked BB ($15 starting stack -> posts $10 BB, $5 left): button reads "All-in to $15 (+$5)"
  const shortBbAllInEngine = new PokerGameEngine({
    initialPlayerChips: 15,
    initialOpponentChips: 500,
    initialButtonSeatIndex: 3, // You = BB
    random: () => 0.5,
  });
  shortBbAllInEngine.act('select_opponents:reginald,buck,elon,tony');
  const shortPrompt = shortBbAllInEngine.act('easy');
  assert.equal(shortPrompt.playerPosition, 'BB');
  assert.equal(shortPrompt.stage, 'player_action');
  assert.equal(shortPrompt.playerChips, 5);
  assert.equal(shortPrompt.prompt?.choices.find((c) => c.id === 'bet')?.label, 'All-in to $15 (+$5)');

  const afterShortRaise = shortBbAllInEngine.act('raise');
  assert.ok(
    afterShortRaise.narrative.some((e) => e.speaker === 'You' && e.text === 'You raise all-in to $15 (+$5).'),
    'Short-stack BB all-in raise must log raise all-in to $15 (+$5)',
  );
  const shortPreFlopCalls = afterShortRaise.turnEvents.filter((e) => e.streetName === 'Pre-flop');
  assert.equal(shortPreFlopCalls.length, 4);
  for (const ev of shortPreFlopCalls) {
    assert.equal(ev.action, 'call');
    assert.equal(ev.amount, 5);
  }

  // 4. AI opponent in BB pre-flop (toCall === 0 && currentStreetHighBet === 10) raising logs "Raises to $20." & badge "Raises to $20"
  const makeAiBbRaiseDeck = () => {
    const cards = [
      new Card('♠', 'K'), new Card('♥', 'Q'), // Player (BTN)
      new Card('♣', '4'), new Card('♦', '8'), // Seat 1: Reginald (SB -> calls $5, never raises)
      new Card('♠', 'A'), new Card('♥', 'A'), // Seat 2: Buck (BB -> raises to $20!)
      new Card('♥', '4'), new Card('♣', '8'), // Seat 3: Elon (UTG -> limps $10)
      new Card('♠', '4'), new Card('♥', '8'), // Seat 4: Tony (CO -> limps $10)
      new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'),
      new Card('♣', 'J'),
      new Card('♥', '3'),
    ];
    return { draw: () => cards.shift()! };
  };
  const aiBbEngine = new PokerGameEngine({
    initialButtonSeatIndex: 0, // BTN=You, SB=reginald, BB=buck, UTG=elon, CO=tony
    random: () => 0.5,
    deckFactory: makeAiBbRaiseDeck,
  });
  aiBbEngine.act('select_opponents:reginald,buck,elon,tony');
  const beforeBtnCall = aiBbEngine.act('hard');
  assert.equal(beforeBtnCall.playerPosition, 'BTN');
  assert.equal(beforeBtnCall.stage, 'player_response');

  const afterBtnCall = aiBbEngine.act('call');
  const buckOpp = afterBtnCall.opponents.find((o) => o.id === 'buck')!;
  const buckRaiseEvent = afterBtnCall.turnEvents.find((e) => e.opponentId === 'buck' && e.streetName === 'Pre-flop');
  assert.ok(buckRaiseEvent, 'Expected pre-flop turnEvent for BB (Buck)');
  assert.equal(buckRaiseEvent.action, 'bet');
  assert.equal(buckRaiseEvent.actionBadge, 'Raises to $20');
  assert.equal(buckOpp.lastAction, 'Raises to $20');
  assert.ok(
    afterBtnCall.narrative.some((e) => e.speaker === 'Buck' && e.text === 'Raises to $20.'),
    'AI BB pre-flop raise must log "Raises to $20." instead of "Bets $10."',
  );
  assert.ok(
    !afterBtnCall.narrative.some((e) => e.speaker === 'Buck' && e.text === 'Bets $10.'),
    'AI BB pre-flop raise must not log "Bets $10."',
  );
  assert.equal(afterBtnCall.stage, 'player_response');
  assert.equal(afterBtnCall.currentBet, 10, 'Player (BTN) must face $10 more after AI BB raises to $20');
  assert.equal(afterBtnCall.prompt?.choices.find((c) => c.id === 'call')?.label, 'Call $10');
});

test('PokerGameEngine produces full Cash Out sessionSummary with hands played, final stack, rebuy credits, and net gain/loss', () => {
  // 1. Multi-hand session without rebuys (e.g. 4 hands ending with an $820 stack -> +$320 net gain):
  const makeWinningDeck = () => {
    const cards = [
      new Card('♠', 'A'), new Card('♥', 'A'), // Player: Pair of Aces
      new Card('♠', 'K'), new Card('♥', 'K'), // Seat 1
      new Card('♠', 'Q'), new Card('♥', 'Q'), // Seat 2
      new Card('♠', 'J'), new Card('♥', 'J'), // Seat 3
      new Card('♠', '10'), new Card('♥', '10'), // Seat 4
      new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'), // Flop
      new Card('♣', '4'), // Turn
      new Card('♥', '7'), // River
    ];
    return { draw: () => cards.shift()! };
  };

  const fourHandEngine = new PokerGameEngine({
    initialPlayerChips: 500,
    initialOpponentChips: 500,
    initialButtonSeatIndex: 0,
    random: () => 0.5, // Easy mode: opponents always call/check
    deckFactory: makeWinningDeck,
  });
  fourHandEngine.act('select_opponents:reginald,buck,elon,tony');
  fourHandEngine.act('easy');

  // Hand 1: Player bets/raises all 4 streets ($20 pre-flop + $20 flop + $30 turn + $40 river = $110 x 5 = $550 pot -> +$440 net = $940)
  // Wait: to hit an exact $820 stack after 4 hands (+$320 net = +$80 per hand = $20 total wager per seat x 4 opponents):
  // On each hand, everyone puts in $20 pre-flop (or $10 pre-flop + $10) -> let's check:
  // If Player calls $10 pre-flop and bets $20 on Flop, then checks Turn and River:
  // Total per seat = $30 ($150 pot, player nets +$120).
  // Across 4 hands:
  //   Hand 1: call $10 pre-flop, bet $20 flop, check turn, check river -> +$120 ($620)
  //   Hand 2: call $10 pre-flop, bet $20 flop, check turn, check river -> +$120 ($740)
  //   Hand 3: call $10 pre-flop, check flop, check turn, check river -> +$40 ($780)
  //   Hand 4: call $10 pre-flop, check flop, check turn, check river -> +$40 ($820)!
  for (let h = 1; h <= 4; h += 1) {
    let s = fourHandEngine.getState();
    // Pre-flop: call (or check if BB on Hand 4)
    s = fourHandEngine.act(s.stage === 'player_response' ? 'call' : 'check');
    // Flop: bet $20 on Hands 1 & 2, check on Hands 3 & 4
    if (h <= 2) {
      s = fourHandEngine.act('bet');
    } else {
      s = fourHandEngine.act('check');
    }
    // Turn: check
    s = fourHandEngine.act('check');
    // River: check
    s = fourHandEngine.act('check');
    assert.equal(s.stage, 'hand_over');
    if (h < 4) {
      fourHandEngine.act('yes');
    }
  }

  const cashOutState = fourHandEngine.act('no');
  assert.equal(cashOutState.stage, 'game_over');
  assert.equal(cashOutState.playerChips, 820);
  assert.deepEqual(cashOutState.sessionSummary, {
    handsPlayed: 4,
    handsWon: 4,
    startingStack: 500,
    finalStack: 820,
    rebuyCount: 0,
    rebuyChips: 0,
    totalBuyIn: 500,
    netProfit: 320,
  });
  assert.equal(
    cashOutState.prompt?.message,
    'Session complete! Hands: 4 • Final Stack: $820 • Rebuys: 0 ($0) • Net: +$320.',
  );
  assert.match(cashOutState.dealerSpeech, /Hands: 4 • Final Stack: \$820 • Rebuys: 0 \(\$0\) • Net: \+\$320/);
  assert.match(
    cashOutState.narrative[cashOutState.narrative.length - 1]?.text ?? '',
    /Hands: 4 • Final Stack: \$820 • Rebuys: 0 \(\$0\) • Net: \+\$320/,
  );

  // 2. Session WITH a $500 house rebuy after busting:
  //    Player starts with $10, loses all $10 on Hand 1 ($0 stack), clicks Play Again ('yes') -> granted $500 house rebuy!
  //    On Hand 2, player wins a $50 pot (calls $10 pre-flop, checks down -> $540 final stack).
  //    Even though finalStack ($540) > startingStack ($10), totalBuyIn is $10 + $500 = $510 -> netProfit is +$30 (NOT +$530!).
  //    And if player folds Hand 2 after posting $0 (BTN) and cashes out with $500 after starting with $500 + 1 rebuy ($500) = $1000 totalBuyIn -> netProfit is -$500!
  let rebuyHand = 0;
  const makeRebuyDeck = () => {
    rebuyHand += 1;
    if (rebuyHand === 1) {
      // Hand 1: Player loses $10 all-in to Reginald's Aces
      const cards = [
        new Card('♠', '3'), new Card('♥', '7'), // Player (loses)
        new Card('♠', 'A'), new Card('♥', 'A'), // Seat 1: Reginald (wins)
        new Card('♦', 'J'), new Card('♥', '8'),
        new Card('♦', '10'), new Card('♦', '3'),
        new Card('♠', 'J'), new Card('♣', '5'),
        new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'),
        new Card('♣', 'Q'),
        new Card('♥', '4'),
      ];
      return { draw: () => cards.shift()! };
    }
    return makeWinningDeck();
  };

  const rebuyEngine = new PokerGameEngine({
    initialPlayerChips: 10,
    initialOpponentChips: 500,
    initialButtonSeatIndex: 0,
    random: () => 0.5,
    deckFactory: makeRebuyDeck,
  });
  rebuyEngine.act('select_opponents:reginald,buck,elon,tony');
  rebuyEngine.act('easy');
  const bustedHand1 = rebuyEngine.act('call'); // Player calls $10 all-in -> loses at showdown -> $0 chips
  assert.equal(bustedHand1.stage, 'hand_over');
  assert.equal(bustedHand1.playerChips, 0);
  assert.equal(bustedHand1.sessionSummary.rebuyCount, 0);

  // Clicking Play Again grants a $500 house rebuy (rebuyCount = 1, rebuyChips = 500, totalBuyIn = 510)
  const afterRebuyStart = rebuyEngine.act('yes');
  assert.equal(afterRebuyStart.sessionSummary.rebuyCount, 1);
  assert.equal(afterRebuyStart.sessionSummary.rebuyChips, 500);
  assert.equal(afterRebuyStart.sessionSummary.totalBuyIn, 510);

  // Player folds Hand 2 (as CO, $0 posted) with $500 stack and cashes out:
  // Final stack = $500, Total Buy-In = $510 ($10 initial + $500 rebuy) -> Net = -$10!
  rebuyEngine.act('fold');
  const rebuyCashOut = rebuyEngine.act('no');
  assert.equal(rebuyCashOut.stage, 'game_over');
  assert.deepEqual(rebuyCashOut.sessionSummary, {
    handsPlayed: 2,
    handsWon: 0,
    startingStack: 10,
    finalStack: 500,
    rebuyCount: 1,
    rebuyChips: 500,
    totalBuyIn: 510,
    netProfit: -10,
  });
  assert.equal(
    rebuyCashOut.prompt?.message,
    'Session complete! Hands: 2 • Final Stack: $500 • Rebuys: 1 ($500) • Net: -$10.',
  );

  // Restart resets rebuyCount, rebuyChips, handsPlayed, and netProfit back to 0
  const afterRestart = rebuyEngine.act('restart');
  assert.deepEqual(afterRestart.sessionSummary, {
    handsPlayed: 0,
    handsWon: 0,
    startingStack: 10,
    finalStack: 10,
    rebuyCount: 0,
    rebuyChips: 0,
    totalBuyIn: 10,
    netProfit: 0,
  });
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
  assert.ok(actState.stage === 'player_action' || actState.stage === 'player_response');
  assert.equal(actState.playerPosition, 'BTN');

  // 3. GET / (index.html) with frame-ancestors CSP
  const htmlRes = await simulateRequest(handler, { method: 'GET', url: '/' });
  assert.equal(htmlRes.statusCode, 200);
  assert.equal(htmlRes.headers['content-security-policy'], "frame-ancestors 'none'");
  assert.ok(htmlRes.body.includes("High Roller Hold'em"));
  assert.ok(htmlRes.body.includes('Vincent'));
  assert.ok(htmlRes.body.includes('seat-far-left'));
  assert.ok(htmlRes.body.includes('opponent-modal-overlay'));
  assert.ok(htmlRes.body.includes('pots-window'));
  // Collapsible panels have proper initial ARIA & inert attributes (#history-drawer starts closed)
  assert.match(htmlRes.body, /id="pots-toggle-btn"[^>]*aria-controls="pots-window"[^>]*aria-expanded="true"/);
  assert.match(htmlRes.body, /id="pots-window"[^>]*aria-hidden="false"/);
  assert.doesNotMatch(htmlRes.body, /<aside[^>]*id="pots-window"[^>]*\binert\b/);
  assert.match(htmlRes.body, /id="log-toggle-btn"[^>]*aria-controls="history-drawer"[^>]*aria-expanded="false"/);
  assert.match(htmlRes.body, /id="history-drawer"[^>]*aria-hidden="true"[^>]*\binert\b/);

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
  assert.match(cssRes.body, /\.pots-window\s*\{[^}]*visibility:\s*hidden;/s);
  assert.match(cssRes.body, /\.pots-window\.open\s*\{[^}]*visibility:\s*visible;/s);
  assert.match(cssRes.body, /\.history-drawer\s*\{[^}]*visibility:\s*hidden;/s);
  assert.match(cssRes.body, /\.history-drawer\.open\s*\{[^}]*visibility:\s*visible;/s);
  assert.match(
    cssRes.body,
    /@media\s*\(max-height:\s*600px\)\s*\{[\s\S]*?\.casino-painting\s*\{[\s\S]*?display:\s*none;/,
    'Short landscape media query must hide .casino-painting to prevent overlap with overhead seat UI',
  );
  assert.match(
    cssRes.body,
    /\.pov-perspective-container\s*\{[\s\S]*?z-index:\s*5;/,
    '.pov-perspective-container must stack above .wall-bg and .ceiling decor',
  );
  assert.ok(cssRes.body.includes('.pots-player-cell'));
  assert.ok(cssRes.body.includes('.pots-player-label'));
  assert.ok(cssRes.body.includes('.pots-pos-pill'));
  assert.match(cssRes.body, /\.pots-pos-pill\s*\{[^}]*flex-shrink:\s*0;/s);
  assert.match(cssRes.body, /\.pots-player-label\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
  assert.ok(cssRes.body.includes('min(350px, calc(100vw - 16px))'));

  // 5. GET /game.js
  const jsRes = await simulateRequest(handler, { method: 'GET', url: '/game.js' });
  assert.equal(jsRes.statusCode, 200);
  assert.ok(jsRes.body.includes('SoundFX'));
  assert.ok(jsRes.body.includes('CHARACTER_ART'));
  assert.ok(jsRes.body.includes('pots-player-cell'));
  assert.ok(jsRes.body.includes('pots-player-label'));
  assert.ok(jsRes.body.includes('pots-pos-pill'));
  assert.ok(jsRes.body.includes('reginald'));
  assert.ok(jsRes.body.includes('buck'));
  assert.ok(jsRes.body.includes('bruce'));
  assert.ok(jsRes.body.includes('elon'));
  assert.ok(jsRes.body.includes('viktor'));
  assert.ok(jsRes.body.includes('meiling'));
  assert.ok(jsRes.body.includes('tony'));
  assert.ok(jsRes.body.includes('tariq'));
});

test('GUI card renderer exposes accessible rank+suit names, hides mirrored glyphs, and labels card backs', async () => {
  const engine = new PokerGameEngine();
  const handler = createPokerRequestHandler(engine);
  const jsRes = await simulateRequest(handler, { method: 'GET', url: '/game.js' });
  assert.equal(jsRes.statusCode, 200);

  // Every face-down card back in game.js must route through renderCardBackHTML (no bare unlabelled card-back markup)
  assert.equal(
    jsRes.body.includes('<div class="card card-back"><div class="card-back-pattern"></div></div>'),
    false,
    'game.js must not emit bare unlabelled .card-back markup',
  );

  interface CardA11yHelpers {
    formatAccessibleCardName: (card: CardData | null | undefined) => string;
    renderSuitHTML: (suit: string) => string;
    renderCardBackHTML: () => string;
    renderCardHTML: (card: CardData | null | undefined) => string;
  }

  const sandbox: { __POKER_CARD_A11Y__?: CardA11yHelpers } = {};
  vm.runInNewContext(jsRes.body, sandbox);
  const helpers = sandbox.__POKER_CARD_A11Y__;
  assert.ok(helpers, 'game.js must expose __POKER_CARD_A11Y__ helpers');

  // Rank & suit accessible name mapping across all face cards, numeric cards, and all 4 suits
  assert.equal(helpers.formatAccessibleCardName(cardToData(new Card('♦', '10'))), '10 of Diamonds');
  assert.equal(helpers.formatAccessibleCardName(cardToData(new Card('♦', '4'))), '4 of Diamonds');
  assert.equal(helpers.formatAccessibleCardName(cardToData(new Card('♠', 'A'))), 'Ace of Spades');
  assert.equal(helpers.formatAccessibleCardName(cardToData(new Card('♥', 'K'))), 'King of Hearts');
  assert.equal(helpers.formatAccessibleCardName(cardToData(new Card('♣', 'Q'))), 'Queen of Clubs');
  assert.equal(helpers.formatAccessibleCardName(cardToData(new Card('♦', 'J'))), 'Jack of Diamonds');
  assert.equal(helpers.formatAccessibleCardName(null), 'Face-down card');
  assert.equal(helpers.formatAccessibleCardName(undefined), 'Face-down card');
  assert.equal(
    helpers.formatAccessibleCardName({ suit: '♠', value: '2', numeric: 0, color: 'black', str: '??' }),
    'Face-down card',
  );

  // Face-up diamond card: single accessible name on .card, mirrored indices + SVGs hidden from assistive tech
  const tenOfDiamondsHTML = helpers.renderCardHTML(cardToData(new Card('♦', '10')));
  assert.match(tenOfDiamondsHTML, /class="card red flipping" role="img" aria-label="10 of Diamonds"/);
  assert.match(tenOfDiamondsHTML, /class="card-top-idx" aria-hidden="true"/);
  assert.match(tenOfDiamondsHTML, /class="card-center-suit" aria-hidden="true"/);
  assert.match(tenOfDiamondsHTML, /class="card-bottom-idx" aria-hidden="true"/);
  assert.equal((tenOfDiamondsHTML.match(/class="card-val" aria-hidden="true"/g) || []).length, 2);
  assert.equal((tenOfDiamondsHTML.match(/class="card-suit" aria-hidden="true"/g) || []).length, 2);
  assert.equal((tenOfDiamondsHTML.match(/class="suit-icon-svg diamond-svg"[^>]*aria-hidden="true"/g) || []).length, 3);

  // Face-up non-diamond card
  const aceOfSpadesHTML = helpers.renderCardHTML(cardToData(new Card('♠', 'A')));
  assert.match(aceOfSpadesHTML, /class="card black flipping" role="img" aria-label="Ace of Spades"/);

  // Face-down card backs (direct helper, null card, and masked '??' card)
  for (const backHTML of [
    helpers.renderCardBackHTML(),
    helpers.renderCardHTML(null),
    helpers.renderCardHTML({ suit: '♠', value: '2', numeric: 0, color: 'black', str: '??' }),
  ]) {
    assert.match(backHTML, /class="card card-back" role="img" aria-label="Face-down card"/);
    assert.match(backHTML, /class="card-back-pattern" aria-hidden="true"/);
  }
});
