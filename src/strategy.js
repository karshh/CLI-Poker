const { evaluateHand } = require('./poker');

const MODES = ['easy', 'medium', 'hard'];

function strength(machineCards, communityCards) {
  const values = machineCards.map((card) => card.getNumericValue());
  const high = Math.max(...values);
  const gap = Math.abs(values[0] - values[1]);
  let score = (high - 2) / 12;
  if (values[0] === values[1]) score += 0.3;
  if (gap <= 2) score += 0.08;
  if (machineCards[0].suit === machineCards[1].suit) score += 0.07;

  if (communityCards.length >= 3) {
    const rank = evaluateHand([...machineCards, ...communityCards]);
    score += rank.category * 0.13;
    if (rank.category >= 2) score += 0.2;
  }
  return Math.min(score, 1);
}

function decideAction(mode, machineCards, communityCards, facingBet, random = Math.random) {
  if (!MODES.includes(mode)) throw new RangeError(`Unknown mode: ${mode}`);
  const handStrength = strength(machineCards, communityCards);
  const roll = random();

  if (mode === 'easy') {
    if (facingBet) return roll < 0.25 ? 'fold' : 'call';
    return roll < 0.45 ? 'bet' : 'check';
  }

  const callThreshold = mode === 'hard' ? 0.32 : 0.24;
  const betThreshold = mode === 'hard' ? 0.58 : 0.68;
  if (facingBet) return handStrength < callThreshold && roll > handStrength ? 'fold' : 'call';
  return handStrength > betThreshold && roll < handStrength ? 'bet' : 'check';
}

module.exports = { MODES, decideAction, strength };
