import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import closeIconMarkup from './assets/icons/icon-close.svg?raw'
import menuIconMarkup from './assets/icons/icon-menu.svg?raw'
import settingsIconMarkup from './assets/icons/icon-settings.svg?raw'
import statsIconMarkup from './assets/icons/icon-stats.svg?raw'
import './App.css'

const WORD_LENGTH = 5
const MAX_GUESSES = 6
const FLIP_HALF_MS = 250
const REVEAL_STEP_MS = 250
const DANCE_STEP_MS = 100
const REVEAL_DONE_MS = (WORD_LENGTH - 1) * REVEAL_STEP_MS + FLIP_HALF_MS * 2 + 100
const COMPLETION_TOAST_MS = 2600
const RESULTS_REVEAL_DELAY_MS = 950
const COPY_FEEDBACK_MS = 1300
const SETTINGS_STORAGE_KEY = 'wordbee.settings.v1'
const ACCESS_STORAGE_KEY = 'wordbee.access.v1'
const CLIENT_SESSION_STORAGE_KEY = 'wordbee.client-session.v1'
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
const STATS_ICON_SELECTOR = '.wordbee-icon-button--stats, .results-link-card--stats'
const STATS_BAR_CONFIG = [
  { selector: '.stats-bar--short', highScale: 1.45, lowScale: 0.86, durationMs: 900 },
  { selector: '.stats-bar--tall', highScale: 0.7, lowScale: 1.16, durationMs: 840 },
  { selector: '.stats-bar--mid', highScale: 1.25, lowScale: 0.9, durationMs: 980 },
]
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
  },
  topStarters: [],
}

