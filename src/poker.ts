import type { Card } from './card.js';

export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type HandName =
  | 'High card'
  | 'One pair'
  | 'Two pair'
  | 'Three of a kind'
  | 'Straight'
  | 'Flush'
  | 'Full house'
  | 'Four of a kind'
  | 'Straight flush';

export interface HandRank {
  readonly category: HandCategory;
  readonly tiebreak: readonly number[];
  readonly name: HandName;
}

const HAND_NAMES: Record<HandCategory, HandName> = {
  0: 'High card',
  1: 'One pair',
  2: 'Two pair',
  3: 'Three of a kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full house',
  7: 'Four of a kind',
  8: 'Straight flush',
};

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];

  const results: T[][] = [];
  for (let index = 0; index <= items.length - size; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    for (const rest of combinations(items.slice(index + 1), size - 1)) {
      results.push([item, ...rest]);
    }
  }
  return results;
}

function findStraight(values: readonly number[]): number {
  const unique = [...new Set(values)].sort((left, right) => right - left);
  if (unique.includes(14)) unique.push(1);

  for (let index = 0; index <= unique.length - 5; index += 1) {
    const high = unique[index];
    const low = unique[index + 4];
    if (high !== undefined && low !== undefined && high - low === 4) return high;
  }
  return 0;
}

function createRank(category: HandCategory, tiebreak: readonly number[]): HandRank {
  return { category, tiebreak, name: HAND_NAMES[category] };
}

function rankFive(cards: readonly Card[]): HandRank {
  const values = cards.map((card) => card.getNumericValue()).sort((left, right) => right - left);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0]);
  const topGroup = groups[0];
  const nextGroup = groups[1];
  const firstCard = cards[0];
  if (topGroup === undefined || nextGroup === undefined || firstCard === undefined) {
    throw new RangeError('A five-card hand is required.');
  }

  const flush = cards.every((card) => card.suit === firstCard.suit);
  const straightHigh = findStraight(values);

  if (flush && straightHigh > 0) return createRank(8, [straightHigh]);
  if (topGroup[1] === 4) return createRank(7, [topGroup[0], nextGroup[0]]);
  if (topGroup[1] === 3 && nextGroup[1] === 2) return createRank(6, [topGroup[0], nextGroup[0]]);
  if (flush) return createRank(5, values);
  if (straightHigh > 0) return createRank(4, [straightHigh]);
  if (topGroup[1] === 3) {
    return createRank(3, [topGroup[0], ...groups.slice(1).map(([value]) => value).sort((left, right) => right - left)]);
  }
  if (topGroup[1] === 2 && nextGroup[1] === 2) {
    const pairs = groups.filter(([, count]) => count === 2).map(([value]) => value).sort((left, right) => right - left);
    const kicker = groups.find(([, count]) => count === 1)?.[0];
    if (kicker === undefined) throw new Error('Two-pair hand is missing its kicker.');
    return createRank(2, [...pairs, kicker]);
  }
  if (topGroup[1] === 2) {
    return createRank(1, [topGroup[0], ...groups.slice(1).map(([value]) => value).sort((left, right) => right - left)]);
  }
  return createRank(0, values);
}

function compareRanks(left: HandRank, right: HandRank): number {
  if (left.category !== right.category) return left.category - right.category;
  for (let index = 0; index < Math.max(left.tiebreak.length, right.tiebreak.length); index += 1) {
    const difference = (left.tiebreak[index] ?? 0) - (right.tiebreak[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function evaluateHand(cards: readonly Card[]): HandRank {
  if (cards.length < 5 || cards.length > 7) throw new RangeError('A poker hand needs five to seven cards.');
  const rankedHands = combinations(cards, 5).map(rankFive).sort((left, right) => compareRanks(right, left));
  const best = rankedHands[0];
  if (best === undefined) throw new Error('Could not evaluate the provided hand.');
  return best;
}

export function compareHands(leftCards: readonly Card[], rightCards: readonly Card[]): number {
  return compareRanks(evaluateHand(leftCards), evaluateHand(rightCards));
}
