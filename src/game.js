const { Deck } = require('./card');
const { compareHands, evaluateHand } = require('./poker');
const { MODES, decideAction } = require('./strategy');

const BETS_BY_STREET = [10, 20, 30, 40];
const STREET_NAMES = ['Pre-flop', 'Flop', 'Turn', 'River'];

async function promptChoice(io, prompt, choices) {
  const accepted = new Set(choices);
  while (true) {
    const answer = (await io.ask(prompt)).trim().toLowerCase();
    if (accepted.has(answer)) return answer;
    io.print(`Please enter one of: ${choices.join(', ')}.`);
  }
}

async function chooseMode(io) {
  return promptChoice(io, 'Choose a difficulty (easy, medium, hard): ', MODES);
}

function showCards(io, label, cards) {
  io.print(`${label}: ${cards.map(String).join('  ')}`);
}

async function playHand(io, mode) {
  const deck = new Deck();
  const playerCards = [deck.draw()];
  const machineCards = [deck.draw()];
  playerCards.push(deck.draw());
  machineCards.push(deck.draw());
  const board = [];
  let pot = 0;

  io.print('\nYour cards:');
  showCards(io, 'Your cards', playerCards);
  io.print(`Opponent difficulty: ${mode}`);

  for (let street = 0; street < STREET_NAMES.length; street += 1) {
    if (street === 1) board.push(deck.draw(), deck.draw(), deck.draw());
    if (street > 1) board.push(deck.draw());

    io.print(`\n${STREET_NAMES[street]}${board.length ? ` — board: ${board.map(String).join('  ')}` : ''}`);
    const bet = BETS_BY_STREET[street];
    const playerAction = await promptChoice(
      io,
      `Your action (check, bet $${bet}, fold): `,
      ['check', 'bet', 'fold'],
    );

    if (playerAction === 'fold') {
      return finishFold(io, deck, playerCards, machineCards, board, pot);
    }

    if (playerAction === 'bet') {
      pot += bet;
      const response = decideAction(mode, machineCards, board, true);
      if (response === 'fold') {
        io.print('The machine folds. You win the hand.');
        return { result: 'win', pot };
      }
      pot += bet;
      io.print(`The machine calls $${bet}.`);
      continue;
    }

    const response = decideAction(mode, machineCards, board, false);
    if (response !== 'bet') {
      io.print('The machine checks.');
      continue;
    }

    pot += bet;
    io.print(`The machine bets $${bet}.`);
    const reply = await promptChoice(io, `Your response (call $${bet}, fold): `, ['call', 'fold']);
    if (reply === 'fold') {
      return finishFold(io, deck, playerCards, machineCards, board, pot);
    }
    pot += bet;
  }

  return finishShowdown(io, playerCards, machineCards, board, pot);
}

function finishFold(io, deck, playerCards, machineCards, board, pot) {
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

function finishShowdown(io, playerCards, machineCards, board, pot) {
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

async function main(io) {
  io.print('Welcome to CLI Poker — heads-up Texas Hold’em.');
  const mode = await chooseMode(io);
  io.print(`\nPlaying on ${mode.toUpperCase()} mode.`);

  while (true) {
    await playHand(io, mode);
    const again = await promptChoice(io, '\nPlay another hand? (yes/no): ', ['yes', 'no', 'y', 'n']);
    if (again === 'no' || again === 'n') break;
  }
  io.print('Thanks for playing!');
}

module.exports = { chooseMode, finishFold, finishShowdown, main, playHand, promptChoice };
