# CLI Poker

A heads-up Texas Hold’em game against a computer opponent, played in your terminal. Choose Easy, Medium, or Hard, make decisions street by street, and review a short lesson after a loss.

## Requirements

- Node.js 26.10.0 or newer, as pinned in `.nvmrc`.
- npm, included with Node.js.

Install the pinned development tools and build the app:

```sh
npm ci
npm run build
```

Start the game with `npm start` (which builds first), or run `node dist/src/index.js` after building. Run the unit tests with:

```sh
npm test
```

## Docker

Build the image (the build stage installs pinned development tools and runs the tests):

```sh
docker build --pull -t cli-poker .
```

Run the interactive game in a terminal:

```sh
docker run --rm -it cli-poker
```

The final image contains only the compiled app and Node.js runtime, runs as the unprivileged `node` user, and does not expose network ports.

## Playing

This is a simplified, fixed-bet, heads-up Texas Hold’em game. You and the machine receive two private cards; the board is dealt as a three-card flop, one-card turn, and one-card river. The best five-card hand made from your two cards and the board wins. Each street allows at most one fixed bet, so there are no blinds, raises, or side pots.

At launch, choose a difficulty by entering `easy`, `medium`, or `hard`. During each betting decision, enter one of the choices shown in the prompt:

- `check` — continue without betting when no bet is outstanding.
- `bet` — wager the fixed amount displayed for this street.
- `call` — match the machine's outstanding bet.
- `fold` — give up the hand and award the pot to the machine.
- `yes` / `y` or `no` / `n` — choose whether to play another hand.

Invalid answers are rejected and the prompt is repeated. At showdown, both hands and the winning hand category are displayed. If you lose, the game explains the result and suggests a decision to review. When you fold, the completed board is shown as hindsight for learning; those future cards were not information available when you folded.

## Difficulty Modes

- **Easy** — the machine makes more randomized calls and bets.
- **Medium** — the machine considers its hole cards and the strength of its hand against the visible board.
- **Hard** — the machine uses stricter betting and calling thresholds based on the same hand-strength estimate. It is still a simple opponent, not a solver or a human-level poker strategy.

All modes use the same rules and hand rankings. The deck is shuffled with Node's cryptographic random-number generator; the opponent's decisions are intentionally heuristic. The opponent's decision function receives only the machine's own two cards and the community cards visible so far. It is never given or allowed to inspect your private cards when choosing an action; your cards are used only to evaluate the result after a hand ends.

## TypeScript

The TypeScript compiler does not provide a separate LTS release channel. This project pins the current stable compiler (`typescript` 7.0.2) and Node.js type definitions (`@types/node` 26.6.4). The compiler configuration enables strict mode, unchecked-index protection, exact optional properties, explicit module syntax, erasable TypeScript syntax, and additional control-flow and unused-code checks.

## AI Credit

This project was implemented with assistance from the **OpenAI Codex coding agent**. The underlying model name/version is not exposed in the session metadata available for this project, so it cannot be reliably listed here. No other AI models are known to have contributed.
