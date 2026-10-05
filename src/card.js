const { randomInt } = require('node:crypto');

const SUITS = ['♥', '♦', '♣', '♠'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const NUMERIC_VALUES = Object.fromEntries(VALUES.map((value, index) => [value, index + 2]));

class Card {
  constructor(suit, value) {
    this.suit = suit;
    this.value = value;
  }

  toString() {
    return `${this.value}${this.suit}`;
  }

  getNumericValue() {
    return NUMERIC_VALUES[this.value];
  }
}

class Deck {
  constructor() {
    this.reset();
    this.shuffle();
  }

  reset() {
    this.cards = SUITS.flatMap((suit) => VALUES.map((value) => new Card(suit, value)));
  }

  shuffle() {
    for (let index = this.cards.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      [this.cards[index], this.cards[swapIndex]] = [this.cards[swapIndex], this.cards[index]];
    }
  }

  draw() {
    return this.cards.pop();
  }

  cardsRemaining() {
    return this.cards.length;
  }
}

module.exports = { Card, Deck };
