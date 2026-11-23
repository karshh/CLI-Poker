import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Card, Deck, type CardValue, type Suit } from '../src/card.js';
import {
  compareHands,
  evaluateHand,
  explainEqualCategoryWin,
  findBestFiveCards,
  type HandName,
} from '../src/poker.js';
import { promptChoice } from '../src/game.js';
import { decideAction, MODES } from '../src/strategy.js';

function card(value: CardValue, suit: Suit): Card {
  return new Card(suit, value);
}

test('deck contains 52 unique cards and draws down to empty', () => {
  const deck = new Deck();
  assert.equal(deck.cardsRemaining(), 52);
  assert.equal(new Set(Array.from({ length: 52 }, () => deck.draw().toString())).size, 52);
  assert.throws(() => deck.draw(), /empty deck/);
  assert.equal(deck.cardsRemaining(), 0);
});

test('recognizes every hand category', () => {
  const examples: ReadonlyArray<{ readonly cards: readonly Card[]; readonly expected: HandName }> = [
    { cards: [card('A', '♠'), card('J', '♥'), card('8', '♦'), card('5', '♣'), card('2', '♠')], expected: 'High card' },
    { cards: [card('A', '♠'), card('A', '♥'), card('8', '♦'), card('5', '♣'), card('2', '♠')], expected: 'One pair' },
    { cards: [card('A', '♠'), card('A', '♥'), card('8', '♦'), card('8', '♣'), card('2', '♠')], expected: 'Two pair' },
    { cards: [card('A', '♠'), card('A', '♥'), card('A', '♦'), card('5', '♣'), card('2', '♠')], expected: 'Three of a kind' },
    { cards: [card('9', '♠'), card('8', '♥'), card('7', '♦'), card('6', '♣'), card('5', '♠')], expected: 'Straight' },
    { cards: [card('A', '♠'), card('J', '♠'), card('8', '♠'), card('5', '♠'), card('2', '♠')], expected: 'Flush' },
    { cards: [card('A', '♠'), card('A', '♥'), card('A', '♦'), card('5', '♣'), card('5', '♠')], expected: 'Full house' },
    { cards: [card('A', '♠'), card('A', '♥'), card('A', '♦'), card('A', '♣'), card('2', '♠')], expected: 'Four of a kind' },
    { cards: [card('9', '♠'), card('8', '♠'), card('7', '♠'), card('6', '♠'), card('5', '♠')], expected: 'Straight flush' },
  ];

  for (const example of examples) assert.equal(evaluateHand(example.cards).name, example.expected);
});

test('handles the ace-low wheel and compares kickers', () => {
  const wheel = [card('A', '♠'), card('2', '♥'), card('3', '♦'), card('4', '♣'), card('5', '♠')];
  assert.equal(evaluateHand(wheel).tiebreak[0], 5);
  const pairWithAce = [card('K', '♠'), card('K', '♥'), card('A', '♦'), card('8', '♣'), card('2', '♠')];
  const pairWithQueen = [card('K', '♦'), card('K', '♣'), card('Q', '♦'), card('8', '♥'), card('2', '♦')];
  assert.ok(compareHands(pairWithAce, pairWithQueen) > 0);
});

test('evaluates the best five of seven cards', () => {
  const seven = [
    card('A', '♠'), card('K', '♠'), card('Q', '♠'), card('J', '♠'), card('10', '♠'), card('2', '♦'), card('3', '♣'),
  ];
  assert.equal(evaluateHand(seven).name, 'Straight flush');
});

test('difficulty modes return legal actions', () => {
  assert.deepEqual(MODES, ['easy', 'medium', 'hard']);
  const machineCards = [card('A', '♠'), card('K', '♠')] as const;
  for (const mode of MODES) {
    assert.ok(['fold', 'call'].includes(decideAction(mode, machineCards, [], true, () => 0.5)));
    assert.ok(['check', 'bet'].includes(decideAction(mode, machineCards, [], false, () => 0.5)));
  }
  assert.throws(() => decideAction('expert', machineCards, [], false), /Unknown mode/);
});