type TileState = 'empty' | 'tbd' | 'correct' | 'present' | 'absent'
type EvaluatedState = Exclude<TileState, 'empty' | 'tbd'>
type TileAnimation = 'idle' | 'pop' | 'flip-in' | 'flip-out'
type GameStatus = 'playing' | 'won' | 'lost'
type PuzzleMetadata = {
  date: string
  answerLength: number
  confidence: number
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
  example: string
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
  guessDistribution: Record<number, number>
  topStarters: StarterStat[]
}
type StarterStat = {
  word: string
  count: number
  percentage: number
}
type FamilyDailyResult = {
  id: string
  userId: string
  displayName: string
  date: string
  answer?: string
  outcome: Exclude<GameStatus, 'playing'>
  guessesUsed: number
  starterWord: string
  guesses: string[]
  board: EvaluatedState[][]
  completedAt: string
}
type FamilyStatsUser = {
  id: string
  displayName: string
  firstName: string
  lastInitial: string
  stats: StatsSummary
  history: FamilyDailyResult[]
}
type FamilyStatsDashboard = {
  currentUserId: string
  users: FamilyStatsUser[]
}
type FamilyTodayStatus = {
  completed: boolean
  result?: FamilyDailyResult
  stats: StatsSummary
  definition?: DefinitionSummary
}
type ResultsResponse = {
  stats: StatsSummary
  answer?: string
  definition?: DefinitionSummary
  result?: FamilyDailyResult
}
type GameResult = {
  outcome: GameStatus
  guessesUsed: number
  board: EvaluatedState[][]
  guesses: string[]
  stats: StatsSummary
  answer?: string
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
}
type FriendsFamilyAccess = FriendsFamilyIdentity & {
  avatar: AvatarConfig
  token: string
}
type AccessState = GuestAccess | FriendsFamilyAccess
type AccessLoginResponse = {
  identity: FriendsFamilyIdentity
  token: string
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
    const rawAccess = window.localStorage.getItem(ACCESS_STORAGE_KEY)
    if (!rawAccess) return null

    const storedAccess = JSON.parse(rawAccess) as Partial<FriendsFamilyAccess | GuestAccess>
    if (storedAccess.kind === 'guest') {
      return { kind: 'guest' }
    }

    if (
      storedAccess.kind === 'friends-family' &&
      typeof storedAccess.userId === 'string' &&
      typeof storedAccess.displayName === 'string' &&
      typeof storedAccess.firstName === 'string' &&
      typeof storedAccess.lastInitial === 'string' &&
      typeof storedAccess.token === 'string'
    ) {
      const displayName = storedAccess.displayName.slice(0, 64)

      return {
        avatar: sanitizeAvatarConfig(storedAccess.avatar, displayName),
        kind: 'friends-family',
        userId: storedAccess.userId.slice(0, 80),
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
    throw new ApiError(responseBody.error || 'API server unavailable', response.status)
  }

  return responseBody as ResponseBody
}

function getClientSessionId() {
  try {
    const storedSessionId = window.sessionStorage.getItem(CLIENT_SESSION_STORAGE_KEY)
    if (storedSessionId) return storedSessionId

    const sessionId = createRandomId()
    window.sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, sessionId)
    return sessionId
  } catch {
    return createRandomId()
  }
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

function hydrateBoardFromResult(result: FamilyDailyResult) {
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

function getKeyboardStateFromResult(result: FamilyDailyResult) {
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

function getStatsTrigger(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>(STATS_ICON_SELECTOR)
}

function normalizeTransform(transform: string) {
  return transform === 'none' ? 'scaleY(1)' : transform
}

function useStatsIconAnimation() {
  useEffect(() => {
    if (!Element.prototype.animate) return

    const hoverAnimations = new WeakMap<Element, Animation>()
    const returnAnimations = new WeakMap<Element, Animation>()
    const activeAnimations = new Set<Animation>()

    const cancelAnimation = (animation?: Animation) => {
      if (!animation) return

      animation.cancel()
      activeAnimations.delete(animation)
    }

    const getStatsBars = (trigger: Element) =>
      STATS_BAR_CONFIG.flatMap((config) => {
        const bar = trigger.querySelector(config.selector)
        return bar ? [{ bar, config }] : []
      })

    const startBarAnimation = (trigger: Element) => {
      getStatsBars(trigger).forEach(({ bar, config }) => {
        const currentTransform = normalizeTransform(window.getComputedStyle(bar).transform)

        cancelAnimation(returnAnimations.get(bar))
        cancelAnimation(hoverAnimations.get(bar))
        returnAnimations.delete(bar)

        const animation = bar.animate(
          [
            { transform: currentTransform, offset: 0 },
            { transform: `scaleY(${config.highScale})`, offset: 0.48 },
            { transform: `scaleY(${config.lowScale})`, offset: 1 },
          ],
          {
            duration: config.durationMs,
            easing: 'ease-in-out',
            direction: 'alternate',
            iterations: Infinity,
          },
        )

        hoverAnimations.set(bar, animation)
        activeAnimations.add(animation)
      })
    }

    const returnBarToRest = (trigger: Element) => {
      getStatsBars(trigger).forEach(({ bar }) => {
        const currentTransform = normalizeTransform(window.getComputedStyle(bar).transform)

        cancelAnimation(hoverAnimations.get(bar))
        hoverAnimations.delete(bar)
        cancelAnimation(returnAnimations.get(bar))

        const animation = bar.animate(
          [
            { transform: currentTransform },
            { transform: 'scaleY(1)' },
          ],
          {
            duration: 280,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          },
        )

        returnAnimations.set(bar, animation)
        activeAnimations.add(animation)
        animation.addEventListener(
          'finish',
          () => {
            activeAnimations.delete(animation)

            if (returnAnimations.get(bar) === animation) {
              returnAnimations.delete(bar)
            }
          },
          { once: true },
        )
      })
    }

    const onPointerOver = (event: PointerEvent) => {
      const trigger = getStatsTrigger(event.target)
      if (!trigger || (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget))) {
        return
      }

      startBarAnimation(trigger)
    }

    const onPointerOut = (event: PointerEvent) => {
      const trigger = getStatsTrigger(event.target)
      if (!trigger || (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget))) {
        return
      }

      returnBarToRest(trigger)
    }

    const onFocusIn = (event: FocusEvent) => {
      const trigger = getStatsTrigger(event.target)
      if (trigger) {
        startBarAnimation(trigger)
      }
    }

    const onFocusOut = (event: FocusEvent) => {
      const trigger = getStatsTrigger(event.target)
      if (trigger) {
        returnBarToRest(trigger)
      }
    }

    document.addEventListener('pointerover', onPointerOver)
    document.addEventListener('pointerout', onPointerOut)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    return () => {
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)

      activeAnimations.forEach((animation) => animation.cancel())
      activeAnimations.clear()
    }
  }, [])
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAvatarBuilderOpen, setIsAvatarBuilderOpen] = useState(false)
  const [puzzle, setPuzzle] = useState<PuzzleMetadata | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [stats, setStats] = useState<StatsSummary>(EMPTY_STATS)
  const [familyStats, setFamilyStats] = useState<FamilyStatsDashboard | null>(null)
  const [familyStatsError, setFamilyStatsError] = useState('')
  const [isFamilyStatsLoading, setIsFamilyStatsLoading] = useState(false)
  const [isFamilyStatsOpen, setIsFamilyStatsOpen] = useState(false)
  const [isFamilyDailyStatusLoading, setIsFamilyDailyStatusLoading] = useState(false)
  const [completedResult, setCompletedResult] = useState<GameResult | null>(null)
  const [isResultsOpen, setIsResultsOpen] = useState(false)
  const gameIdRef = useRef('')
  const clientSessionIdRef = useRef('')
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

  useStatsIconAnimation()

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

  const updateAvatar = useCallback((avatar: AvatarConfig) => {
    setAccessState((previousAccess) =>
      previousAccess?.kind === 'friends-family'
        ? { ...previousAccess, avatar }
        : previousAccess,
    )
  }, [])

  const resetCurrentGame = useCallback(() => {
    setBoard(createBoard())
    setKeyboardState({})
    setCurrentRow(0)
    setCurrentColumn(0)
    setInvalidRow(null)
    setWinningRow(null)
    setStatus('playing')
    setCompletedResult(null)
    setIsResultsOpen(false)

    if (puzzle) {
      gameIdRef.current = createGameId(puzzle.date)
    }
  }, [puzzle])

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
    resetCurrentGame()
  }, [clientSessionId, friendsFamilyToken, resetCurrentGame])

  const handleSessionBlocked = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        setAccessState(null)
        setFamilyStats(null)
        setIsFamilyStatsOpen(false)
        resetCurrentGame()
        showToast('Signed out on this device')
        return true
      }

      return false
    },
    [resetCurrentGame, showToast],
  )

  const loadFamilyStats = useCallback(async () => {
    if (!friendsFamilyToken) return

    setIsFamilyStatsLoading(true)
    setFamilyStatsError('')

    try {
      const responseBody = await requestJson<FamilyStatsDashboard>('/api/friends-family/stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientSessionId,
          token: friendsFamilyToken,
        }),
      })

      setFamilyStats(responseBody)
    } catch (error) {
      if (!handleSessionBlocked(error)) {
        setFamilyStatsError(error instanceof Error ? error.message : 'Could not load stats')
      }
    } finally {
      setIsFamilyStatsLoading(false)
    }
  }, [clientSessionId, friendsFamilyToken, handleSessionBlocked])

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
        const result = await requestJson<ResultsResponse>('/api/results', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            board,
            clientSessionId,
            date: puzzle.date,
            friendsFamilyToken,
            gameId: gameIdRef.current,
            guesses,
            guessesUsed,
            outcome,
          }),
        })

        setStats(result.stats)
        if (result.result) {
          setBoard(hydrateBoardFromResult(result.result))
          setKeyboardState(getKeyboardStateFromResult(result.result))
          setStatus(result.result.outcome)
          setWinningRow(result.result.outcome === 'won' ? result.result.guessesUsed - 1 : null)
        }
        setCompletedResult({
          ...baseResult,
          answer: result.answer || answer,
          board: result.result?.board ?? baseResult.board,
          definition: result.definition,
          guesses: result.result?.guesses ?? baseResult.guesses,
          guessesUsed: result.result?.guessesUsed ?? baseResult.guessesUsed,
          outcome: result.result?.outcome ?? baseResult.outcome,
          saved: true,
          stats: result.stats,
        })
      } catch (error) {
        if (!handleSessionBlocked(error)) {
          console.warn('Could not save result', error)
        }
      }
    },
    [clientSessionId, friendsFamilyToken, handleSessionBlocked, puzzle, stats],
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
      showToast(puzzleError || 'Loading daily answer')
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
      const responseBody = await requestJson<Partial<GuessResponse> & { error?: string }>(
        '/api/guess',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            date: puzzle.date,
            guess,
            reveal: isLastRow,
          }),
        },
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
    currentColumn,
    currentRow,
    puzzle,
    puzzleError,
    shakeRow,
    showResultAfterPause,
    showToast,
  ])

	  const handleKey = useCallback(
	    (rawKey: string, source: 'physical' | 'onscreen' = 'physical') => {
	      if (status !== 'playing' || isRevealing) return
	      if (isFamilyDailyStatusLoading) return
	      if (!puzzle) {
	        showToast(puzzleError || 'Loading daily answer')
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
    let isMounted = true

    async function loadPuzzle() {
      try {
        const responseBody = await requestJson<Partial<PuzzleMetadata> & { error?: string }>(
          '/api/today',
        )

        if (
          typeof responseBody.date !== 'string' ||
          responseBody.answerLength !== WORD_LENGTH ||
          typeof responseBody.confidence !== 'number' ||
          typeof responseBody.status !== 'string'
        ) {
          throw new Error('Unexpected daily answer response')
        }

        if (!isMounted) return

        setPuzzle({
          date: responseBody.date,
          answerLength: responseBody.answerLength,
          confidence: responseBody.confidence,
          status: responseBody.status,
        })
        gameIdRef.current = createGameId(responseBody.date)
        setPuzzleError('')
      } catch (error) {
        if (!isMounted) return

        const message = error instanceof Error ? error.message : 'Could not load daily answer'
        console.warn('Could not load daily answer', error)

        setPuzzleError(message)
      }
    }

    loadPuzzle()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!puzzle || !friendsFamilyToken) {
      return
    }

    let isMounted = true

    async function loadTodayStatus() {
      setIsFamilyDailyStatusLoading(true)

      try {
        const responseBody = await requestJson<FamilyTodayStatus>(
          '/api/friends-family/today-status',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              clientSessionId,
              date: puzzle?.date,
              token: friendsFamilyToken,
            }),
          },
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
            outcome: serverResult.outcome,
            saved: true,
            stats: responseBody.stats,
          })
        } else if (completedResult?.saved) {
          resetCurrentGame()
        }
      } catch (error) {
        if (!handleSessionBlocked(error)) {
          console.warn('Could not load family daily status', error)
        }
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
    handleSessionBlocked,
    puzzle,
    resetCurrentGame,
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSettingsOpen || isAccessPromptOpen || isFamilyStatsOpen || isResultsOpen) return
      handleKey(event.key)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [handleKey, isAccessPromptOpen, isFamilyStatsOpen, isResultsOpen, isSettingsOpen])

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
            avatar: previousAccess.avatar,
            token,
          }
        })
      } catch (error) {
        console.warn('Could not verify friends and family access', error)

        if (isMounted) {
          setAccessState(null)
          showToast('Sign in again')
        }
      }
    }

    verifyAccess()

	    return () => {
	      isMounted = false
	    }
	  }, [clientSessionId, friendsFamilyToken, showToast])

	  useEffect(() => {
	    if (!friendsFamilyToken) return

	    const verifyActiveSession = async () => {
	      try {
	        await requestJson<AccessVerifyResponse>('/api/friends-family/verify', {
	          method: 'POST',
	          headers: {
	            'Content-Type': 'application/json',
	          },
	          body: JSON.stringify({
	            claimSession: false,
	            clientSessionId,
	            token: friendsFamilyToken,
	          }),
	        })
	      } catch (error) {
	        handleSessionBlocked(error)
	      }
	    }

	    const intervalId = window.setInterval(() => {
	      void verifyActiveSession()
	    }, 15000)

	    return () => window.clearInterval(intervalId)
	  }, [clientSessionId, friendsFamilyToken, handleSessionBlocked])

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
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="wordbee-toast-layer" aria-live="polite" aria-atomic="true">
        {toast && <div className="wordbee-toast">{toast}</div>}
      </div>

      <header className="wordbee-header">
        <div className="wordbee-header__side wordbee-header__side--left">
          <button
            className="wordbee-icon-button wordbee-icon-button--menu"
            type="button"
            aria-label="Menu"
          >
            <InlineIcon markup={menuIconMarkup} />
          </button>
        </div>

        <h1 className="wordbee-title">Wordbee</h1>

        <div className="wordbee-header__side wordbee-header__side--right">
          {completedResult && (
            <button
              className="wordbee-results-reopen-button"
              type="button"
              onClick={() => setIsResultsOpen(true)}
            >
              See results
            </button>
          )}
          {accessState?.kind === 'friends-family' && (
            <button
              className="wordbee-icon-button wordbee-icon-button--stats"
              type="button"
              aria-label="Statistics"
              aria-haspopup="dialog"
              aria-expanded={isFamilyStatsOpen}
              onClick={() => {
                setIsFamilyStatsOpen(true)
                void loadFamilyStats()
              }}
            >
              <InlineIcon markup={statsIconMarkup} />
            </button>
          )}
          {accessState?.kind === 'friends-family' ? (
            <button
              aria-label={`Settings for ${accessState.displayName}`}
              aria-haspopup="dialog"
              aria-expanded={isSettingsOpen}
              className="wordbee-profile-button"
              onClick={() => setIsSettingsOpen(true)}
              type="button"
            >
              <AvatarImage
                avatar={accessState.avatar}
                displayName={accessState.displayName}
                size={72}
              />
            </button>
          ) : (
            <button
              className="wordbee-icon-button wordbee-icon-button--settings"
              type="button"
              aria-label="Settings"
              aria-haspopup="dialog"
              aria-expanded={isSettingsOpen}
              onClick={() => setIsSettingsOpen(true)}
            >
              <InlineIcon markup={settingsIconMarkup} />
            </button>
          )}
        </div>
      </header>

      <main className="wordbee-game" aria-label="Wordbee game">
        <section className="wordbee-board-container" aria-label="Game board">
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

      {isSettingsOpen && (
        <SettingsDialog
          accessState={accessState}
          clientSessionId={clientSessionId}
          effectiveDarkTheme={isDarkTheme}
          onAccessLogin={(nextAccessState) => setAccessState(nextAccessState)}
          onAvatarChange={() => setIsAvatarBuilderOpen(true)}
          onClose={() => setIsSettingsOpen(false)}
          onSignOut={signOut}
          onSettingChange={updateSetting}
          settings={settings}
        />
      )}

      {isAvatarBuilderOpen && accessState?.kind === 'friends-family' && (
        <div className="avatar-backdrop" onClick={() => setIsAvatarBuilderOpen(false)}>
          <section
            aria-label="Change avatar"
            aria-modal="true"
            className="avatar-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="Close avatar builder"
              className="avatar-close"
              onClick={() => setIsAvatarBuilderOpen(false)}
              type="button"
            >
              <InlineIcon markup={closeIconMarkup} />
            </button>
            <AvatarBuilder
              displayName={accessState.displayName}
              initialAvatar={accessState.avatar}
              onCancel={() => setIsAvatarBuilderOpen(false)}
              onSave={(avatar) => {
                updateAvatar(avatar)
                setIsAvatarBuilderOpen(false)
              }}
              saveLabel="Save avatar"
            />
          </section>
        </div>
      )}

      {accessState === null && (
        <AccessDialog
          clientSessionId={clientSessionId}
          onGuest={() => setAccessState({ kind: 'guest' })}
          onLogin={(nextAccessState) => setAccessState(nextAccessState)}
        />
      )}

      {completedResult && isResultsOpen && (
        <ResultsDialog
          canOpenStats={accessState?.kind === 'friends-family'}
          onClose={() => setIsResultsOpen(false)}
          onCopy={copyResult}
          onOpenStats={() => {
            setIsFamilyStatsOpen(true)
            void loadFamilyStats()
          }}
          result={completedResult}
        />
      )}

      {isFamilyStatsOpen && accessState?.kind === 'friends-family' && (
        <FamilyStatsDialog
          currentUserId={accessState.userId}
          dashboard={familyStats}
          error={familyStatsError}
          isLoading={isFamilyStatsLoading}
          onClose={() => setIsFamilyStatsOpen(false)}
          onReload={() => void loadFamilyStats()}
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
}: {
  autoFocusCode?: boolean
  className?: string
  clientSessionId: string
  guestButtonLabel?: string
  hideCodeLabel?: boolean
  onGuest?: () => void
  onLogin: (accessState: FriendsFamilyAccess) => void
}) {
  const [code, setCode] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastInitial, setLastInitial] = useState('')
  const [step, setStep] = useState<'code' | 'profile' | 'avatar'>('code')
  const [pendingAccess, setPendingAccess] = useState<FriendsFamilyAccess | null>(null)
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

  const login = async () => {
    setError('')
    setIsSubmitting(true)

    try {
      const responseBody = await requestJson<AccessLoginResponse>('/api/friends-family/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientSessionId,
          code,
          firstName,
          lastInitial,
        }),
      })

      if (
        responseBody.identity?.kind !== 'friends-family' ||
        typeof responseBody.token !== 'string'
      ) {
        throw new Error('Could not sign in')
      }

      const nextAccessState = {
        avatar: createDefaultAvatarConfig(responseBody.identity.displayName),
        ...responseBody.identity,
        token: responseBody.token,
      }

      setPendingAccess(nextAccessState)
      setStep('avatar')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not sign in')
    } finally {
      setIsSubmitting(false)
    }
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
        <AvatarBuilder
          displayName={pendingAccess.displayName}
          initialAvatar={pendingAccess.avatar}
          onSave={(avatar) => onLogin({ ...pendingAccess, avatar })}
          saveLabel="Save avatar"
        />
      ) : null}

      {error && <p className="access-error">{error}</p>}
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

