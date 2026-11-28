import { randomUUID } from 'node:crypto';
import { Deck, Card, type Suit, type CardValue } from '../card.js';
import {
  compareHands,
  evaluateHand,
  explainEqualCategoryWin,
  findBestFiveCards,
  type HandRank,
} from '../poker.js';
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
export type TablePosition = 'BTN' | 'SB' | 'BB' | 'UTG' | 'CO';

export const TABLE_POSITIONS: readonly TablePosition[] = ['BTN', 'SB', 'BB', 'UTG', 'CO'];
export const TABLE_POSITION_LABELS: Record<TablePosition, string> = {
  BTN: 'Dealer Button',
  SB: 'Small Blind',
  BB: 'Big Blind',
  UTG: 'Under the Gun',
  CO: 'Cutoff',
};

export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;

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
  position: TablePosition;
  positionLabel: string;
  isButton: boolean;
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
  bestFiveCards?: string[];
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
  revealedCards?: CardData[];
  chipsAfter: number;
  handContributionAfter: number;
  potAfter: number;
}

export interface TurnStartSeatSnapshot {
  chips: number;
  handContribution: number;
  folded: boolean;
  lastAction: string | null;
}

export interface PotAwardBreakdown {
  label: string;
  amount: number;
  winners: { id: string; name: string; amount: number }[];
}

export interface SessionSummary {
  handsPlayed: number;
  handsWon: number;
  startingStack: number;
  finalStack: number;
  rebuyCount: number;
  rebuyChips: number;
  totalBuyIn: number;
  netProfit: number;
}

export interface SerializedGameState {
  tableInstanceId: string;
  stateRevision: number;
  stateToken: string;
  stage: GameStage;
  mode: Mode | null;
  streetIndex: number;
  streetName: string;
  buttonSeatIndex: number;
  playerPosition: TablePosition;
  playerPositionLabel: string;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  pot: number;
  turnStartPot: number;
  turnStartPlayerChips: number;
  turnStartPlayerContribution: number;
  turnStartOpponents: Record<string, TurnStartSeatSnapshot>;
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
    result: 'win' | 'tie' | 'mixed' | 'loss' | 'fold';
    pot: number;
    playerPayout?: number;
    pots?: PotAwardBreakdown[];
    playerRank: HandRank | null;
    opponentRank: HandRank | null;
    winnerNames: string[];
    message: string;
    lesson?: string;
    equalCategoryDetail?: string;
    bestFiveCards?: string[];
    winningBestFiveCards?: string[];
  } | null;
  handCount: number;
  sessionSummary: SessionSummary;
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
  streetContribution: number;
  totalPotWon: number;
  handsWon: number;
  cards: [Card, Card] | null;
  cardsHidden: boolean;
  folded: boolean;
  lastAction: string | null;
  speech: string;
  reaction: OpponentReaction;
  rank: HandRank | null;
  bestFiveCards: string[] | null;
}

export interface PokerGameEngineOptions {
  initialPlayerChips?: number;
  initialOpponentChips?: number;
  initialButtonSeatIndex?: number;
  smallBlind?: number;
  bigBlind?: number;
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
  seatIndex: number;
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
  awards: { seat: PotSeat; amount: number }[];
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
  private readonly initialButtonSeatIndex: number;
  private readonly smallBlind: number;
  private readonly bigBlind: number;
  private deck: Pick<Deck, 'draw'> = new Deck();
  private readonly tableInstanceId: string = randomUUID();
  private stateRevision = 1;
  private mode: Mode | null = null;
  private stage: GameStage = 'select_opponents';
  private streetIndex = 0;
  private buttonSeatIndex = 0;
  private pot = 0;
  private playerChips: number;
  private playerHandContribution = 0;
  private playerStreetContribution = 0;
  private playerTotalPotWon = 0;
  private playerHandsWon = 0;
  private playerRebuyCount = 0;
  private playerRebuyChips = 0;
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
  private currentStreetHighBet = 0;
  private streetHasRaise = false;
  private streetActionQueue: number[] = [];
  private turnStartPot = 0;
  private turnStartPlayerChips = 0;
  private turnStartPlayerContribution = 0;
  private turnStartOpponents: Record<string, TurnStartSeatSnapshot> = {};
  private turnEvents: TurnEvent[] = [];

  constructor(options: PokerGameEngineOptions = {}) {
    this.random = options.random ?? Math.random;
    this.deckFactory = options.deckFactory ?? (() => new Deck());
    this.defaultPlayerChips = options.initialPlayerChips ?? 500;
    this.playerChips = this.defaultPlayerChips;
    this.defaultOpponentChips = options.initialOpponentChips ?? 500;
    this.initialButtonSeatIndex = (((options.initialButtonSeatIndex ?? 0) % 5) + 5) % 5;
    this.buttonSeatIndex = this.initialButtonSeatIndex;
    this.smallBlind = options.smallBlind ?? SMALL_BLIND;
    this.bigBlind = options.bigBlind ?? BIG_BLIND;
    this.stage = 'select_opponents';
    this.seatOpponents(pickFourOpponents(this.random));
    this.captureTurnStartSnapshot();
    this.narrative = [
      {
        speaker: 'Dealer',
        text: 'Welcome to VIP Texas Hold’em! Select 4 opponents from the roster to begin.',
      },
    ];
  }

  private getSeatPosition(seatIndex: number): TablePosition {
    const offset = (seatIndex - this.buttonSeatIndex + 5) % 5;
    return TABLE_POSITIONS[offset]!;
  }

  private buildStreetOrder(startSeatIndex: number): number[] {
    return [0, 1, 2, 3, 4].map((offset) => (startSeatIndex + offset) % 5);
  }

  private captureTurnStartSnapshot(): void {
    this.turnStartPot = this.pot;
    this.turnStartPlayerChips = this.playerChips;
    this.turnStartPlayerContribution = this.playerHandContribution;
    const oppSnap: Record<string, TurnStartSeatSnapshot> = {};
    for (const opp of this.opponents) {
      oppSnap[opp.profile.id] = {
        chips: opp.chips,
        handContribution: opp.handContribution,
        folded: opp.folded,
        lastAction: opp.lastAction,
      };
    }
    this.turnStartOpponents = oppSnap;
  }

  private isSeatActive(seatIndex: number): boolean {
    if (seatIndex === 0) return !this.playerFolded;
    const opp = this.opponents[seatIndex - 1];
    return Boolean(opp && !opp.folded && opp.cards);
  }

