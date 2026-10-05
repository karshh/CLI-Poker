import { randomInt } from 'node:crypto';

export const SUITS = ['♥', '♦', '♣', '♠'] as const;
export type Suit = (typeof SUITS)[number];

export const CARD_VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export type CardValue = (typeof CARD_VALUES)[number];

const NUMERIC_VALUES: Record<CardValue, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export class Card {
  readonly suit: Suit;
  readonly value: CardValue;

  constructor(suit: Suit, value: CardValue) {
    this.suit = suit;
    this.value = value;
  }

  toString(): string {
    return `${this.value}${this.suit}`;
  }

  getNumericValue(): number {
    return NUMERIC_VALUES[this.value];
  }
}

export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
    this.shuffle();
  }

  reset(): void {
    this.cards = SUITS.flatMap((suit) => CARD_VALUES.map((value) => new Card(suit, value)));
  }

  shuffle(): void {
    for (let index = this.cards.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      const currentCard = this.cards[index];
      const swappingCard = this.cards[swapIndex];
      if (currentCard === undefined || swappingCard === undefined) {
        throw new Error('Cannot shuffle an incomplete deck.');
      }
      this.cards[index] = swappingCard;
      this.cards[swapIndex] = currentCard;
    }
  }

  draw(): Card {
    const card = this.cards.pop();
    if (card === undefined) throw new RangeError('Cannot draw from an empty deck.');
    return card;
  }

  cardsRemaining(): number {
    return this.cards.length;
  }
}
