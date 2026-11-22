import { randomUUID } from 'node:crypto';
import { Deck, Card, type Suit, type CardValue } from '../card.js';
import { compareHands, evaluateHand, type HandRank } from '../poker.js';
import { decideAction, type Mode } from '../strategy.js';
import { STREETS } from '../game.js';

export interface CardData {
  suit: Suit;
  value: CardValue;
  numeric: number;
  color: 'red' | 'black';
  str: string;
}

const HIDDEN_CARD_DATA: CardData = {
  suit: '♠',
  value: '2',
  numeric: 0,
  color: 'black',
  str: '??',
};

export function cardToData(card: Card): CardData {
  return {
    suit: card.suit,
    value: card.value,
    numeric: card.getNumericValue(),
    color: card.suit === '♥' || card.suit === '♦' ? 'red' : 'black',
    str: card.toString(),
  };
}

export type GameStage =
  | 'select_opponents'
  | 'select_mode'
  | 'player_action'
  | 'player_response'
  | 'hand_over'
  | 'game_over';

export class StaleStateError extends Error {
  public readonly code = 'STALE_STATE';
  public readonly expectedRevision: number | undefined;
  public readonly currentRevision: number;
  public readonly expectedInstanceId: string | undefined;
  public readonly currentInstanceId: string;

  constructor(
    expectedRevision: number | undefined,
    currentRevision: number,
    expectedInstanceId: string | undefined,
    currentInstanceId: string,
  ) {
    super(
      `Stale action submission (client ${expectedInstanceId ?? 'unknown'}:${expectedRevision ?? '?'}, server ${currentInstanceId}:${currentRevision}). Refreshing table state.`,
    );
    this.name = 'StaleStateError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
    this.expectedInstanceId = expectedInstanceId;
    this.currentInstanceId = currentInstanceId;
  }
}

export interface PromptChoice {
  id: string;
  label: string;
  key: string;
  variant?: 'primary' | 'danger' | 'default';
}

export interface PromptInfo {
  type: GameStage;
  revision: number;
  token: string;
  message: string;
  choices: PromptChoice[];
}

export type OpponentId = 'reginald' | 'buck' | 'bruce' | 'elon' | 'viktor' | 'meiling' | 'tony' | 'tariq';
export type OpponentShortName = 'Reginald' | 'Buck' | 'Bruce' | 'Elon' | 'Viktor' | 'Mei-Ling' | 'Tony' | 'Tariq';
export type SpeakerName = 'Dealer' | 'You' | 'System' | OpponentShortName;

export interface NarrativeEntry {
  speaker: SpeakerName;
  text: string;
}

export type OpponentSeat = 'far-left' | 'top-left' | 'top-right' | 'far-right';
export type OpponentReaction =
  | 'neutral'
  | 'confident'
  | 'thinking'
  | 'nervous'
  | 'celebrating'
  | 'defeated'
  | 'folded';

export interface OpponentSummary {
  id: OpponentId;
  name: string;
  shortName: OpponentShortName;
  title: string;
  emoji: string;
  introLine: string;
}

export interface OpponentData {
  id: OpponentId;
  name: string;
  shortName: OpponentShortName;
  title: string;
  emoji: string;
  seat: OpponentSeat;
  chips: number;
  handContribution: number;
  totalPotWon: number;
  handsWon: number;
  cards: CardData[];
  cardsHidden: boolean;
  folded: boolean;
  lastAction: string | null;
  speech: string;
  reaction: OpponentReaction;
  rank: HandRank | null;
}

export interface TurnEvent {
  opponentId: OpponentId;
  opponentName: string;
  shortName: OpponentShortName;
  streetName: string;
  boardSnapshot: CardData[];
  thinkingSpeech: string;
  action: 'check' | 'bet' | 'call' | 'fold';
  amount?: number;
  decisionSpeech: string;
  actionBadge: string;
  reaction: OpponentReaction;
  folded: boolean;
  chipsAfter: number;
  handContributionAfter: number;
  potAfter: number;
}

export interface SerializedGameState {
  tableInstanceId: string;
  stateRevision: number;
  stateToken: string;
  stage: GameStage;
  mode: Mode | null;
  streetIndex: number;
  streetName: string;
  currentBet: number;
  pot: number;
  turnStartPot: number;
  turnEvents: TurnEvent[];
  playerChips: number;
  playerHandContribution: number;
  playerTotalPotWon: number;
  playerHandsWon: number;
  playerFolded: boolean;
  opponentChips: number;
  playerCards: CardData[];
  opponentCards: CardData[];
  opponentCardsHidden: boolean;
  availableOpponents: OpponentSummary[];
  opponents: OpponentData[];
  board: CardData[];
  dealerSpeech: string;
  opponentSpeech: string;
  opponentReaction: 'neutral' | 'confident' | 'thinking' | 'nervous' | 'celebrating' | 'defeated';
  narrative: NarrativeEntry[];
  prompt: PromptInfo | null;
  playerCurrentRank: string | null;
  outcome: {
    result: 'win' | 'tie' | 'loss' | 'fold';
    pot: number;
    playerRank: HandRank | null;
    opponentRank: HandRank | null;
    winnerNames: string[];
    message: string;
    lesson?: string;
  } | null;
  handCount: number;
  lastAction: {
    actor: 'player' | 'opponent' | 'dealer';
    action: string;
    amount?: number;
  } | null;
}

export interface OpponentProfile {
  id: OpponentId;
  name: string;
  shortName: OpponentShortName;
  title: string;
  emoji: string;
  introLine: string;
  newHandLine: string;
  thinkingLines: readonly string[];
  betLine: (amt: number) => string;
  callLine: (amt: number) => string;
  checkLine: string;
  foldLine: string;
  winLine: string;
  loseLine: string;
  tieLine: string;
}

