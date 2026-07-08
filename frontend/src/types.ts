export type TileState = 'empty' | 'tbd' | 'correct' | 'present' | 'absent'
export type EvaluatedState = Exclude<TileState, 'empty' | 'tbd'>
export type TileAnimation = 'idle' | 'pop' | 'flip-in' | 'flip-out'
export type GameStatus = 'playing' | 'won' | 'lost'
export type PlayMode = 'daily' | 'random' | 'past'
export type FamilyStatsView = 'overview' | 'players' | 'daily'
export type WordbeeGameKey = 'wordle' | 'sudoku' | 'connections' | 'strands'
export type AdditionalGameKey = Exclude<WordbeeGameKey, 'wordle'>

export type PuzzleMetadata = {
  date: string
  answerLength: number
  confidence: number
  mode: PlayMode
  puzzleId?: string
  status: string
}

export type GuessResponse = {
  scores: EvaluatedState[]
  didWin: boolean
  answer?: string
}

export type DefinitionSummary = {
  word: string
  phonetic: string
  partOfSpeech: string
  definition: string
  synonyms: string[]
  sourceUrl: string
}

export type StarterStat = {
  word: string
  count: number
  percentage: number
}

export type StarterInsight = StarterStat & {
  users: number
  averageGuesses: number
  winPercentage: number
}

export type StatsSummary = {
  played: number
  wins: number
  winPercentage: number
  averageGuesses: number
  currentStreak: number
  maxStreak: number
  currentWinStreak: number
  bestWinStreak: number
  currentPlayStreak: number
  bestPlayStreak: number
  guessDistribution: Record<string, number>
  topStarters: StarterStat[]
  averageSkill?: number
  averageLuck?: number
  favoriteStarter?: StarterStat | null
}

export type GuessAnalysisStep = {
  turn: number
  guess: string
  states: EvaluatedState[]
  before: number
  after: number
  eliminated: number
  eliminatedPercentage: number
  bestWord: string
  bestRemaining: number
  skill: number
  luck: number
  expectedRemaining: number
}

export type SolveAnalysis = {
  skill: number
  luck: number
  openerScore: number
  pathLabel: string
  remainingAfterLast: number
  steps: GuessAnalysisStep[]
}

export type AvatarFeatureKey =
  | 'hairVariant'
  | 'clothesVariant'
  | 'gestureVariant'
  | 'glassesVariant'
  | 'beardVariant'
  | 'clothesGraphicVariant'
  | 'eyebrowsVariant'
  | 'eyesVariant'
  | 'noseVariant'
  | 'mouthVariant'

export type AvatarConfig = {
  version: number
  seed: string
} & Record<AvatarFeatureKey, string>

export type FamilyDailyResult = {
  id: string
  userId: string
  displayName: string
  avatar?: AvatarConfig
  date: string
  answer?: string
  outcome: Exclude<GameStatus, 'playing'>
  guessesUsed: number
  starterWord: string
  guesses: string[]
  board: EvaluatedState[][]
  completedAt: string
  locked?: boolean
  analysis?: SolveAnalysis
}

export type FamilyStatsUser = {
  id: string
  displayName: string
  avatar?: AvatarConfig
  firstName: string
  lastInitial: string
  stats: StatsSummary
  history: FamilyDailyResult[]
}

export type FamilyTimelineDay = {
  date: string
  answer: string
  players: number
  wins: number
  winPercentage: number
  averageGuesses: number
  averageSkill: number
  averageLuck: number
  topStarter: string
  bestPlayer: string
  bestScore: string
  locked?: boolean
}

export type FamilyGroupStats = {
  played: number
  wins: number
  winPercentage: number
  averageGuesses: number
  averageSkill: number
  averageLuck: number
  daysTracked: number
  players: number
  guessDistribution: Record<string, number>
  topStarters: StarterInsight[]
  timeline: FamilyTimelineDay[]
  recentResults: FamilyDailyResult[]
  bestDay?: FamilyTimelineDay | null
  toughestDay?: FamilyTimelineDay | null
}

export type FamilyStatsDashboard = {
  canRevealCurrentDay?: boolean
  currentDate?: string
  currentUserId: string
  group?: FamilyGroupStats
  users: FamilyStatsUser[]
}

export type DateClampInfo = {
  firstDate?: string
  clampedToOldest?: boolean
  oldestDate?: string
  clampedToNewest?: boolean
  newestDate?: string
}

export type ConnectionsCard = {
  id: string
  content: string
  position: number
}

export type ConnectionsGroup = {
  title: string
  cards: string[]
  rank: number
}

export type ConnectionsPuzzle = DateClampInfo & {
  gameKey: 'connections'
  date: string
  editor: string
  status: string
  cards: ConnectionsCard[]
  mistakesAllowed: number
}

export type ConnectionsGuessResponse = {
  correct: boolean
  oneAway: boolean
  group?: ConnectionsGroup
}

export type StrandsCoord = [number, number]

export type StrandsPuzzle = DateClampInfo & {
  gameKey: 'strands'
  date: string
  clue: string
  constructors: string
  editor: string
  status: string
  board: string[]
  themeWordCount: number
  spangramLength: number
}