  private getSeatChips(seatIndex: number): number {
    if (seatIndex === 0) return this.playerChips;
    return this.opponents[seatIndex - 1]?.chips ?? 0;
  }

  private getSeatStreetContribution(seatIndex: number): number {
    if (seatIndex === 0) return this.playerStreetContribution;
    return this.opponents[seatIndex - 1]?.streetContribution ?? 0;
  }

  private countActiveSeats(): number {
    return (this.playerFolded ? 0 : 1) + this.getActiveOpponents().length;
  }

  private countFundedActiveSeats(): number {
    const fundedOpps = this.getActiveOpponents().filter((o) => o.chips > 0).length;
    const playerFunded = !this.playerFolded && this.playerChips > 0 ? 1 : 0;
    return fundedOpps + playerFunded;
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
        streetContribution: 0,
        totalPotWon: saved ? saved.totalPotWon : 0,
        handsWon: saved ? saved.handsWon : 0,
        cards: null,
        cardsHidden: true,
        folded: false,
        lastAction: null,
        speech: profile.introLine,
        reaction: 'neutral',
        rank: null,
        bestFiveCards: null,
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

  private getPlayerToCall(): number {
    return Math.max(0, this.currentStreetHighBet - this.playerStreetContribution);
  }

  private getLegalPlayerCallAmount(): number {
    return Math.max(0, Math.min(this.playerChips, this.getPlayerToCall()));
  }

  private getLegalPlayerBetOrRaiseCost(streetBet: number): number {
    if (this.streetHasRaise) return 0;
    const fundedOpps = this.getActiveOpponents().filter((o) => o.chips > 0).length;
    if (fundedOpps === 0) return 0;
    const toCall = this.getPlayerToCall();
    if (this.playerChips <= toCall) return 0;
    const targetStreetTotal = this.currentStreetHighBet + streetBet;
    const desiredAdditional = Math.max(0, targetStreetTotal - this.playerStreetContribution);
    return Math.max(0, Math.min(this.playerChips, desiredAdditional));
  }

  private serializeOpponent(opp: InternalOpponent, oppIndex: number): OpponentData {
    const seatIndex = oppIndex + 1;
    const position = this.getSeatPosition(seatIndex);
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
      position,
      positionLabel: TABLE_POSITION_LABELS[position],
      isButton: seatIndex === this.buttonSeatIndex,
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
      ...(!opp.cardsHidden && opp.bestFiveCards ? { bestFiveCards: opp.bestFiveCards } : {}),
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

    const serializedOpponents = this.opponents.map((opp, idx) => this.serializeOpponent(opp, idx));
    const primaryIdx = this.opponents[2] ? 2 : 0;
    const primary = this.opponents[primaryIdx] ?? this.getPrimaryOpponent();
    const primarySerialized = this.serializeOpponent(primary, primaryIdx);
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
          ? this.getLegalPlayerBetOrRaiseCost(streetBet)
          : streetBet;

    const playerPosition = this.getSeatPosition(0);

    return {
      tableInstanceId: this.tableInstanceId,
      stateRevision: this.stateRevision,
      stateToken: `${this.tableInstanceId}:${this.stateRevision}`,
      stage: this.stage,
      mode: this.mode,
      streetIndex: this.streetIndex,
      streetName: STREETS[this.streetIndex]?.name ?? 'Showdown',
      buttonSeatIndex: this.buttonSeatIndex,
      playerPosition,
      playerPositionLabel: TABLE_POSITION_LABELS[playerPosition],
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      currentBet: effectiveCurrentBet,
      pot: this.pot,
      turnStartPot: this.turnStartPot,
      turnStartPlayerChips: this.turnStartPlayerChips,
      turnStartPlayerContribution: this.turnStartPlayerContribution,
      turnStartOpponents: this.turnStartOpponents,
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
      sessionSummary: this.getSessionSummary(),
      lastAction: this.lastAction,
    };
  }

  private getSessionSummary(): SessionSummary {
    const totalBuyIn = this.defaultPlayerChips + this.playerRebuyChips;
    return {
      handsPlayed: this.handCount,
      handsWon: this.playerHandsWon,
      startingStack: this.defaultPlayerChips,
      finalStack: this.playerChips,
      rebuyCount: this.playerRebuyCount,
      rebuyChips: this.playerRebuyChips,
      totalBuyIn,
      netProfit: this.playerChips - totalBuyIn,
    };
  }

  private formatSessionNet(netProfit: number): string {
    return netProfit > 0 ? `+$${netProfit}` : netProfit < 0 ? `-$${Math.abs(netProfit)}` : '$0';
  }

  private formatSessionSummaryLine(): string {
    const s = this.getSessionSummary();
    const netText = this.formatSessionNet(s.netProfit);
    return `Session complete! Hands: ${s.handsPlayed} • Final Stack: $${s.finalStack} • Rebuys: ${s.rebuyCount} ($${s.rebuyChips}) • Net: ${netText}.`;
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
      ...(opp.folded && opp.cards
        ? { revealedCards: [cardToData(opp.cards[0]), cardToData(opp.cards[1])] }
        : {}),
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
    this.captureTurnStartSnapshot();

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

    if (this.stage === 'player_action' || this.stage === 'player_response') {
      const currentStreet = STREETS[this.streetIndex];
      if (!currentStreet || !this.playerCards || !this.mode) {
        throw new Error('Game state corrupted.');
      }

      const toCall = this.getPlayerToCall();

      if (action === 'fold') {
        this.playerFolded = true;
        this.lastAction = { actor: 'player', action: 'fold' };
        this.narrative.push({ speaker: 'You', text: 'You folded.' });
        this.processStreetQueue(false);
        this.stateRevision += 1;
        return this.getState();
      }

      if (action === 'check') {
        if (toCall > 0) {
          throw new Error(`Cannot check while facing a $${toCall} bet; please call, raise, or fold.`);
        }
        this.lastAction = { actor: 'player', action: 'check' };
        this.narrative.push({ speaker: 'You', text: 'You check.' });
        this.captureTurnStartSnapshot();
        this.processStreetQueue(true);
        this.stateRevision += 1;
        return this.getState();
      }

      if (action === 'call') {
        if (toCall <= 0) {
          throw new Error('No bet to call; please check, bet, or fold.');
        }
        const callAmt = this.getLegalPlayerCallAmount();
        const isAllIn = callAmt < toCall || this.playerChips - callAmt === 0;
        this.pot += callAmt;
        this.playerChips -= callAmt;
        this.playerHandContribution += callAmt;
        this.playerStreetContribution += callAmt;
        this.lastAction = { actor: 'player', action: 'call', amount: callAmt };
        this.narrative.push({
          speaker: 'You',
          text: isAllIn ? `You call all-in for $${callAmt}.` : `You call $${callAmt}.`,
        });
        this.captureTurnStartSnapshot();
        this.processStreetQueue(true);
        this.stateRevision += 1;
        return this.getState();
      }

      if (action === 'bet' || action === 'raise') {
        const betCost = this.getLegalPlayerBetOrRaiseCost(currentStreet.bet);
        if (betCost <= 0) {
          throw new Error('Cannot bet or raise right now; please check, call, or fold.');
        }
        const isRaise = toCall > 0 || this.currentStreetHighBet > 0;
        const isAllIn = this.playerChips - betCost === 0;
        this.pot += betCost;
        this.playerChips -= betCost;
        this.playerHandContribution += betCost;
        this.playerStreetContribution += betCost;

        if (this.playerStreetContribution > this.currentStreetHighBet) {
          this.currentStreetHighBet = this.playerStreetContribution;
          this.streetHasRaise = true;
          this.currentBettorName = 'You';
          // Re-queue all other active funded seats clockwise after seat 0
          this.streetActionQueue = [1, 2, 3, 4];
        }

        this.lastAction = { actor: 'player', action: 'bet', amount: betCost };
        const actionDesc = isAllIn
          ? isRaise
            ? `You raise all-in to $${this.playerStreetContribution} (+$${betCost}).`
            : `You go all-in for $${betCost}.`
          : isRaise
            ? `You raise to $${this.playerStreetContribution} (+$${betCost}).`
            : `You bet $${betCost}.`;
        this.narrative.push({ speaker: 'You', text: actionDesc });
        this.captureTurnStartSnapshot();
        this.processStreetQueue(true);
        this.stateRevision += 1;
        return this.getState();
      }

      throw new Error(
        toCall > 0
          ? `Invalid response: ${action}. Expected call, bet/raise, or fold.`
          : `Invalid action: ${action}. Expected check, bet, or fold.`,
      );
    }

    if (this.stage === 'hand_over') {
      if (action === 'yes' || action === 'y' || action === 'again') {
        this.startNewHand();
        this.stateRevision += 1;
        return this.getState();
      }
      if (action === 'no' || action === 'n' || action === 'quit') {
        this.stage = 'game_over';
        const summaryLine = this.formatSessionSummaryLine();
        this.dealerSpeech = `${summaryLine} Thanks for playing at the VIP High Roller table!`;
        this.narrative.push({ speaker: 'Dealer', text: `${summaryLine} Thank you for playing!` });
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
    this.buttonSeatIndex = this.initialButtonSeatIndex;
    this.pot = 0;
    this.turnEvents = [];
    this.playerChips = this.defaultPlayerChips;
    this.playerHandContribution = 0;
    this.playerStreetContribution = 0;
    this.playerTotalPotWon = 0;
    this.playerHandsWon = 0;
    this.playerRebuyCount = 0;
    this.playerRebuyChips = 0;
    this.playerFolded = false;
    this.playerCards = null;
    this.opponentLedger.clear();
    this.board = [];
    this.outcome = null;
    this.handCount = 0;
    this.lastAction = null;
    this.currentBettorName = null;
    this.currentStreetHighBet = 0;
    this.streetHasRaise = false;
    this.streetActionQueue = [];
    this.dealerSpeech = 'New session! Choose 4 opponents to join your table.';

    for (const opp of this.opponents) {
      opp.chips = this.defaultOpponentChips;
      opp.handContribution = 0;
      opp.streetContribution = 0;
      opp.totalPotWon = 0;
      opp.handsWon = 0;
      opp.cards = null;
      opp.cardsHidden = true;
      opp.folded = false;
      opp.lastAction = null;
      opp.reaction = 'neutral';
      opp.speech = opp.profile.introLine;
      opp.rank = null;
      opp.bestFiveCards = null;
    }

    this.captureTurnStartSnapshot();
    this.narrative = [
      { speaker: 'Dealer', text: 'New session started! Select 4 opponents from the roster to begin.' },
    ];
  }

  private foldOpponent(opp: InternalOpponent): void {
    opp.folded = true;
    opp.cardsHidden = false; // Reveal folded opponent's cards immediately upon folding
    if (opp.cards && this.board.length >= 3) {
      opp.rank = evaluateHand([...opp.cards, ...this.board]);
    }
    opp.lastAction = 'Folded';
    opp.reaction = 'folded';
    opp.speech = opp.profile.foldLine;
    this.narrative.push({ speaker: opp.profile.shortName, text: 'Folds.' });
  }

  private callOpponent(opp: InternalOpponent, additionalToCall: number): number {
    const paid = Math.max(0, Math.min(opp.chips, additionalToCall));
    opp.chips -= paid;
    opp.handContribution += paid;
    opp.streetContribution += paid;
    this.pot += paid;
    opp.lastAction = paid < additionalToCall ? `All-in $${paid}` : `Calls $${paid}`;
    opp.reaction = 'confident';
    opp.speech = opp.profile.callLine(paid);
    this.narrative.push({
      speaker: opp.profile.shortName,
      text: paid < additionalToCall ? `Calls all-in for $${paid}.` : `Calls $${paid}.`,
    });
    return paid;
  }

  private postBlind(seatIndex: number, blindAmount: number, label: 'SB' | 'BB'): number {
    if (blindAmount <= 0) return 0;
    if (seatIndex === 0) {
      const posted = Math.max(0, Math.min(this.playerChips, blindAmount));
      this.playerChips -= posted;
      this.playerHandContribution += posted;
      this.playerStreetContribution += posted;
      this.pot += posted;
      return posted;
    }
    const opp = this.opponents[seatIndex - 1];
    if (!opp) return 0;
    const posted = Math.max(0, Math.min(opp.chips, blindAmount));
    opp.chips -= posted;
    opp.handContribution += posted;
    opp.streetContribution += posted;
    this.pot += posted;
    opp.lastAction = posted < blindAmount ? `${label} All-in $${posted}` : `${label} $${posted}`;
    return posted;
  }

  private getSeatDisplayName(seatIndex: number): string {
    if (seatIndex === 0) return 'You';
    return this.opponents[seatIndex - 1]?.profile.name ?? 'Opponent';
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
      this.playerRebuyCount += 1;
      this.playerRebuyChips += 500;
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

    // Rotate table positions clockwise by 1 seat on every new hand so BTN/SB/BB/UTG/CO are fair for everyone
    this.buttonSeatIndex = this.handCount === 0 ? this.initialButtonSeatIndex : (this.buttonSeatIndex + 1) % 5;
    this.handCount += 1;
    this.deck = this.deckFactory();
    this.playerCards = [this.deck.draw(), this.deck.draw()];
    this.playerHandContribution = 0;
    this.playerStreetContribution = 0;
    this.playerFolded = false;

    for (const opp of this.opponents) {
      opp.cards = [this.deck.draw(), this.deck.draw()];
      opp.cardsHidden = true;
      opp.folded = false;
      opp.handContribution = 0;
      opp.streetContribution = 0;
      opp.lastAction = null;
      opp.reaction = 'neutral';
      opp.speech = '';
      opp.rank = null;
      opp.bestFiveCards = null;
    }

    this.board = [];
    this.streetIndex = 0;
    this.pot = 0;
    this.outcome = null;
    this.lastAction = null;
    this.currentBettorName = null;
    this.currentStreetHighBet = 0;
    this.streetHasRaise = false;
    this.turnEvents = [];

    const sbSeat = (this.buttonSeatIndex + 1) % 5;
    const bbSeat = (this.buttonSeatIndex + 2) % 5;
    const utgSeat = (this.buttonSeatIndex + 3) % 5;
    const sbPosted = this.postBlind(sbSeat, this.smallBlind, 'SB');
    const bbPosted = this.postBlind(bbSeat, this.bigBlind, 'BB');
    // Keep the nominal full big-blind bring-in for remaining funded seats even if the BB posted short all-in
    // (the short BB keeps its actual contribution for side-pot eligibility).
    const useFullBringIn = this.bigBlind > 0 && this.countFundedActiveSeats() >= 2;
    this.currentStreetHighBet = useFullBringIn
      ? Math.max(this.bigBlind, sbPosted, bbPosted)
      : Math.max(sbPosted, bbPosted);
    if (bbPosted >= sbPosted && bbPosted > 0) {
      this.currentBettorName = this.getSeatDisplayName(bbSeat);
    } else if (sbPosted > 0) {
      this.currentBettorName = this.getSeatDisplayName(sbSeat);
    }

    const playerPos = this.getSeatPosition(0);
    const sbName = this.getSeatDisplayName(sbSeat);
    const bbName = this.getSeatDisplayName(bbSeat);
    const blindsText =
      sbPosted > 0 || bbPosted > 0 ? ` ${sbName} posts SB ($${sbPosted}), ${bbName} posts BB ($${bbPosted}).` : '';

    this.dealerSpeech = `Hand #${this.handCount} (You: ${playerPos}).${blindsText}`;
    this.narrative.push({
      speaker: 'Dealer',
      text: `--- Hand #${this.handCount} (BTN: ${this.getSeatDisplayName(this.buttonSeatIndex)}, You: ${playerPos}).${blindsText} ---`,
    });

    // Capture post-blind / pre-turn snapshot so UI live pots start cleanly with posted blinds
    this.captureTurnStartSnapshot();

    // Pre-flop action order starts clockwise from UTG: [UTG, CO, BTN, SB, BB]
    this.streetActionQueue = this.buildStreetOrder(utgSeat);
    this.processStreetQueue(true);
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

  private runSingleOpponentTurn(opp: InternalOpponent, seatIndex: number, recordEvents: boolean): void {
    if (!opp.cards || !this.mode) return;
    const currentStreet = STREETS[this.streetIndex];
    const streetBet = currentStreet?.bet ?? 10;
    const toCall = Math.max(0, this.currentStreetHighBet - opp.streetContribution);
    const facingBet = toCall > 0;

    if (facingBet) {
      const decision = decideAction(this.mode, opp.cards, this.board, true, this.random);
      if (decision === 'fold') {
        this.foldOpponent(opp);
        if (recordEvents) this.recordTurnEvent(opp, 'fold');
        return;
      }

      // Allow pre-flop raise if no voluntary raise has happened yet and another active seat has chips
      const canRaise =
        !this.streetHasRaise &&
        this.streetIndex === 0 &&
        opp.chips > toCall &&
        this.countFundedActiveSeats() > 1;
      if (canRaise && decideAction(this.mode, opp.cards, this.board, false, this.random) === 'bet') {
        const targetTotal = this.currentStreetHighBet + streetBet;
        const additional = Math.min(opp.chips, targetTotal - opp.streetContribution);
        opp.chips -= additional;
        opp.handContribution += additional;
        opp.streetContribution += additional;
        this.pot += additional;
        this.currentStreetHighBet = opp.streetContribution;
        this.streetHasRaise = true;
        this.currentBettorName = opp.profile.name;
        opp.lastAction =
          opp.chips === 0 ? `All-in $${additional}` : `Raises to $${opp.streetContribution}`;
        opp.reaction = 'confident';
        opp.speech = opp.profile.betLine(opp.streetContribution);
        this.narrative.push({
          speaker: opp.profile.shortName,
          text: `Raises to $${opp.streetContribution}.`,
        });
        if (recordEvents) this.recordTurnEvent(opp, 'bet', additional);
        // Re-queue all other seats clockwise after this raiser
        this.streetActionQueue = this.buildStreetOrder((seatIndex + 1) % 5).filter((s) => s !== seatIndex);
        return;
      }

      const paid = this.callOpponent(opp, toCall);
      if (recordEvents) this.recordTurnEvent(opp, 'call', paid);
      return;
    }

    // Not facing a bet (toCall === 0)
    const canBet = !this.streetHasRaise && opp.chips > 0 && this.countFundedActiveSeats() > 1;
    const decision = canBet ? decideAction(this.mode, opp.cards, this.board, false, this.random) : 'check';
    if (decision === 'bet' && canBet) {
      const isRaise = this.currentStreetHighBet > 0;
      const actualBet = Math.min(opp.chips, streetBet);
      opp.chips -= actualBet;
      opp.handContribution += actualBet;
      opp.streetContribution += actualBet;
      this.pot += actualBet;
      this.currentStreetHighBet = opp.streetContribution;
      this.streetHasRaise = true;
      this.currentBettorName = opp.profile.name;
      opp.lastAction =
        opp.chips === 0
          ? isRaise
            ? `All-in to $${opp.streetContribution}`
            : `All-in $${actualBet}`
          : isRaise
            ? `Raises to $${opp.streetContribution}`
            : `Bets $${actualBet}`;
      opp.reaction = 'confident';
      opp.speech = opp.profile.betLine(isRaise ? opp.streetContribution : actualBet);
      this.narrative.push({
        speaker: opp.profile.shortName,
        text: isRaise
          ? opp.chips === 0
            ? `Raises all-in to $${opp.streetContribution} (+$${actualBet}).`
            : `Raises to $${opp.streetContribution}.`
          : `Bets $${actualBet}.`,
      });
      if (recordEvents) this.recordTurnEvent(opp, 'bet', actualBet);
      this.streetActionQueue = this.buildStreetOrder((seatIndex + 1) % 5).filter((s) => s !== seatIndex);
    } else {
      opp.lastAction = opp.chips === 0 ? 'All-in' : 'Checks';
      opp.reaction = 'neutral';
      opp.speech = opp.profile.checkLine;
      if (recordEvents) this.recordTurnEvent(opp, 'check');
    }
  }

  private getMaxActiveStreetContribution(): number {
    let maxContrib = this.playerFolded ? 0 : this.playerStreetContribution;
    for (const opp of this.opponents) {
      if (!opp.folded && opp.streetContribution > maxContrib) {
        maxContrib = opp.streetContribution;
      }
    }
    return maxContrib;
  }

  /**
   * Recomputes the effective street wager whenever <= 1 funded active seat remains
   * (for example, if a nominal $10 big-blind bring-in was preserved after short-stacked
   * blinds posted all-in, and all other funded seats subsequently folded).
   */
  private syncEffectiveStreetHighBet(): void {
    if (this.countFundedActiveSeats() <= 1) {
      const maxLiveStreetBet = this.getMaxActiveStreetContribution();
      if (this.currentStreetHighBet > maxLiveStreetBet) {
        this.currentStreetHighBet = maxLiveStreetBet;
      }
    }
  }

  /**
   * Unified clockwise action-queue processor for every street.
   * Pauses whenever it reaches Seat 0 (Player) with a legal decision; otherwise runs
   * opponents in positional order and advances streets automatically until settlement.
   */
  private processStreetQueue(recordEvents: boolean): void {
    while (this.streetActionQueue.length > 0) {
      if (this.countActiveSeats() <= 1) {
        this.finishUncontestedHand();
        return;
      }

      this.syncEffectiveStreetHighBet();

      const seatIdx = this.streetActionQueue.shift()!;
      if (!this.isSeatActive(seatIdx)) continue;
      if (this.getSeatChips(seatIdx) <= 0) continue;

      const toCall = Math.max(0, this.currentStreetHighBet - this.getSeatStreetContribution(seatIdx));
      if (toCall === 0 && this.countFundedActiveSeats() <= 1) {
        continue;
      }

      if (seatIdx === 0) {
        const street = STREETS[this.streetIndex];
        const playerPos = this.getSeatPosition(0);
        if (toCall > 0) {
          this.stage = 'player_response';
          const legalCall = this.getLegalPlayerCallAmount();
          const bettor = this.currentBettorName ?? 'Table';
          this.dealerSpeech = `${street?.name ?? 'Pre-flop'} (${playerPos}): ${bettor} at $${this.currentStreetHighBet}. $${legalCall} to call.`;
        } else {
          this.stage = 'player_action';
          this.dealerSpeech = `${street?.name ?? 'Pre-flop'} (${playerPos}): Action is on you. Pot is $${this.pot}.`;
        }
        return;
      }

      const opp = this.opponents[seatIdx - 1];
      if (!opp) continue;
      this.runSingleOpponentTurn(opp, seatIdx, recordEvents);
    }

    this.advanceStreet(recordEvents);
  }

  private finishUncontestedHand(
    preRefunded: { seatId: string; seatName: string; amount: number } | null = null,
  ): void {
    if (!this.playerFolded) {
      this.handleAllOpponentsFold(preRefunded);
    } else {
      this.finishFoldedHand(true);
    }
  }

  private advanceStreet(recordEvents = true): void {
    // Refund any uncalled excess from the closing street before dealing next street or settling
    const refunded = this.refundUncalledExcess();

    if (this.countActiveSeats() <= 1) {
      this.finishUncontestedHand(refunded);
      return;
    }

    // Clear per-street contributions & old opponent chat bubbles at the start of every new round
    this.playerStreetContribution = 0;
    this.currentStreetHighBet = 0;
    this.streetHasRaise = false;
    this.currentBettorName = null;
    for (const opp of this.opponents) {
      opp.streetContribution = 0;
      opp.speech = '';
      if (!opp.folded) {
        opp.lastAction = null;
      }
    }

    // If River just finished -> settle hand!
    if (this.streetIndex >= STREETS.length - 1) {
      if (this.playerFolded) {
        this.finishFoldedHand(false);
      } else {
        this.finishShowdown();
      }
      return;
    }

    const fundedActiveSeats = this.countFundedActiveSeats();
    const playerAllIn = !this.playerFolded && this.playerChips <= 0;

    // Deal next street
    this.streetIndex += 1;
    this.dealNextCommunityCards(this.streetIndex);
    const street = STREETS[this.streetIndex];
    const cardsText =
      this.streetIndex === 1
        ? this.board.map((c) => c.toString()).join(', ')
        : (this.board[this.board.length - 1]?.toString() ?? '');
    if (street) {
      const note = this.playerFolded
        ? 'Remaining opponents act.'
        : playerAllIn
          ? 'You are all-in.'
          : fundedActiveSeats <= 1
            ? 'No further betting possible.'
            : `Bet: $${street.bet}.`;
      this.narrative.push({
        speaker: 'Dealer',
        text: `${street.name} dealt: [${cardsText}]. ${note}`,
      });
    }

    // If <= 1 funded active seat remains, no further betting is possible on this or later streets -> deal out straight to settlement
    if (fundedActiveSeats <= 1) {
      while (this.streetIndex < STREETS.length - 1) {
        this.streetIndex += 1;
        this.dealNextCommunityCards(this.streetIndex);
        const s = STREETS[this.streetIndex];
        if (s) {
          this.narrative.push({
            speaker: 'Dealer',
            text: `${s.name} dealt: [${this.board[this.board.length - 1]?.toString() ?? ''}].`,
          });
        }
      }
      if (this.playerFolded) {
        this.finishFoldedHand(false);
      } else {
        this.finishShowdown();
      }
      return;
    }

    // Post-flop action starts clockwise left of the Dealer Button: [SB, BB, UTG, CO, BTN]
    const sbSeat = (this.buttonSeatIndex + 1) % 5;
    this.streetActionQueue = this.buildStreetOrder(sbSeat);
    this.processStreetQueue(recordEvents && !this.playerFolded);
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

    // Combine contribution layers that share the exact same eligible active contenders
    // so folded dead-money levels never create artificial split boundaries that award extra odd chips.
    type ContestedPot = {
      pot: number;
      contenders: PotSeat[];
    };
    const contestedPotsByKey = new Map<string, ContestedPot>();
    const contestedPots: ContestedPot[] = [];

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
        slices.push({ slicePot, unmatched: true, winners: [sole], awards: [{ seat: sole, amount: slicePot }] });
      } else {
        const sliceContenders = eligible.length > 0 ? eligible : activeSeats;
        const contenderKey = sliceContenders
          .map((s) => s.id)
          .sort()
          .join('|');
        const existing = contestedPotsByKey.get(contenderKey);
        if (existing) {
          existing.pot += slicePot;
        } else {
          const potEntry: ContestedPot = { pot: slicePot, contenders: sliceContenders };
          contestedPotsByKey.set(contenderKey, potEntry);
          contestedPots.push(potEntry);
        }
      }

      prevLevel = level;
    }

    const sbSeat = (this.buttonSeatIndex + 1) % 5;
    for (const potEntry of contestedPots) {
      const sliceWinners = compareBest(potEntry.contenders);
      if (sliceWinners.length > 0) {
        // Poker TDA Rule 21: award odd chip(s) once per logical pot clockwise after the Dealer Button
        const orderedWinners = [...sliceWinners].sort(
          (a, b) => ((a.seatIndex - sbSeat + 5) % 5) - ((b.seatIndex - sbSeat + 5) % 5),
        );
        const share = Math.floor(potEntry.pot / orderedWinners.length);
        let remainder = potEntry.pot - share * orderedWinners.length;
        const sliceAwards: { seat: PotSeat; amount: number }[] = [];
        for (const w of orderedWinners) {
          const award = share + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder -= 1;
          payoutById.set(w.id, (payoutById.get(w.id) ?? 0) + award);
          sliceAwards.push({ seat: w, amount: award });
        }
        slices.push({ slicePot: potEntry.pot, unmatched: false, winners: orderedWinners, awards: sliceAwards });
      }
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

  private finishFoldedHand(wonUncontested: boolean): void {
    if (!this.playerCards) return;

    this.refundUncalledExcess();

    // Reveal all players' cards once the hand finishes so you can see every hand & the winner's cards
    for (const opp of this.opponents) {
      if (opp.cards) {
        opp.cardsHidden = false;
        if (this.board.length >= 3) {
          opp.rank = evaluateHand([...opp.cards, ...this.board]);
        }
      }
    }

    const active = this.getActiveOpponents();
    const isUncontested = wonUncontested || active.length === 1;
    const seats: PotSeat[] = [
      {
        id: 'player',
        seatIndex: 0,
        name: 'You',
        isPlayer: true,
        contribution: this.playerHandContribution,
        active: false,
        cards: null,
      },
      ...this.opponents.map((opp, idx) => ({
        id: opp.profile.id,
        seatIndex: idx + 1,
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
      winner.lastAction =
        winner.rank && !isUncontested
          ? `Wins $${amt} (${winner.rank.name})`
          : amt > 0
            ? `Wins $${amt}`
            : 'Wins Pot';
    }

    const contestedSlices = settlement.slices.filter((s) => !s.unmatched);
    const hasSidePots = contestedSlices.length > 1;
    const { pots: potBreakdown, summary: potRecap } = this.buildPotBreakdown(contestedSlices);

    const winnerNames = potWinners.map((w) => w.profile.name);
    const winnerLabel = this.formatNameList(winnerNames);
    const winningRank = !isUncontested && potWinners[0]?.rank ? potWinners[0].rank : null;
    const playerRank = this.board.length >= 3 ? evaluateHand([...this.playerCards, ...this.board]) : null;
    const resolutionDetail = isUncontested
      ? 'as the last player standing'
      : winningRank
        ? `with ${winningRank.name}`
        : 'after the remaining seats played out the hand';
    const explanation = hasSidePots
      ? `You folded! ${potRecap}.`
      : `You folded! ${winnerLabel} ${potWinners.length > 1 ? 'collected' : 'won'} the $${this.pot} pot ${resolutionDetail}.`;

    this.dealerSpeech = explanation;
    this.narrative.push({ speaker: 'Dealer', text: explanation });

    this.outcome = {
      result: 'fold',
      pot: this.pot,
      playerPayout: 0,
      ...(potBreakdown.length > 0 ? { pots: potBreakdown } : {}),
      playerRank,
      opponentRank: winningRank,
      winnerNames,
      message: hasSidePots
        ? `You folded. ${potRecap}.`
        : winningRank
          ? `You folded. ${winnerLabel} won the $${this.pot} pot with ${winningRank.name}.`
          : `You folded. ${winnerLabel} won the $${this.pot} pot.`,
    };

    this.stage = 'hand_over';
  }

  private handleAllOpponentsFold(
    preRefunded: { seatId: string; seatName: string; amount: number } | null = null,
  ): void {
    // Refund any uncalled excess first so returned bets are NEVER counted as pot winnings
    const refunded = preRefunded ?? this.refundUncalledExcess();
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

  private buildPotBreakdown(contestedSlices: readonly PotSliceAward[]): {
    pots: PotAwardBreakdown[];
    summary: string;
  } {
    const total = contestedSlices.length;
    const pots: PotAwardBreakdown[] = contestedSlices.map((slice, idx) => {
      const label = idx === 0 ? 'Main pot' : total === 2 ? 'Side pot' : `Side pot ${idx}`;
      return {
        label,
        amount: slice.slicePot,
        winners: slice.awards.map((a) => ({
          id: a.seat.id,
          name: a.seat.name,
          amount: a.amount,
        })),
      };
    });

    const summary = pots
      .map((p) => {
        if (p.winners.length === 1) {
          return `${p.label} ($${p.amount}): ${p.winners[0]!.name}`;
        }
        const allEqual = p.winners.every((w) => w.amount === p.winners[0]!.amount);
        if (allEqual) {
          const names = this.formatNameList(p.winners.map((w) => w.name));
          return `${p.label} ($${p.amount}): ${names} split ($${p.winners[0]!.amount} each)`;
        }
        const parts = p.winners.map((w) => `${w.name} $${w.amount}`).join(', ');
        return `${p.label} ($${p.amount}): ${parts}`;
      })
      .join('; ');

    return { pots, summary };
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
    const playerBestFive = findBestFiveCards(playerFull).map((c) => c.toString());

    type Contender = {
      isPlayer: boolean;
      name: string;
      cards: Card[];
      rank: HandRank;
      bestFive: string[];
      opp?: InternalOpponent;
    };

    const contenders: Contender[] = [
      { isPlayer: true, name: 'You', cards: playerFull, rank: playerRank, bestFive: playerBestFive },
    ];

    for (const opp of this.opponents) {
      if (!opp.cards) continue;
      opp.cardsHidden = false; // Reveal folded & showdown hands at end of hand
      if (opp.folded) continue;
      const oppFull = [...opp.cards, ...this.board];
      const oppRank = evaluateHand(oppFull);
      const oppBestFive = findBestFiveCards(oppFull).map((c) => c.toString());
      opp.rank = oppRank;
      opp.bestFiveCards = oppBestFive;
      contenders.push({
        isPlayer: false,
        name: opp.profile.name,
        cards: oppFull,
        rank: oppRank,
        bestFive: oppBestFive,
        opp,
      });
    }

    const seats: PotSeat[] = [
      {
        id: 'player',
        seatIndex: 0,
        name: 'You',
        isPlayer: true,
        contribution: this.playerHandContribution,
        active: !this.playerFolded,
        cards: playerFull,
      },
      ...this.opponents.map((opp, idx) => ({
        id: opp.profile.id,
        seatIndex: idx + 1,
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
    const { pots: potBreakdown, summary: potRecap } = this.buildPotBreakdown(contestedSlices);
    const playerOverallBest = settlement.bestOverallWinners.some((w) => w.isPlayer);
    const tiedOpponentsOverall = settlement.bestOverallWinners.filter((w) => !w.isPlayer);
    const mainSlice = contestedSlices[0];
    const playerWonMain = Boolean(mainSlice && mainSlice.winners.some((w) => w.isPlayer));
    const playerWonAny = playerPayout > 0 || (this.pot === 0 && playerOverallBest);
    const otherWonAny = contestedSlices.some((s) => s.winners.some((w) => !w.isPlayer));
    const playerWonAllPotsSole =
      contestedSlices.length > 0
        ? contestedSlices.every((s) => s.winners.length === 1 && s.winners[0]?.isPlayer)
        : playerOverallBest && tiedOpponentsOverall.length === 0;
    const pureTieAllPots =
      contestedSlices.length > 0
        ? contestedSlices.every((s) => s.winners.length > 1 && s.winners.some((w) => w.isPlayer))
        : playerOverallBest && tiedOpponentsOverall.length > 0;

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

    if (playerWonAllPotsSole) {
      const wonAmt = this.pot > 0 ? playerPayout : 0;
      const equalDetail = explainEqualCategoryWin(playerRank, bestOpp.rank);
      const detailSuffix = equalDetail ? ` (${equalDetail})` : '';
      const explanation = hasSidePots
        ? `Showdown! You won $${wonAmt} total with ${playerRank.name}${detailSuffix} — ${potRecap}. (${oppBreakdown}).`
        : `Showdown! You won the $${wonAmt} pot with ${playerRank.name}${detailSuffix}! (${oppBreakdown}).`;
      const lesson = equalDetail
        ? `Lesson: your ${playerRank.name} beat ${bestOpp.name}'s ${bestOpp.rank.name} (${equalDetail}).`
        : undefined;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: explanation });
      this.outcome = {
        result: 'win',
        pot: this.pot,
        playerPayout: wonAmt,
        ...(potBreakdown.length > 0 ? { pots: potBreakdown } : {}),
        playerRank,
        opponentRank: bestOpp.rank,
        winnerNames: hasSidePots ? allPaidWinners.map((w) => w.name) : ['You'],
        message: hasSidePots
          ? `You won $${wonAmt} total with ${playerRank.name}${detailSuffix} (${potRecap}).`
          : `You won $${wonAmt}! Your ${playerRank.name} beat ${bestOpp.name}'s ${bestOpp.rank.name}${detailSuffix}${oppContenders.length > 1 ? ` (${oppBreakdown})` : ''}.`,
        ...(lesson ? { lesson } : {}),
        ...(equalDetail ? { equalCategoryDetail: equalDetail } : {}),
        bestFiveCards: playerBestFive,
        winningBestFiveCards: playerBestFive,
      };
    } else if (pureTieAllPots) {
      const tiedOppNames = this.formatNameList(tiedOpponentsOverall.map((w) => w.name));
      const explanation = hasSidePots
        ? `Showdown! Tie with ${tiedOppNames} (${playerRank.name}) — ${potRecap}.`
        : `Showdown! Tie with ${tiedOppNames} — both held ${playerRank.name}. Pot of $${this.pot} is split!`;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: explanation });
      this.outcome = {
        result: 'tie',
        pot: this.pot,
        playerPayout,
        ...(potBreakdown.length > 0 ? { pots: potBreakdown } : {}),
        playerRank,
        opponentRank: bestOpp.rank,
        winnerNames: hasSidePots
          ? allPaidWinners.map((w) => w.name)
          : settlement.bestOverallWinners.map((w) => w.name),
        message: hasSidePots
          ? `Tie with ${tiedOppNames} (${playerRank.name}): ${potRecap}.`
          : `Tie with ${tiedOppNames} (${playerRank.name})! Pot of $${this.pot} split.`,
        bestFiveCards: playerBestFive,
        winningBestFiveCards: playerBestFive,
      };
    } else if (playerWonAny && otherWonAny) {
      const mainWinnerNames = this.formatNameList((mainSlice?.winners ?? []).map((w) => w.name));
      const equalDetail = !playerWonMain
        ? explainEqualCategoryWin(bestOpp.rank, playerRank)
        : explainEqualCategoryWin(playerRank, bestOpp.rank);
      const detailSuffix = equalDetail ? ` — ${equalDetail}` : '';
      const summary = !playerWonMain
        ? `Showdown! Mixed result — ${potRecap}. You won $${playerPayout} in side pot(s) with ${playerRank.name}; ${mainWinnerNames} took the main pot (${bestOpp.rank.name}${detailSuffix}).`
        : `Showdown! Mixed result — ${potRecap}. You won $${playerPayout} total with ${playerRank.name}${detailSuffix ? ` (${equalDetail})` : ''}.`;
      const explanation = `${summary} (${oppBreakdown}).`;
      const lesson = equalDetail
        ? !playerWonMain
          ? `Lesson: in the main pot, your ${playerRank.name} lost to ${bestOpp.name}'s ${bestOpp.rank.name} (${equalDetail}).`
          : `Lesson: in the main pot, your ${playerRank.name} beat ${bestOpp.name}'s ${bestOpp.rank.name} (${equalDetail}).`
        : undefined;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: explanation });
      this.outcome = {
        result: 'mixed',
        pot: this.pot,
        playerPayout,
        ...(potBreakdown.length > 0 ? { pots: potBreakdown } : {}),
        playerRank,
        opponentRank: bestOpp.rank,
        winnerNames: allPaidWinners.map((w) => w.name),
        message: `Mixed result (you won $${playerPayout}): ${potRecap}${equalDetail ? ` (${equalDetail})` : ''}.`,
        ...(lesson ? { lesson } : {}),
        ...(equalDetail ? { equalCategoryDetail: equalDetail } : {}),
        bestFiveCards: playerBestFive,
        winningBestFiveCards: playerWonMain ? playerBestFive : bestOpp.bestFive,
      };
    } else {
      const winnerSeats = allPaidWinners.length > 0 ? allPaidWinners : settlement.bestOverallWinners;
      const winnerLabel = this.formatNameList(winnerSeats.map((w) => w.name));
      const winningRankName = bestOpp.rank.name;
      const equalDetail = explainEqualCategoryWin(bestOpp.rank, playerRank);
      const detailSuffix = equalDetail ? ` (${equalDetail})` : '';
      const explanation = hasSidePots
        ? `Showdown! ${potRecap}. Your ${playerRank.name} lost to ${bestOpp.name}'s ${winningRankName}${detailSuffix}.`
        : `Showdown! ${winnerLabel} won the $${this.pot} pot with ${winningRankName}, beating your ${playerRank.name}${detailSuffix}.`;
      const lesson = `Lesson: your ${playerRank.name} lost to ${bestOpp.name}'s ${winningRankName}${detailSuffix}.`;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: `${explanation} (${oppBreakdown}).` });
      this.outcome = {
        result: 'loss',
        pot: this.pot,
        playerPayout: 0,
        ...(potBreakdown.length > 0 ? { pots: potBreakdown } : {}),
        playerRank,
        opponentRank: bestOpp.rank,
        winnerNames: winnerSeats.map((w) => w.name),
        message: hasSidePots
          ? `${potRecap}. (${winningRankName} over your ${playerRank.name}${equalDetail ? ` — ${equalDetail}` : ''}).`
          : `${winnerLabel} won $${this.pot} with ${winningRankName} over your ${playerRank.name}${detailSuffix}.`,
        lesson,
        ...(equalDetail ? { equalCategoryDetail: equalDetail } : {}),
        bestFiveCards: playerBestFive,
        winningBestFiveCards: bestOpp.bestFive,
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
      const betCost = this.getLegalPlayerBetOrRaiseCost(streetBet);
      const choices: PromptChoice[] = [{ id: 'check', label: 'Check', key: 'C', variant: 'primary' }];
      if (betCost > 0) {
        const isRaise = this.currentStreetHighBet > 0;
        const isAllIn = betCost >= this.playerChips;
        const raiseTarget = this.playerStreetContribution + betCost;
        const betLabel = isRaise
          ? isAllIn
            ? `All-in to $${raiseTarget} (+$${betCost})`
            : `Raise to $${raiseTarget} (+$${betCost})`
          : isAllIn
            ? `All-in $${betCost}`
            : `Bet $${betCost}`;
        choices.push({ id: 'bet', label: betLabel, key: 'B', variant: 'default' });
      }
      choices.push({ id: 'fold', label: 'Fold', key: 'F', variant: 'danger' });

      const playerPos = this.getSeatPosition(0);
      return {
        type: 'player_action',
        revision: this.stateRevision,
        token,
        message: `Your action (${STREETS[this.streetIndex]?.name} • ${playerPos}):`,
        choices,
      };
    }

    if (this.stage === 'player_response') {
      const streetBet = STREETS[this.streetIndex]?.bet ?? 10;
      const toCall = this.getPlayerToCall();
      const legalCall = this.getLegalPlayerCallAmount();
      const raiseCost = this.getLegalPlayerBetOrRaiseCost(streetBet);
      const bettorLabel = this.currentBettorName ?? 'Table';
      const callLabel = legalCall < toCall || legalCall === this.playerChips ? `All-in $${legalCall}` : `Call $${legalCall}`;
      const choices: PromptChoice[] = [{ id: 'call', label: callLabel, key: 'C', variant: 'primary' }];
      if (raiseCost > 0) {
        const targetTotal = this.playerStreetContribution + raiseCost;
        const raiseLabel =
          raiseCost === this.playerChips ? `All-in $${raiseCost}` : `Raise to $${targetTotal}`;
        choices.push({ id: 'bet', label: raiseLabel, key: 'B', variant: 'default' });
      }
      choices.push({ id: 'fold', label: 'Fold', key: 'F', variant: 'danger' });

      const playerPos = this.getSeatPosition(0);
      return {
        type: 'player_response',
        revision: this.stateRevision,
        token,
        message: `${STREETS[this.streetIndex]?.name} (${playerPos}) — ${bettorLabel} at $${this.currentStreetHighBet}. Your response:`,
        choices,
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
        message: this.formatSessionSummaryLine(),
        choices: [{ id: 'restart', label: 'Start New Session', key: 'Space', variant: 'primary' }],
      };
    }

    return null;
  }
}