function ResultsDialog({
  canOpenStats = false,
  onClose,
  onCopy,
  onOpenStats,
  result,
}: {
  canOpenStats?: boolean
  onClose: () => void
  onCopy: () => void
  onOpenStats: () => void
  result: GameResult
}) {
  const distributionMax = getDistributionMax(result.stats)
  const emojiRows = createShareText(result)

  return (
    <div className="results-backdrop" aria-live="polite" onClick={onClose} role="presentation">
      <section
        aria-label="Completed game summary"
        aria-modal="true"
        className="results-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="results-close" type="button" aria-label="Close" onClick={onClose}>
          <InlineIcon markup={closeIconMarkup} />
        </button>
        <DefinitionPanel definition={result.definition} fallbackWord={result.answer} />

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
          <h3 id="distribution-title">Guess Distribution</h3>
          <div className="distribution-list">
            {Array.from({ length: MAX_GUESSES }, (_, index) => {
              const guessNumber = index + 1
              const count = result.stats.guessDistribution[guessNumber] ?? 0
              const isCurrentGuess =
                result.outcome === 'won' && result.guessesUsed === guessNumber

              return (
                <div className="distribution-row" key={guessNumber}>
                  <span className="distribution-row__label">{guessNumber}</span>
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

        {canOpenStats && (
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

        <div className="results-secondary-actions">
          <a href="/random">Play random</a>
          <a href="/history">Play past words</a>
        </div>
        <p className="results-note">Random and history plays are not tracked.</p>

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
  const displayWord = definition?.word || fallbackWord || 'Wordbee'
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
      {definition?.example && <blockquote>{definition.example}</blockquote>}
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

function FamilyStatsDialog({
  currentUserId,
  dashboard,
  error,
  isLoading,
  onClose,
  onReload,
}: {
  currentUserId: string
  dashboard: FamilyStatsDashboard | null
  error: string
  isLoading: boolean
  onClose: () => void
  onReload: () => void
}) {
  const [selectedUserId, setSelectedUserId] = useState(currentUserId)
  const users = dashboard?.users ?? []
  const selectedUser =
    users.find((user) => user.id === selectedUserId) ??
    users.find((user) => user.id === currentUserId) ??
    users[0]
  const [selectedResultId, setSelectedResultId] = useState('')
  const selectedResult =
    selectedUser?.history.find((result) => result.id === selectedResultId) ??
    selectedUser?.history[0]

  useEffect(() => {
    if (!selectedUser) return
    if (selectedUser.history.some((result) => result.id === selectedResultId)) return
    setSelectedResultId(selectedUser.history[0]?.id ?? '')
  }, [selectedResultId, selectedUser])

  return (
    <div className="family-stats-backdrop" onClick={onClose}>
      <section
        aria-labelledby="family-stats-title"
        aria-modal="true"
        className="family-stats-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="family-stats-header">
          <div>
            <h2 id="family-stats-title">Family stats</h2>
            <p>Daily play only. Random and past-word games are not tracked.</p>
          </div>
          <button className="settings-close" type="button" aria-label="Close" onClick={onClose}>
            <InlineIcon markup={closeIconMarkup} />
          </button>
        </div>

        {isLoading && <p className="family-stats-status">Loading stats...</p>}
        {error && (
          <div className="family-stats-error">
            <span>{error}</span>
            <button type="button" onClick={onReload}>
              Retry
            </button>
          </div>
        )}

        {users.length > 0 && (
          <>
            <div className="family-stats-table-wrap">
              <table className="family-stats-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Wins</th>
                    <th>Win %</th>
                    <th>Avg</th>
                    <th>Win streak</th>
                    <th>Play streak</th>
                    <th>Best</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      data-selected={user.id === selectedUser?.id}
                      key={user.id}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <td>
                        <button type="button">{user.displayName}</button>
                      </td>
                      <td>{user.stats.wins}</td>
                      <td>{user.stats.winPercentage}</td>
                      <td>{formatAverage(user.stats.averageGuesses)}</td>
                      <td>{user.stats.currentWinStreak}</td>
                      <td>{user.stats.currentPlayStreak}</td>
                      <td>{user.stats.bestWinStreak}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedUser && (
              <section className="family-profile" aria-label={`${selectedUser.displayName} stats`}>
                <div className="family-profile__heading">
                  <h3>{selectedUser.displayName}</h3>
                  <span>{selectedUser.stats.played} played</span>
                </div>

                <div className="family-profile-grid">
                  <StatValue label="Wins" value={selectedUser.stats.wins} />
                  <StatValue label="Win %" value={selectedUser.stats.winPercentage} />
                  <StatValue
                    label="Avg Guesses"
                    value={Number(formatAverage(selectedUser.stats.averageGuesses))}
                  />
                  <StatValue label="Current Win Streak" value={selectedUser.stats.currentWinStreak} />
                  <StatValue label="Best Win Streak" value={selectedUser.stats.bestWinStreak} />
                  <StatValue
                    label="Best Play Streak"
                    value={selectedUser.stats.bestPlayStreak}
                  />
                </div>

                <div className="family-profile-columns">
                  <section className="starter-list" aria-labelledby="starter-title">
                    <h4 id="starter-title">Top starters</h4>
                    {selectedUser.stats.topStarters.length > 0 ? (
                      <ol>
                        {selectedUser.stats.topStarters.map((starter) => (
                          <li key={starter.word}>
                            <strong>{starter.word}</strong>
                            <span>
                              {starter.count} times · {starter.percentage}%
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>No starter words yet.</p>
                    )}
                  </section>

                  <section className="daily-history" aria-labelledby="history-title">
                    <h4 id="history-title">Daily history</h4>
                    {selectedUser.history.length > 0 ? (
                      <div className="daily-history__list">
                        {selectedUser.history.map((result) => (
                          <button
                            data-selected={result.id === selectedResult?.id}
                            key={result.id}
                            onClick={() => setSelectedResultId(result.id)}
                            type="button"
                          >
                            <span>{formatHistoryDate(result.date)}</span>
                            <strong>{formatOutcome(result)}</strong>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p>No completed days yet.</p>
                    )}
                  </section>
                </div>

                {selectedResult && <FamilyResultBoard result={selectedResult} />}
              </section>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function FamilyResultBoard({ result }: { result: FamilyDailyResult }) {
  return (
    <section className="family-result-board" aria-label={`${result.displayName} ${result.date}`}>
      <div className="family-result-board__heading">
        <span>{formatHistoryDate(result.date)}</span>
        <strong>{formatOutcome(result)}</strong>
      </div>
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
    </section>
  )
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
  return result.outcome === 'won' ? `${result.guessesUsed}/6` : 'X/6'
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
            <SettingsAccessSection clientSessionId={clientSessionId} onLogin={onAccessLogin} />
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
  onLogin,
}: {
  clientSessionId: string
  onLogin: (accessState: FriendsFamilyAccess) => void
}) {
  return (
    <div className="settings-access-section">
      <span className="settings-row__label">Enter friends and family code</span>
      <FriendsFamilyAccessForm
        clientSessionId={clientSessionId}
        className="access-form--settings"
        hideCodeLabel
        onLogin={onLogin}
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
        <span className="settings-avatar-preview">
          <AvatarImage avatar={avatar} displayName={value} size={96} />
        </span>
        <span className="settings-identity-value">{value}</span>
        <button className="settings-avatar-button" onClick={onAvatarChange} type="button">
          Change avatar
        </button>
        <button className="settings-avatar-button" onClick={onSignOut} type="button">
          Sign out
        </button>
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
