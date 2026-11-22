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

export interface PromptChoice {
  id: string;
  label: string;
  key: string;
  variant?: 'primary' | 'danger' | 'default';
}

export interface PromptInfo {
  type: GameStage;
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
  private deck: Deck = new Deck();
  private mode: Mode | null = null;
  private stage: GameStage = 'select_opponents';
  private streetIndex = 0;
  private pot = 0;
  private playerChips = 500;
  private playerHandContribution = 0;
  private playerTotalPotWon = 0;
  private playerHandsWon = 0;
  private playerCards: [Card, Card] | null = null;
  private opponents: InternalOpponent[] = [];
  private board: Card[] = [];
  private dealerSpeech = 'Welcome to the VIP High Roller Lounge! Choose 4 opponents to join your table.';
  private narrative: NarrativeEntry[] = [];
  private outcome: SerializedGameState['outcome'] = null;
  private handCount = 0;
  private lastAction: SerializedGameState['lastAction'] = null;
  private currentBettorName: string | null = null;
  private turnStartPot = 0;
  private turnEvents: TurnEvent[] = [];

  constructor() {
    this.stage = 'select_opponents';
    this.seatOpponents(pickFourOpponents());
    this.narrative = [
      {
        speaker: 'Dealer',
        text: 'Welcome to VIP Texas Hold’em! Select 4 opponents from the roster to begin.',
      },
    ];
  }

  private seatOpponents(profiles: readonly OpponentProfile[]): void {
    this.opponents = profiles.slice(0, 4).map((profile, idx) => ({
      profile,
      seat: TABLE_SEATS[idx]!,
      chips: 500,
      handContribution: 0,
      totalPotWon: 0,
      handsWon: 0,
      cards: null,
      cardsHidden: true,
      folded: false,
      lastAction: null,
      speech: profile.introLine,
      reaction: 'neutral',
      rank: null,
    }));
  }

  private getPrimaryOpponent(): InternalOpponent {
    return this.opponents[2] ?? this.opponents[0]!;
  }

