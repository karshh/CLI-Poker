const HAND_NAMES = [
  'High card',
  'One pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

function combinations(cards, size) {
  if (size === 0) return [[]];
  if (cards.length < size) return [];

  const results = [];
  for (let index = 0; index <= cards.length - size; index += 1) {
    for (const rest of combinations(cards.slice(index + 1), size - 1)) {
      results.push([cards[index], ...rest]);
    }
  }
  return results;
}

function findStraight(values) {
  const unique = [...new Set(values)].sort((left, right) => right - left);
  if (unique.includes(14)) unique.push(1);

  for (let index = 0; index <= unique.length - 5; index += 1) {
    if (unique[index] - unique[index + 4] === 4) return unique[index];
  }
  return 0;
}

function rankFive(cards) {
  const values = cards.map((card) => card.getNumericValue()).sort((left, right) => right - left);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const groups = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = findStraight(values);

  if (flush && straightHigh) return { category: 8, tiebreak: [straightHigh] };
  if (groups[0][1] === 4) return { category: 7, tiebreak: [groups[0][0], groups[1][0]] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { category: 6, tiebreak: [groups[0][0], groups[1][0]] };
  if (flush) return { category: 5, tiebreak: values };
  if (straightHigh) return { category: 4, tiebreak: [straightHigh] };
  if (groups[0][1] === 3) return { category: 3, tiebreak: [groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)] };
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = groups.filter(([, count]) => count === 2).map(([value]) => value).sort((a, b) => b - a);
    return { category: 2, tiebreak: [...pairs, groups.find(([, count]) => count === 1)[0]] };
  }
  if (groups[0][1] === 2) {
    return { category: 1, tiebreak: [groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)] };
  }
  return { category: 0, tiebreak: values };
}

function compareRanks(left, right) {
  if (left.category !== right.category) return left.category - right.category;
  for (let index = 0; index < Math.max(left.tiebreak.length, right.tiebreak.length); index += 1) {
    const difference = (left.tiebreak[index] || 0) - (right.tiebreak[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function evaluateHand(cards) {
  if (cards.length < 5 || cards.length > 7) throw new RangeError('A poker hand needs five to seven cards.');
  const best = combinations(cards, 5).map(rankFive).sort((left, right) => compareRanks(right, left))[0];
  return { ...best, name: HAND_NAMES[best.category] };
}

function compareHands(leftCards, rightCards) {
  return compareRanks(evaluateHand(leftCards), evaluateHand(rightCards));
}

module.exports = { HAND_NAMES, compareHands, evaluateHand };
