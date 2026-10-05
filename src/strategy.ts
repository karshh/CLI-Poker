import type { Card } from './card.js';
import { evaluateHand } from './poker.js';

export const MODES = ['easy', 'medium', 'hard'] as const;
export type Mode = (typeof MODES)[number];
export type OpponentAction = 'fold' | 'call' | 'bet' | 'check';
export type MachineHoleCards = readonly [Card, Card];

function isMode(mode: string): mode is Mode {
  return (MODES as readonly string[]).includes(mode);
}

export function strength(machineCards: MachineHoleCards, communityCards: readonly Card[]): number {
  const values = machineCards.map((card) => card.getNumericValue());
  const firstValue = values[0];
  const secondValue = values[1];
  if (firstValue === undefined || secondValue === undefined) throw new Error('Machine needs two hole cards.');

  const high = Math.max(firstValue, secondValue);
  const gap = Math.abs(firstValue - secondValue);
  let score = (high - 2) / 12;
  if (firstValue === secondValue) score += 0.3;
  if (gap <= 2) score += 0.08;
  if (machineCards[0].suit === machineCards[1].suit) score += 0.07;

  if (communityCards.length >= 3) {
    const rank = evaluateHand([...machineCards, ...communityCards]);
    score += rank.category * 0.13;
    if (rank.category >= 2) score += 0.2;
  }
  return Math.min(score, 1);
}

export function decideAction(
  mode: string,
  machineCards: MachineHoleCards,
  communityCards: readonly Card[],
  facingBet: boolean,
  random: () => number = Math.random,
): OpponentAction {
  if (!isMode(mode)) throw new RangeError(`Unknown mode: ${mode}`);
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