export const ALL_OPPONENT_PROFILES: readonly OpponentProfile[] = [
  {
    id: 'reginald',
    name: 'Lord Reginald',
    shortName: 'Reginald',
    title: 'ROYAL ARISTOCRAT',
    emoji: '🎩',
    introLine: 'Cheerio! A frightfully splendid evening for cards, wot?',
    newHandLine: 'Fresh hand, Vincent! Do be a dear.',
    thinkingLines: [
      'Good heavens, let me ponder...',
      'Hmm... rather intriguing indeed, wot?',
      'Contemplating over imaginary tea...',
    ],
    betLine: (amt) => `I say! A gentlemanly wager of $${amt}!`,
    callLine: (amt) => `Quite right, I shall match $${amt}, old chap.`,
    checkLine: 'I shall check, old sport.',
    foldLine: 'Balderdash! I bow out most gracefully.',
    winLine: 'Jolly good show! Simply splendid!',
    loseLine: 'Oh, blast! Well played, good fellow.',
    tieLine: 'An honorable draw! Pip pip!',
  },
  {
    id: 'buck',
    name: '"Big Oil" Buck',
    shortName: 'Buck',
    title: 'TEXAN OIL BARON',
    emoji: '🤠',
    introLine: 'Howdy partner! My oil wells printed fresh cash today!',
    newHandLine: 'Deal ’em hot! Let’s strike black gold!',
    thinkingLines: [
      'Hold your horses, fixin’ to think...',
      'Hmm... gusher or dry hole, partner?',
      'Reckon I oughta study these cards...',
    ],
    betLine: (amt) => `Yeehaw! Tossin’ $${amt} right in the pot!`,
    callLine: (amt) => `I’m ridin’ along for $${amt}, partner!`,
    checkLine: 'I’ll just tap the table, partner.',
    foldLine: 'Too rich for my boots! I’m foldin’.',
    winLine: 'YEEHAW! Bigger than a Texas gusher!',
    loseLine: 'Well butter my biscuit, nice hand!',
    tieLine: 'Reckon we’re splittin’ the ranch!',
  },
  {
    id: 'bruce',
    name: '"Croc" Bruce',
    shortName: 'Bruce',
    title: 'OUTBACK LEGEND',
    emoji: '🦘',
    introLine: 'G’day mate! Ready to wrestle some cards?',
    newHandLine: 'Chuck us a couple of rippers, Vincent!',
    thinkingLines: [
      'Crikey, let me have a gander...',
      'Strewth, tough call mate...',
      'Hold on, wrestlin’ with the odds...',
    ],
    betLine: (amt) => `Fair dinkum! Chuckin’ in $${amt}, mate!`,
    callLine: (amt) => `No worries, I’ll match $${amt}!`,
    checkLine: 'Check, mate. No drama.',
    foldLine: 'Yeah nah, I’m bailin’ out mate.',
    winLine: 'Beauty! What a ripper of a pot!',
    loseLine: 'Ah crikey, ya got me good mate!',
    tieLine: 'Fair go! We’ll split it down the middle.',
  },
  {
    id: 'elon',
    name: 'Elon Musk',
    shortName: 'Elon',
    title: 'TECH MOGUL',
    emoji: '🚀',
    introLine: 'Let’s play from first principles. To the moon!',
    newHandLine: 'Interesting. Dealing a new simulation.',
    thinkingLines: [
      'Running Monte Carlo in my head...',
      'Hmm... concerning. Calculating EV...',
      'Thinking from first principles...',
    ],
    betLine: (amt) => `Going $${amt}. High conviction!`,
    callLine: (amt) => `Matching $${amt}. Acceptable risk.`,
    checkLine: 'Check. Waiting for the next update.',
    foldLine: 'Not optimal. Pivoting to Mars. Fold.',
    winLine: 'To the moon! Literally printing chips!',
    loseLine: 'Concerning. Needs a software patch.',
    tieLine: 'Perfectly balanced. Interesting.',
  },
  {
    id: 'viktor',
    name: 'Comrade Viktor',
    shortName: 'Viktor',
    title: 'SOVIET COMRADE',
    emoji: '⭐',
    introLine: 'Greetings, Comrade! Soon it is OUR chips!',
    newHandLine: 'Deal fairly for the Motherland, Vincent!',
    thinkingLines: [
      'Consulting the Five-Year Plan...',
      'Hmm... smells like capitalist bluff...',
      'Analyzing for the Motherland...',
    ],
    betLine: (amt) => `Seizing the means! I bet $${amt}, Comrade!`,
    callLine: (amt) => `Da! I match $${amt} for the people.`,
    checkLine: 'Check. Patience is Soviet virtue.',
    foldLine: 'Tactical retreat! I fold, Comrade.',
    winLine: 'Victory! Now it is OUR pot, Comrade!',
    loseLine: 'Nyet! Capitalist luck strikes again!',
    tieLine: 'Equal redistribution! Very good!',
  },
  {
    id: 'meiling',
    name: 'Madame Mei-Ling',
    shortName: 'Mei-Ling',
    title: 'SHANGHAI TYCOON',
    emoji: '🐉',
    introLine: 'Welcome! May good fortune favor the bold!',
    newHandLine: 'The feng shui feels very auspicious today.',
    thinkingLines: [
      'Hmm... reading the table’s feng shui...',
      'Aiyah, let me think very carefully...',
      'Seeing if good fortune smiles here...',
    ],
    betLine: (amt) => `Small change! I put in $${amt}.`,
    callLine: (amt) => `Naturally, I call $${amt}.`,
    checkLine: 'I check. Patience brings great wealth.',
    foldLine: 'Aiyah, bad luck! I fold this hand.',
    winLine: 'Very auspicious! Fortune favors me!',
    loseLine: 'Hmph! Lucky cards this time.',
    tieLine: 'Harmony at the table! We share.',
  },
  {
    id: 'tony',
    name: 'Don "Big Tony"',
    shortName: 'Tony',
    title: 'NY WISEGUY',
    emoji: '🤌',
    introLine: 'Ey! Fuhgeddaboudit! Sit down, let’s play some cards!',
    newHandLine: 'Deal ’em clean, Vinny! Don’t make me ask twice!',
    thinkingLines: [
      'Ey, lemme think here, capisce?...',
      'Hmm... somethin’ smells fishy, wise guy...',
      'Hold on, I’m weighin’ da vig here...',
    ],
    betLine: (amt) => `I’m makin’ ya an offer ya can’t refuse — $${amt}!`,
    callLine: (amt) => `Ey, $${amt}? Fuhgeddaboudit, I call!`,
    checkLine: 'Check. I’m watchin’ ya, wise guy.',
    foldLine: 'Fuhgeddaboudit! Dis hand’s sleepin’ wit da fishes.',
    winLine: 'Bada bing, bada boom! Da family collects!',
    loseLine: 'Madonna mia! Lucky break, wise guy!',
    tieLine: 'Ey, we split da vig. Fair’s fair, capisce?',
  },
  {
    id: 'tariq',
    name: 'Sheikh Tariq',
    shortName: 'Tariq',
    title: 'GOLDEN SHEIKH',
    emoji: '👑',
    introLine: 'Ahlan, my friend! Pocket change to a billionaire, habibi!',
    newHandLine: 'Deal the cards, Vincent! My golden yacht is waiting!',
    thinkingLines: [
      'Hmm... consulting my palace advisors, habibi...',
      'Wait one moment, checking my gold reserves...',
      'Yalla, let me study these cards, my friend...',
    ],
    betLine: (amt) => `Yalla! $${amt} is mere pocket change, habibi!`,
    callLine: (amt) => `Of course I call $${amt}! Bring out the gold!`,
    checkLine: 'I check, my friend. Patience is royal wisdom.',
    foldLine: 'Mafish mushkila! Keep this tiny pot, habibi. I fold.',
    winLine: 'Mashallah! Another skyscraper for my collection!',
    loseLine: 'Bravo, habibi! Enjoy my spare change!',
    tieLine: 'We share like kings! Magnificent, my friend!',
  },
];

const PROFILE_BY_ID = new Map<OpponentId, OpponentProfile>(
  ALL_OPPONENT_PROFILES.map((p) => [p.id, p]),
);

const TABLE_SEATS: readonly OpponentSeat[] = ['far-left', 'top-left', 'top-right', 'far-right'];

interface InternalOpponent {
  profile: OpponentProfile;
  seat: OpponentSeat;
  chips: number;
  handContribution: number;
  totalPotWon: number;
  handsWon: number;
  cards: [Card, Card] | null;
  cardsHidden: boolean;
  folded: boolean;
  lastAction: string | null;
  speech: string;
  reaction: OpponentReaction;
  rank: HandRank | null;
}

export interface PokerGameEngineOptions {
  initialPlayerChips?: number;
  initialOpponentChips?: number;
  random?: () => number;
  deckFactory?: () => Pick<Deck, 'draw'>;
}

interface SeatLedgerEntry {
  chips: number;
  totalPotWon: number;
  handsWon: number;
}

interface PotSeat {
  id: string;
  name: string;
  isPlayer: boolean;
  contribution: number;
  active: boolean;
  cards: Card[] | null;
  opp?: InternalOpponent;
}

interface PotSliceAward {
  slicePot: number;
  unmatched: boolean;
  winners: PotSeat[];
}

interface PotSettlementSummary {
  payoutById: Map<string, number>;
  unmatchedById: Map<string, number>;
  slices: PotSliceAward[];
  bestOverallWinners: PotSeat[];
}

function pickFourOpponents(random: () => number = Math.random): OpponentProfile[] {
  const pool = [...ALL_OPPONENT_PROFILES];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, 4);
}

export class PokerGameEngine {
  private readonly random: () => number;
  private readonly deckFactory: () => Pick<Deck, 'draw'>;
  private readonly defaultPlayerChips: number;
  private readonly defaultOpponentChips: number;
  private deck: Pick<Deck, 'draw'> = new Deck();
  private readonly tableInstanceId: string = randomUUID();
  private stateRevision = 1;
  private mode: Mode | null = null;
  private stage: GameStage = 'select_opponents';
  private streetIndex = 0;
  private pot = 0;
  private playerChips: number;
  private playerHandContribution = 0;
  private playerTotalPotWon = 0;
  private playerHandsWon = 0;
  private playerFolded = false;
  private playerCards: [Card, Card] | null = null;
  private opponents: InternalOpponent[] = [];
  private opponentLedger = new Map<OpponentId, SeatLedgerEntry>();
  private board: Card[] = [];
  private dealerSpeech = 'Welcome to the VIP High Roller Lounge! Choose 4 opponents to join your table.';
  private narrative: NarrativeEntry[] = [];
  private outcome: SerializedGameState['outcome'] = null;
  private handCount = 0;
  private lastAction: SerializedGameState['lastAction'] = null;
  private currentBettorName: string | null = null;
  private currentStreetWager = 0;
  private turnStartPot = 0;
  private turnEvents: TurnEvent[] = [];

  constructor(options: PokerGameEngineOptions = {}) {
    this.random = options.random ?? Math.random;
    this.deckFactory = options.deckFactory ?? (() => new Deck());
    this.defaultPlayerChips = options.initialPlayerChips ?? 500;
    this.playerChips = this.defaultPlayerChips;
    this.defaultOpponentChips = options.initialOpponentChips ?? 500;
    this.stage = 'select_opponents';
    this.seatOpponents(pickFourOpponents(this.random));
    this.narrative = [
      {
        speaker: 'Dealer',
        text: 'Welcome to VIP Texas Hold’em! Select 4 opponents from the roster to begin.',
      },
    ];
  }