  private getActiveOpponents(): InternalOpponent[] {
    return this.opponents.filter((opp) => !opp.folded);
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

    return {
      stage: this.stage,
      mode: this.mode,
      streetIndex: this.streetIndex,
      streetName: STREETS[this.streetIndex]?.name ?? 'Showdown',
      currentBet: STREETS[this.streetIndex]?.bet ?? 0,
      pot: this.pot,
      turnStartPot: this.turnStartPot,
      turnEvents: this.turnEvents,
      playerChips: this.playerChips,
      playerHandContribution: this.playerHandContribution,
      playerTotalPotWon: this.playerTotalPotWon,
      playerHandsWon: this.playerHandsWon,
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
    return lines[Math.floor(Math.random() * lines.length)] ?? 'Thinking...';
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

  public act(rawAction: string): SerializedGameState {
    const action = rawAction.trim().toLowerCase();
    this.turnEvents = [];
    this.turnStartPot = this.pot;

    // Open opponent selector anytime
    if (action === 'open_opponent_select') {
      this.stage = 'select_opponents';
      this.dealerSpeech = 'Choose 4 opponents from our VIP roster for your table.';
      return this.getState();
    }

    // Explicit opponent selection: "select_opponents:reginald,buck,elon,tony"
    if (action.startsWith('select_opponents:')) {
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
        this.dealerSpeech = `Opponents seated! Now select your table difficulty.`;
      }
      return this.getState();
    }

    // Shuffle 4 random opponents from the 7 VIPs
    if (action === 'new_table' || action === 'random_opponents') {
      this.seatOpponents(pickFourOpponents());
      const names = this.opponents.map((o) => o.profile.name).join(', ');
      this.narrative.push({ speaker: 'Dealer', text: `Random VIP table seated: ${names}.` });
      if (this.mode) {
        this.startNewHand();
      } else {
        this.stage = 'select_mode';
        this.dealerSpeech = `Random table seated! Now select your table difficulty.`;
      }
      return this.getState();
    }

    // Allow selecting difficulty directly from select_opponents or select_mode
    if (this.stage === 'select_opponents' || this.stage === 'select_mode') {
      if (action === 'easy' || action === 'medium' || action === 'hard') {
        this.mode = action;
        const names = this.opponents.map((o) => o.profile.name).join(', ');
        this.narrative.push({
          speaker: 'System',
          text: `Difficulty set to ${this.mode.toUpperCase()}. Opponents: ${names}.`,
        });
        this.startNewHand();
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
        this.handlePlayerFold();
        return this.getState();
      }

      if (action === 'bet') {
        const betAmt = currentStreet.bet;
        this.pot += betAmt;
        this.playerChips -= betAmt;
        this.playerHandContribution += betAmt;
        this.turnStartPot = this.pot;
        this.lastAction = { actor: 'player', action: 'bet', amount: betAmt };
        this.narrative.push({ speaker: 'You', text: `You bet $${betAmt}.` });

        const callers: string[] = [];
        const folders: string[] = [];

        for (const opp of this.getActiveOpponents()) {
          if (!opp.cards) continue;
          const decision = decideAction(this.mode, opp.cards, this.board, true);
          if (decision === 'fold') {
            this.foldOpponent(opp);
            this.recordTurnEvent(opp, 'fold');
            folders.push(opp.profile.shortName);
          } else {
            this.callOpponent(opp, betAmt);
            this.recordTurnEvent(opp, 'call', betAmt);
            callers.push(opp.profile.shortName);
          }
        }

        if (this.getActiveOpponents().length === 0) {
          this.handleAllOpponentsFold();
          return this.getState();
        }

        const summaryParts: string[] = [];
        if (callers.length > 0) summaryParts.push(`${this.formatNameList(callers)} call $${betAmt}`);
        if (folders.length > 0) summaryParts.push(`${this.formatNameList(folders)} fold`);
        const summaryText = `${summaryParts.join('; ')}. Pot is $${this.pot}.`;
        this.dealerSpeech = summaryText;
        this.narrative.push({ speaker: 'Dealer', text: summaryText });
        this.lastAction = { actor: 'opponent', action: 'call', amount: betAmt };

        this.advanceStreet();
        return this.getState();
      }

      if (action === 'check') {
        this.turnStartPot = this.pot;
        this.lastAction = { actor: 'player', action: 'check' };
        this.narrative.push({ speaker: 'You', text: 'You check.' });

        const active = this.getActiveOpponents();
        let bettor: InternalOpponent | null = null;
        const checkedBeforeBet: InternalOpponent[] = [];
        const callers: string[] = [];
        const folders: string[] = [];
        const betAmt = currentStreet.bet;

        for (const opp of active) {
          if (!opp.cards) continue;
          if (!bettor) {
            const decision = decideAction(this.mode, opp.cards, this.board, false);
            if (decision === 'bet') {
              bettor = opp;
              opp.chips -= betAmt;
              opp.handContribution += betAmt;
              this.pot += betAmt;
              opp.lastAction = `Bets $${betAmt}`;
              opp.reaction = 'confident';
              opp.speech = opp.profile.betLine(betAmt);
              this.narrative.push({ speaker: opp.profile.shortName, text: `Bets $${betAmt}.` });
              this.recordTurnEvent(opp, 'bet', betAmt);
            } else {
              opp.lastAction = 'Checks';
              opp.reaction = 'neutral';
              opp.speech = opp.profile.checkLine;
              checkedBeforeBet.push(opp);
              this.recordTurnEvent(opp, 'check');
            }
          } else {
            const decision = decideAction(this.mode, opp.cards, this.board, true);
            if (decision === 'fold') {
              this.foldOpponent(opp);
              this.recordTurnEvent(opp, 'fold');
              folders.push(opp.profile.shortName);
            } else {
              this.callOpponent(opp, betAmt);
              this.recordTurnEvent(opp, 'call', betAmt);
              callers.push(opp.profile.shortName);
            }
          }
        }

        if (bettor) {
          for (const opp of checkedBeforeBet) {
            if (!opp.cards) continue;
            const decision = decideAction(this.mode, opp.cards, this.board, true);
            if (decision === 'fold') {
              this.foldOpponent(opp);
              this.recordTurnEvent(opp, 'fold');
              folders.push(opp.profile.shortName);
            } else {
              this.callOpponent(opp, betAmt);
              this.recordTurnEvent(opp, 'call', betAmt);
              callers.push(opp.profile.shortName);
            }
          }

          this.currentBettorName = bettor.profile.name;
          this.lastAction = { actor: 'opponent', action: 'bet', amount: betAmt };
          const parts = [`${bettor.profile.shortName} bets $${betAmt}`];
          if (callers.length > 0) parts.push(`${this.formatNameList(callers)} call`);
          if (folders.length > 0) parts.push(`${this.formatNameList(folders)} fold`);
          this.dealerSpeech = `${parts.join('; ')}. Your response?`;
          this.stage = 'player_response';
          return this.getState();
        }

        this.lastAction = { actor: 'opponent', action: 'check' };
        this.dealerSpeech = 'Everyone checks around the table.';
        this.narrative.push({ speaker: 'Dealer', text: 'All active players check.' });

        this.advanceStreet();
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
        this.handlePlayerFold();
        return this.getState();
      }

      if (action === 'call') {
        const betAmt = currentStreet.bet;
        this.pot += betAmt;
        this.playerChips -= betAmt;
        this.playerHandContribution += betAmt;
        this.currentBettorName = null;
        this.lastAction = { actor: 'player', action: 'call', amount: betAmt };
        this.dealerSpeech = `You call $${betAmt}. Pot is $${this.pot}.`;
        this.narrative.push({ speaker: 'You', text: `You call $${betAmt}.` });

        this.advanceStreet();
        return this.getState();
      }

      throw new Error(`Invalid response: ${action}. Expected call or fold.`);
    }

    if (this.stage === 'hand_over') {
      if (action === 'yes' || action === 'y' || action === 'again') {
        this.startNewHand();
        return this.getState();
      }
      if (action === 'no' || action === 'n' || action === 'quit') {
        this.stage = 'game_over';
        this.dealerSpeech = 'Thanks for playing at the VIP High Roller table!';
        this.narrative.push({ speaker: 'Dealer', text: 'Session finished. Thank you for playing!' });
        return this.getState();
      }
      throw new Error(`Invalid choice: ${action}. Expected yes or no.`);
    }

    if (this.stage === 'game_over') {
      if (action === 'restart' || action === 'yes' || action === 'y') {
        this.playerChips = 500;
        this.playerHandContribution = 0;
        this.playerTotalPotWon = 0;
        this.playerHandsWon = 0;
        this.handCount = 0;
        this.mode = null;
        this.board = [];
        this.playerCards = null;
        this.outcome = null;
        this.stage = 'select_opponents';
        this.dealerSpeech = 'New session! Choose 4 opponents to join your table.';
        return this.getState();
      }
      throw new Error('Game is over. Send restart to play again.');
    }

    return this.getState();
  }

  private foldOpponent(opp: InternalOpponent): void {
    opp.folded = true;
    opp.cardsHidden = true;
    opp.lastAction = 'Folded';
    opp.reaction = 'folded';
    opp.speech = opp.profile.foldLine;
    this.narrative.push({ speaker: opp.profile.shortName, text: 'Folds.' });
  }

  private callOpponent(opp: InternalOpponent, betAmt: number): void {
    opp.chips -= betAmt;
    opp.handContribution += betAmt;
    this.pot += betAmt;
    opp.lastAction = `Calls $${betAmt}`;
    opp.reaction = 'confident';
    opp.speech = opp.profile.callLine(betAmt);
    this.narrative.push({ speaker: opp.profile.shortName, text: `Calls $${betAmt}.` });
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
    this.deck = new Deck();
    this.playerCards = [this.deck.draw(), this.deck.draw()];
    this.playerHandContribution = 0;

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

  private advanceStreet(): void {
    this.streetIndex += 1;

    for (const opp of this.opponents) {
      opp.speech = '';
      if (!opp.folded) {
        opp.lastAction = null;
      }
    }

    if (this.streetIndex === 1) {
      this.board.push(this.deck.draw(), this.deck.draw(), this.deck.draw());
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
      this.board.push(this.deck.draw());
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
      this.board.push(this.deck.draw());
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

  private handlePlayerFold(): void {
    if (!this.playerCards) return;

    while (this.board.length < 5) {
      this.board.push(this.deck.draw());
    }

    for (const opp of this.opponents) {
      opp.cardsHidden = true;
    }

    const active = this.getActiveOpponents();
    const contenders = active.length > 0 ? active : [this.getPrimaryOpponent()];

    let potWinners: InternalOpponent[] = [contenders[0]!];
    for (let i = 1; i < contenders.length; i += 1) {
      const candidate = contenders[i]!;
      if (!candidate.cards || !potWinners[0]?.cards) continue;
      const cmp = compareHands([...candidate.cards, ...this.board], [...potWinners[0].cards, ...this.board]);
      if (cmp > 0) {
        potWinners = [candidate];
      } else if (cmp === 0) {
        potWinners.push(candidate);
      }
    }

    const share = Math.floor(this.pot / potWinners.length);
    let remainder = this.pot - share * potWinners.length;
    for (const winner of potWinners) {
      const payout = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      winner.chips += payout;
      winner.totalPotWon += payout;
      winner.handsWon += 1;
      winner.reaction = 'celebrating';
      winner.speech = winner.profile.winLine;
      winner.lastAction = 'Wins Pot';
    }

    const winnerNames = potWinners.map((w) => w.profile.name);
    const winnerLabel = this.formatNameList(winnerNames);
    const playerRank = evaluateHand([...this.playerCards, ...this.board]);
    const explanation = `You folded! ${winnerLabel} ${potWinners.length > 1 ? 'split' : 'won'} the $${this.pot} pot.`;

    this.dealerSpeech = explanation;
    this.narrative.push({ speaker: 'You', text: 'You folded.' }, { speaker: 'Dealer', text: explanation });

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
    this.playerChips += this.pot;
    this.playerTotalPotWon += this.pot;
    this.playerHandsWon += 1;
    const explanation = `All opponents folded! You won the $${this.pot} pot uncontested!`;
    this.dealerSpeech = explanation;
    this.narrative.push({ speaker: 'Dealer', text: explanation });

    this.outcome = {
      result: 'win',
      pot: this.pot,
      playerRank: null,
      opponentRank: null,
      winnerNames: ['You'],
      message: `All opponents folded! You won the $${this.pot} pot!`,
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

    let winners: Contender[] = [contenders[0]!];
    for (let i = 1; i < contenders.length; i += 1) {
      const c = contenders[i]!;
      const cmp = compareHands(c.cards, winners[0]!.cards);
      if (cmp > 0) {
        winners = [c];
      } else if (cmp === 0) {
        winners.push(c);
      }
    }

    const playerInWinners = winners.some((w) => w.isPlayer);
    const winningOpponents = winners.filter((w) => !w.isPlayer);

    const oppContenders = contenders.filter((c) => !c.isPlayer);
    let bestOpp = oppContenders[0]!;
    for (let i = 1; i < oppContenders.length; i += 1) {
      if (compareHands(oppContenders[i]!.cards, bestOpp.cards) > 0) {
        bestOpp = oppContenders[i]!;
      }
    }

    const oppBreakdown = oppContenders.map((c) => `${c.name}: ${c.rank.name}`).join(', ');

    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;
    for (const w of winners) {
      const payout = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      if (w.isPlayer) {
        this.playerChips += payout;
        this.playerTotalPotWon += payout;
        this.playerHandsWon += 1;
      } else if (w.opp) {
        w.opp.chips += payout;
        w.opp.totalPotWon += payout;
        w.opp.handsWon += 1;
      }
    }

    const winnerSet = new Set(winners.map((w) => w.opp?.profile.id));
    for (const opp of activeOpponents) {
      if (winnerSet.has(opp.profile.id)) {
        opp.reaction = winners.length > 1 ? 'neutral' : 'celebrating';
        opp.speech = winners.length > 1 ? opp.profile.tieLine : opp.profile.winLine;
        opp.lastAction = winners.length > 1 ? `Tie (${opp.rank?.name})` : `Wins (${opp.rank?.name})`;
      } else {
        opp.reaction = 'defeated';
        opp.speech = opp.profile.loseLine;
        opp.lastAction = opp.rank?.name ?? null;
      }
    }

    if (playerInWinners && winningOpponents.length === 0) {
      const explanation = `Showdown! You won the $${this.pot} pot with ${playerRank.name}! (${oppBreakdown}).`;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: explanation });
      this.outcome = {
        result: 'win',
        pot: this.pot,
        playerRank,
        opponentRank: bestOpp.rank,
        winnerNames: ['You'],
        message: `You won $${this.pot}! Your ${playerRank.name} beat ${bestOpp.name}'s ${bestOpp.rank.name}${oppContenders.length > 1 ? ` (${oppBreakdown})` : ''}.`,
      };
    } else if (playerInWinners && winningOpponents.length > 0) {
      const tiedOppNames = this.formatNameList(winningOpponents.map((w) => w.name));
      const explanation = `Showdown! Tie with ${tiedOppNames} — both held ${playerRank.name}. Pot of $${this.pot} is split!`;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: explanation });
      this.outcome = {
        result: 'tie',
        pot: this.pot,
        playerRank,
        opponentRank: bestOpp.rank,
        winnerNames: winners.map((w) => w.name),
        message: `Tie with ${tiedOppNames} (${playerRank.name})! Pot of $${this.pot} split.`,
      };
    } else {
      const winnerLabel = this.formatNameList(winningOpponents.map((w) => w.name));
      const winningRankName = winningOpponents[0]!.rank.name;
      const explanation = `Showdown! ${winnerLabel} won the $${this.pot} pot with ${winningRankName}, beating your ${playerRank.name}.`;
      const lesson = `Lesson: your ${playerRank.name} lost to ${winnerLabel}'s ${winningRankName}.`;
      this.dealerSpeech = explanation;
      this.narrative.push({ speaker: 'Dealer', text: `${explanation} (${oppBreakdown}).` });
      this.outcome = {
        result: 'loss',
        pot: this.pot,
        playerRank,
        opponentRank: winningOpponents[0]!.rank,
        winnerNames: winningOpponents.map((w) => w.name),
        message: `${winnerLabel} won $${this.pot} with ${winningRankName} over your ${playerRank.name}.`,
        lesson,
      };
    }

    this.stage = 'hand_over';
  }

  private getPrompt(): PromptInfo | null {
    if (this.stage === 'select_opponents') {
      return {
        type: 'select_opponents',
        message: 'Select 4 opponents from the VIP roster:',
        choices: [{ id: 'random_opponents', label: 'Random 4 Opponents', key: 'R', variant: 'primary' }],
      };
    }

    if (this.stage === 'select_mode') {
      return {
        type: 'select_mode',
        message: 'Choose table difficulty:',
        choices: [
          { id: 'easy', label: 'Easy', key: '1' },
          { id: 'medium', label: 'Medium', key: '2' },
          { id: 'hard', label: 'Hard', key: '3' },
        ],
      };
    }

    if (this.stage === 'player_action') {
      const betAmt = STREETS[this.streetIndex]?.bet ?? 10;
      return {
        type: 'player_action',
        message: `Your action (${STREETS[this.streetIndex]?.name}):`,
        choices: [
          { id: 'check', label: 'Check', key: 'C', variant: 'primary' },
          { id: 'bet', label: `Bet $${betAmt}`, key: 'B', variant: 'default' },
          { id: 'fold', label: 'Fold', key: 'F', variant: 'danger' },
        ],
      };
    }

    if (this.stage === 'player_response') {
      const betAmt = STREETS[this.streetIndex]?.bet ?? 10;
      const bettorLabel = this.currentBettorName ?? 'Opponent';
      return {
        type: 'player_response',
        message: `${bettorLabel} bet $${betAmt}. Your response:`,
        choices: [
          { id: 'call', label: `Call $${betAmt}`, key: 'C', variant: 'primary' },
          { id: 'fold', label: 'Fold', key: 'F', variant: 'danger' },
        ],
      };
    }

    if (this.stage === 'hand_over') {
      const outcomeNote = this.outcome?.message ? `${this.outcome.message} ` : '';
      return {
        type: 'hand_over',
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
        message: 'Session complete.',
        choices: [{ id: 'restart', label: 'Start New Session', key: 'Space', variant: 'primary' }],
      };
    }

    return null;
  }
}
