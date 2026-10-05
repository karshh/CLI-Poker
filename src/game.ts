import { Deck, type Card } from './card.js';
import { compareHands, evaluateHand, type HandRank } from './poker.js';
import { decideAction, MODES, type Mode } from './strategy.js';

const STREETS = [
  { name: 'Pre-flop', bet: 10 },
  { name: 'Flop', bet: 20 },
  { name: 'Turn', bet: 30 },
  { name: 'River', bet: 40 },
] as const;

export interface GameIO {
  ask(prompt: string): Promise<string>;
  print(message: string): void;
}

export interface HandOutcome {
  readonly result: 'win' | 'tie' | 'loss' | 'fold';
  readonly pot: number;
  readonly playerRank: HandRank | null;
  readonly machineRank: HandRank | null;
}

export async function promptChoice<const Choice extends string>(
  io: GameIO,
  prompt: string,
  choices: readonly Choice[],
): Promise<Choice> {
  const accepted = new Set<string>(choices);
  while (true) {
    const answer = (await io.ask(prompt)).trim().toLowerCase();
    if (accepted.has(answer)) return answer as Choice;
    io.print(`Please enter one of: ${choices.join(', ')}.`);
  }
}

export async function chooseMode(io: GameIO): Promise<Mode> {
  return promptChoice(io, 'Choose a difficulty (easy, medium, hard): ', MODES);
}

function showCards(io: GameIO, label: string, cards: readonly Card[]): void {
  io.print(`${label}: ${cards.map(String).join('  ')}`);
}

export async function playHand(io: GameIO, mode: Mode): Promise<HandOutcome> {
  const deck = new Deck();
  const playerCards: [Card, Card] = [deck.draw(), deck.draw()];
  const machineCards: [Card, Card] = [deck.draw(), deck.draw()];
  const board: Card[] = [];
  let pot = 0;

  io.print('\nYour cards:');
  showCards(io, 'Your cards', playerCards);
  io.print(`Opponent difficulty: ${mode}`);

  for (const [streetIndex, street] of STREETS.entries()) {
    if (streetIndex === 1) board.push(deck.draw(), deck.draw(), deck.draw());
    if (streetIndex > 1) board.push(deck.draw());

    io.print(`\n${street.name}${board.length ? ` — board: ${board.map(String).join('  ')}` : ''}`);
    const playerAction = await promptChoice(
      io,
      `Your action (check, bet $${street.bet}, fold): `,
      ['check', 'bet', 'fold'] as const,
    );

    if (playerAction === 'fold') return finishFold(io, deck, playerCards, machineCards, board, pot);

    if (playerAction === 'bet') {
      pot += street.bet;
      const response = decideAction(mode, machineCards, board, true);
      if (response === 'fold') {
        io.print('The machine folds. You win the hand.');
        return { result: 'win', pot, playerRank: null, machineRank: null };
      }
      pot += street.bet;
      io.print(`The machine calls $${street.bet}.`);
      continue;
    }

    const response = decideAction(mode, machineCards, board, false);
    if (response !== 'bet') {
      io.print('The machine checks.');
      continue;
    }

    pot += street.bet;
    io.print(`The machine bets $${street.bet}.`);
    const reply = await promptChoice(io, `Your response (call $${street.bet}, fold): `, ['call', 'fold'] as const);
    if (reply === 'fold') return finishFold(io, deck, playerCards, machineCards, board, pot);
    pot += street.bet;
  }

  return finishShowdown(io, playerCards, machineCards, board, pot);
}

function finishFold(
  io: GameIO,
  deck: Deck,
  playerCards: readonly [Card, Card],
  machineCards: readonly [Card, Card],
  board: Card[],
  pot: number,
): HandOutcome {
  while (board.length < 5) board.push(deck.draw());
  io.print('\nYou folded; the machine wins the pot.');
  io.print('Hindsight only — these remaining community cards were not visible when you folded.');
  showCards(io, 'Your cards', playerCards);
  showCards(io, 'Machine cards', machineCards);
  showCards(io, 'Completed board', board);
  const playerRank = evaluateHand([...playerCards, ...board]);
  const machineRank = evaluateHand([...machineCards, ...board]);
  io.print(`With all cards visible, your best hand was ${playerRank.name}; the machine made ${machineRank.name}.`);
  io.print('Lesson: use this only to review the result, not as proof that folding was wrong—the future cards were unknowable at the time.');
  return { result: 'fold', pot, playerRank, machineRank };
}

function finishShowdown(
  io: GameIO,
  playerCards: readonly [Card, Card],
  machineCards: readonly [Card, Card],
  board: readonly Card[],
  pot: number,
): HandOutcome {
  io.print('\nShowdown');
  showCards(io, 'Your cards', playerCards);
  showCards(io, 'Machine cards', machineCards);
  showCards(io, 'Board', board);
  const playerRank = evaluateHand([...playerCards, ...board]);
  const machineRank = evaluateHand([...machineCards, ...board]);
  const comparison = compareHands([...playerCards, ...board], [...machineCards, ...board]);

  if (comparison > 0) {
    io.print(`You win with ${playerRank.name}! Pot: $${pot}.`);
    return { result: 'win', pot, playerRank, machineRank };
  }
  if (comparison === 0) {
    io.print(`It's a tie: both players have ${playerRank.name}.`);
    return { result: 'tie', pot, playerRank, machineRank };
  }

  io.print(`The machine wins with ${machineRank.name}; your best hand was ${playerRank.name}.`);
  io.print(`Lesson: your ${playerRank.name} lost to ${machineRank.name}. You could consider folding to a bet with a weaker hand; if you called, compare the visible board and the bet size before deciding next time.`);
  return { result: 'loss', pot, playerRank, machineRank };
}

export async function main(io: GameIO): Promise<void> {
  io.print('Welcome to CLI Poker — heads-up Texas Hold’em.');
  const mode = await chooseMode(io);
  io.print(`\nPlaying on ${mode.toUpperCase()} mode.`);

  while (true) {
    await playHand(io, mode);
    const again = await promptChoice(io, '\nPlay another hand? (yes/no): ', ['yes', 'no', 'y', 'n'] as const);
    if (again === 'no' || again === 'n') break;
  }
  io.print('Thanks for playing!');
}
