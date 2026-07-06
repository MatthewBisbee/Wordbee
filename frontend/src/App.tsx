import type { CSSProperties } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import closeIconMarkup from './assets/icons/icon-close.svg?raw'
import menuIconMarkup from './assets/icons/icon-menu.svg?raw'
import settingsIconMarkup from './assets/icons/icon-settings.svg?raw'
import statsIconMarkup from './assets/icons/icon-stats.svg?raw'
import wordleLogoUrl from './assets/Wordle_Logo.svg'
import './App.css'

const WORD_LENGTH = 5
const MAX_GUESSES = 6
const GUESS_DISTRIBUTION_ROWS = [
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3' },
  { key: '4', label: '4' },
  { key: '5', label: '5' },
  { key: '6', label: '6' },
  { key: 'fail', label: 'X' },
] as const
const FLIP_HALF_MS = 250
const REVEAL_STEP_MS = 250
const DANCE_STEP_MS = 100
const REVEAL_DONE_MS = (WORD_LENGTH - 1) * REVEAL_STEP_MS + FLIP_HALF_MS * 2 + 100
const COMPLETION_TOAST_MS = 2600
const RESULTS_REVEAL_DELAY_MS = 950
const COPY_FEEDBACK_MS = 1300
const SETTINGS_STORAGE_KEY = 'wordbee.settings.v1'
const ACCESS_STORAGE_KEY = 'wordbee.access.v1'
const LEGACY_AVATAR_STORAGE_KEY = 'wordbee.avatars.v1'
const CLIENT_SESSION_STORAGE_KEY = 'wordbee.client-session.v1'
const FIRST_OFFICIAL_PUZZLE_DATE = '2021-06-19'
const AVATAR_API_URL = 'https://api.dicebear.com/10.x/notionists/svg'
const AVATAR_CONFIG_VERSION = 1
const AVATAR_HAIR_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Hat', value: 'hat' },
  ...createVariantOptions(63),
] as const
const AVATAR_CLOTHES_OPTIONS = createVariantOptions(25)
const AVATAR_GESTURE_OPTIONS = [
  { label: 'Hand', value: 'hand' },
  { label: 'Phone', value: 'handPhone' },
  { label: 'OK', value: 'ok' },
  { label: 'Long OK', value: 'okLongArm' },
  { label: 'Point', value: 'point' },
  { label: 'Long point', value: 'pointLongArm' },
  { label: 'Wave', value: 'waveLongArm' },
  { label: 'Two-arm wave', value: 'waveLongArms' },
  { label: 'Wave OK', value: 'waveOkLongArms' },
  { label: 'Wave point', value: 'wavePointLongArms' },
] as const
const AVATAR_GLASSES_OPTIONS = [
  { label: 'None', value: 'none' },
  ...createVariantOptions(11),
] as const
const AVATAR_BEARD_OPTIONS = [{ label: 'None', value: 'none' }, ...createVariantOptions(12)]
const AVATAR_CLOTHES_GRAPHIC_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Electric', value: 'electric' },
  { label: 'Galaxy', value: 'galaxy' },
  { label: 'Saturn', value: 'saturn' },
] as const
const AVATAR_EYEBROWS_OPTIONS = createVariantOptions(13)
const AVATAR_EYES_OPTIONS = createVariantOptions(5)
const AVATAR_MOUTH_OPTIONS = createVariantOptions(30)
const AVATAR_NOSE_OPTIONS = createVariantOptions(20)
const AVATAR_FEATURES = [
  { key: 'hairVariant', label: 'Hair', options: AVATAR_HAIR_OPTIONS },
  { key: 'clothesVariant', label: 'Clothes', options: AVATAR_CLOTHES_OPTIONS },
  { key: 'gestureVariant', label: 'Pose', options: AVATAR_GESTURE_OPTIONS },
  { key: 'glassesVariant', label: 'Glasses', options: AVATAR_GLASSES_OPTIONS },
  { key: 'beardVariant', label: 'Facial hair', options: AVATAR_BEARD_OPTIONS },
  {
    key: 'clothesGraphicVariant',
    label: 'Shirt graphic',
    options: AVATAR_CLOTHES_GRAPHIC_OPTIONS,
  },
  { key: 'eyebrowsVariant', label: 'Eyebrows', options: AVATAR_EYEBROWS_OPTIONS },
  { key: 'eyesVariant', label: 'Eyes', options: AVATAR_EYES_OPTIONS },
  { key: 'noseVariant', label: 'Nose', options: AVATAR_NOSE_OPTIONS },
  { key: 'mouthVariant', label: 'Mouth', options: AVATAR_MOUTH_OPTIONS },
] as const
const AVATAR_GRAPHIC_COMPATIBLE_CLOTHES = new Set(
  createVariantOptions(10).map((option) => option.value),
)
const AVATAR_GRAPHIC_UNAVAILABLE_OPTIONS = [
  { label: 'Not on this shirt', value: 'none' },
] as const
const DICE_FRAME_INTERVAL_MS = 22
const DICE_FIRST_ROLL_FRAME = 6
const DICE_REST_FRAME = 90
const DICE_FRAME_MODULES = import.meta.glob<string>('./assets/dice/*.gif', {
  eager: true,
  query: '?url',
  import: 'default',
})
const DICE_ROLL_FRAMES = Object.entries(DICE_FRAME_MODULES)
  .map(([path, src]) => ({
    frame: Number(path.match(/frame_(\d+)_/)?.[1] ?? 0),
    src,
  }))
  .filter(({ frame }) => frame >= DICE_FIRST_ROLL_FRAME && frame <= DICE_REST_FRAME)
  .sort((a, b) => a.frame - b.frame)
const DICE_REST_SRC =
  DICE_ROLL_FRAMES.find(({ frame }) => frame === DICE_REST_FRAME)?.src ??
  DICE_ROLL_FRAMES[DICE_ROLL_FRAMES.length - 1]?.src ??
  ''
const SKILL_HELP_TEXT =
  'Skill scores how efficiently your guesses split the remaining possible answers. If only one answer is left, only playing that answer scores well.'
const LUCK_HELP_TEXT =
  "Luck compares the clue you actually received with that guess's average clue spread. Higher means the answer gave more help than expected."
const EMPTY_STATS: StatsSummary = {
  played: 0,
  wins: 0,
  winPercentage: 0,
  averageGuesses: 0,
  currentStreak: 0,
  maxStreak: 0,
  currentWinStreak: 0,
  bestWinStreak: 0,
  currentPlayStreak: 0,
  bestPlayStreak: 0,
  guessDistribution: {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    fail: 0,
  },
  topStarters: [],
}