  private saveOpponentsToLedger(): void {
    for (const opp of this.opponents) {
      this.opponentLedger.set(opp.profile.id, {
        chips: opp.chips,
        totalPotWon: opp.totalPotWon,
        handsWon: opp.handsWon,
      });
    }
  }

  private seatOpponents(profiles: readonly OpponentProfile[]): void {
    this.saveOpponentsToLedger();
    this.opponents = profiles.slice(0, 4).map((profile, idx) => {
      const saved = this.opponentLedger.get(profile.id);
      return {
        profile,
        seat: TABLE_SEATS[idx]!,
        chips: saved ? saved.chips : this.defaultOpponentChips,
        handContribution: 0,
        totalPotWon: saved ? saved.totalPotWon : 0,
        handsWon: saved ? saved.handsWon : 0,
        cards: null,
        cardsHidden: true,
        folded: false,
        lastAction: null,
        speech: profile.introLine,
        reaction: 'neutral',
        rank: null,
      };
    });
  }

  private isHandActive(): boolean {
    return this.stage === 'player_action' || this.stage === 'player_response';
  }

  private getPrimaryOpponent(): InternalOpponent {
    return this.opponents[2] ?? this.opponents[0]!;
  }

  private getActiveOpponents(): InternalOpponent[] {
    return this.opponents.filter((opp) => !opp.folded);
  }

  private getLegalPlayerBetAmount(streetBet: number): number {
    return Math.max(0, Math.min(this.playerChips, streetBet));
  }

  private getLegalPlayerCallAmount(): number {
    return Math.max(0, Math.min(this.playerChips, this.currentStreetWager));
  }

  private serializeOpponent(opp: InternalOpponent): OpponentData {
    const cards: CardData[] = opp.cards
      ? opp.cardsHidden
        ? [{ ...HIDDEN_CARD_DATA }, { ...HIDDEN_CARD_DATA }]
        : [cardToData(opp.cards[0]), cardToData(opp.cards[1])]
      : [];

    return {
      id: opp.profile.id,
      name: opp.profile.name,
      shortName: opp.profile.shortName,
      title: opp.profile.title,
      emoji: opp.profile.emoji,
      seat: opp.seat,
      chips: opp.chips,
      handContribution: opp.handContribution,
      totalPotWon: opp.totalPotWon,
      handsWon: opp.handsWon,
      cards,
      cardsHidden: opp.cardsHidden,
      folded: opp.folded,
      lastAction: opp.lastAction,
      speech: opp.speech,
      reaction: opp.reaction,
      rank: opp.cardsHidden ? null : opp.rank,
    };
  }

