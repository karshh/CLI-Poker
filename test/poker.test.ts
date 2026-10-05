import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Card, Deck, type CardValue, type Suit } from '../src/card.js';
import { compareHands, evaluateHand, type HandName } from '../src/poker.js';
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