type TileState = 'empty' | 'tbd' | 'correct' | 'present' | 'absent'
type EvaluatedState = Exclude<TileState, 'empty' | 'tbd'>
type TileAnimation = 'idle' | 'pop' | 'flip-in' | 'flip-out'
type GameStatus = 'playing' | 'won' | 'lost'
type PlayMode = 'daily' | 'random' | 'past'
type FamilyStatsView = 'overview' | 'players' | 'daily'
type PuzzleMetadata = {
  date: string
  answerLength: number
  confidence: number
  mode: PlayMode
  puzzleId?: string
  status: string
}
type GuessResponse = {
  scores: EvaluatedState[]
  didWin: boolean
  answer?: string
}
type DefinitionSummary = {
  word: string
  phonetic: string
  partOfSpeech: string
  definition: string
  synonyms: string[]
  sourceUrl: string
}
type StatsSummary = {
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
type StarterStat = {
  word: string
  count: number
  percentage: number
}
type StarterInsight = StarterStat & {
  users: number
  averageGuesses: number
  winPercentage: number
}
type GuessAnalysisStep = {
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
type SolveAnalysis = {
  skill: number
  luck: number
  openerScore: number
  pathLabel: string
  remainingAfterLast: number
  steps: GuessAnalysisStep[]
}
type FamilyDailyResult = {
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
type FamilyStatsUser = {
  id: string
  displayName: string
  avatar?: AvatarConfig
  firstName: string
  lastInitial: string
  stats: StatsSummary
  history: FamilyDailyResult[]
}
type FamilyTimelineDay = {
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
type FamilyGroupStats = {
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
type FamilyStatsDashboard = {
  canRevealCurrentDay?: boolean
  currentDate?: string
  currentUserId: string
  group?: FamilyGroupStats
  users: FamilyStatsUser[]
}
type FamilyTodayStatus = {
  attempt?: FamilyDailyAttempt
  completed: boolean
  result?: FamilyDailyResult
  stats: StatsSummary
  definition?: DefinitionSummary
}
type FamilyDailyAttempt = {
  userId: string
  date: string
  guesses: string[]
  guessesUsed: number
  board: EvaluatedState[][]
  updatedAt: string
}
type ResultsResponse = {
  stats: StatsSummary
  answer?: string
  definition?: DefinitionSummary
  result?: FamilyDailyResult
}
type GameResult = {
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
type Settings = {
  darkThemeOverride: boolean | null
  highContrast: boolean
  onscreenKeyboardOnly: boolean
}
type AvatarOption = {
  label: string
  value: string
}
type AvatarFeatureKey = (typeof AVATAR_FEATURES)[number]['key']
type AvatarConfig = {
  version: typeof AVATAR_CONFIG_VERSION
  seed: string
} & Record<AvatarFeatureKey, string>
type GuestAccess = {
  kind: 'guest'
}
type FriendsFamilyIdentity = {
  kind: 'friends-family'
  userId: string
  displayName: string
  firstName: string
  lastInitial: string
  avatar?: AvatarConfig
}
type PendingFriendsFamilyIdentity = Omit<FriendsFamilyIdentity, 'userId'> & {
  userId?: string
}
type FriendsFamilyAccess = FriendsFamilyIdentity & {
  avatar: AvatarConfig
  token: string
}
type PendingFriendsFamilyAccess = PendingFriendsFamilyIdentity & {
  avatar: AvatarConfig
}
type AccessState = GuestAccess | FriendsFamilyAccess
type AccessLoginResponse = {
  identity?: FriendsFamilyIdentity
  pendingIdentity?: PendingFriendsFamilyIdentity
  requiresAvatar?: boolean
  token?: string
}
type AccessVerifyResponse = {
  identity: FriendsFamilyIdentity
}
type AccessValidateResponse = {
  ok: boolean
}

type Tile = {
  letter: string
  state: TileState
  animation: TileAnimation
}
type CompletedResultInput = {
  answer?: string
  board: EvaluatedState[][]
  guesses: string[]
  guessesUsed: number
  outcome: GameStatus
}

const keyboardRows = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['Enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'Backspace'],
]

const statePriority: Record<EvaluatedState, number> = {
  absent: 1,
  present: 2,
  correct: 3,
}

const defaultSettings: Settings = {
  darkThemeOverride: null,
  highContrast: false,
  onscreenKeyboardOnly: false,
}

function createVariantOptions(count: number): AvatarOption[] {
  return Array.from({ length: count }, (_, index) => {
    const displayNumber = index + 1
    return {
      label: `Style ${displayNumber}`,
      value: `variant${String(displayNumber).padStart(2, '0')}`,
    }
  })
}

function hashNumber(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function getRandomIndex(length: number) {
  if (length <= 0) return 0

  try {
    if (!window.crypto?.getRandomValues) throw new Error('Crypto unavailable')
    const randomValues = new Uint32Array(1)
    window.crypto.getRandomValues(randomValues)
    return randomValues[0] % length
  } catch {
    return Math.floor(Math.random() * length)
  }
}

function getRandomItem<Item>(items: readonly Item[]) {
  return items[getRandomIndex(items.length)]
}

function getDefaultAvatarFeatureValue(
  options: readonly AvatarOption[],
  seedHash: number,
  offset: number,
) {
  return options[(seedHash + offset) % options.length]?.value ?? ''
}

function isAvatarOptionValue(
  options: readonly AvatarOption[],
  value: unknown,
): value is string {
  return typeof value === 'string' && options.some((option) => option.value === value)
}

function avatarClothesSupportsGraphic(clothesVariant: string) {
  return AVATAR_GRAPHIC_COMPATIBLE_CLOTHES.has(clothesVariant)
}

function normalizeAvatarGraphic(avatar: AvatarConfig) {
  if (avatarClothesSupportsGraphic(avatar.clothesVariant)) {
    return avatar
  }

  return {
    ...avatar,
    clothesGraphicVariant: 'none',
  }
}

function createDefaultAvatarConfig(displayName = ''): AvatarConfig {
  const seedHash = hashNumber(displayName.trim().toLowerCase() || 'wordbee')
  const avatar = {
    seed: `wb-${seedHash.toString(36)}`,
    version: AVATAR_CONFIG_VERSION,
  } as AvatarConfig

  AVATAR_FEATURES.forEach((feature, index) => {
    avatar[feature.key] = getDefaultAvatarFeatureValue(feature.options, seedHash, index * 7)
  })

  return normalizeAvatarGraphic(avatar)
}

function createRandomAvatarConfig(previousAvatar: AvatarConfig): AvatarConfig {
  const nextAvatar = { ...previousAvatar }

  AVATAR_FEATURES.forEach((feature) => {
    nextAvatar[feature.key] = getRandomItem(feature.options).value
  })

  return normalizeAvatarGraphic(nextAvatar)
}

function sanitizeAvatarConfig(rawAvatar: unknown, displayName = ''): AvatarConfig {
  const defaultAvatar = createDefaultAvatarConfig(displayName)

  if (!rawAvatar || typeof rawAvatar !== 'object') {
    return defaultAvatar
  }

  const storedAvatar = rawAvatar as Partial<AvatarConfig>
  const avatar: AvatarConfig = {
    ...defaultAvatar,
    seed:
      typeof storedAvatar.seed === 'string' && storedAvatar.seed.trim()
        ? storedAvatar.seed.slice(0, 80)
        : defaultAvatar.seed,
    version: AVATAR_CONFIG_VERSION,
  }

  AVATAR_FEATURES.forEach((feature) => {
    const storedValue = storedAvatar[feature.key]

    if (isAvatarOptionValue(feature.options, storedValue)) {
      avatar[feature.key] = storedValue
    }
  })

  return normalizeAvatarGraphic(avatar)
}

function updateAvatarFeature(
  avatar: AvatarConfig,
  key: AvatarFeatureKey,
  value: string,
): AvatarConfig {
  const nextAvatar = {
    ...avatar,
    [key]: value,
  }

  if (
    key === 'clothesGraphicVariant' &&
    value !== 'none' &&
    !avatarClothesSupportsGraphic(nextAvatar.clothesVariant)
  ) {
    nextAvatar.clothesVariant = AVATAR_CLOTHES_OPTIONS[0].value
  }

  return normalizeAvatarGraphic(nextAvatar)
}

function setOptionalAvatarVariant(
  params: URLSearchParams,
  variantParameter: string,
  probabilityParameter: string,
  value: string,
) {
  if (value === 'none') {
    params.set(probabilityParameter, '0')
    return
  }

  params.set(probabilityParameter, '100')
  params.set(variantParameter, value)
}

function createAvatarUrl(avatar: AvatarConfig, size = 256) {
  const params = new URLSearchParams({
    clothesVariant: avatar.clothesVariant,
    eyebrowsVariant: avatar.eyebrowsVariant,
    eyesVariant: avatar.eyesVariant,
    gestureProbability: '100',
    gestureVariant: avatar.gestureVariant,
    mouthVariant: avatar.mouthVariant,
    noseVariant: avatar.noseVariant,
    seed: avatar.seed,
    size: String(size),
  })

  setOptionalAvatarVariant(params, 'hairVariant', 'hairProbability', avatar.hairVariant)
  setOptionalAvatarVariant(params, 'beardVariant', 'beardProbability', avatar.beardVariant)
  setOptionalAvatarVariant(
    params,
    'glassesVariant',
    'glassesProbability',
    avatar.glassesVariant,
  )
  setOptionalAvatarVariant(
    params,
    'clothesGraphicVariant',
    'clothesGraphicProbability',
    avatar.clothesGraphicVariant,
  )

  return `${AVATAR_API_URL}?${params.toString()}`
}

function decodeTokenPayload(rawToken: unknown) {
  if (typeof rawToken !== 'string' || !rawToken.includes('.')) return null

  try {
    const [encodedPayload] = rawToken.split('.', 1)
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(window.atob(`${base64}${padding}`)) as Record<string, unknown>
  } catch {
    return null
  }
}

function loadSettings(): Settings {
  try {
    const rawSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!rawSettings) return defaultSettings

    const storedSettings = JSON.parse(rawSettings) as Partial<Settings>
    return {
      ...defaultSettings,
      ...storedSettings,
      darkThemeOverride:
        typeof storedSettings.darkThemeOverride === 'boolean'
          ? storedSettings.darkThemeOverride
          : null,
    }
  } catch {
    return defaultSettings
  }
}

function loadAccessState(): AccessState | null {
  try {
    window.localStorage.removeItem(LEGACY_AVATAR_STORAGE_KEY)
    const rawAccess = window.localStorage.getItem(ACCESS_STORAGE_KEY)
    if (!rawAccess) return null

    const storedAccess = JSON.parse(rawAccess) as Partial<FriendsFamilyAccess | GuestAccess>
    if (storedAccess.kind === 'guest') {
      return { kind: 'guest' }
    }

    if (
      storedAccess.kind === 'friends-family' &&
      typeof storedAccess.displayName === 'string' &&
      typeof storedAccess.firstName === 'string' &&
      typeof storedAccess.lastInitial === 'string' &&
      typeof storedAccess.token === 'string'
    ) {
      const displayName = storedAccess.displayName.slice(0, 64)
      const tokenPayload = decodeTokenPayload(storedAccess.token)
      const userId =
        typeof storedAccess.userId === 'string'
          ? storedAccess.userId.slice(0, 80)
          : typeof tokenPayload?.userId === 'string'
            ? tokenPayload.userId.slice(0, 80)
            : ''

      return {
        avatar: createDefaultAvatarConfig(displayName),
        kind: 'friends-family',
        userId,
        displayName,
        firstName: storedAccess.firstName.slice(0, 40),
        lastInitial: storedAccess.lastInitial.slice(0, 1),
        token: storedAccess.token,
      }
    }
  } catch {
    window.localStorage.removeItem(ACCESS_STORAGE_KEY)
  }

  return null
}

function getDevicePrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function getIsStandaloneApp() {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean }
  return (
    navigatorWithStandalone.standalone === true ||
    (window.matchMedia?.('(display-mode: standalone)').matches ?? false)
  )
}

function createBoard() {
  return Array.from({ length: MAX_GUESSES }, () =>
    Array.from({ length: WORD_LENGTH }, () => ({
      letter: '',
      state: 'empty' as TileState,
      animation: 'idle' as TileAnimation,
    })),
  )
}

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function requestJson<ResponseBody>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const responseText = await response.text()
  let responseBody: { error?: string } = {}

  if (responseText.trim()) {
    try {
      responseBody = JSON.parse(responseText) as { error?: string }
    } catch {
      throw new ApiError(
        response.ok ? 'Invalid server response' : 'API server unavailable. Check the dev terminal.',
        response.status,
      )
    }
  }

	  if (!response.ok) {
	    throw new ApiError(
	      getApiErrorMessage(responseBody.error, response.status),
	      response.status,
	    )
	  }

  return responseBody as ResponseBody
}

function getApiErrorMessage(errorMessage: string | undefined, status: number) {
  if (
    status === 404 &&
    errorMessage?.includes('The requested URL was not found on the server')
  ) {
    return 'API route unavailable. Stop npm run dev and start it again.'
  }

  return errorMessage || 'API server unavailable'
}

function getClientSessionId() {
  try {
    const storedSessionId = window.sessionStorage.getItem(CLIENT_SESSION_STORAGE_KEY)
    if (storedSessionId) return storedSessionId

    const legacySessionId = window.localStorage.getItem(CLIENT_SESSION_STORAGE_KEY)
    if (legacySessionId) {
      window.sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, legacySessionId)
      window.localStorage.removeItem(CLIENT_SESSION_STORAGE_KEY)
      return legacySessionId
    }

    const sessionId = createRandomId()
    window.sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, sessionId)
    return sessionId
  } catch {
    return createRandomId()
  }
}

function getDefaultPastDate() {
  const dateValue = new Date()
  dateValue.setDate(dateValue.getDate() - 1)
  return formatDateInput(dateValue)
}

function formatDateInput(dateValue: Date) {
  const year = dateValue.getFullYear()
  const month = String(dateValue.getMonth() + 1).padStart(2, '0')
  const day = String(dateValue.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getPuzzleHeaderLabel(puzzle: PuzzleMetadata | null) {
  if (!puzzle) return ''
  if (puzzle.mode === 'random') return 'Random puzzle'
  if (puzzle.mode === 'past') return formatPuzzleHeaderDate(puzzle.date)
  return ''
}

function formatPuzzleHeaderDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number)
  if (!year || !month || !day) return dateValue

  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(
    new Date(year, month - 1, day),
  )

  return `${monthLabel} ${day}${getOrdinalSuffix(day)}, ${year}`
}

function getOrdinalSuffix(day: number) {
  const teenRemainder = day % 100
  if (teenRemainder >= 11 && teenRemainder <= 13) return 'th'

  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

function isSessionConflict(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.message === 'Session is active elsewhere'
  )
}

function isCompleteAccessLoginResponse(
  responseBody: AccessLoginResponse,
): responseBody is AccessLoginResponse & {
  identity: FriendsFamilyIdentity
  token: string
} {
  return responseBody.identity?.kind === 'friends-family' && typeof responseBody.token === 'string'
}

function isPendingAccessLoginResponse(
  responseBody: AccessLoginResponse,
): responseBody is AccessLoginResponse & {
  pendingIdentity: PendingFriendsFamilyIdentity
} {
  return (
    responseBody.requiresAvatar === true &&
    responseBody.pendingIdentity?.kind === 'friends-family' &&
    typeof responseBody.pendingIdentity.displayName === 'string' &&
    typeof responseBody.pendingIdentity.firstName === 'string' &&
    typeof responseBody.pendingIdentity.lastInitial === 'string'
  )
}

function createRandomId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createGameId(date: string) {
  if (window.crypto?.randomUUID) {
    return `${date}-${window.crypto.randomUUID()}`
  }

  return `${date}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getCompletedBoard(board: Tile[][], activeRow: number, scores: EvaluatedState[]) {
  return board
    .slice(0, activeRow)
    .map((row) => row.map((tile) => tile.state as EvaluatedState))
    .concat([scores])
}

function getCompletedGuesses(board: Tile[][], activeRow: number) {
  return board
    .slice(0, activeRow + 1)
    .map((row) => row.map((tile) => tile.letter).join(''))
}

function hydrateBoardFromResult(result: { guesses: string[]; board: EvaluatedState[][] }) {
  const nextBoard = createBoard()

  result.guesses.forEach((guess, rowIndex) => {
    const rowStates = result.board[rowIndex] ?? []

    guess.split('').forEach((letter, tileIndex) => {
      nextBoard[rowIndex][tileIndex] = {
        animation: 'idle',
        letter,
        state: rowStates[tileIndex] ?? 'absent',
      }
    })
  })

  return nextBoard
}

function getKeyboardStateFromResult(result: { guesses: string[]; board: EvaluatedState[][] }) {
  return result.guesses.reduce<Record<string, EvaluatedState>>((nextState, guess, rowIndex) => {
    guess.split('').forEach((letter, tileIndex) => {
      const state = result.board[rowIndex]?.[tileIndex]
      if (!state) return

      const normalizedLetter = letter.toLowerCase()
      const previousState = nextState[normalizedLetter]
      if (previousState && statePriority[previousState] >= statePriority[state]) return

      nextState[normalizedLetter] = state
    })

    return nextState
  }, {})
}

function createShareText(result: GameResult) {
  return result.board.map((row) =>
    row
      .map((state) => {
        if (state === 'correct') return '🟩'
        if (state === 'present') return '🟨'
        return '⬜'
      })
      .join(''),
  ).join('\n')
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.readOnly = true
    textArea.style.position = 'fixed'
    textArea.style.left = '0'
    textArea.style.top = '0'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()

    const copied = document.execCommand('copy')
    textArea.remove()

    if (!copied) {
      throw new Error('Clipboard unavailable')
    }
  }
}

function getDistributionMax(stats: StatsSummary) {
  return Math.max(1, ...Object.values(stats.guessDistribution))
}

function App() {
  const [board, setBoard] = useState(createBoard)
  const [settings, setSettings] = useState(loadSettings)
  const [accessState, setAccessState] = useState<AccessState | null>(loadAccessState)
  const [devicePrefersDark, setDevicePrefersDark] = useState(getDevicePrefersDark)
  const [currentRow, setCurrentRow] = useState(0)
  const [currentColumn, setCurrentColumn] = useState(0)
  const [keyboardState, setKeyboardState] = useState<Record<string, EvaluatedState>>({})
  const [toast, setToast] = useState('')
  const [invalidRow, setInvalidRow] = useState<number | null>(null)
  const [winningRow, setWinningRow] = useState<number | null>(null)
  const [status, setStatus] = useState<GameStatus>('playing')
  const [isRevealing, setIsRevealing] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAvatarBuilderOpen, setIsAvatarBuilderOpen] = useState(false)
  const [puzzle, setPuzzle] = useState<PuzzleMetadata | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [stats, setStats] = useState<StatsSummary>(EMPTY_STATS)
  const [familyStats, setFamilyStats] = useState<FamilyStatsDashboard | null>(null)
  const [familyStatsError, setFamilyStatsError] = useState('')
  const [isFamilyStatsLoading, setIsFamilyStatsLoading] = useState(false)
  const [isFamilyStatsOpen, setIsFamilyStatsOpen] = useState(false)
  const [familyStatsView, setFamilyStatsView] = useState<FamilyStatsView>('overview')
  const [pastWordDate, setPastWordDate] = useState(getDefaultPastDate)
  const [isFamilyDailyStatusLoading, setIsFamilyDailyStatusLoading] = useState(
    accessState?.kind === 'friends-family',
  )
  const [todayStatusReloadKey, setTodayStatusReloadKey] = useState(0)
  const [completedResult, setCompletedResult] = useState<GameResult | null>(null)
  const [isResultsOpen, setIsResultsOpen] = useState(false)
  const gameIdRef = useRef('')
  const clientSessionIdRef = useRef('')
  const menuAreaRef = useRef<HTMLDivElement | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const resultsRevealTimerRef = useRef<number | null>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const isDarkTheme = settings.darkThemeOverride ?? devicePrefersDark
  const friendsFamilyToken = accessState?.kind === 'friends-family' ? accessState.token : ''
  const isAccessPromptOpen = accessState === null
  if (!clientSessionIdRef.current) {
    clientSessionIdRef.current = getClientSessionId()
  }
  const clientSessionId = clientSessionIdRef.current
  const puzzleHeaderLabel = getPuzzleHeaderLabel(puzzle)
  const isStandaloneApp = getIsStandaloneApp()
  const isSolvedUntrackedPuzzle = Boolean(
    completedResult && puzzle?.mode !== 'daily' && completedResult.mode === puzzle?.mode,
  )

  const showToast = useCallback((message: string, durationMs = 1200) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }

    setToast(message)

    if (durationMs > 0) {
      toastTimerRef.current = window.setTimeout(() => {
        setToast('')
        toastTimerRef.current = null
      }, durationMs)
    }
  }, [])

  const updateSetting = useCallback(
    <Key extends keyof Settings>(key: Key, value: Settings[Key]) => {
      setSettings((previousSettings) => ({
        ...previousSettings,
        [key]: value,
      }))
    },
    [],
  )

  const resetGameState = useCallback((nextPuzzle: PuzzleMetadata | null) => {
    setBoard(createBoard())
    setKeyboardState({})
    setCurrentRow(0)
    setCurrentColumn(0)
    setInvalidRow(null)
    setWinningRow(null)
    setStatus('playing')
    setCompletedResult(null)
    setIsResultsOpen(false)

    if (nextPuzzle) {
      gameIdRef.current = createGameId(nextPuzzle.date)
    }
  }, [])

  const resetCurrentGame = useCallback(() => {
    resetGameState(puzzle)
  }, [puzzle, resetGameState])

  const signOut = useCallback(() => {
    const token = friendsFamilyToken
    if (token) {
      void requestJson<{ ok: boolean }>('/api/friends-family/sign-out', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientSessionId,
          token,
        }),
      }).catch((error) => {
        console.warn('Could not sign out server session', error)
      })
    }

    setAccessState(null)
    setFamilyStats(null)
    setFamilyStatsError('')
    setIsFamilyStatsOpen(false)
    setIsFamilyDailyStatusLoading(false)
    setIsMenuOpen(false)
    resetCurrentGame()
  }, [clientSessionId, friendsFamilyToken, resetCurrentGame])

  const handleAccessLogin = useCallback(
    (nextAccessState: FriendsFamilyAccess) => {
      setAccessState(nextAccessState)
      setIsFamilyDailyStatusLoading(true)
      setFamilyStats(null)
      setFamilyStatsError('')
      setIsSettingsOpen(false)
      setTodayStatusReloadKey((reloadKey) => reloadKey + 1)
    },
    [],
  )

  const claimCurrentSession = useCallback(async () => {
    if (!friendsFamilyToken) return null

    const responseBody = await requestJson<AccessVerifyResponse>('/api/friends-family/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        claimSession: true,
        clientSessionId,
        token: friendsFamilyToken,
      }),
    })

    setAccessState((previousAccess) => {
      if (
        previousAccess?.kind !== 'friends-family' ||
        previousAccess.token !== friendsFamilyToken
      ) {
        return previousAccess
      }

      return {
        ...previousAccess,
        ...responseBody.identity,
        avatar: responseBody.identity.avatar
          ? sanitizeAvatarConfig(responseBody.identity.avatar, responseBody.identity.displayName)
          : createDefaultAvatarConfig(responseBody.identity.displayName),
        token: friendsFamilyToken,
      }
    })

    return responseBody
  }, [clientSessionId, friendsFamilyToken])

  const requestWithSessionRecovery = useCallback(
    async <ResponseBody,>(url: string, initFactory: () => RequestInit) => {
      try {
        return await requestJson<ResponseBody>(url, initFactory())
      } catch (error) {
        if (!isSessionConflict(error) || !friendsFamilyToken) {
          throw error
        }

        await claimCurrentSession()
        return requestJson<ResponseBody>(url, initFactory())
      }
    },
    [claimCurrentSession, friendsFamilyToken],
  )

  const saveAvatarChange = useCallback(
    (avatar: AvatarConfig) => {
      const token = friendsFamilyToken
      if (!token) return

      void requestWithSessionRecovery<AccessVerifyResponse>('/api/friends-family/avatar', () => ({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          avatar,
          clientSessionId,
          token,
        }),
      }))
        .then((responseBody) => {
          setAccessState((previousAccess) => {
            if (previousAccess?.kind !== 'friends-family' || previousAccess.token !== token) {
              return previousAccess
            }

            return {
              ...previousAccess,
              ...responseBody.identity,
              avatar: responseBody.identity.avatar
                ? sanitizeAvatarConfig(
                    responseBody.identity.avatar,
                    responseBody.identity.displayName,
                  )
                : createDefaultAvatarConfig(responseBody.identity.displayName),
              token,
            }
          })
        })
        .catch((error) => {
          console.warn('Could not sync avatar', error)
          showToast('Could not sync avatar')
        })
    },
    [clientSessionId, friendsFamilyToken, requestWithSessionRecovery, showToast],
  )

  const loadFamilyStats = useCallback(async () => {
    if (!friendsFamilyToken) return

    setIsFamilyStatsLoading(true)
    setFamilyStatsError('')

    try {
      const responseBody = await requestWithSessionRecovery<FamilyStatsDashboard>(
        '/api/friends-family/stats',
        () => ({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clientSessionId,
            token: friendsFamilyToken,
          }),
        }),
      )

      setFamilyStats(responseBody)
    } catch (error) {
      setFamilyStatsError(error instanceof Error ? error.message : 'Could not load stats')
    } finally {
      setIsFamilyStatsLoading(false)
    }
  }, [clientSessionId, friendsFamilyToken, requestWithSessionRecovery])

  const beginPuzzle = useCallback(
    (nextPuzzle: PuzzleMetadata) => {
      setPuzzle(nextPuzzle)
      setPuzzleError('')
      setIsMenuOpen(false)
      setIsFamilyDailyStatusLoading(false)
      resetGameState(nextPuzzle)

      if (nextPuzzle.mode === 'daily') {
        setTodayStatusReloadKey((reloadKey) => reloadKey + 1)
      }
    },
    [resetGameState],
  )

  const loadDailyPuzzle = useCallback(async () => {
    try {
      const responseBody = await requestJson<Partial<PuzzleMetadata> & { error?: string }>(
        '/api/today',
        { cache: 'no-store' },
      )

      if (
        typeof responseBody.date !== 'string' ||
        responseBody.answerLength !== WORD_LENGTH ||
        typeof responseBody.confidence !== 'number' ||
        typeof responseBody.status !== 'string'
      ) {
        throw new Error('Unexpected daily Wordle response')
      }

      beginPuzzle({
        date: responseBody.date,
        answerLength: responseBody.answerLength,
        confidence: responseBody.confidence,
        mode: 'daily',
        status: responseBody.status,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load daily Wordle'
      console.warn('Could not load daily Wordle', error)
      setPuzzleError(message)
    }
  }, [beginPuzzle])

  const startRandomPuzzle = useCallback(async () => {
    try {
      const responseBody = await requestJson<Partial<PuzzleMetadata> & { error?: string }>(
        '/api/puzzle/random',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

      if (
        responseBody.mode !== 'random' ||
        typeof responseBody.date !== 'string' ||
        responseBody.answerLength !== WORD_LENGTH ||
        typeof responseBody.confidence !== 'number' ||
        typeof responseBody.puzzleId !== 'string' ||
        typeof responseBody.status !== 'string'
      ) {
        throw new Error('Unexpected random puzzle response')
      }

      beginPuzzle({
        date: responseBody.date,
        answerLength: responseBody.answerLength,
        confidence: responseBody.confidence,
        mode: 'random',
        puzzleId: responseBody.puzzleId,
        status: responseBody.status,
      })
    } catch (error) {
      console.warn('Could not start random puzzle', error)
      showToast(error instanceof Error ? error.message : 'Could not start random puzzle')
    }
  }, [beginPuzzle, showToast])

  const startPastPuzzle = useCallback(
    async (dateValue: string) => {
      if (!dateValue) {
        showToast('Choose a date')
        return
      }

      try {
        const responseBody = await requestJson<
          Partial<PuzzleMetadata> & {
            clampedToOldest?: boolean
            clampedToNewest?: boolean
            error?: string
            newestDate?: string
            oldestDate?: string
          }
        >('/api/puzzle/past', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ date: dateValue }),
        })

        if (
          responseBody.mode !== 'past' ||
          typeof responseBody.date !== 'string' ||
          responseBody.answerLength !== WORD_LENGTH ||
          typeof responseBody.confidence !== 'number' ||
          typeof responseBody.puzzleId !== 'string' ||
          typeof responseBody.status !== 'string'
        ) {
          throw new Error('Unexpected past Wordle response')
        }

        beginPuzzle({
          date: responseBody.date,
          answerLength: responseBody.answerLength,
          confidence: responseBody.confidence,
          mode: 'past',
          puzzleId: responseBody.puzzleId,
          status: responseBody.status,
        })
        setPastWordDate(responseBody.date)

        if (responseBody.clampedToOldest) {
          showToast(
            `${formatPuzzleHeaderDate(responseBody.oldestDate ?? FIRST_OFFICIAL_PUZZLE_DATE)} is the oldest day playable.`,
            2400,
          )
        } else if (responseBody.clampedToNewest) {
          showToast(
            `${formatPuzzleHeaderDate(responseBody.newestDate ?? responseBody.date)} is the newest day playable.`,
            2400,
          )
        }
      } catch (error) {
        console.warn('Could not start past Wordle', error)
        showToast(error instanceof Error ? error.message : 'Could not start past Wordle')
      }
    },
    [beginPuzzle, showToast],
  )

  const openFamilyStats = useCallback(
    (view: FamilyStatsView) => {
      setFamilyStatsView(view)
      setIsMenuOpen(false)
      setIsResultsOpen(false)
      setIsSettingsOpen(false)
      setIsFamilyStatsOpen(true)
      void loadFamilyStats()
    },
    [loadFamilyStats],
  )
  const closeFamilyStats = useCallback(() => {
    setIsFamilyStatsOpen(false)
  }, [])

  const shakeRow = useCallback((row: number) => {
    setInvalidRow(row)
    window.setTimeout(() => setInvalidRow(null), 650)
  }, [])

  const addLetter = useCallback(
    (letter: string) => {
      if (currentColumn >= WORD_LENGTH) return

      const row = currentRow
      const column = currentColumn

      setBoard((previousBoard) =>
        previousBoard.map((boardRow, rowIndex) =>
          rowIndex === row
            ? boardRow.map((tile, tileIndex) =>
                tileIndex === column
                  ? {
                      letter,
                      state: 'tbd',
                      animation: 'pop',
                    }
                  : tile,
              )
            : boardRow,
        ),
      )

      window.setTimeout(() => {
        setBoard((previousBoard) =>
          previousBoard.map((boardRow, rowIndex) =>
            rowIndex === row
              ? boardRow.map((tile, tileIndex) =>
                  tileIndex === column && tile.animation === 'pop'
                    ? { ...tile, animation: 'idle' }
                    : tile,
                )
              : boardRow,
          ),
        )
      }, 120)

      setCurrentColumn((columnIndex) => columnIndex + 1)
    },
    [currentColumn, currentRow],
  )

  const removeLetter = useCallback(() => {
    if (currentColumn === 0) return

    const nextColumn = currentColumn - 1

    setBoard((previousBoard) =>
      previousBoard.map((boardRow, rowIndex) =>
        rowIndex === currentRow
          ? boardRow.map((tile, tileIndex) =>
              tileIndex === nextColumn
                ? { letter: '', state: 'empty', animation: 'idle' }
                : tile,
            )
          : boardRow,
      ),
    )

    setCurrentColumn(nextColumn)
  }, [currentColumn, currentRow])

  const submitResult = useCallback(
    async ({
      answer,
      board,
      guesses,
      guessesUsed,
      outcome,
    }: CompletedResultInput) => {
      const baseResult: GameResult = {
        answer,
        board,
        copied: false,
        guesses,
        guessesUsed,
        mode: puzzle?.mode ?? 'daily',
        outcome,
        saved: false,
        stats,
      }

      setCompletedResult(baseResult)
      setIsResultsOpen(true)

      if (!puzzle) {
        return
      }

      try {
        const result = await requestWithSessionRecovery<ResultsResponse>('/api/results', () => ({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            board,
            clientSessionId,
            date: puzzle.date,
            friendsFamilyToken: puzzle.mode === 'daily' ? friendsFamilyToken : '',
            gameId: gameIdRef.current,
            guesses,
            guessesUsed,
            mode: puzzle.mode,
            outcome,
            puzzleId: puzzle.puzzleId,
          }),
        }))

        if (puzzle.mode === 'daily') {
          setStats(result.stats)
        }
        if (result.result) {
          setBoard(hydrateBoardFromResult(result.result))
          setKeyboardState(getKeyboardStateFromResult(result.result))
          setStatus(result.result.outcome)
          setWinningRow(result.result.outcome === 'won' ? result.result.guessesUsed - 1 : null)
        }
        setCompletedResult({
          ...baseResult,
          analysis: result.result?.analysis,
          answer: result.answer || answer,
          board: result.result?.board ?? baseResult.board,
          definition: result.definition,
          guesses: result.result?.guesses ?? baseResult.guesses,
          guessesUsed: result.result?.guessesUsed ?? baseResult.guessesUsed,
          mode: puzzle.mode,
          outcome: result.result?.outcome ?? baseResult.outcome,
          saved: true,
          stats: result.stats,
        })
      } catch (error) {
        if (error instanceof ApiError && error.message === 'Daily Wordle is not available yet') {
          void loadDailyPuzzle()
          showToast(error.message)
        }

        console.warn('Could not save result', error)
      }
    },
    [clientSessionId, friendsFamilyToken, loadDailyPuzzle, puzzle, requestWithSessionRecovery, showToast, stats],
  )

  const showResultAfterPause = useCallback(
    (resultInput: CompletedResultInput) => {
      if (resultsRevealTimerRef.current !== null) {
        window.clearTimeout(resultsRevealTimerRef.current)
      }

      resultsRevealTimerRef.current = window.setTimeout(() => {
        resultsRevealTimerRef.current = null
        void submitResult(resultInput)
      }, RESULTS_REVEAL_DELAY_MS)
    },
    [submitResult],
  )

  const revealGuess = useCallback(async () => {
    if (!puzzle) {
      showToast(puzzleError || 'Loading puzzle')
      return
    }

    if (currentColumn < WORD_LENGTH) {
      shakeRow(currentRow)
      showToast('Not enough letters')
      return
    }

    const row = currentRow
    const guess = board[row].map((tile) => tile.letter).join('')

    const isLastRow = row === MAX_GUESSES - 1

    setIsRevealing(true)

    let guessResult: GuessResponse

    try {
      const responseBody = await requestWithSessionRecovery<
        Partial<GuessResponse> & { error?: string }
      >(
        '/api/guess',
        () => ({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            attemptIndex: row,
            clientSessionId,
            date: puzzle.date,
            friendsFamilyToken: puzzle.mode === 'daily' ? friendsFamilyToken : '',
            guess,
            mode: puzzle.mode,
            puzzleId: puzzle.puzzleId,
            reveal: isLastRow,
          }),
        }),
	      )

      if (
        !Array.isArray(responseBody.scores) ||
        responseBody.scores.length !== WORD_LENGTH ||
        typeof responseBody.didWin !== 'boolean'
      ) {
        throw new Error('Unexpected guess response')
      }

      guessResult = {
        scores: responseBody.scores,
        didWin: responseBody.didWin,
        answer: responseBody.answer,
      }
    } catch (error) {
      setIsRevealing(false)

      if (
        error instanceof ApiError &&
        (error.message === 'Already completed today' ||
          error.message === 'Puzzle progress changed. Refreshing latest guesses.' ||
          error.message === 'Daily Wordle is not available yet')
      ) {
        setTodayStatusReloadKey((reloadKey) => reloadKey + 1)
      }

      if (error instanceof ApiError && error.message === 'Daily Wordle is not available yet') {
        void loadDailyPuzzle()
      }

      shakeRow(row)
      showToast(error instanceof Error ? error.message : 'Could not check guess')
      return
    }

    const { didWin, scores } = guessResult

    scores.forEach((score, index) => {
      window.setTimeout(() => {
        setBoard((previousBoard) =>
          previousBoard.map((boardRow, rowIndex) =>
            rowIndex === row
              ? boardRow.map((tile, tileIndex) =>
                  tileIndex === index ? { ...tile, animation: 'flip-in' } : tile,
                )
              : boardRow,
          ),
        )
      }, index * REVEAL_STEP_MS)

      window.setTimeout(() => {
        setBoard((previousBoard) =>
          previousBoard.map((boardRow, rowIndex) =>
            rowIndex === row
              ? boardRow.map((tile, tileIndex) =>
                  tileIndex === index
                    ? { ...tile, state: score, animation: 'flip-out' }
                    : tile,
                )
              : boardRow,
          ),
        )
      }, index * REVEAL_STEP_MS + FLIP_HALF_MS)

      window.setTimeout(() => {
        setBoard((previousBoard) =>
          previousBoard.map((boardRow, rowIndex) =>
            rowIndex === row
              ? boardRow.map((tile, tileIndex) =>
                  tileIndex === index ? { ...tile, animation: 'idle' } : tile,
                )
              : boardRow,
          ),
        )
      }, index * REVEAL_STEP_MS + FLIP_HALF_MS * 2)

      window.setTimeout(() => {
        setKeyboardState((previousState) => {
          const letter = guess[index].toLowerCase()
          const previousLetterState = previousState[letter]

          if (
            previousLetterState &&
            statePriority[previousLetterState] >= statePriority[score]
          ) {
            return previousState
          }

          return { ...previousState, [letter]: score }
        })
      }, index * REVEAL_STEP_MS + FLIP_HALF_MS * 2)
    })

    window.setTimeout(() => {
      setIsRevealing(false)

      if (didWin) {
        setStatus('won')
        setWinningRow(row)
        showResultAfterPause({
          board: getCompletedBoard(board, row, scores),
          guesses: getCompletedGuesses(board, row),
          guessesUsed: row + 1,
          outcome: 'won',
        })
        showToast(
          ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew'][
            row
          ],
          COMPLETION_TOAST_MS,
        )
        return
      }

      if (isLastRow) {
        setStatus('lost')
        showResultAfterPause({
          answer: guessResult.answer,
          board: getCompletedBoard(board, row, scores),
          guesses: getCompletedGuesses(board, row),
          guessesUsed: MAX_GUESSES,
          outcome: 'lost',
        })
        showToast(guessResult.answer || 'Answer unavailable', COMPLETION_TOAST_MS)
        return
      }

      setCurrentRow((row) => row + 1)
      setCurrentColumn(0)
    }, REVEAL_DONE_MS)
  }, [
	    board,
	    clientSessionId,
	    currentColumn,
	    currentRow,
	    friendsFamilyToken,
	    loadDailyPuzzle,
	    puzzle,
	    puzzleError,
    requestWithSessionRecovery,
    shakeRow,
    showResultAfterPause,
    showToast,
  ])

	  const handleKey = useCallback(
	    (rawKey: string, source: 'physical' | 'onscreen' = 'physical') => {
	      if (status !== 'playing' || isRevealing) return
	      if (puzzle?.mode === 'daily' && isFamilyDailyStatusLoading) return
	      if (!puzzle) {
	        showToast(puzzleError || 'Loading puzzle')
        return
      }
      if (settings.onscreenKeyboardOnly && source === 'physical') return

      if (rawKey === 'Backspace') {
        removeLetter()
        return
      }

      if (rawKey === 'Enter') {
        revealGuess()
        return
      }

      if (/^[a-zA-Z]$/.test(rawKey)) {
        addLetter(rawKey.toUpperCase())
      }
    },
    [
		      addLetter,
		      isFamilyDailyStatusLoading,
		      isRevealing,
      removeLetter,
      revealGuess,
      settings.onscreenKeyboardOnly,
      puzzle,
      puzzleError,
      showToast,
      status,
    ],
  )

  const copyResult = useCallback(async () => {
    if (!completedResult) return

    try {
      await copyTextToClipboard(createShareText(completedResult))
      setCompletedResult({ ...completedResult, copied: true })

      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }

      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCompletedResult((previousResult) =>
          previousResult ? { ...previousResult, copied: false } : previousResult,
        )
        copyFeedbackTimerRef.current = null
      }, COPY_FEEDBACK_MS)
    } catch (error) {
      console.warn('Could not copy result', error)
      showToast('Copy failed')
    }
  }, [completedResult, showToast])

  useEffect(() => {
    void loadDailyPuzzle()
  }, [loadDailyPuzzle])

  useEffect(() => {
	    if (!puzzle || puzzle.mode !== 'daily' || !friendsFamilyToken) {
	      setIsFamilyDailyStatusLoading(false)
	      return
	    }

    let isMounted = true

    async function loadTodayStatus() {
      setIsFamilyDailyStatusLoading(true)

      try {
        const responseBody = await requestWithSessionRecovery<FamilyTodayStatus>(
          '/api/friends-family/today-status',
          () => ({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              clientSessionId,
              date: puzzle?.date,
              token: friendsFamilyToken,
            }),
          }),
        )

        if (!isMounted) return

        setStats(responseBody.stats)

        if (responseBody.completed && responseBody.result) {
          const serverResult = responseBody.result
          setBoard(hydrateBoardFromResult(serverResult))
          setKeyboardState(getKeyboardStateFromResult(serverResult))
          setCurrentRow(Math.min(serverResult.guessesUsed, MAX_GUESSES - 1))
          setCurrentColumn(WORD_LENGTH)
          setStatus(serverResult.outcome)
          setWinningRow(serverResult.outcome === 'won' ? serverResult.guessesUsed - 1 : null)
          setCompletedResult({
            answer: serverResult.answer,
            board: serverResult.board,
            copied: false,
            definition: responseBody.definition,
            guesses: serverResult.guesses,
            guessesUsed: serverResult.guessesUsed,
            mode: 'daily',
            outcome: serverResult.outcome,
            saved: true,
            stats: responseBody.stats,
          })
        } else if (responseBody.attempt && responseBody.attempt.guessesUsed > 0) {
          const serverAttempt = responseBody.attempt
          setBoard(hydrateBoardFromResult(serverAttempt))
          setKeyboardState(getKeyboardStateFromResult(serverAttempt))
          setCurrentRow(Math.min(serverAttempt.guessesUsed, MAX_GUESSES - 1))
          setCurrentColumn(0)
          setStatus('playing')
          setWinningRow(null)
          setCompletedResult(null)
          setIsResultsOpen(false)
        } else if (completedResult?.saved) {
          resetCurrentGame()
        }
      } catch (error) {
        if (error instanceof ApiError && error.message === 'Daily Wordle is not available yet') {
          void loadDailyPuzzle()
        }

        console.warn('Could not load friends and family daily status', error)
      } finally {
        if (isMounted) {
          setIsFamilyDailyStatusLoading(false)
        }
      }
    }

    loadTodayStatus()

    return () => {
      isMounted = false
    }
  }, [
	    clientSessionId,
	    completedResult?.saved,
	    friendsFamilyToken,
	    loadDailyPuzzle,
	    puzzle,
    requestWithSessionRecovery,
	    resetCurrentGame,
	    todayStatusReloadKey,
	  ])

  useEffect(() => {
    if (!isMenuOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const menuArea = menuAreaRef.current
      if (!menuArea || !(event.target instanceof Node)) return
      if (menuArea.contains(event.target)) return

      setIsMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [isMenuOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isMenuOpen) {
        setIsMenuOpen(false)
        return
      }

      if (
        isSettingsOpen ||
        isAccessPromptOpen ||
        isFamilyStatsOpen ||
        isResultsOpen ||
        isMenuOpen
      ) {
        return
      }
      handleKey(event.key)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    handleKey,
    isAccessPromptOpen,
    isFamilyStatsOpen,
    isMenuOpen,
    isResultsOpen,
    isSettingsOpen,
  ])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
      }

      if (resultsRevealTimerRef.current !== null) {
        window.clearTimeout(resultsRevealTimerRef.current)
      }

      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    if (accessState === null) {
      window.localStorage.removeItem(ACCESS_STORAGE_KEY)
      window.localStorage.removeItem(LEGACY_AVATAR_STORAGE_KEY)
      return
    }

    if (accessState.kind === 'friends-family') {
      window.localStorage.removeItem(LEGACY_AVATAR_STORAGE_KEY)
      window.localStorage.setItem(
        ACCESS_STORAGE_KEY,
        JSON.stringify({
          kind: accessState.kind,
          userId: accessState.userId,
          displayName: accessState.displayName,
          firstName: accessState.firstName,
          lastInitial: accessState.lastInitial,
          token: accessState.token,
        }),
      )
      return
    }

    window.localStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify(accessState))
  }, [accessState])

  useEffect(() => {
    if (!friendsFamilyToken) return

    let isMounted = true
    const token = friendsFamilyToken

	    async function verifyAccess() {
	      try {
	        const responseBody = await requestJson<AccessVerifyResponse>('/api/friends-family/verify', {
	          method: 'POST',
	          headers: {
	            'Content-Type': 'application/json',
	          },
	          body: JSON.stringify({
	            claimSession: true,
	            clientSessionId,
	            token,
	          }),
	        })

	        if (!isMounted) return

	        setAccessState((previousAccess) => {
          if (previousAccess?.kind !== 'friends-family' || previousAccess.token !== token) {
            return previousAccess
          }

          return {
            ...previousAccess,
            ...responseBody.identity,
            avatar: responseBody.identity.avatar
              ? sanitizeAvatarConfig(responseBody.identity.avatar, responseBody.identity.displayName)
              : createDefaultAvatarConfig(responseBody.identity.displayName),
            token,
          }
        })
      } catch (error) {
        if (isMounted) {
          console.warn('Could not verify friends and family access', error)
          showToast('Could not verify sign-in')
        }
	      }
    }

    verifyAccess()

	    return () => {
	      isMounted = false
	    }
	  }, [clientSessionId, friendsFamilyToken, showToast])

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mediaQuery) return

    const onChange = (event: MediaQueryListEvent) => {
      setDevicePrefersDark(event.matches)
    }

    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

	  useEffect(() => {
	    if (!isSettingsOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isAvatarBuilderOpen) {
          setIsAvatarBuilderOpen(false)
          return
        }

        setIsSettingsOpen(false)
      }
    }

	    window.addEventListener('keydown', onKeyDown)
	    return () => window.removeEventListener('keydown', onKeyDown)
	  }, [isAvatarBuilderOpen, isSettingsOpen])

	  useEffect(() => {
	    if (!isAvatarBuilderOpen) return

	    const onKeyDown = (event: KeyboardEvent) => {
	      if (event.key === 'Escape') {
	        setIsAvatarBuilderOpen(false)
	      }
	    }

	    window.addEventListener('keydown', onKeyDown)
	    return () => window.removeEventListener('keydown', onKeyDown)
	  }, [isAvatarBuilderOpen])

  useEffect(() => {
    if (!isFamilyStatsOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFamilyStatsOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFamilyStatsOpen])

  return (
    <div
      className={[
        'wordbee-app',
        isDarkTheme ? 'wordbee-app--dark' : 'wordbee-app--light',
        settings.highContrast ? 'wordbee-app--high-contrast' : '',
        isStandaloneApp ? 'wordbee-app--standalone' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
	      <div className="wordbee-toast-layer" aria-live="polite" aria-atomic="true">
	        {toast && <div className="wordbee-toast">{toast}</div>}
	      </div>

      <header className="wordbee-header">
        <div className="wordbee-header__side wordbee-header__side--left" ref={menuAreaRef}>
          {isFamilyStatsOpen ? (
            <button className="wordbee-page-back-button" onClick={closeFamilyStats} type="button">
              Back
            </button>
          ) : (
            <>
              <button
                className="wordbee-icon-button wordbee-icon-button--menu"
                type="button"
                aria-expanded={isMenuOpen}
                aria-label="Games menu"
                aria-haspopup="menu"
                onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
              >
                {accessState?.kind === 'friends-family' ? (
                  <span className="wordbee-menu-avatar">
                    <AvatarImage
                      avatar={accessState.avatar}
                      displayName={accessState.displayName}
                      size={72}
                    />
                  </span>
                ) : (
                  <InlineIcon markup={menuIconMarkup} />
                )}
              </button>
              {isMenuOpen && (
                <WordbeeMenu
                  maxPastDate={getDefaultPastDate()}
                  minPastDate={FIRST_OFFICIAL_PUZZLE_DATE}
                  onDaily={() => void loadDailyPuzzle()}
                  onPast={() => void startPastPuzzle(pastWordDate)}
                  onPastDateChange={setPastWordDate}
                  onRandom={() => void startRandomPuzzle()}
                  pastDate={pastWordDate}
                  showDaily={puzzle?.mode !== 'daily'}
                />
              )}
            </>
          )}
        </div>

        <h1
          className={[
            'wordbee-title',
            puzzleHeaderLabel ? 'wordbee-title--visible' : '',
            isSolvedUntrackedPuzzle ? 'wordbee-title--left-anchor' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {puzzleHeaderLabel || 'Wordle'}
        </h1>

        <div className="wordbee-header__side wordbee-header__side--right">
          {!isFamilyStatsOpen && completedResult && (
            <button
              className="wordbee-results-reopen-button"
              type="button"
              onClick={() => setIsResultsOpen(true)}
            >
              See results
            </button>
          )}
          {!isFamilyStatsOpen && accessState?.kind === 'friends-family' && (
            <button
              className="wordbee-icon-button wordbee-icon-button--stats"
              type="button"
              aria-label="Stats"
              onClick={() => openFamilyStats('overview')}
            >
              <InlineIcon markup={statsIconMarkup} />
            </button>
          )}
          <button
            className="wordbee-icon-button wordbee-icon-button--settings"
            type="button"
            aria-label={
              accessState?.kind === 'friends-family'
                ? `Settings for ${accessState.displayName}`
                : 'Settings'
            }
            aria-haspopup="dialog"
            aria-expanded={isSettingsOpen}
            onClick={() => setIsSettingsOpen(true)}
          >
            <InlineIcon markup={settingsIconMarkup} />
          </button>
        </div>
      </header>

      {isFamilyStatsOpen && accessState?.kind === 'friends-family' ? (
        <FamilyStatsPage
          currentUserId={accessState.userId}
          dashboard={familyStats}
          error={familyStatsError}
          initialView={familyStatsView}
          isLoading={isFamilyStatsLoading}
          onBack={closeFamilyStats}
          onReload={() => void loadFamilyStats()}
        />
      ) : (
        <main className="wordbee-game" aria-label="Wordle game">
          <section className="wordbee-board-container" aria-label="Wordle board">
            <div className="wordbee-board">
              {board.map((row, rowIndex) => (
                <div
                  className={[
                    'wordbee-row',
                    invalidRow === rowIndex ? 'wordbee-row--invalid' : '',
                    winningRow === rowIndex ? 'wordbee-row--win' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={`row-${rowIndex}`}
                  role="group"
                  aria-label={`Row ${rowIndex + 1}`}
                >
                  {row.map((tile, tileIndex) => (
                    <div
                      className="wordbee-tile"
                      data-animation={tile.animation}
                      data-state={tile.state}
                      key={`tile-${rowIndex}-${tileIndex}`}
                      role="img"
                      aria-roledescription="tile"
                      aria-label={tileAriaLabel(tile, tileIndex)}
                      style={
                        {
                          '--dance-delay': `${tileIndex * DANCE_STEP_MS}ms`,
                        } as CSSProperties
                      }
                    >
                      {tile.letter}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <Keyboard
            keys={keyboardRows}
            onKey={(key) => handleKey(key, 'onscreen')}
            states={keyboardState}
          />
        </main>
      )}

      {isSettingsOpen && (
        <SettingsDialog
          accessState={accessState}
          clientSessionId={clientSessionId}
          effectiveDarkTheme={isDarkTheme}
          onAccessLogin={handleAccessLogin}
          onAvatarChange={() => {
            setIsSettingsOpen(false)
            setIsAvatarBuilderOpen(true)
          }}
          onClose={() => setIsSettingsOpen(false)}
          onSignOut={signOut}
          onSettingChange={updateSetting}
          settings={settings}
        />
      )}

      {isAvatarBuilderOpen && accessState?.kind === 'friends-family' && (
        <AvatarDialog
          ariaLabel="Change avatar"
          displayName={accessState.displayName}
          initialAvatar={accessState.avatar}
          onClose={() => setIsAvatarBuilderOpen(false)}
          onCancel={() => setIsAvatarBuilderOpen(false)}
          onSave={(avatar) => {
            saveAvatarChange(avatar)
            setIsAvatarBuilderOpen(false)
          }}
          saveLabel="Save avatar"
        />
      )}

      {accessState === null && (
        <AccessDialog
          clientSessionId={clientSessionId}
          onGuest={() => setAccessState({ kind: 'guest' })}
          onLogin={handleAccessLogin}
        />
      )}

      {completedResult && isResultsOpen && (
        <ResultsDialog
          canOpenStats={accessState?.kind === 'friends-family'}
          onClose={() => setIsResultsOpen(false)}
          onCopy={copyResult}
          onOpenPastWords={() => {
            setIsMenuOpen(true)
            setIsResultsOpen(false)
          }}
          onOpenStats={() => {
            setIsResultsOpen(false)
            openFamilyStats('daily')
          }}
          onPlayRandom={() => void startRandomPuzzle()}
          result={completedResult}
        />
      )}

    </div>
  )
}

function tileAriaLabel(tile: Tile, index: number) {
  const position = ['1st', '2nd', '3rd', '4th', '5th'][index]

  if (!tile.letter) return `${position} letter, empty`
  if (tile.state === 'tbd') return `${position} letter, ${tile.letter}`
  if (tile.state === 'correct') return `${position} letter, ${tile.letter}, correct`
  if (tile.state === 'present') {
    return `${position} letter, ${tile.letter}, present in another position`
  }

  return `${position} letter, ${tile.letter}, absent`
}

function Keyboard({
  keys,
  onKey,
  states,
}: {
  keys: string[][]
  onKey: (key: string) => void
  states: Record<string, EvaluatedState>
}) {
  return (
    <div className="wordbee-keyboard" aria-label="Keyboard">
      {keys.map((row, rowIndex) => (
        <div className="wordbee-keyboard__row" key={`keyboard-row-${rowIndex}`}>
          {rowIndex === 1 && <div className="wordbee-keyboard__spacer" />}
          {row.map((key) => {
            const isAction = key.length > 1
            const keyState = states[key.toLowerCase()]

            return (
              <button
                className={isAction ? 'wordbee-key wordbee-key--wide' : 'wordbee-key'}
                data-state={keyState ?? undefined}
                key={key}
                type="button"
                onClick={() => onKey(key)}
                aria-label={key === 'Backspace' ? 'Backspace' : key}
              >
                {key === 'Backspace' ? <BackspaceIcon /> : key}
              </button>
            )
          })}
          {rowIndex === 1 && <div className="wordbee-keyboard__spacer" />}
        </div>
      ))}
    </div>
  )
}

function AccessDialog({
  clientSessionId,
  onGuest,
  onLogin,
}: {
  clientSessionId: string
  onGuest: () => void
  onLogin: (accessState: FriendsFamilyAccess) => void
}) {
  return (
    <div className="access-backdrop">
      <section
        aria-labelledby="access-title"
        aria-modal="true"
        className="access-modal"
        role="dialog"
      >
        <h2 id="access-title">Who's playing?</h2>
        <FriendsFamilyAccessForm
          autoFocusCode
          clientSessionId={clientSessionId}
          guestButtonLabel="I don't have a friends and family code"
          onGuest={onGuest}
          onLogin={onLogin}
          useAvatarDialog
        />
      </section>
    </div>
  )
}

function FriendsFamilyAccessForm({
  autoFocusCode = false,
  className = '',
  clientSessionId,
  guestButtonLabel,
  hideCodeLabel = false,
  onGuest,
  onLogin,
  onAvatarDialogClose,
  useAvatarDialog = false,
}: {
  autoFocusCode?: boolean
  className?: string
  clientSessionId: string
  guestButtonLabel?: string
  hideCodeLabel?: boolean
  onGuest?: () => void
  onLogin: (accessState: FriendsFamilyAccess) => void
  onAvatarDialogClose?: () => void
  useAvatarDialog?: boolean
}) {
  const [code, setCode] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastInitial, setLastInitial] = useState('')
  const [step, setStep] = useState<'code' | 'profile' | 'avatar'>('code')
  const [pendingAccess, setPendingAccess] = useState<PendingFriendsFamilyAccess | null>(null)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validateCode = async () => {
    setError('')
    setIsSubmitting(true)

    try {
      const responseBody = await requestJson<AccessValidateResponse>(
        '/api/friends-family/validate-code',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        },
      )

      if (!responseBody.ok) {
        throw new Error('Code not recognized')
      }

      setStep('profile')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Code not recognized')
    } finally {
      setIsSubmitting(false)
    }
  }

  const requestLogin = (createUser = false, avatar?: AvatarConfig) =>
    requestJson<AccessLoginResponse>('/api/friends-family/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientSessionId,
        code,
        createUser,
        ...(avatar ? { avatar } : {}),
        firstName,
        lastInitial,
      }),
    })

  const completeSignedInLogin = (responseBody: AccessLoginResponse, avatar?: AvatarConfig) => {
    if (!isCompleteAccessLoginResponse(responseBody)) {
      throw new Error('Could not sign in')
    }

    const serverAvatar = responseBody.identity.avatar
      ? sanitizeAvatarConfig(responseBody.identity.avatar, responseBody.identity.displayName)
      : null
    onLogin({
      ...responseBody.identity,
      avatar:
        serverAvatar ??
        avatar ??
        createDefaultAvatarConfig(responseBody.identity.displayName),
      token: responseBody.token,
    })
  }

  const login = async () => {
    setError('')
    setIsSubmitting(true)

    try {
      const responseBody = await requestLogin(false)

      if (isCompleteAccessLoginResponse(responseBody)) {
        completeSignedInLogin(responseBody)
        return
      }

      if (isPendingAccessLoginResponse(responseBody)) {
        setPendingAccess({
          avatar: createDefaultAvatarConfig(responseBody.pendingIdentity.displayName),
          ...responseBody.pendingIdentity,
        })
        setStep('avatar')
        return
      }

      throw new Error('Could not sign in')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not sign in')
    } finally {
      setIsSubmitting(false)
    }
  }

  const savePendingAvatar = async (avatar: AvatarConfig) => {
    if (!pendingAccess || isSubmitting) return

    setError('')
    setIsSubmitting(true)

    try {
      const responseBody = await requestLogin(true, avatar)
      completeSignedInLogin(responseBody, avatar)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save avatar')
    } finally {
      setIsSubmitting(false)
    }
  }

  const cancelPendingAvatar = () => {
    setPendingAccess(null)
    setStep('profile')
    onAvatarDialogClose?.()
  }

  return (
    <div className={['access-form', className].filter(Boolean).join(' ')}>
      {step === 'code' ? (
        <>
          {guestButtonLabel && onGuest && (
            <button className="access-guest-button" type="button" onClick={onGuest}>
              {guestButtonLabel}
            </button>
          )}
          <label className="access-field">
            <span className={hideCodeLabel ? 'wordbee-sr-only' : ''}>
              Friends and family code
            </span>
            <input
              autoComplete="one-time-code"
              autoFocus={autoFocusCode}
              inputMode="numeric"
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && code.trim()) {
                  void validateCode()
                }
              }}
              type="password"
              value={code}
            />
          </label>
          <button
            className="access-primary-button"
            disabled={!code.trim() || isSubmitting}
            onClick={() => void validateCode()}
            type="button"
          >
            Continue
          </button>
        </>
      ) : step === 'profile' ? (
        <>
          <p className="access-confirmed">Code accepted.</p>
          <p className="access-profile-note">Use this same name to sign in on another device.</p>
          <label className="access-field">
            <span>First name</span>
            <input
              autoComplete="given-name"
              autoFocus
              maxLength={40}
              onChange={(event) => setFirstName(event.target.value)}
              type="text"
              value={firstName}
            />
          </label>
          <label className="access-field access-field--short">
            <span>Last initial</span>
            <input
              autoComplete="off"
              maxLength={1}
              onChange={(event) => setLastInitial(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && firstName.trim() && lastInitial.trim()) {
                  void login()
                }
              }}
              type="text"
              value={lastInitial}
            />
          </label>
          <button
            className="access-primary-button"
            disabled={!firstName.trim() || !lastInitial.trim() || isSubmitting}
            onClick={() => void login()}
            type="button"
          >
            Save
          </button>
        </>
      ) : pendingAccess ? (
        useAvatarDialog ? (
          <>
            <p className="access-confirmed">Code accepted.</p>
            <AvatarDialog
              ariaLabel="Choose your avatar"
              displayName={pendingAccess.displayName}
              initialAvatar={pendingAccess.avatar}
              onCancel={cancelPendingAvatar}
              onClose={cancelPendingAvatar}
              onSave={(avatar) => void savePendingAvatar(avatar)}
              saveLabel="Save avatar"
            />
          </>
        ) : (
          <AvatarBuilder
            displayName={pendingAccess.displayName}
            initialAvatar={pendingAccess.avatar}
            onCancel={cancelPendingAvatar}
            onSave={(avatar) => void savePendingAvatar(avatar)}
            saveLabel="Save avatar"
          />
        )
      ) : null}

      {error && <p className="access-error">{error}</p>}
    </div>
  )
}

function AvatarDialog({
  ariaLabel,
  displayName,
  initialAvatar,
  onCancel,
  onClose,
  onSave,
  saveLabel,
}: {
  ariaLabel: string
  displayName: string
  initialAvatar: AvatarConfig
  onCancel?: () => void
  onClose?: () => void
  onSave: (avatar: AvatarConfig) => void
  saveLabel: string
}) {
  return (
    <div className="avatar-backdrop" onClick={onClose}>
      <section
        aria-label={ariaLabel}
        aria-modal="true"
        className="avatar-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        {onClose && (
          <button
            aria-label="Close avatar builder"
            className="avatar-close"
            onClick={onClose}
            type="button"
          >
            <InlineIcon markup={closeIconMarkup} />
          </button>
        )}
        <AvatarBuilder
          displayName={displayName}
          initialAvatar={initialAvatar}
          onCancel={onCancel}
          onSave={onSave}
          saveLabel={saveLabel}
        />
      </section>
    </div>
  )
}

function AvatarBuilder({
  displayName,
  initialAvatar,
  onCancel,
  onSave,
  saveLabel,
}: {
  displayName: string
  initialAvatar: AvatarConfig
  onCancel?: () => void
  onSave: (avatar: AvatarConfig) => void
  saveLabel: string
}) {
  const [draftAvatar, setDraftAvatar] = useState(initialAvatar)

  useEffect(() => {
    setDraftAvatar(initialAvatar)
  }, [initialAvatar])

  const updateDraftAvatar = (key: AvatarFeatureKey, value: string) => {
    setDraftAvatar((previousAvatar) => updateAvatarFeature(previousAvatar, key, value))
  }
  const selectedClothesSupportsGraphic = avatarClothesSupportsGraphic(draftAvatar.clothesVariant)

  return (
    <div className="avatar-builder">
      <div className="avatar-builder__preview-row">
        <div className="avatar-preview avatar-preview--large">
          <AvatarImage avatar={draftAvatar} displayName={displayName} size={384} />
        </div>
        <div className="avatar-builder__heading">
          <h3>Choose your avatar</h3>
          <DiceRandomButton
            onRandomize={() =>
              setDraftAvatar((previousAvatar) => createRandomAvatarConfig(previousAvatar))
            }
          />
        </div>
      </div>

      <div className="avatar-builder__controls">
        {AVATAR_FEATURES.map((feature) => {
          const isUnavailableGraphic =
            feature.key === 'clothesGraphicVariant' && !selectedClothesSupportsGraphic
          const options = isUnavailableGraphic
            ? AVATAR_GRAPHIC_UNAVAILABLE_OPTIONS
            : feature.options

          return (
            <AvatarFeatureSelector
              disabled={isUnavailableGraphic}
              key={feature.key}
              label={feature.label}
              onChange={(value) => updateDraftAvatar(feature.key, value)}
              options={options}
              value={isUnavailableGraphic ? 'none' : draftAvatar[feature.key]}
            />
          )
        })}
      </div>

      <div className="avatar-builder__actions">
        {onCancel && (
          <button className="avatar-secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
        )}
        <button
          className="avatar-primary-button"
          onClick={() => onSave(draftAvatar)}
          type="button"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  )
}

function AvatarFeatureSelector({
  label,
  onChange,
  options,
  value,
  disabled = false,
}: {
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  options: readonly AvatarOption[]
  value: string
}) {
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const currentOption = options[currentIndex] ?? options[0]

  const selectOffset = (offset: number) => {
    const nextIndex = (currentIndex + offset + options.length) % options.length
    const nextValue = options[nextIndex]?.value

    if (nextValue) {
      onChange(nextValue)
    }
  }

  return (
    <div className="avatar-feature">
      <span className="avatar-feature__label">{label}</span>
      <div className="avatar-feature__selector" data-disabled={disabled}>
        <button
          aria-label={`Previous ${label}`}
          className="avatar-feature__button"
          disabled={disabled || options.length <= 1}
          onClick={() => selectOffset(-1)}
          type="button"
        >
          <span aria-hidden="true">&lt;</span>
        </button>
        <span className="avatar-feature__value">{currentOption?.label}</span>
        <button
          aria-label={`Next ${label}`}
          className="avatar-feature__button"
          disabled={disabled || options.length <= 1}
          onClick={() => selectOffset(1)}
          type="button"
        >
          <span aria-hidden="true">&gt;</span>
        </button>
      </div>
    </div>
  )
}

function AvatarImage({
  avatar,
  className = '',
  displayName,
  size = 256,
}: {
  avatar: AvatarConfig
  className?: string
  displayName: string
  size?: number
}) {
  return (
    <img
      alt={`${displayName} avatar`}
      className={['avatar-image', className].filter(Boolean).join(' ')}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      src={createAvatarUrl(avatar, size)}
    />
  )
}

function DiceRandomButton({ onRandomize }: { onRandomize: () => void }) {
  const [isDiceRolling, setIsDiceRolling] = useState(false)
  const [diceFrameIndex, setDiceFrameIndex] = useState(Math.max(DICE_ROLL_FRAMES.length - 1, 0))
  const diceRollTimerRef = useRef<number | null>(null)
  const diceRollRunIdRef = useRef(0)
  const dicePreloadRef = useRef<HTMLImageElement[]>([])

  const stopDiceRoll = useCallback(() => {
    diceRollRunIdRef.current += 1

    if (diceRollTimerRef.current !== null) {
      window.clearTimeout(diceRollTimerRef.current)
      diceRollTimerRef.current = null
    }

    setIsDiceRolling(false)
    setDiceFrameIndex(Math.max(DICE_ROLL_FRAMES.length - 1, 0))
  }, [])

  const startDiceRoll = useCallback(() => {
    if (DICE_ROLL_FRAMES.length <= 1) return

    const rollId = diceRollRunIdRef.current + 1
    diceRollRunIdRef.current = rollId

    if (diceRollTimerRef.current !== null) {
      window.clearTimeout(diceRollTimerRef.current)
    }

    setIsDiceRolling(true)
    setDiceFrameIndex(0)

    const advanceFrame = (frameIndex: number) => {
      if (diceRollRunIdRef.current !== rollId) return

      if (document.visibilityState === 'hidden') {
        stopDiceRoll()
        return
      }

      if (frameIndex >= DICE_ROLL_FRAMES.length - 1) {
        setDiceFrameIndex(DICE_ROLL_FRAMES.length - 1)
        diceRollTimerRef.current = null
        setIsDiceRolling(false)
        return
      }

      setDiceFrameIndex(frameIndex)
      diceRollTimerRef.current = window.setTimeout(
        () => advanceFrame(frameIndex + 1),
        DICE_FRAME_INTERVAL_MS,
      )
    }

    diceRollTimerRef.current = window.setTimeout(
      () => advanceFrame(1),
      DICE_FRAME_INTERVAL_MS,
    )
  }, [stopDiceRoll])

  useEffect(() => {
    dicePreloadRef.current = DICE_ROLL_FRAMES.map(({ src }) => {
      const image = new Image()
      image.decoding = 'sync'
      image.src = src
      return image
    })

    return () => {
      dicePreloadRef.current = []
      diceRollRunIdRef.current += 1

      if (diceRollTimerRef.current !== null) {
        window.clearTimeout(diceRollTimerRef.current)
        diceRollTimerRef.current = null
      }
    }
  }, [])

  const diceImageSrc = isDiceRolling
    ? DICE_ROLL_FRAMES[diceFrameIndex]?.src ?? DICE_REST_SRC
    : DICE_REST_SRC

  return (
    <button
      aria-label="Randomize avatar"
      className="avatar-random-button"
      data-rolling={isDiceRolling}
      disabled={isDiceRolling}
      onClick={() => {
        startDiceRoll()
        onRandomize()
      }}
      type="button"
    >
      {diceImageSrc ? (
        <img alt="" decoding="sync" draggable={false} src={diceImageSrc} />
      ) : (
        <span aria-hidden="true" className="avatar-random-button__fallback">
          D6
        </span>
      )}
    </button>
  )
}

function WordbeeMenu({
  maxPastDate,
  minPastDate,
  onDaily,
  onPast,
  onPastDateChange,
  onRandom,
  pastDate,
  showDaily,
}: {
  maxPastDate: string
  minPastDate: string
  onDaily: () => void
  onPast: () => void
  onPastDateChange: (dateValue: string) => void
  onRandom: () => void
  pastDate: string
  showDaily: boolean
}) {
  const [isWordleOpen, setIsWordleOpen] = useState(true)

  return (
    <div className="wordbee-menu-popover" role="menu">
      <button
        aria-expanded={isWordleOpen}
        className="wordbee-game-menu-button"
        onClick={() => setIsWordleOpen((isOpen) => !isOpen)}
        role="menuitem"
        type="button"
      >
        <img alt="" className="wordbee-game-menu-button__logo" src={wordleLogoUrl} />
        <span>Wordle</span>
        <span className="wordbee-game-menu-button__chevron" aria-hidden="true" />
      </button>

      {isWordleOpen && (
        <div className="wordbee-menu-game-options">
          {showDaily && (
            <button onClick={onDaily} role="menuitem" type="button">
              Daily Wordle
            </button>
          )}
          <button onClick={onRandom} role="menuitem" type="button">
            Endless random
          </button>
          <div className="wordbee-menu-past">
            <label htmlFor="wordbee-past-date">Past date</label>
            <div>
              <input
                id="wordbee-past-date"
                max={maxPastDate}
                min={minPastDate}
                onChange={(event) => onPastDateChange(event.target.value)}
                type="date"
                value={pastDate}
              />
              <button onClick={onPast} type="button">
                Play
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ResultsDialog({
  canOpenStats = false,
  onClose,
  onCopy,
  onOpenPastWords,
  onOpenStats,
  onPlayRandom,
  result,
}: {
  canOpenStats?: boolean
  onClose: () => void
  onCopy: () => void
  onOpenPastWords: () => void
  onOpenStats: () => void
  onPlayRandom: () => void
  result: GameResult
}) {
  const distributionMax = getDistributionMax(result.stats)
  const emojiRows = createShareText(result)
  const isDailyResult = result.mode === 'daily'

  return (
    <div className="results-backdrop" aria-live="polite" onClick={onClose} role="presentation">
      <section
        aria-label="Completed Wordle summary"
        aria-modal="true"
        className="results-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="results-close" type="button" aria-label="Close" onClick={onClose}>
          <InlineIcon markup={closeIconMarkup} />
        </button>
        <DefinitionPanel definition={result.definition} fallbackWord={result.answer} />

        {isDailyResult && (
          <>
            <section className="results-section" aria-labelledby="summary-title">
              <h3 id="summary-title">Statistics</h3>
              <div className="results-stat-grid">
                <StatValue label="Played" value={result.stats.played} />
                <StatValue label="Win %" value={result.stats.winPercentage} />
                <StatValue label="Current Streak" value={result.stats.currentStreak} />
                <StatValue label="Max Streak" value={result.stats.maxStreak} />
              </div>
            </section>

            <section className="results-section" aria-labelledby="distribution-title">
              <h3 id="distribution-title">Solve Distribution</h3>
              <div className="distribution-list">
                {GUESS_DISTRIBUTION_ROWS.map((row) => {
                  const count = result.stats.guessDistribution[row.key] ?? 0
                  const isCurrentGuess =
                    (result.outcome === 'won' && result.guessesUsed === Number(row.key)) ||
                    (result.outcome === 'lost' && row.key === 'fail')

                  return (
                    <div className="distribution-row" key={row.key}>
                      <span className="distribution-row__label">{row.label}</span>
                      <span
                        className={[
                          'distribution-row__bar',
                          isCurrentGuess ? 'distribution-row__bar--current' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={
                          {
                            '--bar-width': `${Math.max(8, (count / distributionMax) * 100)}%`,
                          } as CSSProperties
                        }
                      >
                        {count}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}

        {canOpenStats && isDailyResult && (
          <button
            className="results-link-card results-link-card--stats"
            onClick={onOpenStats}
            type="button"
          >
            <InlineIcon markup={statsIconMarkup} />
            <span>
              <strong>Detailed stats</strong>
              <span>Compare streaks, dates, and solve patterns.</span>
            </span>
            <span className="results-link-card__arrow" aria-hidden="true">
              ›
            </span>
          </button>
        )}

        {!isDailyResult && result.analysis && (
          <section
            className="results-section results-section--analysis"
            aria-labelledby="session-insights-title"
          >
            <h3 id="session-insights-title">Solve insights</h3>
            <SolveAnalysisPanel analysis={result.analysis} />
          </section>
        )}

	        <div className="results-secondary-actions">
	          <button onClick={onPlayRandom} type="button">Play random</button>
	          <button onClick={onOpenPastWords} type="button">Pick past date</button>
	        </div>
        <p className="results-note">Random and past plays are not tracked.</p>

        <div className="results-copy-area">
          <button
            aria-label="Copy emoji results"
            className="results-copy-button"
            type="button"
            onClick={onCopy}
          >
            <span className="results-copy-button__emoji">{emojiRows}</span>
          </button>
          <span
            aria-live="polite"
            aria-hidden={!result.copied}
            className="results-copy-feedback"
            data-visible={result.copied}
          >
            Copied!
          </span>
        </div>
      </section>
    </div>
  )
}

function DefinitionPanel({
  definition,
  fallbackWord,
}: {
  definition?: DefinitionSummary
  fallbackWord?: string
}) {
  const displayWord = definition?.word || fallbackWord || 'Wordle'
  const synonyms = definition?.synonyms ?? []

  return (
    <section className="definition-panel" aria-label="Answer definition">
      <div className="definition-panel__heading">
        <strong>{displayWord}</strong>
        {definition?.phonetic && <em>{definition.phonetic}</em>}
      </div>
      {definition?.partOfSpeech && (
        <span className="definition-panel__part">{definition.partOfSpeech}</span>
      )}
      <p>{definition?.definition || 'Short definition is still loading.'}</p>
      {synonyms.length > 0 && (
        <div className="definition-panel__synonyms">
          <span>Synonyms</span>
          <span>{synonyms.join(', ')}</span>
        </div>
      )}
    </section>
  )
}

function StatValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="results-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function FamilyStatsPage({
  currentUserId,
  dashboard,
  error,
  initialView,
  isLoading,
  onBack,
  onReload,
}: {
  currentUserId: string
  dashboard: FamilyStatsDashboard | null
  error: string
  initialView: FamilyStatsView
  isLoading: boolean
  onBack: () => void
  onReload: () => void
}) {
  const [selectedUserId, setSelectedUserId] = useState(currentUserId)
  const [selectedResultId, setSelectedResultId] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [view, setView] = useState<FamilyStatsView>(initialView)
  const users = dashboard?.users ?? []
  const group = dashboard?.group ?? createFallbackGroupStats(users)
  const selectedUser =
    users.find((user) => user.id === selectedUserId) ??
    users.find((user) => user.id === currentUserId) ??
    users[0]
  const selectedUserOpenHistory =
    selectedUser?.history.filter((result) => !isLockedResult(result)) ?? []
  const playerResult =
    selectedUserOpenHistory.find((result) => result.id === selectedResultId) ??
    selectedUserOpenHistory[0]
  const selectedDay =
    group.timeline.find((day) => day.date === selectedDate) ??
    group.timeline[group.timeline.length - 1]
  const selectedDayResults = selectedDay ? getResultsForDate(users, selectedDay.date) : []
  const selectedDayOpenResults = selectedDayResults.filter((result) => !isLockedResult(result))
  const dayResult =
    selectedDayOpenResults.find((result) => result.id === selectedResultId) ??
    selectedDayOpenResults[0]
  const isInitialStatsLoad = isLoading && !dashboard

  useEffect(() => {
    setView(initialView)
  }, [initialView])

  useEffect(() => {
    if (view !== 'players') return
    if (!selectedUser) return
    if (
      selectedUser.history.some(
        (result) => result.id === selectedResultId && !isLockedResult(result),
      )
    ) {
      return
    }
    setSelectedResultId(getFirstUnlockedResult(selectedUser.history)?.id ?? '')
  }, [selectedResultId, selectedUser, view])

  useEffect(() => {
    if (selectedDate && group.timeline.some((day) => day.date === selectedDate)) return
    setSelectedDate(group.timeline[group.timeline.length - 1]?.date ?? '')
  }, [group.timeline, selectedDate])

  useEffect(() => {
    if (view !== 'daily') return

    const dayResultId = dayResult?.id ?? ''
    if (selectedResultId === dayResultId) return

    setSelectedResultId(dayResultId)
  }, [dayResult?.id, selectedResultId, view])

  const openPlayer = (userId: string) => {
    setSelectedUserId(userId)
    setView('players')
  }

  return (
    <main className="stats-page" aria-labelledby="stats-page-title">
      <div className="stats-page__inner">
        <section className="stats-hero">
          <div>
            <span className="stats-kicker">Friends & family</span>
            <h2 id="stats-page-title">Stats</h2>
            <p>Daily play only. Random and past-date Wordle plays stay untracked.</p>
          </div>
          <div className="stats-hero__actions">
            <button className="stats-secondary-button" onClick={onBack} type="button">
              Back to game
            </button>
            <button
              className="stats-primary-button"
              disabled={isLoading}
              onClick={onReload}
              type="button"
            >
              Refresh
            </button>
          </div>
        </section>

        {error && (
          <div className="stats-error">
            <span>{error}</span>
            <button disabled={isLoading} onClick={onReload} type="button">
              Retry
            </button>
          </div>
        )}

        {isInitialStatsLoad ? null : users.length === 0 && !isLoading ? (
          <section className="stats-empty">
            <h3>No tracked daily results yet</h3>
            <p>Friends-and-family daily completions will appear here.</p>
          </section>
        ) : (
          <>
            <StatsPageTabs onChange={setView} view={view} />
            {view === 'overview' && (
              <StatsOverview group={group} onSelectUser={openPlayer} users={users} />
            )}
            {view === 'players' && selectedUser && (
              <StatsPlayerView
                onSelectResult={setSelectedResultId}
                onSelectUser={setSelectedUserId}
                result={playerResult}
                selectedUser={selectedUser}
                users={users}
              />
            )}
            {view === 'daily' && (
              <StatsDailyView
                day={selectedDay}
                onSelectDate={setSelectedDate}
                onSelectResult={setSelectedResultId}
                result={dayResult}
                results={selectedDayResults}
                selectedDate={selectedDate}
                timeline={group.timeline}
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}

function StatsPageTabs({
  onChange,
  view,
}: {
  onChange: (view: FamilyStatsView) => void
  view: FamilyStatsView
}) {
  return (
    <div className="stats-tabs" role="tablist" aria-label="Stats views">
      {(
        [
          ['overview', 'Overview'],
          ['players', 'Players'],
          ['daily', 'Daily review'],
        ] as const
      ).map(([value, label]) => (
        <button
          aria-selected={view === value}
          key={value}
          onClick={() => onChange(value)}
          role="tab"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function StatsOverview({
  group,
  onSelectUser,
  users,
}: {
  group: FamilyGroupStats
  onSelectUser: (userId: string) => void
  users: FamilyStatsUser[]
}) {
  const averageLeader = getAverageLeader(users)
  const winsLeader = getWinsLeader(users)
  const currentStreakLeader = getCurrentPlayStreakLeader(users)
  const playsLeader = getPlaysLeader(users)
  const winRateLeader = getWinRateLeader(users)

  return (
    <section className="stats-section" aria-label="Stats overview">
      <div className="stats-metric-grid">
        <StatsMetric label="Total plays" value={group.played} />
        <StatsMetric
          label="Lowest average"
          player={averageLeader}
          value={averageLeader ? formatAverage(averageLeader.stats.averageGuesses) : '--'}
        />
        <StatsMetric
          label="Most wins"
          player={winsLeader}
          value={winsLeader?.stats.wins ?? '--'}
        />
        <StatsMetric
          label="Longest current streak"
          player={currentStreakLeader}
          value={currentStreakLeader?.stats.currentPlayStreak ?? '--'}
        />
        <StatsMetric
          label="Most plays"
          player={playsLeader}
          value={playsLeader?.stats.played ?? '--'}
        />
        <StatsMetric
          label="Highest win rate"
          player={winRateLeader}
          value={winRateLeader ? `${winRateLeader.stats.winPercentage}%` : '--'}
        />
      </div>

      <div className="stats-chart-grid">
        <GuessDistributionChart distribution={group.guessDistribution} title="Solve distribution" />
        <StarterBarChart starters={group.topStarters} title="First-word habits" />
      </div>

      <TrendChart timeline={group.timeline} />
      <PlayerLeaderboard onSelectUser={onSelectUser} users={users} />
    </section>
  )
}

function StatsPlayerView({
  onSelectResult,
  onSelectUser,
  result,
  selectedUser,
  users,
}: {
  onSelectResult: (resultId: string) => void
  onSelectUser: (userId: string) => void
  result?: FamilyDailyResult
  selectedUser: FamilyStatsUser
  users: FamilyStatsUser[]
}) {
  return (
    <section className="stats-section" aria-label={`${selectedUser.displayName} stats`}>
      <div className="stats-player-tabs" aria-label="Players">
        {users.map((user) => (
          <button
            aria-pressed={user.id === selectedUser.id}
            key={user.id}
            onClick={() => onSelectUser(user.id)}
            type="button"
          >
            <PlayerAvatar
              avatar={user.avatar}
              displayName={user.displayName}
              size={30}
              userId={user.id}
            />
            <span>{user.displayName}</span>
          </button>
        ))}
      </div>

      <div className="stats-profile-heading">
        <div className="stats-profile-identity">
          <PlayerAvatar
            avatar={selectedUser.avatar}
            displayName={selectedUser.displayName}
            size={54}
            userId={selectedUser.id}
          />
          <div>
            <span className="stats-kicker">Player insight</span>
            <h3>{selectedUser.displayName}</h3>
          </div>
        </div>
        <span>{selectedUser.stats.played} daily plays</span>
      </div>

      <div className="stats-metric-grid stats-metric-grid--player">
        <StatsMetric label="Wins" value={selectedUser.stats.wins} />
        <StatsMetric label="Win rate" value={`${selectedUser.stats.winPercentage}%`} />
        <StatsMetric label="Avg guesses" value={formatAverage(selectedUser.stats.averageGuesses)} />
        <StatsMetric
          help={SKILL_HELP_TEXT}
          label="Skill"
          value={selectedUser.stats.averageSkill ?? 0}
        />
        <StatsMetric
          help={LUCK_HELP_TEXT}
          label="Luck"
          value={selectedUser.stats.averageLuck ?? 0}
        />
        <StatsMetric label="Best streak" value={selectedUser.stats.bestWinStreak} />
      </div>

      <div className="stats-chart-grid">
        <GuessDistributionChart
          distribution={selectedUser.stats.guessDistribution}
          title="Personal distribution"
        />
        <StarterBarChart starters={selectedUser.stats.topStarters} title="Favorite first words" />
      </div>

      <div className="stats-history-layout">
        <section className="stats-history-panel" aria-labelledby="player-history-title">
          <h4 id="player-history-title">Daily history</h4>
          {selectedUser.history.length > 0 ? (
            <div className="stats-history-list">
              {selectedUser.history.map((historyResult) => {
                const locked = isLockedResult(historyResult)

                return (
                  <button
                    data-locked={locked}
                    data-selected={!locked && historyResult.id === result?.id}
                    disabled={locked}
                    key={historyResult.id}
                    onClick={() => onSelectResult(historyResult.id)}
                    type="button"
                  >
                    <span>{formatHistoryDate(historyResult.date)}</span>
                    <strong>{formatOutcome(historyResult)}</strong>
                    <em>{locked ? 'Solve today to reveal' : historyResult.starterWord}</em>
                  </button>
                )
              })}
            </div>
          ) : (
            <p>No completed days yet.</p>
          )}
        </section>

        {result && <FamilyResultBoard result={result} />}
      </div>
    </section>
  )
}

function StatsDailyView({
  day,
  onSelectDate,
  onSelectResult,
  result,
  results,
  selectedDate,
  timeline,
}: {
  day?: FamilyTimelineDay
  onSelectDate: (dateValue: string) => void
  onSelectResult: (resultId: string) => void
  result?: FamilyDailyResult
  results: FamilyDailyResult[]
  selectedDate: string
  timeline: FamilyTimelineDay[]
}) {
  const isLockedDay = Boolean(day?.locked)

  return (
    <section className="stats-section" aria-label="Daily stats review">
      <div className="stats-day-rail" aria-label="Tracked days">
        {timeline.map((timelineDay) => (
          <button
            aria-pressed={timelineDay.date === selectedDate}
            data-locked={Boolean(timelineDay.locked)}
            key={timelineDay.date}
            onClick={() => onSelectDate(timelineDay.date)}
            type="button"
          >
            <strong>{formatHistoryDate(timelineDay.date)}</strong>
          </button>
        ))}
      </div>

      {day ? (
        <>
          <div className="stats-day-summary">
            <InsightCard
              detail={
                isLockedDay
                  ? `${day.players} player${day.players === 1 ? '' : 's'} finished`
                  : `${day.players} players, ${day.winPercentage}% wins`
              }
              label="Answer"
              locked={isLockedDay}
              value={isLockedDay ? 'Locked' : day.answer}
            />
            <InsightCard
              detail={isLockedDay ? 'Solve today to reveal' : `${day.bestScore} by ${day.bestPlayer}`}
              label="Best solve"
              locked={isLockedDay}
              value={isLockedDay ? 'Locked' : day.bestPlayer}
            />
          </div>

          <div className="stats-daily-results" aria-label={`${formatHistoryDate(day.date)} results`}>
            {results.map((dailyResult) => {
              const locked = isLockedResult(dailyResult)

              return (
                <button
                  data-locked={locked}
                  data-selected={!locked && dailyResult.id === result?.id}
                  disabled={locked}
                  key={dailyResult.id}
                  onClick={() => onSelectResult(dailyResult.id)}
                  type="button"
                >
                  <PlayerAvatar
                    avatar={dailyResult.avatar}
                    displayName={dailyResult.displayName}
                    size={48}
                    userId={dailyResult.userId}
                  />
                  <strong className="stats-daily-result-name">{dailyResult.displayName}</strong>
                  <span className="stats-daily-result-outcome">
                    {locked ? 'Solve today to reveal' : formatOutcomeWithGuesses(dailyResult)}
                  </span>
                </button>
              )
            })}
          </div>

          {result && !isLockedResult(result) && <FamilyResultBoard result={result} />}
        </>
      ) : (
        <section className="stats-empty">
          <h3>No daily results yet</h3>
          <p>Completed friends-and-family days will appear here.</p>
        </section>
      )}
    </section>
  )
}

function StatsMetric({
  help,
  label,
  player,
  value,
}: {
  help?: string
  label: string
  player?: FamilyStatsUser
  value: number | string
}) {
  const variant = player ? 'player' : 'number'

  return (
    <article className={`stats-metric stats-metric--${variant}`}>
      {player ? (
        <div className="stats-metric__value-row">
          <strong>{value}</strong>
          <span className="stats-metric__player">
            <PlayerAvatar
              avatar={player.avatar}
              displayName={player.displayName}
              size={28}
              userId={player.id}
            />
            <span>{player.displayName}</span>
          </span>
        </div>
      ) : (
        <strong>{value}</strong>
      )}
      <span>
        {label}
        {help && <StatsHelpTooltip text={help} />}
      </span>
    </article>
  )
}

function StatsHelpTooltip({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const contentRef = useRef<HTMLSpanElement | null>(null)
  const tooltipId = useId()

  const updatePopoverPosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return

    const buttonRect = button.getBoundingClientRect()
    const width = Math.min(286, Math.max(180, window.innerWidth - 24))
    const left = Math.min(
      Math.max(12, buttonRect.left + buttonRect.width / 2 - width / 2),
      window.innerWidth - width - 12,
    )
    const contentHeight = contentRef.current?.offsetHeight ?? 96
    const belowTop = buttonRect.bottom + 8
    const hasRoomBelow = belowTop + contentHeight + 12 <= window.innerHeight
    const top = hasRoomBelow
      ? belowTop
      : Math.max(12, buttonRect.top - contentHeight - 8)

    setPopoverStyle({
      left,
      top,
      width,
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return

    updatePopoverPosition()

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || contentRef.current?.contains(target)) return
      setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updatePopoverPosition)
    window.addEventListener('scroll', updatePopoverPosition, true)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updatePopoverPosition)
      window.removeEventListener('scroll', updatePopoverPosition, true)
    }
  }, [isOpen, updatePopoverPosition])

  return (
    <span className="stats-help-wrap">
      <button
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        aria-label={text}
        className="stats-help"
        ref={buttonRef}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
        type="button"
      >
        ?
      </button>
      {isOpen &&
        createPortal(
          <span
            className="stats-help__content"
            id={tooltipId}
            ref={contentRef}
            role="tooltip"
            style={popoverStyle}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}

function InsightCard({
  avatar,
  detail,
  label,
  locked = false,
  value,
}: {
  avatar?: { avatar?: AvatarConfig; displayName: string; userId: string }
  detail: string
  label: string
  locked?: boolean
  value: string
}) {
  return (
    <article className="stats-insight-card" data-locked={locked}>
      <span>{label}</span>
      <div className="stats-insight-card__value">
        {avatar && (
          <PlayerAvatar
            avatar={avatar.avatar}
            displayName={avatar.displayName}
            size={36}
            userId={avatar.userId}
          />
        )}
        <strong>{value}</strong>
      </div>
      <p>{detail}</p>
    </article>
  )
}

function GuessDistributionChart({
  distribution,
  title,
}: {
  distribution: Record<string, number>
  title: string
}) {
  const max = Math.max(1, ...GUESS_DISTRIBUTION_ROWS.map((row) => distribution[row.key] ?? 0))

  return (
    <section className="stats-chart-card" aria-labelledby={`${toSlug(title)}-title`}>
      <h4 id={`${toSlug(title)}-title`}>{title}</h4>
      <div className="stats-distribution-chart">
        {GUESS_DISTRIBUTION_ROWS.map((row) => {
          const count = distribution[row.key] ?? 0

          return (
            <div className="stats-distribution-row" key={row.key}>
              <span>{row.label}</span>
              <strong
                style={
                  {
                    '--bar-width': `${Math.max(4, (count / max) * 100)}%`,
                  } as CSSProperties
                }
              >
                {count}
              </strong>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function StarterBarChart({
  starters,
  title,
}: {
  starters: Array<StarterStat | StarterInsight>
  title: string
}) {
  const visibleStarters = starters.slice(0, 8)
  const max = Math.max(1, ...visibleStarters.map((starter) => starter.count))

  return (
    <section className="stats-chart-card" aria-labelledby={`${toSlug(title)}-title`}>
      <h4 id={`${toSlug(title)}-title`}>{title}</h4>
      {visibleStarters.length > 0 ? (
        <div className="stats-starter-bars">
          {visibleStarters.map((starter) => (
            <div className="stats-starter-bar" key={starter.word}>
              <div>
                <strong>{starter.word}</strong>
                <span>
                  {starter.count} plays · {starter.percentage}%
                </span>
              </div>
              <em
                style={
                  {
                    '--bar-width': `${Math.max(6, (starter.count / max) * 100)}%`,
                  } as CSSProperties
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="stats-muted">No first-word data yet.</p>
      )}
    </section>
  )
}

function TrendChart({ timeline }: { timeline: FamilyTimelineDay[] }) {
  const chartTitleId = useId()
  const visibleDays = timeline.filter((day) => !day.locked).slice(-18)
  const width = 360
  const height = 176
  const plotLeft = 34
  const plotRight = 14
  const plotTop = 16
  const plotBottom = 34
  const minValue = 1
  const maxValue = 6
  const yTicks = [1, 2, 3, 4, 5, 6]
  const plotWidth = width - plotLeft - plotRight
  const plotHeight = height - plotTop - plotBottom
  const yForValue = (value: number) =>
    plotTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight
  const points = visibleDays.map((day, index) => {
    const value = Math.min(maxValue, Math.max(minValue, day.averageGuesses))
    const x =
      visibleDays.length === 1
        ? width / 2
        : plotLeft + (index / (visibleDays.length - 1)) * plotWidth
    const y = yForValue(value)
    return { day, x, y }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const firstDay = visibleDays[0]
  const lastDay = visibleDays[visibleDays.length - 1]

  return (
    <section className="stats-chart-card stats-chart-card--wide" aria-labelledby="stats-trend-title">
      <div className="stats-chart-heading">
        <h4 id="stats-trend-title">Daily average guesses</h4>
        <span>{visibleDays.length} tracked days</span>
      </div>
      {points.length > 0 ? (
        <svg
          aria-labelledby={chartTitleId}
          className="stats-trend-chart"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <title id={chartTitleId}>Average guesses by day</title>
          {yTicks.map((tick) => {
            const y = yForValue(tick)

            return (
              <g key={tick}>
                <path className="stats-trend-grid" d={`M ${plotLeft} ${y} H ${width - plotRight}`} />
                <text
                  className="stats-trend-axis-label stats-trend-axis-label--y"
                  x={plotLeft - 9}
                  y={y}
                >
                  {tick}
                </text>
              </g>
            )
          })}
          <path
            className="stats-trend-axis"
            d={`M ${plotLeft} ${plotTop} V ${height - plotBottom} H ${width - plotRight}`}
          />
          <path className="stats-trend-line" d={path} />
          {points.map((point) => (
            <circle className="stats-trend-point" cx={point.x} cy={point.y} key={point.day.date} r="4">
              <title>
                {formatHistoryDate(point.day.date)}: {formatAverage(point.day.averageGuesses)} average
              </title>
            </circle>
          ))}
          {firstDay && (
            <text className="stats-trend-axis-label" x={plotLeft} y={height - 10}>
              {formatHistoryDate(firstDay.date)}
            </text>
          )}
          {lastDay && lastDay.date !== firstDay?.date && (
            <text
              className="stats-trend-axis-label stats-trend-axis-label--end"
              x={width - plotRight}
              y={height - 10}
            >
              {formatHistoryDate(lastDay.date)}
            </text>
          )}
          <text className="stats-trend-axis-title" x={plotLeft} y={10}>
            Avg guesses
          </text>
        </svg>
      ) : (
        <p className="stats-muted">Trend data will appear after daily completions.</p>
      )}
    </section>
  )
}

type LeaderboardSortKey =
  | 'averageGuesses'
  | 'winPercentage'
  | 'wins'
  | 'currentWinStreak'
  | 'bestWinStreak'
  | 'averageSkill'
  | 'played'

type LeaderboardSortOption = {
  direction: 'asc' | 'desc'
  formatValue: (user: FamilyStatsUser) => string
  getValue: (user: FamilyStatsUser) => number
  key: LeaderboardSortKey
  label: string
}

const LEADERBOARD_SORT_OPTIONS: LeaderboardSortOption[] = [
  {
    direction: 'asc',
    formatValue: (user) => `${formatAverage(user.stats.averageGuesses)} avg guesses`,
    getValue: (user) => user.stats.averageGuesses,
    key: 'averageGuesses',
    label: 'Average guesses',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.winPercentage}% win rate`,
    getValue: (user) => user.stats.winPercentage,
    key: 'winPercentage',
    label: 'Win rate',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.wins} wins`,
    getValue: (user) => user.stats.wins,
    key: 'wins',
    label: 'Wins',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.currentWinStreak} current streak`,
    getValue: (user) => user.stats.currentWinStreak,
    key: 'currentWinStreak',
    label: 'Current streak',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.bestWinStreak} best streak`,
    getValue: (user) => user.stats.bestWinStreak,
    key: 'bestWinStreak',
    label: 'Best streak',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.averageSkill ?? 0} skill`,
    getValue: (user) => user.stats.averageSkill ?? 0,
    key: 'averageSkill',
    label: 'Skill',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.played} plays`,
    getValue: (user) => user.stats.played,
    key: 'played',
    label: 'Total plays',
  },
]

function PlayerLeaderboard({
  onSelectUser,
  users,
}: {
  onSelectUser: (userId: string) => void
  users: FamilyStatsUser[]
}) {
  const [sortKey, setSortKey] = useState<LeaderboardSortKey>('averageGuesses')
  const selectedSort = getLeaderboardSortOption(sortKey)
  const rankedUsers = [...users].sort((first, second) =>
    compareLeaderboardUsers(first, second, sortKey),
  )

  return (
    <section className="stats-leaderboard" aria-labelledby="stats-leaderboard-title">
      <div className="stats-chart-heading">
        <h4 id="stats-leaderboard-title">Leaderboard</h4>
        <label className="stats-leaderboard-sort">
          <span>Ranked by</span>
          <select
            aria-label="Rank leaderboard by"
            onChange={(event) => setSortKey(event.target.value as LeaderboardSortKey)}
            value={sortKey}
          >
            {LEADERBOARD_SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="stats-leaderboard-list">
        {rankedUsers.map((user, index) => (
          <button key={user.id} onClick={() => onSelectUser(user.id)} type="button">
            <span>#{index + 1}</span>
            <PlayerAvatar
              avatar={user.avatar}
              displayName={user.displayName}
              size={34}
              userId={user.id}
            />
            <strong>{user.displayName}</strong>
            <em>{formatLeaderboardValue(user, selectedSort)}</em>
            <i>{formatLeaderboardSecondaryValue(user, sortKey)}</i>
          </button>
        ))}
      </div>
    </section>
  )
}

function FamilyResultBoard({ result }: { result: FamilyDailyResult }) {
  return (
    <section className="family-result-board" aria-label={`${result.displayName} ${result.date}`}>
      <div className="family-result-board__heading">
        <div className="family-result-board__player">
          <PlayerAvatar
            avatar={result.avatar}
            displayName={result.displayName}
            size={42}
            userId={result.userId}
          />
          <div>
            <span>{formatHistoryDate(result.date)}</span>
            <strong>{result.displayName}</strong>
          </div>
        </div>
        <em>{formatOutcomeWithGuesses(result)}</em>
      </div>
      <div className="family-result-board__body">
        <div className="family-mini-board">
          {result.guesses.map((guess, rowIndex) => (
            <div className="family-mini-board__row" key={`${result.id}-${rowIndex}`}>
              {guess.split('').map((letter, tileIndex) => (
                <span
                  data-state={result.board[rowIndex]?.[tileIndex] ?? 'absent'}
                  key={`${result.id}-${rowIndex}-${tileIndex}`}
                >
                  {letter}
                </span>
              ))}
            </div>
          ))}
        </div>
        {result.analysis && <SolveAnalysisPanel analysis={result.analysis} />}
      </div>
    </section>
  )
}

function SolveAnalysisPanel({ analysis }: { analysis: SolveAnalysis }) {
  return (
    <div className="solve-analysis">
      <div className="solve-analysis__scores">
        <ScoreMeter help={SKILL_HELP_TEXT} label="Skill" value={analysis.skill} />
        <ScoreMeter help={LUCK_HELP_TEXT} label="Luck" value={analysis.luck} />
      </div>
      <div className="solve-analysis__path">
        <span>Solve path</span>
        <strong>{analysis.remainingAfterLast} left after final guess</strong>
      </div>
      <p className="solve-analysis__note">
        Counts show possible answers before and after each clue. Expected remaining is an
        average over possible clue patterns.
      </p>
      <ol className="solve-analysis__steps">
        {analysis.steps.map((step) => (
          <li key={`${step.turn}-${step.guess}`}>
            <div className="solve-analysis__step-heading">
              <strong>
                {step.turn}. {step.guess}
              </strong>
              <span>
                {formatCandidateCountChange(step)}
              </span>
            </div>
            <div className="solve-analysis__step-bar">
              <span
                style={
                  {
                    '--bar-width': `${Math.max(3, ((step.before - step.after) / step.before) * 100)}%`,
                  } as CSSProperties
                }
              />
            </div>
            <p>{formatStepInsight(step)}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function formatCandidateCountChange(step: GuessAnalysisStep) {
  return step.before <= 1
    ? '1 possible answer'
    : `${step.before} possible -> ${step.after}`
}

function formatStepInsight(step: GuessAnalysisStep) {
  if (step.before <= 1) {
    if (step.guess === step.bestWord) {
      return `${step.bestWord} was the only remaining answer; this guess confirmed it.`
    }

    return `${step.bestWord} was the only remaining answer; ${step.guess} could not improve the path.`
  }

  return `${step.eliminatedPercentage}% eliminated. Expected remaining for ${step.guess}: ${formatAverage(step.expectedRemaining)}. Best sampled play: ${step.bestWord} (${formatAverage(step.bestRemaining)} expected).`
}

function ScoreMeter({
  help,
  label,
  value,
}: {
  help?: string
  label: string
  value: number
}) {
  return (
    <div className="score-meter">
      <div>
        <span>
          {label}
          {help && <StatsHelpTooltip text={help} />}
        </span>
        <strong>{value}</strong>
      </div>
      <em
        style={
          {
            '--meter-width': `${Math.max(4, Math.min(100, value))}%`,
          } as CSSProperties
        }
      />
    </div>
  )
}

function PlayerAvatar({
  avatar,
  displayName,
  size,
}: {
  avatar?: AvatarConfig
  displayName: string
  size: number
  userId: string
}) {
  const displayAvatar =
    (avatar ? sanitizeAvatarConfig(avatar, displayName) : null) ??
    createDefaultAvatarConfig(displayName)

  return (
    <span
      aria-hidden="true"
      className="stats-player-avatar"
      style={{ height: size, width: size }}
    >
      <AvatarImage
        avatar={displayAvatar}
        className="stats-player-avatar__image"
        displayName={displayName}
        size={size * 3}
      />
    </span>
  )
}

function createFallbackGroupStats(users: FamilyStatsUser[]): FamilyGroupStats {
  const results = users.flatMap((user) => user.history)
  const wins = results.filter((result) => result.outcome === 'won')
  const distribution = { ...EMPTY_STATS.guessDistribution }
  wins.forEach((result) => {
    const distributionKey = String(result.guessesUsed)
    distribution[distributionKey] = (distribution[distributionKey] ?? 0) + 1
  })
  distribution.fail = results.length - wins.length

  return {
    played: results.length,
    wins: wins.length,
    winPercentage: results.length ? Math.round((wins.length / results.length) * 100) : 0,
    averageGuesses: results.length
      ? Number(formatAverage(results.reduce((total, result) => total + result.guessesUsed, 0) / results.length))
      : 0,
    averageSkill: 0,
    averageLuck: 0,
    daysTracked: new Set(results.map((result) => result.date)).size,
    players: users.length,
    guessDistribution: distribution,
    topStarters: [],
    timeline: [],
    recentResults: results.slice(0, 36),
    bestDay: null,
    toughestDay: null,
  }
}

function getResultsForDate(users: FamilyStatsUser[], dateValue: string) {
  return users
    .flatMap((user) => user.history)
    .filter((result) => result.date === dateValue)
    .sort((first, second) => {
      if (isLockedResult(first) !== isLockedResult(second)) {
        return isLockedResult(first) ? 1 : -1
      }
      if (first.outcome !== second.outcome) return first.outcome === 'won' ? -1 : 1
      if (first.guessesUsed !== second.guessesUsed) return first.guessesUsed - second.guessesUsed
      return first.completedAt.localeCompare(second.completedAt)
    })
}

function isLockedResult(result?: FamilyDailyResult) {
  return Boolean(result?.locked)
}

function getFirstUnlockedResult(results: FamilyDailyResult[]) {
  return results.find((result) => !isLockedResult(result))
}

function getAverageLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.played > 0)
    .sort((first, second) => first.stats.averageGuesses - second.stats.averageGuesses)[0]
}

function getWinsLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.wins > 0)
    .sort((first, second) => {
      if (second.stats.wins !== first.stats.wins) return second.stats.wins - first.stats.wins
      return first.stats.averageGuesses - second.stats.averageGuesses
    })[0]
}

function getCurrentPlayStreakLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.currentPlayStreak > 0)
    .sort((first, second) => {
      if (second.stats.currentPlayStreak !== first.stats.currentPlayStreak) {
        return second.stats.currentPlayStreak - first.stats.currentPlayStreak
      }
      return first.stats.averageGuesses - second.stats.averageGuesses
    })[0]
}

function getPlaysLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.played > 0)
    .sort((first, second) => {
      if (second.stats.played !== first.stats.played) return second.stats.played - first.stats.played
      return first.stats.averageGuesses - second.stats.averageGuesses
    })[0]
}

function getWinRateLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.played > 0)
    .sort((first, second) => {
      if (second.stats.winPercentage !== first.stats.winPercentage) {
        return second.stats.winPercentage - first.stats.winPercentage
      }
      if (second.stats.wins !== first.stats.wins) return second.stats.wins - first.stats.wins
      return first.stats.averageGuesses - second.stats.averageGuesses
    })[0]
}

function getLeaderboardSortOption(sortKey: LeaderboardSortKey) {
  return (
    LEADERBOARD_SORT_OPTIONS.find((option) => option.key === sortKey) ??
    LEADERBOARD_SORT_OPTIONS[0]
  )
}

function compareLeaderboardUsers(
  first: FamilyStatsUser,
  second: FamilyStatsUser,
  sortKey: LeaderboardSortKey,
) {
  if (first.stats.played === 0 || second.stats.played === 0) {
    if (first.stats.played !== second.stats.played) return first.stats.played === 0 ? 1 : -1
  }

  const sortOption = getLeaderboardSortOption(sortKey)
  const firstValue = sortOption.getValue(first)
  const secondValue = sortOption.getValue(second)

  if (firstValue !== secondValue) {
    return sortOption.direction === 'asc' ? firstValue - secondValue : secondValue - firstValue
  }

  return compareLeaderboardTiebreakers(first, second, sortKey)
}

function compareLeaderboardTiebreakers(
  first: FamilyStatsUser,
  second: FamilyStatsUser,
  sortKey: LeaderboardSortKey,
) {
  const tiebreakers =
    sortKey === 'averageGuesses'
      ? [
          compareStat(first.stats.averageSkill ?? 0, second.stats.averageSkill ?? 0, 'desc'),
          compareStat(first.stats.winPercentage, second.stats.winPercentage, 'desc'),
          compareStat(first.stats.wins, second.stats.wins, 'desc'),
        ]
      : [
          compareStat(first.stats.averageGuesses, second.stats.averageGuesses, 'asc'),
          compareStat(first.stats.averageSkill ?? 0, second.stats.averageSkill ?? 0, 'desc'),
          compareStat(first.stats.winPercentage, second.stats.winPercentage, 'desc'),
          compareStat(first.stats.wins, second.stats.wins, 'desc'),
        ]

  return (
    tiebreakers.find((result) => result !== 0) ??
    first.displayName.localeCompare(second.displayName)
  )
}

function compareStat(firstValue: number, secondValue: number, direction: 'asc' | 'desc') {
  return direction === 'asc' ? firstValue - secondValue : secondValue - firstValue
}

function formatLeaderboardValue(user: FamilyStatsUser, sortOption: LeaderboardSortOption) {
  if (user.stats.played === 0) return 'No plays yet'
  return sortOption.formatValue(user)
}

function formatLeaderboardSecondaryValue(user: FamilyStatsUser, sortKey: LeaderboardSortKey) {
  if (user.stats.played === 0) return ''
  if (sortKey === 'averageGuesses') return `${user.stats.averageSkill ?? 0} skill`
  return `${formatAverage(user.stats.averageGuesses)} avg guesses`
}

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function formatAverage(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatHistoryDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number)
  if (!year || !month || !day) return dateValue

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function formatOutcome(result: FamilyDailyResult) {
  if (isLockedResult(result)) return 'Locked'

  return result.outcome === 'won' ? `${result.guessesUsed}/6` : 'X/6'
}

function formatOutcomeWithGuesses(result: FamilyDailyResult) {
  if (isLockedResult(result)) return 'Locked'

  return `${formatOutcome(result)} guesses`
}

function SettingsDialog({
  accessState,
  clientSessionId,
  effectiveDarkTheme,
  onAccessLogin,
  onAvatarChange,
  onClose,
  onSignOut,
  onSettingChange,
  settings,
}: {
  accessState: AccessState | null
  clientSessionId: string
  effectiveDarkTheme: boolean
  onAccessLogin: (accessState: FriendsFamilyAccess) => void
  onAvatarChange: () => void
  onClose: () => void
  onSignOut: () => void
  onSettingChange: <Key extends keyof Settings>(key: Key, value: Settings[Key]) => void
  settings: Settings
}) {
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="settings-modal__header">
          <h2 id="settings-title">SETTINGS</h2>
          <button className="settings-close" type="button" aria-label="Close" onClick={onClose}>
            <InlineIcon markup={closeIconMarkup} />
          </button>
        </div>

        <div className="settings-list">
          <SettingsRow
            checked={effectiveDarkTheme}
            label="Dark Theme"
            onChange={(checked) => onSettingChange('darkThemeOverride', checked)}
          />
          <SettingsRow
            checked={settings.highContrast}
            description="Contrast and colorblindness improvements"
            label="High Contrast Mode"
            onChange={(checked) => onSettingChange('highContrast', checked)}
          />
          <SettingsRow
            checked={settings.onscreenKeyboardOnly}
            description="Ignore key input except from the onscreen keyboard. Most helpful for users using speech recognition or other assistive devices."
            label="Onscreen Keyboard Input Only"
            onChange={(checked) => onSettingChange('onscreenKeyboardOnly', checked)}
          />
          {accessState?.kind === 'friends-family' && (
            <SettingsIdentityRow
              avatar={accessState.avatar}
              label="Signed in as"
              onAvatarChange={onAvatarChange}
              onSignOut={onSignOut}
              value={accessState.displayName}
            />
          )}
          {accessState?.kind === 'guest' && (
            <SettingsAccessSection
              clientSessionId={clientSessionId}
              onAvatarDialogClose={onClose}
              onLogin={onAccessLogin}
            />
          )}
          <div className="settings-links" aria-label="Project links">
            <a
              href="https://github.com/MatthewBisbee/Wordbee"
              rel="noreferrer"
              target="_blank"
            >
              GitHub
            </a>
            <span className="settings-links__separator" aria-hidden="true">
              |
            </span>
            <a href="https://matthewbisbee.com" rel="noreferrer" target="_blank">
              matthewbisbee.com
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}

function SettingsAccessSection({
  clientSessionId,
  onAvatarDialogClose,
  onLogin,
}: {
  clientSessionId: string
  onAvatarDialogClose: () => void
  onLogin: (accessState: FriendsFamilyAccess) => void
}) {
  return (
    <div className="settings-access-section">
      <span className="settings-row__label">Enter friends and family code</span>
      <FriendsFamilyAccessForm
        clientSessionId={clientSessionId}
        className="access-form--settings"
        hideCodeLabel
        onAvatarDialogClose={onAvatarDialogClose}
        onLogin={onLogin}
        useAvatarDialog
      />
    </div>
  )
}

function SettingsIdentityRow({
  avatar,
  label,
  onAvatarChange,
  onSignOut,
  value,
}: {
  avatar: AvatarConfig
  label: string
  onAvatarChange: () => void
  onSignOut: () => void
  value: string
}) {
  return (
    <div className="settings-row settings-profile-row">
      <span className="settings-row__text">
        <span className="settings-row__label">{label}</span>
      </span>
      <span className="settings-profile">
        <span className="settings-profile-identity">
          <span className="settings-avatar-preview">
            <AvatarImage avatar={avatar} displayName={value} size={96} />
          </span>
          <span className="settings-identity-value">{value}</span>
        </span>
        <span className="settings-profile-actions">
          <button className="settings-avatar-button" onClick={onAvatarChange} type="button">
            Change avatar
          </button>
          <button className="settings-avatar-button" onClick={onSignOut} type="button">
            Sign out
          </button>
        </span>
      </span>
    </div>
  )
}

function SettingsRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean
  description?: string
  label: string
  onChange: (checked: boolean) => void
}) {
  const inputId = `setting-${label.toLowerCase().replaceAll(' ', '-')}`
  const labelId = `${inputId}-label`

  return (
    <div className="settings-row">
      <div className="settings-row__text" id={labelId}>
        <span className="settings-row__label">{label}</span>
        {description && <span className="settings-row__description">{description}</span>}
      </div>
      <button
        aria-checked={checked}
        aria-labelledby={labelId}
        className="settings-switch"
        id={inputId}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span className="settings-switch__thumb" />
      </button>
    </div>
  )
}

function InlineIcon({ markup }: { markup: string }) {
  return (
    <span
      className="wordbee-inline-icon"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

function BackspaceIcon() {
  return (
    <svg aria-hidden="true" className="wordbee-backspace-icon" viewBox="0 0 24 24">
      <path d="M22 3H7c-.7 0-1.2.35-1.6.88L0 12l5.4 8.11c.4.54.9.89 1.6.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm0 16H7.1L2.4 12l4.7-7H22v14Zm-11.6-2 3.6-3.6 3.6 3.6 1.4-1.4-3.6-3.6L19 8.4 17.6 7 14 10.6 10.4 7 9 8.4l3.6 3.6L9 15.6l1.4 1.4Z" />
    </svg>
  )
}

export default App
