const test = require('node:test');
const assert = require('node:assert/strict');
const { Card, Deck } = require('../src/card');
const { compareHands, evaluateHand } = require('../src/poker');
const { MODES, decideAction } = require('../src/strategy');
const { promptChoice } = require('../src/game');

function cards(values) {
  return values.map(([value, suit]) => new Card(suit, value));
}

test('deck contains 52 unique cards and draws down to empty', () => {
  const deck = new Deck();
  assert.equal(deck.cardsRemaining(), 52);
  assert.equal(new Set(deck.cards.map(String)).size, 52);
  for (let index = 0; index < 52; index += 1) assert.ok(deck.draw());
  assert.equal(deck.draw(), undefined);
  assert.equal(deck.cardsRemaining(), 0);
});

test('recognizes every hand category', () => {
  const examples = [
    [['A♠', 'J♥', '8♦', '5♣', '2♠'], 'High card'],
    [['A♠', 'A♥', '8♦', '5♣', '2♠'], 'One pair'],
    [['A♠', 'A♥', '8♦', '8♣', '2♠'], 'Two pair'],
    [['A♠', 'A♥', 'A♦', '5♣', '2♠'], 'Three of a kind'],
    [['9♠', '8♥', '7♦', '6♣', '5♠'], 'Straight'],
    [['A♠', 'J♠', '8♠', '5♠', '2♠'], 'Flush'],
    [['A♠', 'A♥', 'A♦', '5♣', '5♠'], 'Full house'],
    [['A♠', 'A♥', 'A♦', 'A♣', '2♠'], 'Four of a kind'],
    [['9♠', '8♠', '7♠', '6♠', '5♠'], 'Straight flush'],
  ];

  for (const [hand, expected] of examples) {
    assert.equal(evaluateHand(cards(hand.map((card) => [card.slice(0, -1), card.slice(-1)]))).name, expected);
  }
});

test('handles the ace-low wheel and compares kickers', () => {
  const wheel = cards([['A', '♠'], ['2', '♥'], ['3', '♦'], ['4', '♣'], ['5', '♠']]);
  assert.equal(evaluateHand(wheel).tiebreak[0], 5);
  const pairWithAce = cards([['K', '♠'], ['K', '♥'], ['A', '♦'], ['8', '♣'], ['2', '♠']]);
  const pairWithQueen = cards([['K', '♦'], ['K', '♣'], ['Q', '♦'], ['8', '♥'], ['2', '♦']]);
  assert.ok(compareHands(pairWithAce, pairWithQueen) > 0);
});

test('evaluates the best five of seven cards', () => {
  const seven = cards([
    ['A', '♠'], ['K', '♠'], ['Q', '♠'], ['J', '♠'], ['10', '♠'], ['2', '♦'], ['3', '♣'],
  ]);
  assert.equal(evaluateHand(seven).name, 'Straight flush');
});

test('difficulty selection is validated and each mode returns legal actions', () => {
  assert.deepEqual(MODES, ['easy', 'medium', 'hard']);
  for (const mode of MODES) {
    assert.ok(['fold', 'call'].includes(decideAction(mode, cards([['A', '♠'], ['K', '♠']]), [], true, () => 0.5)));
    assert.ok(['check', 'bet'].includes(decideAction(mode, cards([['A', '♠'], ['K', '♠']]), [], false, () => 0.5)));
  }
  assert.throws(() => decideAction('expert', [], [], false), /Unknown mode/);
});

test('opponent strategy accepts only its own cards and the visible board', () => {
  const strategyParameters = Function.prototype.toString.call(decideAction);
  assert.equal(decideAction.length, 4);
  assert.match(strategyParameters, /machineCards, communityCards/);
  assert.doesNotMatch(strategyParameters, /playerCards|userCards|opponentCards/);
  assert.deepEqual(decideAction('hard', cards([['A', '♠'], ['K', '♠']]), [], false, () => 0), 'bet');
});

test('promptChoice rejects invalid input and repeats until a valid answer', async () => {
  const answers = ['maybe', 'HARD'];
  const messages = [];
  const result = await promptChoice({
    ask: async () => answers.shift(),
    print: (message) => messages.push(message),
  }, 'mode: ', ['easy', 'medium', 'hard']);

  assert.equal(result, 'hard');
  assert.deepEqual(messages, ['Please enter one of: easy, medium, hard.']);
});
