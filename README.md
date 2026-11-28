# High Roller Hold'em

A Texas Hold’em game with both a first-person POV VIP casino browser experience (`npm run gui`) and a classic heads-up terminal CLI mode (`npm start`). Choose Easy, Medium, or Hard, face a cast of illustrated VIP high-roller opponents or play street-by-street in your terminal, and review a short lesson after a CLI loss.

## Requirements

- Node.js 26.13.1 or newer, as pinned in `.nvmrc`.
- npm, included with Node.js.

Install the pinned development tools and build the app:

```sh
npm ci
npm run build
```

Start the CLI game with `npm start` (which builds first), or start the graphical POV video game with:

```sh
npm run gui
```

Run the unit tests with:

```sh
npm test
```

## GUI Video Game (`npm run gui`)

Running `npm run gui` launches a graphical first-person POV (point-of-view) Texas Hold'em video game set in a luxury VIP high-roller casino lounge:

- **First-Person POV**: You are seated at the 5-seat oval poker table looking across the green felt, with your two hole cards in the foreground and crisp vector card suits.
- **Casino Environment**: A warm VIP salon with chandelier lighting, wall sconces, velvet wallpaper, mahogany table rail, and luxury casino chairs seated behind the rail.
- **Dealer (Vincent)**: Seated at center-back of the table managing the chip rack, dealing community cards, and narrating showdown results.
- **8 VIP Opponents (Choose 4 per Table)**: Before starting a game, pick any 4 of 8 distinct illustrated opponents (or deal a random 4) — **Lord Reginald**, **"Big Oil" Buck**, **"Croc" Bruce**, **Elon Musk**, **Comrade Viktor**, **Madame Mei-Ling**, **Don "Big Tony"**, and **Sheikh Tariq** — each with themed chairs, overhead name+stack cards, distinct accents, sequential 1–2 second thinking & decision chat bubbles positioned between card and seat, private cards for active in-hand opponents, immediate card reveals when an opponent folds, and full table reveals at hand end (including after player fold).
- **Rotating 5-Handed Table Positions & Blinds**: Every hand assigns **Dealer Button (`BTN`)**, **Small Blind (`SB`, `$5`)**, **Big Blind (`BB`, `$10`)**, **Under the Gun (`UTG`)**, and **Cutoff (`CO`)** clockwise around the 5 seats—rotating by 1 seat every new hand with a moving physical Dealer Button (`D`) puck, color-coded seat badges, and authentic `UTG`-first pre-flop / `SB`-first post-flop action order.
- **Fixed-Limit Betting Rules**: Unlike No-Limit Hold'em (and unlike the heads-up terminal CLI mode below, which has no blinds, raises, or side pots), the GUI lounge uses fixed-limit betting with `$5`/`$10` blinds, fixed street increments (`$10` Pre-flop, `$20` Flop, `$30` Turn, `$40` River), a cap of **one bet or raise per street**, and all-in side pots when a seat is short-stacked.
- **Hidable Table Pots Window**: Toggleable floating tracker (`P` or `💰 Table Pots`) showing each opponent's current hand contribution, total pots won, and chip stack live as turns unfold.
- **Cinematic HUD**: Bottom panel displays live narrative dialogue, full win/loss hand comparisons, expandable game log, and action buttons.
- **Hotkeys**: `C` (Check/Call), `B` (Bet), `F` (Fold), `1`/`2`/`3` (Difficulty), `R` (Random 4 Opponents), `P` (Toggle Table Pots window), `Space` (Play Again), `M` (Mute/Unmute).
- **Audio**: Built-in procedural Web Audio synthesizer (card whooshes, chip clacks, table knocks, win fanfare).

## Docker

Build the image (the build stage installs pinned development tools and runs the tests):

```sh
docker build --pull -t high-roller-holdem .
```

Run the interactive game in a terminal:

```sh
docker run --rm -it high-roller-holdem
```

The final image contains only the compiled app and Node.js runtime, runs as the unprivileged `node` user, and does not expose network ports.

## Playing (Terminal CLI Mode)

The terminal CLI mode (`npm start`) is a simplified, fixed-bet, heads-up Texas Hold’em game. You and the machine receive two private cards; the board is dealt as a three-card flop, one-card turn, and one-card river. The best five-card hand made from your two cards and the board wins. Unlike the 5-handed GUI mode (which includes `$5`/`$10` blinds, one fixed raise per street, and all-in side pots), each street in terminal mode allows at most one fixed bet (`$10`/`$20`/`$30`/`$40`), with no blinds, raises, or side pots.

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