test('opponent strategy receives only its cards and visible community cards', () => {
  const strategyParameters = Function.prototype.toString.call(decideAction);
  assert.equal(decideAction.length, 4);
  assert.match(strategyParameters, /decideAction\(mode, machineCards, communityCards, facingBet/);
  assert.doesNotMatch(strategyParameters, /playerCards|userCards|opponentCards/);
});

test('promptChoice rejects invalid input and repeats until a valid answer', async () => {
  const answers = ['maybe', 'HARD'];
  const messages: string[] = [];
  const result = await promptChoice({
    ask: async () => answers.shift() ?? '',
    print: (message) => messages.push(message),
  }, 'mode: ', ['easy', 'medium', 'hard'] as const);

  assert.equal(result, 'hard');
  assert.deepEqual(messages, ['Please enter one of: easy, medium, hard.']);
});

test('explainEqualCategoryWin explains deciding rank or kicker across all hand categories', () => {
  // 0. High card: top card vs kicker
  const aceHighQueen = evaluateHand([card('A', '♠'), card('Q', '♥'), card('9', '♦'), card('6', '♣'), card('2', '♠')]);
  const kingHigh = evaluateHand([card('K', '♠'), card('Q', '♦'), card('9', '♣'), card('6', '♥'), card('2', '♦')]);
  const aceHighJack = evaluateHand([card('A', '♦'), card('J', '♠'), card('9', '♠'), card('6', '♦'), card('2', '♣')]);
  assert.equal(explainEqualCategoryWin(aceHighQueen, kingHigh), 'Ace-high over King-high');
  assert.equal(explainEqualCategoryWin(aceHighQueen, aceHighJack), 'Ace-high, Queen kicker over Jack kicker');

  // 1. One pair: higher pair vs kicker
  const pairKings = evaluateHand([card('K', '♠'), card('K', '♥'), card('9', '♦'), card('5', '♣'), card('2', '♠')]);
  const pairJacks = evaluateHand([card('J', '♠'), card('J', '♥'), card('A', '♦'), card('5', '♥'), card('2', '♦')]);
  assert.equal(explainEqualCategoryWin(pairKings, pairJacks), 'Pair of Kings over Pair of Jacks');

  const pairAcesKingKicker = evaluateHand([card('A', '♠'), card('A', '♥'), card('K', '♦'), card('7', '♣'), card('3', '♠')]);
  const pairAcesQueenKicker = evaluateHand([card('A', '♦'), card('A', '♣'), card('Q', '♠'), card('7', '♥'), card('3', '♦')]);
  assert.equal(
    explainEqualCategoryWin(pairAcesKingKicker, pairAcesQueenKicker),
    'Pair of Aces, King kicker over Queen kicker',
  );

  // 2. Two pair: top pair, second pair, and kicker
  const acesAndKings = evaluateHand([card('A', '♠'), card('A', '♥'), card('K', '♦'), card('K', '♣'), card('4', '♠')]);
  const acesAndQueens = evaluateHand([card('A', '♦'), card('A', '♣'), card('Q', '♠'), card('Q', '♥'), card('9', '♦')]);
  assert.equal(explainEqualCategoryWin(acesAndKings, acesAndQueens), 'Aces & Kings over Aces & Queens');

  const acesTensKingKicker = evaluateHand([card('A', '♠'), card('A', '♥'), card('10', '♦'), card('10', '♣'), card('K', '♠')]);
  const acesTensJackKicker = evaluateHand([card('A', '♦'), card('A', '♣'), card('10', '♠'), card('10', '♥'), card('J', '♦')]);
  assert.equal(
    explainEqualCategoryWin(acesTensKingKicker, acesTensJackKicker),
    'Aces & 10s, King kicker over Jack kicker',
  );

  // 3. Three of a kind: higher trips vs kicker
  const threeQueens = evaluateHand([card('Q', '♠'), card('Q', '♥'), card('Q', '♦'), card('7', '♣'), card('2', '♠')]);
  const threeNines = evaluateHand([card('9', '♠'), card('9', '♥'), card('9', '♦'), card('A', '♣'), card('K', '♠')]);
  assert.equal(explainEqualCategoryWin(threeQueens, threeNines), 'Three Queens over Three 9s');

  const tripsQueenAceKicker = evaluateHand([card('Q', '♠'), card('Q', '♥'), card('Q', '♦'), card('A', '♣'), card('4', '♠')]);
  const tripsQueenKingKicker = evaluateHand([card('Q', '♣'), card('Q', '♠'), card('Q', '♥'), card('K', '♦'), card('4', '♦')]);
  assert.equal(
    explainEqualCategoryWin(tripsQueenAceKicker, tripsQueenKingKicker),
    'Three Queens, Ace kicker over King kicker',
  );

  // 4 & 8. Straight & Straight flush
  const kingHighStraight = evaluateHand([card('K', '♠'), card('Q', '♥'), card('J', '♦'), card('10', '♣'), card('9', '♠')]);
  const nineHighStraight = evaluateHand([card('9', '♦'), card('8', '♣'), card('7', '♠'), card('6', '♥'), card('5', '♦')]);
  assert.equal(explainEqualCategoryWin(kingHighStraight, nineHighStraight), 'King-high over 9-high');

  const nineHighSf = evaluateHand([card('9', '♠'), card('8', '♠'), card('7', '♠'), card('6', '♠'), card('5', '♠')]);
  const sixHighSf = evaluateHand([card('6', '♥'), card('5', '♥'), card('4', '♥'), card('3', '♥'), card('2', '♥')]);
  assert.equal(explainEqualCategoryWin(nineHighSf, sixHighSf), '9-high over 6-high');

  // 5. Flush: high card vs kicker
  const aceHighFlushQ = evaluateHand([card('A', '♠'), card('Q', '♠'), card('9', '♠'), card('6', '♠'), card('2', '♠')]);
  const kingHighFlush = evaluateHand([card('K', '♥'), card('Q', '♥'), card('9', '♥'), card('6', '♥'), card('2', '♥')]);
  const aceHighFlushJ = evaluateHand([card('A', '♦'), card('J', '♦'), card('9', '♦'), card('6', '♦'), card('2', '♦')]);
  assert.equal(explainEqualCategoryWin(aceHighFlushQ, kingHighFlush), 'Ace-high over King-high');
  assert.equal(explainEqualCategoryWin(aceHighFlushQ, aceHighFlushJ), 'Ace-high, Queen kicker over Jack kicker');

  // 6. Full house: trips rank vs pair rank
  const queensFullOfTwos = evaluateHand([card('Q', '♠'), card('Q', '♥'), card('Q', '♦'), card('2', '♣'), card('2', '♠')]);
  const jacksFullOfAces = evaluateHand([card('J', '♠'), card('J', '♥'), card('J', '♦'), card('A', '♣'), card('A', '♠')]);
  const queensFullOfKings = evaluateHand([card('Q', '♠'), card('Q', '♥'), card('Q', '♣'), card('K', '♦'), card('K', '♠')]);
  const queensFullOfJacks = evaluateHand([card('Q', '♦'), card('Q', '♣'), card('Q', '♠'), card('J', '♥'), card('J', '♦')]);
  assert.equal(explainEqualCategoryWin(queensFullOfTwos, jacksFullOfAces), 'Queens full of 2s over Jacks full of Aces');
  assert.equal(
    explainEqualCategoryWin(queensFullOfKings, queensFullOfJacks),
    'Queens full of Kings over Queens full of Jacks',
  );

  // 7. Four of a kind: quads rank vs kicker
  const fourAcesKing = evaluateHand([card('A', '♠'), card('A', '♥'), card('A', '♦'), card('A', '♣'), card('K', '♠')]);
  const fourKingsAce = evaluateHand([card('K', '♠'), card('K', '♥'), card('K', '♦'), card('K', '♣'), card('A', '♦')]);
  const fourAcesQueen = evaluateHand([card('A', '♠'), card('A', '♥'), card('A', '♦'), card('A', '♣'), card('Q', '♠')]);
  assert.equal(explainEqualCategoryWin(fourAcesKing, fourKingsAce), 'Four Aces over Four Kings');
  assert.equal(explainEqualCategoryWin(fourAcesKing, fourAcesQueen), 'Four Aces, King kicker over Queen kicker');

  // Different categories or ties return null
  assert.equal(explainEqualCategoryWin(fourAcesKing, queensFullOfKings), null);
  assert.equal(explainEqualCategoryWin(pairKings, pairKings), null);
  assert.equal(explainEqualCategoryWin(pairJacks, pairKings), null);
});

test('findBestFiveCards returns the exact 5 cards forming the best hand from 7 cards', () => {
  const pool = [
    card('A', '♠'),
    card('K', '♦'),
    card('A', '♥'),
    card('9', '♣'),
    card('7', '♠'),
    card('3', '♦'),
    card('2', '♣'),
  ];
  const best5 = findBestFiveCards(pool);
  assert.equal(best5.length, 5);
  assert.deepEqual(
    best5.map((c) => c.toString()),
    ['A♠', 'A♥', 'K♦', '9♣', '7♠'],
  );
  assert.deepEqual(evaluateHand(best5), evaluateHand(pool));
});