export type StrandsGuessResponse = {
  valid: boolean
  kind: 'theme' | 'spangram' | 'bonus' | 'invalid'
  word: string
  path?: StrandsCoord[]
}

export type SudokuDifficulty = 'easy' | 'medium' | 'hard'

export type SudokuPuzzle = DateClampInfo & {
  gameKey: 'sudoku'
  date: string
  difficulty: SudokuDifficulty
  displayDate: string
  status: string
  puzzle: number[]
}

export type SudokuCheckResponse = {
  complete: boolean
  mistakes: number[]
  solved: boolean
}

export type MultigameStatsSummary = {
  averageSeconds: number
  played: number
  solveRate: number
  wins: number
}

export type MultigameResult = {
  id: string
  userId: string
  displayName: string
  avatar?: AvatarConfig
  gameKey: AdditionalGameKey
  date: string
  variant: string
  outcome: Exclude<GameStatus, 'playing'>
  elapsedSeconds: number | null
  score: Record<string, unknown>
  completedAt: string
  locked?: boolean
}

export type MultigameStatsUser = {
  id: string
  displayName: string
  avatar?: AvatarConfig
  firstName: string
  lastInitial: string
  stats: MultigameStatsSummary
  history: MultigameResult[]
}

export type MultigameDashboard = {
  currentUserId: string
  games: Record<
    AdditionalGameKey,
    {
      groupStats: MultigameStatsSummary
      users: MultigameStatsUser[]
    }
  >
}

export type MultigameResultResponse = {
  ok: boolean
  created: boolean
  result?: MultigameResult
}

// The minimal shape the results dialog needs. Both a freshly finished play and a
// server-loaded MultigameResult satisfy it.
export type MultigameCompletionResult = {
  outcome: Exclude<GameStatus, 'playing'>
  elapsedSeconds: number | null
  date: string
  variant: string
  score: Record<string, unknown>
}

export type MultigameCompleteHandler = (
  result: MultigameCompletionResult,
  stats: MultigameStatsSummary | null,
) => void

export type MultigameStatusResponse = {
  completed: boolean
  result: MultigameResult | null
  attempt: { state: Record<string, unknown>; updatedAt: string } | null
}

export type CalendarOutcome = 'won' | 'lost' | 'locked'
export type CalendarPlayType = 'daily' | 'retro'

export type CalendarEntry = {
  date: string
  outcome: CalendarOutcome
  playType: CalendarPlayType
  detail?: Record<string, unknown>
}

export type GameCalendar = {
  gameKey: WordbeeGameKey
  userId: string
  displayName: string
  firstDate: string
  currentDate: string
  canRevealCurrentDay: boolean
  entries: CalendarEntry[]
}

export type FamilyDailyAttempt = {
  userId: string
  date: string
  guesses: string[]
  guessesUsed: number
  board: EvaluatedState[][]
  updatedAt: string
}

export type FamilyTodayStatus = {
  attempt?: FamilyDailyAttempt
  completed: boolean
  result?: FamilyDailyResult
  stats: StatsSummary
  definition?: DefinitionSummary
}

export type ResultsResponse = {
  stats: StatsSummary
  answer?: string
  definition?: DefinitionSummary
  result?: FamilyDailyResult
}

export type GameResult = {
  mode: PlayMode
  outcome: GameStatus
  guessesUsed: number
  board: EvaluatedState[][]
  guesses: string[]
  stats: StatsSummary
  answer?: string
  analysis?: SolveAnalysis
  copied: boolean
  definition?: DefinitionSummary
  saved: boolean
}

export type Settings = {
  darkThemeOverride: boolean | null
  highContrast: boolean
  onscreenKeyboardOnly: boolean
}

export type AvatarOption = {
  label: string
  value: string
}

export type GuestAccess = {
  kind: 'guest'
}

export type FriendsFamilyIdentity = {
  kind: 'friends-family'
  userId: string
  displayName: string
  firstName: string
  lastInitial: string
  avatar?: AvatarConfig
}

export type PendingFriendsFamilyIdentity = Omit<FriendsFamilyIdentity, 'userId'> & {
  userId?: string
}

export type FriendsFamilyAccess = FriendsFamilyIdentity & {
  avatar: AvatarConfig
  token: string
}

export type PendingFriendsFamilyAccess = PendingFriendsFamilyIdentity & {
  avatar: AvatarConfig
}

export type AccessState = GuestAccess | FriendsFamilyAccess

export type AccessLoginResponse = {
  identity?: FriendsFamilyIdentity
  pendingIdentity?: PendingFriendsFamilyIdentity
  requiresAvatar?: boolean
  token?: string
}

export type AccessVerifyResponse = {
  identity: FriendsFamilyIdentity
}

export type AccessValidateResponse = {
  ok: boolean
}

export type Tile = {
  letter: string
  state: TileState
  animation: TileAnimation
}

export type CompletedResultInput = {
  answer?: string
  board: EvaluatedState[][]
  guesses: string[]
  guessesUsed: number
  outcome: GameStatus
}
