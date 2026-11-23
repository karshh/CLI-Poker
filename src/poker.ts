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

export function findBestFiveCards(cards: readonly Card[]): Card[] {
  if (cards.length < 5 || cards.length > 7) throw new RangeError('A poker hand needs five to seven cards.');
  const rankedCombos = combinations(cards, 5)
    .map((combo) => ({ combo, rank: rankFive(combo) }))
    .sort((left, right) => compareRanks(right.rank, left.rank));
  const best = rankedCombos[0];
  if (best === undefined) throw new Error('Could not evaluate the provided hand.');
  return [...best.combo].sort((a, b) => b.getNumericValue() - a.getNumericValue());
}

export function compareHands(leftCards: readonly Card[], rightCards: readonly Card[]): number {
  return compareRanks(evaluateHand(leftCards), evaluateHand(rightCards));
}

const RANK_SINGULAR: Record<number, string> = {
  1: 'Ace',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace',
};

const RANK_PLURAL: Record<number, string> = {
  1: 'Aces',
  2: '2s',
  3: '3s',
  4: '4s',
  5: '5s',
  6: '6s',
  7: '7s',
  8: '8s',
  9: '9s',
  10: '10s',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces',
};

function rankSingular(value: number | undefined): string {
  return (value !== undefined ? RANK_SINGULAR[value] : undefined) ?? String(value ?? '?');
}

function rankPlural(value: number | undefined): string {
  return (value !== undefined ? RANK_PLURAL[value] : undefined) ?? `${String(value ?? '?')}s`;
}

/**
 * When two compared hands share the exact same category and winnerRank beats loserRank,
 * returns a human-readable explanation of the deciding rank or kicker (e.g.,
 * "Pair of Kings over Pair of Jacks" or "Pair of Aces, King kicker over Queen kicker").
 * Returns null if the categories differ or the hands are tied.
 */
export function explainEqualCategoryWin(winnerRank: HandRank, loserRank: HandRank): string | null {
  if (winnerRank.category !== loserRank.category) return null;

  let diffIndex = -1;
  const maxLen = Math.max(winnerRank.tiebreak.length, loserRank.tiebreak.length);
  for (let i = 0; i < maxLen; i += 1) {
    const wVal = winnerRank.tiebreak[i] ?? 0;
    const lVal = loserRank.tiebreak[i] ?? 0;
    if (wVal !== lVal) {
      if (wVal < lVal) return null;
      diffIndex = i;
      break;
    }
  }
  if (diffIndex === -1) return null;

  const wDiff = winnerRank.tiebreak[diffIndex];
  const lDiff = loserRank.tiebreak[diffIndex];

  switch (winnerRank.category) {
    case 1: {
      // One pair: tiebreak = [pairRank, kicker1, kicker2, kicker3]
      if (diffIndex === 0) {
        return `Pair of ${rankPlural(wDiff)} over Pair of ${rankPlural(lDiff)}`;
      }
      return `Pair of ${rankPlural(winnerRank.tiebreak[0])}, ${rankSingular(wDiff)} kicker over ${rankSingular(lDiff)} kicker`;
    }
    case 2: {
      // Two pair: tiebreak = [highPair, lowPair, kicker]
      const wHigh = rankPlural(winnerRank.tiebreak[0]);
      const wLow = rankPlural(winnerRank.tiebreak[1]);
      const lHigh = rankPlural(loserRank.tiebreak[0]);
      const lLow = rankPlural(loserRank.tiebreak[1]);
      if (diffIndex === 0 || diffIndex === 1) {
        return `${wHigh} & ${wLow} over ${lHigh} & ${lLow}`;
      }
      return `${wHigh} & ${wLow}, ${rankSingular(wDiff)} kicker over ${rankSingular(lDiff)} kicker`;
    }
    case 3: {
      // Three of a kind: tiebreak = [tripsRank, kicker1, kicker2]
      if (diffIndex === 0) {
        return `Three ${rankPlural(wDiff)} over Three ${rankPlural(lDiff)}`;
      }
      return `Three ${rankPlural(winnerRank.tiebreak[0])}, ${rankSingular(wDiff)} kicker over ${rankSingular(lDiff)} kicker`;
    }
    case 4:
    case 8: {
      // Straight / Straight flush: tiebreak = [highCard]
      return `${rankSingular(wDiff)}-high over ${rankSingular(lDiff)}-high`;
    }
    case 5:
    case 0: {
      // Flush / High card: tiebreak = [c0, c1, c2, c3, c4]
      if (diffIndex === 0) {
        return `${rankSingular(wDiff)}-high over ${rankSingular(lDiff)}-high`;
      }
      return `${rankSingular(winnerRank.tiebreak[0])}-high, ${rankSingular(wDiff)} kicker over ${rankSingular(lDiff)} kicker`;
    }
    case 6: {
      // Full house: tiebreak = [tripsRank, pairRank]
      const wTrips = rankPlural(winnerRank.tiebreak[0]);
      const wPair = rankPlural(winnerRank.tiebreak[1]);
      const lTrips = rankPlural(loserRank.tiebreak[0]);
      const lPair = rankPlural(loserRank.tiebreak[1]);
      return `${wTrips} full of ${wPair} over ${lTrips} full of ${lPair}`;
    }
    case 7: {
      // Four of a kind: tiebreak = [quadsRank, kicker]
      if (diffIndex === 0) {
        return `Four ${rankPlural(wDiff)} over Four ${rankPlural(lDiff)}`;
      }
      return `Four ${rankPlural(winnerRank.tiebreak[0])}, ${rankSingular(wDiff)} kicker over ${rankSingular(lDiff)} kicker`;
    }
  }
}