  public getState(): SerializedGameState {
    let playerCurrentRank: string | null = null;
    if (this.playerCards) {
      const cardsToEval = [...this.playerCards, ...this.board];
      if (cardsToEval.length >= 5) {
        playerCurrentRank = evaluateHand(cardsToEval).name;
      } else if (this.playerCards[0] && this.playerCards[1]) {
        if (this.playerCards[0].value === this.playerCards[1].value) {
          playerCurrentRank = `Pocket Pair of ${this.playerCards[0].value}s`;
        } else {
          playerCurrentRank = `High Card ${
            this.playerCards[0].getNumericValue() > this.playerCards[1].getNumericValue()
              ? this.playerCards[0].value
              : this.playerCards[1].value
          }`;
        }
      }
    }

    const serializedOpponents = this.opponents.map((opp) => this.serializeOpponent(opp));
    const primary = this.getPrimaryOpponent();
    const primarySerialized = this.serializeOpponent(primary);
    const anyRevealed = this.opponents.some((opp) => !opp.cardsHidden);
    const legacyReaction: SerializedGameState['opponentReaction'] =
      primary.reaction === 'folded' ? 'defeated' : primary.reaction;

    const availableOpponents: OpponentSummary[] = ALL_OPPONENT_PROFILES.map((p) => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      title: p.title,
      emoji: p.emoji,
      introLine: p.introLine,
    }));

    const streetBet = STREETS[this.streetIndex]?.bet ?? 0;
    const effectiveCurrentBet =
      this.stage === 'player_response'
        ? this.getLegalPlayerCallAmount()
        : this.stage === 'player_action'
          ? this.getLegalPlayerBetAmount(streetBet)
          : streetBet;

    return {
      tableInstanceId: this.tableInstanceId,
      stateRevision: this.stateRevision,
      stateToken: `${this.tableInstanceId}:${this.stateRevision}`,
      stage: this.stage,
      mode: this.mode,
      streetIndex: this.streetIndex,
      streetName: STREETS[this.streetIndex]?.name ?? 'Showdown',
      currentBet: effectiveCurrentBet,
      pot: this.pot,
      turnStartPot: this.turnStartPot,
      turnEvents: this.turnEvents,
      playerChips: this.playerChips,
      playerHandContribution: this.playerHandContribution,
      playerTotalPotWon: this.playerTotalPotWon,
      playerHandsWon: this.playerHandsWon,
      playerFolded: this.playerFolded,
      opponentChips: primary.chips,
      playerCards: this.playerCards ? [cardToData(this.playerCards[0]), cardToData(this.playerCards[1])] : [],
      opponentCards: primarySerialized.cards,
      opponentCardsHidden: !anyRevealed,
      availableOpponents,
      opponents: serializedOpponents,
      board: this.board.map(cardToData),
      dealerSpeech: this.dealerSpeech,
      opponentSpeech: primary.speech,
      opponentReaction: legacyReaction,
      narrative: this.narrative,
      prompt: this.getPrompt(),
      playerCurrentRank,
      outcome: this.outcome,
      handCount: this.handCount,
      lastAction: this.lastAction,
    };
  }

  private pickThinkingLine(opp: InternalOpponent): string {
    const lines = opp.profile.thinkingLines;
    return lines[Math.floor(this.random() * lines.length)] ?? 'Thinking...';
  }

  private recordTurnEvent(
    opp: InternalOpponent,
    action: TurnEvent['action'],
    amount?: number,
  ): void {
    this.turnEvents.push({
      opponentId: opp.profile.id,
      opponentName: opp.profile.name,
      shortName: opp.profile.shortName,
      streetName: STREETS[this.streetIndex]?.name ?? 'Showdown',
      boardSnapshot: this.board.map(cardToData),
      thinkingSpeech: this.pickThinkingLine(opp),
      action,
      ...(amount !== undefined ? { amount } : {}),
      decisionSpeech: opp.speech,
      actionBadge: opp.lastAction ?? '',
      reaction: opp.reaction,
      folded: opp.folded,
      chipsAfter: opp.chips,
      handContributionAfter: opp.handContribution,
      potAfter: this.pot,
    });
  }

  public act(
    rawAction: string,
    expectedRevision?: number,
    expectedInstanceId?: string,
  ): SerializedGameState {
    if (
      (expectedInstanceId !== undefined && expectedInstanceId !== this.tableInstanceId) ||
      (expectedRevision !== undefined && expectedRevision !== this.stateRevision)
    ) {
      throw new StaleStateError(
        expectedRevision,
        this.stateRevision,
        expectedInstanceId,
        this.tableInstanceId,
      );
    }
    const action = rawAction.trim().toLowerCase();
    this.turnEvents = [];
    this.turnStartPot = this.pot;

    // Restrict opening/changing opponent roster strictly to between hands (never mid-hand or after cash out)
    if (action === 'open_opponent_select') {
      if (this.isHandActive()) {
        throw new Error('Cannot change opponents during an active hand. Finish or fold the current hand first.');
      }
      if (this.stage === 'game_over') {
        throw new Error('Session is over. Send restart to start a new session before selecting opponents.');
      }
      this.stage = 'select_opponents';
      this.dealerSpeech = 'Choose 4 opponents from our VIP roster for your table.';
      this.stateRevision += 1;
      return this.getState();
    }

    if (action.startsWith('select_opponents:')) {
      if (this.isHandActive()) {
        throw new Error('Cannot change opponents during an active hand. Finish or fold the current hand first.');
      }
      if (this.stage === 'game_over') {
        throw new Error('Session is over. Send restart to start a new session before selecting opponents.');
      }
      const idList = action
        .slice('select_opponents:'.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const uniqueIds = [...new Set(idList)];
      if (uniqueIds.length !== 4) {
        throw new Error(`Expected exactly 4 unique opponents, received ${uniqueIds.length}.`);
      }
      const chosenProfiles: OpponentProfile[] = [];
      for (const rawId of uniqueIds) {
        const profile = PROFILE_BY_ID.get(rawId as OpponentId);
        if (!profile) {
          throw new Error(`Unknown opponent id: ${rawId}`);
        }
        chosenProfiles.push(profile);
      }

      this.seatOpponents(chosenProfiles);
      const names = this.opponents.map((o) => o.profile.name).join(', ');
      this.narrative.push({ speaker: 'Dealer', text: `Table seated: ${names}.` });

      if (this.mode) {
        this.startNewHand();
      } else {
        this.stage = 'select_mode';
        this.dealerSpeech = 'Opponents seated! Now select your table difficulty.';
      }
      this.stateRevision += 1;
      return this.getState();
    }

    if (action === 'new_table' || action === 'random_opponents') {
      if (this.isHandActive()) {
        throw new Error('Cannot change opponents during an active hand. Finish or fold the current hand first.');
      }
      if (this.stage === 'game_over') {
        throw new Error('Session is over. Send restart to start a new session before selecting opponents.');
      }
      this.seatOpponents(pickFourOpponents(this.random));
      const names = this.opponents.map((o) => o.profile.name).join(', ');
      this.narrative.push({ speaker: 'Dealer', text: `Random VIP table seated: ${names}.` });
      if (this.mode) {
        this.startNewHand();
      } else {
        this.stage = 'select_mode';
        this.dealerSpeech = 'Random table seated! Now select your table difficulty.';
      }
      this.stateRevision += 1;
      return this.getState();
    }

    if (this.stage === 'select_opponents' || this.stage === 'select_mode') {
      if (action === 'easy' || action === 'medium' || action === 'hard') {
        this.mode = action;
        const names = this.opponents.map((o) => o.profile.name).join(', ');
        this.narrative.push({
          speaker: 'System',
          text: `Difficulty set to ${this.mode.toUpperCase()}. Opponents: ${names}.`,
        });
        this.startNewHand();
        this.stateRevision += 1;
        return this.getState();
      }
      if (this.stage === 'select_opponents') {
        throw new Error(`Expected opponent selection (select_opponents:...) or random_opponents, got: ${action}`);
      }
      throw new Error(`Invalid difficulty: ${action}. Expected easy, medium, or hard.`);
    }

    if (this.stage === 'player_action') {
      const currentStreet = STREETS[this.streetIndex];
      if (!currentStreet || !this.playerCards || !this.mode) {
        throw new Error('Game state corrupted.');
      }

      if (action === 'fold') {
        this.handlePlayerFold(false);
        this.stateRevision += 1;
        return this.getState();
      }

      if (action === 'bet') {
        const betAmt = this.getLegalPlayerBetAmount(currentStreet.bet);
        if (betAmt <= 0) {
          throw new Error('Insufficient chips to bet; please check or fold.');
        }
        const isAllIn = betAmt < currentStreet.bet || this.playerChips - betAmt === 0;
        this.pot += betAmt;
        this.playerChips -= betAmt;
        this.playerHandContribution += betAmt;
        this.currentStreetWager = betAmt;
        this.turnStartPot = this.pot;
        this.lastAction = { actor: 'player', action: 'bet', amount: betAmt };
        this.narrative.push({
          speaker: 'You',
          text: isAllIn ? `You go all-in for $${betAmt}.` : `You bet $${betAmt}.`,
        });

        const callers: string[] = [];
        const folders: string[] = [];

        for (const opp of this.getActiveOpponents()) {
          if (!opp.cards) continue;
          if (opp.chips <= 0) {
            this.checkOpponentAllIn(opp);
            this.recordTurnEvent(opp, 'check');
            continue;
          }
          const decision = decideAction(this.mode, opp.cards, this.board, true, this.random);
          if (decision === 'fold') {
            this.foldOpponent(opp);
            this.recordTurnEvent(opp, 'fold');
            folders.push(opp.profile.shortName);
          } else {
            const paid = this.callOpponent(opp, betAmt);
            this.recordTurnEvent(opp, 'call', paid);
            callers.push(opp.profile.shortName);
          }
        }

        if (this.getActiveOpponents().length === 0) {
          this.handleAllOpponentsFold();
          this.stateRevision += 1;
          return this.getState();
        }

        const summaryParts: string[] = [];
        if (callers.length > 0) summaryParts.push(`${this.formatNameList(callers)} call`);
        if (folders.length > 0) summaryParts.push(`${this.formatNameList(folders)} fold`);
        const summaryText =
          summaryParts.length > 0 ? `${summaryParts.join('; ')}. Pot is $${this.pot}.` : `Pot is $${this.pot}.`;
        this.dealerSpeech = summaryText;
        this.narrative.push({ speaker: 'Dealer', text: summaryText });
        this.lastAction = { actor: 'opponent', action: 'call', amount: betAmt };

        this.advanceStreet();
        this.stateRevision += 1;
        return this.getState();
      }

      if (action === 'check') {
        this.turnStartPot = this.pot;
        this.currentStreetWager = 0;
        this.lastAction = { actor: 'player', action: 'check' };
        this.narrative.push({ speaker: 'You', text: 'You check.' });

        const active = this.getActiveOpponents();
        let bettor: InternalOpponent | null = null;
        let streetWager = 0;
        const checkedBeforeBet: InternalOpponent[] = [];
        const callers: string[] = [];
        const folders: string[] = [];
        const streetBet = currentStreet.bet;

        for (const opp of active) {
          if (!opp.cards) continue;
          if (!bettor) {
            const canBet = opp.chips > 0;
            const decision = canBet ? decideAction(this.mode, opp.cards, this.board, false, this.random) : 'check';
            if (decision === 'bet' && canBet) {
              const actualBet = Math.min(opp.chips, streetBet);
              bettor = opp;
              streetWager = actualBet;
              opp.chips -= actualBet;
              opp.handContribution += actualBet;
              this.pot += actualBet;
              opp.lastAction = actualBet < streetBet ? `All-in $${actualBet}` : `Bets $${actualBet}`;
              opp.reaction = 'confident';
              opp.speech = opp.profile.betLine(actualBet);
              this.narrative.push({ speaker: opp.profile.shortName, text: `Bets $${actualBet}.` });
              this.recordTurnEvent(opp, 'bet', actualBet);
            } else {
              opp.lastAction = opp.chips === 0 ? 'All-in' : 'Checks';
              opp.reaction = 'neutral';
              opp.speech = opp.profile.checkLine;
              checkedBeforeBet.push(opp);
              this.recordTurnEvent(opp, 'check');
            }
          } else {
            if (opp.chips <= 0) {
              this.checkOpponentAllIn(opp);
              this.recordTurnEvent(opp, 'check');
              continue;
            }
            const decision = decideAction(this.mode, opp.cards, this.board, true, this.random);
            if (decision === 'fold') {
              this.foldOpponent(opp);
              this.recordTurnEvent(opp, 'fold');
              folders.push(opp.profile.shortName);
            } else {
              const paid = this.callOpponent(opp, streetWager);
              this.recordTurnEvent(opp, 'call', paid);
              callers.push(opp.profile.shortName);
            }
          }
        }

        if (bettor) {
          for (const opp of checkedBeforeBet) {
            if (!opp.cards) continue;
            if (opp.chips <= 0) {
              this.checkOpponentAllIn(opp);
              this.recordTurnEvent(opp, 'check');
              continue;
            }
            const decision = decideAction(this.mode, opp.cards, this.board, true, this.random);
            if (decision === 'fold') {
              this.foldOpponent(opp);
              this.recordTurnEvent(opp, 'fold');
              folders.push(opp.profile.shortName);
            } else {
              const paid = this.callOpponent(opp, streetWager);
              this.recordTurnEvent(opp, 'call', paid);
              callers.push(opp.profile.shortName);
            }
          }

          this.currentBettorName = bettor.profile.name;
          this.currentStreetWager = streetWager;
          this.lastAction = { actor: 'opponent', action: 'bet', amount: streetWager };
          const parts = [`${bettor.profile.shortName} bets $${streetWager}`];
          if (callers.length > 0) parts.push(`${this.formatNameList(callers)} call`);
          if (folders.length > 0) parts.push(`${this.formatNameList(folders)} fold`);
          this.dealerSpeech = `${parts.join('; ')}. Your response?`;

          // If player is already all-in ($0 chips), they automatically stay in to next street without overdrawing!
          if (this.playerChips <= 0) {
            this.narrative.push({ speaker: 'You', text: 'You are already all-in and stay in the hand.' });
            this.advanceStreet();
            this.stateRevision += 1;
            return this.getState();
          }

          this.stage = 'player_response';
          this.stateRevision += 1;
          return this.getState();
        }

        this.lastAction = { actor: 'opponent', action: 'check' };
        this.dealerSpeech = 'Everyone checks around the table.';
        this.narrative.push({ speaker: 'Dealer', text: 'All active players check.' });

        this.advanceStreet();
        this.stateRevision += 1;
        return this.getState();
      }

      throw new Error(`Invalid action: ${action}. Expected check, bet, or fold.`);
    }

    if (this.stage === 'player_response') {
      const currentStreet = STREETS[this.streetIndex];
      if (!currentStreet || !this.playerCards || !this.mode) {
        throw new Error('Game state corrupted.');
      }

      if (action === 'fold') {
        this.handlePlayerFold(true);
        this.stateRevision += 1;
        return this.getState();
      }

      if (action === 'call') {
        const callAmt = this.getLegalPlayerCallAmount();
        const isAllIn = callAmt < this.currentStreetWager || this.playerChips - callAmt === 0;
        this.pot += callAmt;
        this.playerChips -= callAmt;
        this.playerHandContribution += callAmt;
        this.currentBettorName = null;
        this.currentStreetWager = 0;
        this.lastAction = { actor: 'player', action: 'call', amount: callAmt };
        this.dealerSpeech = isAllIn
          ? `You call all-in for $${callAmt}. Pot is $${this.pot}.`
          : `You call $${callAmt}. Pot is $${this.pot}.`;
        this.narrative.push({
          speaker: 'You',
          text: isAllIn ? `You call all-in for $${callAmt}.` : `You call $${callAmt}.`,
        });

        this.advanceStreet();
        this.stateRevision += 1;
        return this.getState();
      }

      throw new Error(`Invalid response: ${action}. Expected call or fold.`);
    }

    if (this.stage === 'hand_over') {
      if (action === 'yes' || action === 'y' || action === 'again') {
        this.startNewHand();
        this.stateRevision += 1;
        return this.getState();
      }
      if (action === 'no' || action === 'n' || action === 'quit') {
        this.stage = 'game_over';
        this.dealerSpeech = 'Thanks for playing at the VIP High Roller table!';
        this.narrative.push({ speaker: 'Dealer', text: 'Session finished. Thank you for playing!' });
        this.stateRevision += 1;
        return this.getState();
      }
      throw new Error(`Invalid choice: ${action}. Expected yes or no.`);
    }

    if (this.stage === 'game_over') {
      if (action === 'restart' || action === 'yes' || action === 'y') {
        this.resetSession();
        this.stateRevision += 1;
        return this.getState();
      }
      throw new Error('Game is over. Send restart to play again.');
    }

    return this.getState();
  }

  private resetSession(): void {
    this.deck = this.deckFactory();
    this.mode = null;
    this.stage = 'select_opponents';
    this.streetIndex = 0;
    this.pot = 0;
    this.turnStartPot = 0;
    this.turnEvents = [];
    this.playerChips = this.defaultPlayerChips;
    this.playerHandContribution = 0;
    this.playerTotalPotWon = 0;
    this.playerHandsWon = 0;
    this.playerFolded = false;
    this.playerCards = null;
    this.opponentLedger.clear();
    this.board = [];
    this.outcome = null;
    this.handCount = 0;
    this.lastAction = null;
    this.currentBettorName = null;
    this.currentStreetWager = 0;
    this.dealerSpeech = 'New session! Choose 4 opponents to join your table.';

    for (const opp of this.opponents) {
      opp.chips = this.defaultOpponentChips;
      opp.handContribution = 0;
      opp.totalPotWon = 0;
      opp.handsWon = 0;
      opp.cards = null;
      opp.cardsHidden = true;
      opp.folded = false;
      opp.lastAction = null;
      opp.reaction = 'neutral';
      opp.speech = opp.profile.introLine;
      opp.rank = null;
    }

    this.narrative = [
      { speaker: 'Dealer', text: 'New session started! Select 4 opponents from the roster to begin.' },
    ];
  }

  private foldOpponent(opp: InternalOpponent): void {
    opp.folded = true;
    opp.cardsHidden = true;
    opp.lastAction = 'Folded';
    opp.reaction = 'folded';
    opp.speech = opp.profile.foldLine;
    this.narrative.push({ speaker: opp.profile.shortName, text: 'Folds.' });
  }

  private callOpponent(opp: InternalOpponent, targetWager: number): number {
    const paid = Math.max(0, Math.min(opp.chips, targetWager));
    opp.chips -= paid;
    opp.handContribution += paid;
    this.pot += paid;
    opp.lastAction = paid < targetWager ? `All-in $${paid}` : `Calls $${paid}`;
    opp.reaction = 'confident';
    opp.speech = opp.profile.callLine(paid);
    this.narrative.push({
      speaker: opp.profile.shortName,
      text: paid < targetWager ? `Calls all-in for $${paid}.` : `Calls $${paid}.`,
    });
    return paid;
  }

  private checkOpponentAllIn(opp: InternalOpponent): void {
    opp.lastAction = 'All-in';
    opp.reaction = 'confident';
    opp.speech = opp.profile.checkLine;
    this.narrative.push({ speaker: opp.profile.shortName, text: 'Is already all-in.' });
  }

  private formatNameList(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0]!;
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  }

  public startNewHand(): void {
    if (this.playerChips <= 0) {
      this.narrative.push({ speaker: 'Dealer', text: 'Rebuy granted! House provides $500 chips.' });
      this.playerChips = 500;
    }
    for (const opp of this.opponents) {
      if (opp.chips <= 0) {
        this.narrative.push({
          speaker: opp.profile.shortName,
          text: `${opp.profile.name} reloads with $500 chips.`,
        });
        opp.chips = 500;
      }
    }

    this.handCount += 1;
    this.deck = this.deckFactory();
    this.playerCards = [this.deck.draw(), this.deck.draw()];
    this.playerHandContribution = 0;
    this.playerFolded = false;

    for (const opp of this.opponents) {
      opp.cards = [this.deck.draw(), this.deck.draw()];
      opp.cardsHidden = true;
      opp.folded = false;
      opp.handContribution = 0;
      opp.lastAction = null;
      opp.reaction = 'neutral';
      opp.speech = '';
      opp.rank = null;
    }

    this.board = [];
    this.streetIndex = 0;
    this.pot = 0;
    this.turnStartPot = 0;
    this.currentStreetWager = 0;
    this.outcome = null;
    this.lastAction = null;
    this.currentBettorName = null;
    this.stage = 'player_action';

    const currentStreet = STREETS[0];
    this.dealerSpeech = `Hand #${this.handCount}. Cards dealt to all 5 seats. Pre-flop action is on you.`;
    this.narrative.push({
      speaker: 'Dealer',
      text: `--- Hand #${this.handCount} (Pre-flop, bet: $${currentStreet.bet}) ---`,
    });
  }

  private dealNextCommunityCards(streetIdx: number): void {
    if (streetIdx === 1) {
      this.board.push(this.deck.draw(), this.deck.draw(), this.deck.draw());
    } else if (streetIdx === 2 || streetIdx === 3) {
      this.board.push(this.deck.draw());
    }
  }

  /**
   * Immediately refunds any uncalled excess bet when a street closes so an uncallable wager
   * can never remain in the pot or be awarded to an ineligible seat.
   */
  private refundUncalledExcess(): { seatId: string; seatName: string; amount: number } | null {
    type SeatContrib = {
      id: string;
      name: string;
      isPlayer: boolean;
      contribution: number;
      opp?: InternalOpponent;
    };

    const allSeats: SeatContrib[] = [
      { id: 'player', name: 'You', isPlayer: true, contribution: this.playerHandContribution },
      ...this.opponents.map((opp) => ({
        id: opp.profile.id,
        name: opp.profile.name,
        isPlayer: false,
        contribution: opp.handContribution,
        opp,
      })),
    ];

    allSeats.sort((a, b) => b.contribution - a.contribution);
    const top = allSeats[0];
    const second = allSeats[1];
    if (!top || !second || top.contribution <= second.contribution) {
      return null;
    }

    const excess = top.contribution - second.contribution;
    this.pot = Math.max(0, this.pot - excess);
    if (top.isPlayer) {
      this.playerChips += excess;
      this.playerHandContribution -= excess;
    } else if (top.opp) {
      top.opp.chips += excess;
      top.opp.handContribution -= excess;
    }

    this.narrative.push({
      speaker: 'Dealer',
      text: `Uncalled bet of $${excess} returned to ${top.name}.`,
    });
    return { seatId: top.id, seatName: top.name, amount: excess };
  }

  private advanceStreet(): void {
    // Settle any uncalled excess wager from the street that just closed before advancing
    this.refundUncalledExcess();

    const activeOppsWithChips = this.getActiveOpponents().filter((o) => o.chips > 0);
    const playerFunded = !this.playerFolded && this.playerChips > 0;
    const fundedActiveSeats = activeOppsWithChips.length + (playerFunded ? 1 : 0);
    const playerAllIn = !this.playerFolded && this.playerChips <= 0;

    // Run out remaining streets without prompting the player whenever:
    //  (a) the player is committed all-in (0 chips remaining), OR
    //  (b) at most 1 active seat has chips remaining (no opponent can call any further wager).
    if (playerAllIn || fundedActiveSeats <= 1) {
      while (this.streetIndex < STREETS.length - 1) {
        this.streetIndex += 1;
        this.currentStreetWager = 0;
        for (const opp of this.opponents) {
          opp.speech = '';
          if (!opp.folded) opp.lastAction = null;
        }
        this.dealNextCommunityCards(this.streetIndex);
        const street = STREETS[this.streetIndex];
        if (street) {
          const cardsText =
            this.streetIndex === 1
              ? this.board.map((c) => c.toString()).join(', ')
              : (this.board[this.board.length - 1]?.toString() ?? '');
          const runoutNote = playerAllIn ? 'You are all-in.' : 'No further betting possible.';
          this.narrative.push({
            speaker: 'Dealer',
            text: `${street.name} dealt: [${cardsText}]. ${runoutNote}`,
          });
          const oppsWithChips = this.getActiveOpponents().filter((o) => o.chips > 0);
          if (oppsWithChips.length >= 2) {
            this.runOpponentsOnlyStreet(street.bet, true);
            this.refundUncalledExcess();
          }
        }
      }
      this.finishShowdown();
      return;
    }

    this.streetIndex += 1;
    this.currentStreetWager = 0;

    for (const opp of this.opponents) {
      opp.speech = '';
      if (!opp.folded) {
        opp.lastAction = null;
      }
    }

    if (this.streetIndex === 1) {
      this.dealNextCommunityCards(1);
      this.stage = 'player_action';
      const street = STREETS[1];
      this.dealerSpeech = `Flop: ${this.board.map((c) => c.toString()).join('  ')}. Bet is $${street.bet}.`;
      this.narrative.push({
        speaker: 'Dealer',
        text: `Flop dealt: [${this.board.map((c) => c.toString()).join(', ')}]. Bet: $${street.bet}.`,
      });
      return;
    }

    if (this.streetIndex === 2) {
      this.dealNextCommunityCards(2);
      this.stage = 'player_action';
      const street = STREETS[2];
      this.dealerSpeech = `Turn: ${this.board[3]?.toString()}. Bet is $${street.bet}.`;
      this.narrative.push({
        speaker: 'Dealer',
        text: `Turn dealt: [${this.board[3]?.toString()}]. Bet: $${street.bet}.`,
      });
      return;
    }

    if (this.streetIndex === 3) {
      this.dealNextCommunityCards(3);
      this.stage = 'player_action';
      const street = STREETS[3];
      this.dealerSpeech = `River: ${this.board[4]?.toString()}. Final betting round: $${street.bet}.`;
      this.narrative.push({
        speaker: 'Dealer',
        text: `River dealt: [${this.board[4]?.toString()}]. Bet: $${street.bet}.`,
      });
      return;
    }

    this.finishShowdown();
  }

  /**
   * Plays out one betting street among the remaining active opponents (used when the player has folded
   * or is committed all-in during a multiway runout). Returns true if only 1 active opponent remains.
   */
  private runOpponentsOnlyStreet(streetBet: number, recordEvents = false): boolean {
    const active = this.getActiveOpponents();
    if (active.length <= 1 || !this.mode) return true;

    let bettor: InternalOpponent | null = null;
    let streetWager = 0;
    const checkedBeforeBet: InternalOpponent[] = [];

    for (const opp of active) {
      if (!opp.cards) continue;
      if (!bettor) {
        const canBet = opp.chips > 0;
        const decision = canBet ? decideAction(this.mode, opp.cards, this.board, false, this.random) : 'check';
        if (decision === 'bet' && canBet) {
          const actualBet = Math.min(opp.chips, streetBet);
          bettor = opp;
          streetWager = actualBet;
          opp.chips -= actualBet;
          opp.handContribution += actualBet;
          this.pot += actualBet;
          opp.lastAction = actualBet < streetBet ? `All-in $${actualBet}` : `Bets $${actualBet}`;
          opp.reaction = 'confident';
          opp.speech = opp.profile.betLine(actualBet);
          this.narrative.push({ speaker: opp.profile.shortName, text: `Bets $${actualBet}.` });
          if (recordEvents) this.recordTurnEvent(opp, 'bet', actualBet);
        } else {
          opp.lastAction = opp.chips === 0 ? 'All-in' : 'Checks';
          opp.reaction = 'neutral';
          opp.speech = opp.profile.checkLine;
          checkedBeforeBet.push(opp);
          if (recordEvents) this.recordTurnEvent(opp, 'check');
        }
      } else {
        if (opp.chips <= 0) {
          this.checkOpponentAllIn(opp);
          if (recordEvents) this.recordTurnEvent(opp, 'check');
          continue;
        }
        const decision = decideAction(this.mode, opp.cards, this.board, true, this.random);
        if (decision === 'fold') {
          this.foldOpponent(opp);
          if (recordEvents) this.recordTurnEvent(opp, 'fold');
        } else {
          const paid = this.callOpponent(opp, streetWager);
          if (recordEvents) this.recordTurnEvent(opp, 'call', paid);
        }
      }
    }

    if (bettor) {
      for (const opp of checkedBeforeBet) {
        if (!opp.cards) continue;
        if (opp.chips <= 0) {
          this.checkOpponentAllIn(opp);
          if (recordEvents) this.recordTurnEvent(opp, 'check');
          continue;
        }
        const decision = decideAction(this.mode, opp.cards, this.board, true, this.random);
        if (decision === 'fold') {
          this.foldOpponent(opp);
          if (recordEvents) this.recordTurnEvent(opp, 'fold');
        } else {
          const paid = this.callOpponent(opp, streetWager);
          if (recordEvents) this.recordTurnEvent(opp, 'call', paid);
        }
      }
    }

    return this.getActiveOpponents().length <= 1;
  }

  /**
   * Builds main pot and any side pots from each seat's contribution, returns unmatched wagers
   * to a sole top contributor, and distributes every eligible slice to the best hand(s) among
   * active contenders who contributed at least to that level.
   */
  private settlePots(seats: readonly PotSeat[]): PotSettlementSummary {
    const payoutById = new Map<string, number>();
    const unmatchedById = new Map<string, number>();
    const slices: PotSliceAward[] = [];

    const activeSeats = seats.filter((s) => s.active);
    const compareBest = (eligible: readonly PotSeat[]): PotSeat[] => {
      if (eligible.length <= 1) return [...eligible];
      let winners: PotSeat[] = [eligible[0]!];
      for (let i = 1; i < eligible.length; i += 1) {
        const candidate = eligible[i]!;
        if (!candidate.cards || !winners[0]?.cards) continue;
        const cmp = compareHands(candidate.cards, winners[0].cards);
        if (cmp > 0) {
          winners = [candidate];
        } else if (cmp === 0) {
          winners.push(candidate);
        }
      }
      return winners;
    };

    const bestOverallWinners = compareBest(activeSeats);
    const levels = [...new Set(seats.map((s) => s.contribution).filter((c) => c > 0))].sort((a, b) => a - b);

    let prevLevel = 0;
    for (const level of levels) {
      const width = level - prevLevel;
      const contributors = seats.filter((s) => s.contribution >= level);
      const slicePot = width * contributors.length;
      const eligible = activeSeats.filter((s) => s.contribution >= level);

      if (contributors.length === 1 && contributors[0]!.active) {
        // Sole unmatched top wager: return directly to that seat's stack
        const sole = contributors[0]!;
        unmatchedById.set(sole.id, (unmatchedById.get(sole.id) ?? 0) + slicePot);
        slices.push({ slicePot, unmatched: true, winners: [sole] });
      } else {
        const sliceContenders = eligible.length > 0 ? eligible : activeSeats;
        const sliceWinners = compareBest(sliceContenders);
        if (sliceWinners.length > 0) {
          const share = Math.floor(slicePot / sliceWinners.length);
          let remainder = slicePot - share * sliceWinners.length;
          for (const w of sliceWinners) {
            const award = share + (remainder > 0 ? 1 : 0);
            if (remainder > 0) remainder -= 1;
            payoutById.set(w.id, (payoutById.get(w.id) ?? 0) + award);
          }
          slices.push({ slicePot, unmatched: false, winners: sliceWinners });
        }
      }

      prevLevel = level;
    }

    // Apply payouts and unmatched returns to actual seat stacks and session totals.
    // Distinguish showdown / hand wins from chip payouts so $0 check-down wins still count in handsWon!
    const contestedSliceCount = slices.filter((s) => !s.unmatched).length;
    const handWinnerIds = new Set<string>();
    for (const [id, amt] of payoutById.entries()) {
      if (amt > 0) handWinnerIds.add(id);
    }
    if (contestedSliceCount === 0) {
      for (const w of bestOverallWinners) {
        handWinnerIds.add(w.id);
      }
    }

    for (const seat of seats) {
      const payout = payoutById.get(seat.id) ?? 0;
      const unmatched = unmatchedById.get(seat.id) ?? 0;
      const wonHand = handWinnerIds.has(seat.id);
      if (seat.isPlayer) {
        this.playerChips += payout + unmatched;
        if (payout > 0) {
          this.playerTotalPotWon += payout;
        }
        if (wonHand) {
          this.playerHandsWon += 1;
        }
      } else if (seat.opp) {
        seat.opp.chips += payout + unmatched;
        if (payout > 0) {
          seat.opp.totalPotWon += payout;
        }
        if (wonHand) {
          seat.opp.handsWon += 1;
        }
      }
    }

    return { payoutById, unmatchedById, slices, bestOverallWinners };
  }

  private handlePlayerFold(currentStreetAlreadyBet: boolean): void {
    if (!this.playerCards) return;

    this.playerFolded = true;
    this.narrative.push({ speaker: 'You', text: 'You folded.' });

    // Keep all opponents' cards strictly hidden when the player folds
    for (const opp of this.opponents) {
      opp.cardsHidden = true;
    }

    // If the player folded before opponents acted on the current street and 2+ opponents are still active,
    // let the remaining opponents finish this street and play out subsequent streets (ending immediately if 1 remains).
    if (!currentStreetAlreadyBet && this.getActiveOpponents().length > 1) {
      const currentStreet = STREETS[this.streetIndex];
      if (currentStreet) {
        this.runOpponentsOnlyStreet(currentStreet.bet);
        this.refundUncalledExcess();
      }
    }

    // Advance through remaining streets while 2+ opponents remain active
    while (this.getActiveOpponents().length > 1 && this.streetIndex < STREETS.length - 1) {
      this.streetIndex += 1;
      for (const opp of this.opponents) {
        opp.speech = '';
        if (!opp.folded) opp.lastAction = null;
      }
      this.dealNextCommunityCards(this.streetIndex);
      if (this.streetIndex === 1) {
        this.narrative.push({
          speaker: 'Dealer',
          text: `Flop dealt: [${this.board.map((c) => c.toString()).join(', ')}]. Remaining opponents act.`,
        });
      } else if (this.streetIndex === 2) {
        this.narrative.push({
          speaker: 'Dealer',
          text: `Turn dealt: [${this.board[3]?.toString()}]. Remaining opponents act.`,
        });
      } else if (this.streetIndex === 3) {
        this.narrative.push({
          speaker: 'Dealer',
          text: `River dealt: [${this.board[4]?.toString()}]. Remaining opponents act.`,
        });
      }

      const street = STREETS[this.streetIndex];
      if (street) {
        const opponentsWithChips = this.getActiveOpponents().filter((o) => o.chips > 0);
        if (opponentsWithChips.length >= 2) {
          this.runOpponentsOnlyStreet(street.bet);
          this.refundUncalledExcess();
        }
      }
    }

    // Ensure all opponent hole cards remain hidden because the player folded out
    for (const opp of this.opponents) {
      opp.cardsHidden = true;
    }

    const active = this.getActiveOpponents();
    const wonUncontested = active.length === 1;
    const seats: PotSeat[] = [
      {
        id: 'player',
        name: 'You',
        isPlayer: true,
        contribution: this.playerHandContribution,
        active: false,
        cards: null,
      },
      ...this.opponents.map((opp) => ({
        id: opp.profile.id,
        name: opp.profile.name,
        isPlayer: false,
        contribution: opp.handContribution,
        active: !opp.folded || (active.length === 0 && opp === this.getPrimaryOpponent()),
        cards: opp.cards && this.board.length >= 3 ? [...opp.cards, ...this.board] : null,
        opp,
      })),
    ];

    const settlement = this.settlePots(seats);
    const winningOpps = this.opponents.filter((o) => (settlement.payoutById.get(o.profile.id) ?? 0) > 0);
    const potWinners =
      winningOpps.length > 0
        ? winningOpps
        : settlement.bestOverallWinners.map((w) => w.opp).filter((o): o is InternalOpponent => Boolean(o));

    for (const winner of potWinners) {
      winner.reaction = 'celebrating';
      winner.speech = winner.profile.winLine;
      const amt = settlement.payoutById.get(winner.profile.id) ?? 0;
      winner.lastAction = amt > 0 ? `Wins $${amt}` : 'Wins Pot';
    }

    const winnerNames = potWinners.map((w) => w.profile.name);
    const winnerLabel = this.formatNameList(winnerNames);
    const playerRank = this.board.length >= 3 ? evaluateHand([...this.playerCards, ...this.board]) : null;
    const resolutionDetail = wonUncontested
      ? 'as the last player standing'
      : 'after the remaining seats played out the hand';
    const explanation = `You folded! ${winnerLabel} ${potWinners.length > 1 ? 'collected' : 'won'} the $${this.pot} pot ${resolutionDetail}.`;

    this.dealerSpeech = explanation;
    this.narrative.push({ speaker: 'Dealer', text: explanation });

    this.outcome = {
      result: 'fold',
      pot: this.pot,
      playerRank,
      opponentRank: null,
      winnerNames,
      message: `You folded. ${winnerLabel} won the $${this.pot} pot.`,
    };

    this.stage = 'hand_over';
  }

  private handleAllOpponentsFold(): void {
    // Refund any uncalled excess first so returned bets are NEVER counted as pot winnings
    const refunded = this.refundUncalledExcess();
    const refundedAmt = refunded && refunded.seatId === 'player' ? refunded.amount : 0;
    const awardedPot = this.pot;

    this.playerChips += awardedPot;
    if (awardedPot > 0) {
      this.playerTotalPotWon += awardedPot;
    }
    this.playerHandsWon += 1;

    const explanation =
      awardedPot > 0
        ? refundedAmt > 0
          ? `All opponents folded! You won the $${awardedPot} pot uncontested (uncalled $${refundedAmt} bet returned).`
          : `All opponents folded! You won the $${awardedPot} pot uncontested!`
        : refundedAmt > 0
          ? `All opponents folded! Your uncalled $${refundedAmt} bet was returned (won $0 from the pot).`
          : 'All opponents folded! You won the hand uncontested.';

    this.dealerSpeech = explanation;
    this.narrative.push({ speaker: 'Dealer', text: explanation });

    this.outcome = {
      result: 'win',
      pot: awardedPot,
      playerRank: null,
      opponentRank: null,
      winnerNames: ['You'],
      message:
        awardedPot > 0
          ? `All opponents folded! You won the $${awardedPot} pot!`
          : refundedAmt > 0
            ? `All opponents folded! Your uncalled $${refundedAmt} bet was returned.`
            : 'All opponents folded! You won the hand.',
    };

    this.stage = 'hand_over';
  }

  private finishShowdown(): void {
    if (!this.playerCards) return;

    const activeOpponents = this.getActiveOpponents();
    if (activeOpponents.length === 0) {
      this.handleAllOpponentsFold();
      return;
    }

    const playerFull = [...this.playerCards, ...this.board];
    const playerRank = evaluateHand(playerFull);

    type Contender = {
      isPlayer: boolean;
      name: string;
      cards: Card[];
      rank: HandRank;
      opp?: InternalOpponent;
    };

    const contenders: Contender[] = [
      { isPlayer: true, name: 'You', cards: playerFull, rank: playerRank },
    ];

    for (const opp of this.opponents) {
      if (opp.folded || !opp.cards) {
        opp.cardsHidden = true;
        continue;
      }
      opp.cardsHidden = false;
      const oppFull = [...opp.cards, ...this.board];
      const oppRank = evaluateHand(oppFull);
      opp.rank = oppRank;
      contenders.push({ isPlayer: false, name: opp.profile.name, cards: oppFull, rank: oppRank, opp });
    }

    const seats: PotSeat[] = [
      {
        id: 'player',
        name: 'You',
        isPlayer: true,
        contribution: this.playerHandContribution,
        active: !this.playerFolded,
        cards: playerFull,
      },
      ...this.opponents.map((opp) => ({
        id: opp.profile.id,
        name: opp.profile.name,
        isPlayer: false,
        contribution: opp.handContribution,
        active: !opp.folded && Boolean(opp.cards),
        cards: opp.cards ? [...opp.cards, ...this.board] : null,
        opp,
      })),
    ];

    const settlement = this.settlePots(seats);
    const playerPayout = settlement.payoutById.get('player') ?? 0;

    const oppContenders = contenders.filter((c) => !c.isPlayer);
    let bestOpp = oppContenders[0]!;
    for (let i = 1; i < oppContenders.length; i += 1) {
      if (compareHands(oppContenders[i]!.cards, bestOpp.cards) > 0) {
        bestOpp = oppContenders[i]!;
      }
    }

    const oppBreakdown = oppContenders.map((c) => `${c.name}: ${c.rank.name}`).join(', ');
    const contestedSlices = settlement.slices.filter((s) => !s.unmatched);
    const hasSidePots = contestedSlices.length > 1;
    const playerOverallBest = settlement.bestOverallWinners.some((w) => w.isPlayer);
    const tiedOpponentsOverall = settlement.bestOverallWinners.filter((w) => !w.isPlayer);

    for (const opp of activeOpponents) {
      const oppPayout = settlement.payoutById.get(opp.profile.id) ?? 0;
      const isOverallBest = settlement.bestOverallWinners.some((w) => w.id === opp.profile.id);
      if (oppPayout > 0 || (this.pot === 0 && isOverallBest)) {
        const tied = settlement.bestOverallWinners.length > 1 && isOverallBest && !hasSidePots;
        opp.reaction = tied ? 'neutral' : 'celebrating';
        opp.speech = tied ? opp.profile.tieLine : opp.profile.winLine;
        opp.lastAction =
          oppPayout > 0
            ? hasSidePots
              ? `Wins $${oppPayout} (${opp.rank?.name})`
              : tied
                ? `Tie (${opp.rank?.name})`
                : `Wins (${opp.rank?.name})`
            : `Wins (${opp.rank?.name})`;
      } else {
        opp.reaction = 'defeated';
        opp.speech = opp.profile.loseLine;
        opp.lastAction = opp.rank?.name ?? null;
      }
    }

    const allPaidWinners = seats.filter((s) => (settlement.payoutById.get(s.id) ?? 0) > 0);
    const sidePotSummary = hasSidePots
      ? allPaidWinners
          .map((s) => `${s.name} won $${settlement.payoutById.get(s.id) ?? 0}`)
          .join('; ')
      : '';

    if (playerOverallBest && tiedOpponentsOverall.length === 0) {
      const wonAmt = this.pot > 0 ? playerPayout : 0;
      const explanation = hasSidePots
        ? `Showdown! You won $${wonAmt} (main pot) with ${playerRank.name}! Side pots: ${sidePotSummary}. (${oppBreakdown}).`
        : `Showdown! You won the $${wonAmt} pot with ${playerRank.name}! (${oppBreakdown}).`;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: explanation });
      this.outcome = {
        result: 'win',
        pot: this.pot,
        playerRank,
        opponentRank: bestOpp.rank,
        winnerNames: hasSidePots ? allPaidWinners.map((w) => w.name) : ['You'],
        message: hasSidePots
          ? `You won $${wonAmt} (main pot) with ${playerRank.name}! (${sidePotSummary}).`
          : `You won $${wonAmt}! Your ${playerRank.name} beat ${bestOpp.name}'s ${bestOpp.rank.name}${oppContenders.length > 1 ? ` (${oppBreakdown})` : ''}.`,
      };
    } else if (playerOverallBest && tiedOpponentsOverall.length > 0) {
      const tiedOppNames = this.formatNameList(tiedOpponentsOverall.map((w) => w.name));
      const explanation = hasSidePots
        ? `Showdown! Tie with ${tiedOppNames} (${playerRank.name}). Payouts: ${sidePotSummary}.`
        : `Showdown! Tie with ${tiedOppNames} — both held ${playerRank.name}. Pot of $${this.pot} is split!`;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: explanation });
      this.outcome = {
        result: 'tie',
        pot: this.pot,
        playerRank,
        opponentRank: bestOpp.rank,
        winnerNames: hasSidePots
          ? allPaidWinners.map((w) => w.name)
          : settlement.bestOverallWinners.map((w) => w.name),
        message: hasSidePots
          ? `Tie with ${tiedOppNames} (${playerRank.name}). ${sidePotSummary}.`
          : `Tie with ${tiedOppNames} (${playerRank.name})! Pot of $${this.pot} split.`,
      };
    } else {
      const winnerSeats = allPaidWinners.length > 0 ? allPaidWinners : settlement.bestOverallWinners;
      const winnerLabel = this.formatNameList(winnerSeats.map((w) => w.name));
      const winningRankName = bestOpp.rank.name;
      const explanation = hasSidePots
        ? `Showdown! ${sidePotSummary}. Your ${playerRank.name} lost to ${bestOpp.name}'s ${winningRankName}.`
        : `Showdown! ${winnerLabel} won the $${this.pot} pot with ${winningRankName}, beating your ${playerRank.name}.`;
      const lesson = `Lesson: your ${playerRank.name} lost to ${bestOpp.name}'s ${winningRankName}.`;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: `${explanation} (${oppBreakdown}).` });
      this.outcome = {
        result: 'loss',
        pot: this.pot,
        playerRank,
        opponentRank: bestOpp.rank,
        winnerNames: winnerSeats.map((w) => w.name),
        message: hasSidePots
          ? `${sidePotSummary}. (${winningRankName} over your ${playerRank.name}).`
          : `${winnerLabel} won $${this.pot} with ${winningRankName} over your ${playerRank.name}.`,
        lesson,
      };
    }

    this.stage = 'hand_over';
  }

  private getPrompt(): PromptInfo | null {
    const token = `${this.tableInstanceId}:${this.stateRevision}`;

    if (this.stage === 'select_opponents') {
      return {
        type: 'select_opponents',
        revision: this.stateRevision,
        token,
        message: 'Select 4 opponents from the VIP roster:',
        choices: [{ id: 'random_opponents', label: 'Random 4 Opponents', key: 'R', variant: 'primary' }],
      };
    }

    if (this.stage === 'select_mode') {
      return {
        type: 'select_mode',
        revision: this.stateRevision,
        token,
        message: 'Choose table difficulty:',
        choices: [
          { id: 'easy', label: 'Easy', key: '1' },
          { id: 'medium', label: 'Medium', key: '2' },
          { id: 'hard', label: 'Hard', key: '3' },
        ],
      };
    }

    if (this.stage === 'player_action') {
      const streetBet = STREETS[this.streetIndex]?.bet ?? 10;
      const legalBet = this.getLegalPlayerBetAmount(streetBet);
      const choices: PromptChoice[] = [{ id: 'check', label: 'Check', key: 'C', variant: 'primary' }];
      if (legalBet > 0) {
        const betLabel = legalBet < streetBet ? `All-in $${legalBet}` : `Bet $${legalBet}`;
        choices.push({ id: 'bet', label: betLabel, key: 'B', variant: 'default' });
      }
      choices.push({ id: 'fold', label: 'Fold', key: 'F', variant: 'danger' });

      return {
        type: 'player_action',
        revision: this.stateRevision,
        token,
        message: `Your action (${STREETS[this.streetIndex]?.name}):`,
        choices,
      };
    }

    if (this.stage === 'player_response') {
      const legalCall = this.getLegalPlayerCallAmount();
      const bettorLabel = this.currentBettorName ?? 'Opponent';
      const callLabel = legalCall < this.currentStreetWager ? `All-in $${legalCall}` : `Call $${legalCall}`;
      return {
        type: 'player_response',
        revision: this.stateRevision,
        token,
        message: `${bettorLabel} bet $${this.currentStreetWager}. Your response:`,
        choices: [
          { id: 'call', label: callLabel, key: 'C', variant: 'primary' },
          { id: 'fold', label: 'Fold', key: 'F', variant: 'danger' },
        ],
      };
    }

    if (this.stage === 'hand_over') {
      const outcomeNote = this.outcome?.message ? `${this.outcome.message} ` : '';
      return {
        type: 'hand_over',
        revision: this.stateRevision,
        token,
        message: `${outcomeNote}Play another hand?`,
        choices: [
          { id: 'yes', label: 'Play Again', key: 'Space', variant: 'primary' },
          { id: 'no', label: 'Cash Out / Quit', key: 'Q', variant: 'default' },
        ],
      };
    }

    if (this.stage === 'game_over') {
      return {
        type: 'game_over',
        revision: this.stateRevision,
        token,
        message: 'Session complete.',
        choices: [{ id: 'restart', label: 'Start New Session', key: 'Space', variant: 'primary' }],
      };
    }

    return null;
  }
}
