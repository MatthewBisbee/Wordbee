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
const STATS_ICON_SELECTOR = '.wordbee-icon-button--stats, .results-link-card--stats'
const STATS_BAR_CONFIG = [
  { selector: '.stats-bar--short', highScale: 1.45, lowScale: 0.86, durationMs: 900 },
  { selector: '.stats-bar--tall', highScale: 0.7, lowScale: 1.16, durationMs: 840 },
  { selector: '.stats-bar--mid', highScale: 1.25, lowScale: 0.9, durationMs: 980 },
]
const EMPTY_STATS: StatsSummary = {
  played: 0,
  winPercentage: 0,
  currentStreak: 0,
  maxStreak: 0,
  guessDistribution: {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  },
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
  winPercentage: number
  currentStreak: number
  maxStreak: number
  guessDistribution: Record<number, number>
}
type ResultsResponse = {
  stats: StatsSummary
  answer?: string
  definition?: DefinitionSummary
}
type GameResult = {
  outcome: GameStatus
  guessesUsed: number
  board: EvaluatedState[][]
  stats: StatsSummary
  answer?: string
  copied: boolean
  definition?: DefinitionSummary
  saved: boolean
}
type Settings = {
  hardMode: boolean
  darkThemeOverride: boolean | null
  highContrast: boolean
  onscreenKeyboardOnly: boolean
}
type GuestAccess = {
  kind: 'guest'
}
type FriendsFamilyIdentity = {
  kind: 'friends-family'
  displayName: string
  firstName: string
  lastInitial: string
}
type FriendsFamilyAccess = FriendsFamilyIdentity & {
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
  hardMode: false,
  darkThemeOverride: null,
  highContrast: false,
  onscreenKeyboardOnly: false,
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
      typeof storedAccess.displayName === 'string' &&
      typeof storedAccess.firstName === 'string' &&
      typeof storedAccess.lastInitial === 'string' &&
      typeof storedAccess.token === 'string'
    ) {
      return {
        kind: 'friends-family',
        displayName: storedAccess.displayName.slice(0, 64),
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

async function requestJson<ResponseBody>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const responseText = await response.text()
  let responseBody: { error?: string } = {}

  if (responseText.trim()) {
    try {
      responseBody = JSON.parse(responseText) as { error?: string }
    } catch {
      throw new Error(response.ok ? 'Invalid server response' : 'Service unavailable')
    }
  }

  if (!response.ok) {
    throw new Error(responseBody.error || 'Service unavailable')
  }

  return responseBody as ResponseBody
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

function getHardModeViolation(board: Tile[][], activeRow: number, guess: string) {
  const requiredPositions = new Map<number, string>()
  const requiredCounts = new Map<string, number>()

  board.slice(0, activeRow).forEach((row) => {
    const rowCounts = new Map<string, number>()

    row.forEach((tile, index) => {
      if (tile.state === 'correct') {
        requiredPositions.set(index, tile.letter)
      }

      if (tile.state === 'correct' || tile.state === 'present') {
        rowCounts.set(tile.letter, (rowCounts.get(tile.letter) ?? 0) + 1)
      }
    })

    rowCounts.forEach((count, letter) => {
      requiredCounts.set(letter, Math.max(requiredCounts.get(letter) ?? 0, count))
    })
  })

  for (const [index, letter] of requiredPositions) {
    if (guess[index] !== letter) {
      return `${letter} must be in position ${index + 1}`
    }
  }

  for (const [letter, count] of requiredCounts) {
    const guessedCount = guess.split('').filter((guessedLetter) => guessedLetter === letter)
      .length

    if (guessedCount < count) {
      return count === 1 ? `Guess must contain ${letter}` : `Guess must contain ${count} ${letter}s`
    }
  }

  return null
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
  const [puzzle, setPuzzle] = useState<PuzzleMetadata | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [stats, setStats] = useState<StatsSummary>(EMPTY_STATS)
  const [completedResult, setCompletedResult] = useState<GameResult | null>(null)
  const [isResultsOpen, setIsResultsOpen] = useState(false)
  const gameIdRef = useRef('')
  const toastTimerRef = useRef<number | null>(null)
  const resultsRevealTimerRef = useRef<number | null>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const isDarkTheme = settings.darkThemeOverride ?? devicePrefersDark
  const friendsFamilyToken = accessState?.kind === 'friends-family' ? accessState.token : ''
  const isAccessPromptOpen = accessState === null

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
      guessesUsed,
      outcome,
    }: CompletedResultInput) => {
      const baseResult: GameResult = {
        answer,
        board,
        copied: false,
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
            date: puzzle.date,
            friendsFamilyToken,
            gameId: gameIdRef.current,
            guessesUsed,
            hardMode: settings.hardMode,
            outcome,
          }),
        })

        setStats(result.stats)
        setCompletedResult({
          ...baseResult,
          answer: result.answer || answer,
          definition: result.definition,
          saved: true,
          stats: result.stats,
        })
      } catch (error) {
        console.warn('Could not save result', error)
      }
    },
    [friendsFamilyToken, puzzle, settings.hardMode, stats],
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

    if (settings.hardMode) {
      const violation = getHardModeViolation(board, row, guess)

      if (violation) {
        shakeRow(row)
        showToast(violation)
        return
      }
    }

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
    settings.hardMode,
    shakeRow,
    showResultAfterPause,
    showToast,
  ])

  const handleKey = useCallback(
    (rawKey: string, source: 'physical' | 'onscreen' = 'physical') => {
      if (status !== 'playing' || isRevealing) return
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
    let isMounted = true

    async function loadStats() {
      try {
        const responseBody = await requestJson<StatsSummary>('/api/stats')
        if (isMounted) {
          setStats(responseBody)
        }
      } catch (error) {
        console.warn('Could not load stats', error)
      }
    }

    if (puzzle) {
      loadStats()
    }

    return () => {
      isMounted = false
    }
  }, [puzzle])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSettingsOpen || isAccessPromptOpen) return
      handleKey(event.key)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [handleKey, isAccessPromptOpen, isSettingsOpen])

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
          body: JSON.stringify({ token }),
        })

        if (!isMounted) return

        setAccessState((previousAccess) => {
          if (previousAccess?.kind !== 'friends-family' || previousAccess.token !== token) {
            return previousAccess
          }

          return {
            ...responseBody.identity,
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
  }, [friendsFamilyToken, showToast])

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
        setIsSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSettingsOpen])

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
          <button
            className="wordbee-icon-button wordbee-icon-button--stats"
            type="button"
            aria-label="Statistics"
          >
            <InlineIcon markup={statsIconMarkup} />
          </button>
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
          effectiveDarkTheme={isDarkTheme}
          onAccessLogin={(nextAccessState) => setAccessState(nextAccessState)}
          onClose={() => setIsSettingsOpen(false)}
          onSettingChange={updateSetting}
          settings={settings}
        />
      )}

      {accessState === null && (
        <AccessDialog
          onGuest={() => setAccessState({ kind: 'guest' })}
          onLogin={(nextAccessState) => setAccessState(nextAccessState)}
        />
      )}

      {completedResult && isResultsOpen && (
        <ResultsDialog
          onClose={() => setIsResultsOpen(false)}
          onCopy={copyResult}
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
  onGuest,
  onLogin,
}: {
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
  guestButtonLabel,
  onGuest,
  onLogin,
}: {
  autoFocusCode?: boolean
  className?: string
  guestButtonLabel?: string
  onGuest?: () => void
  onLogin: (accessState: FriendsFamilyAccess) => void
}) {
  const [code, setCode] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastInitial, setLastInitial] = useState('')
  const [step, setStep] = useState<'code' | 'profile'>('code')
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

      onLogin({
        ...responseBody.identity,
        token: responseBody.token,
      })
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
            <span>Friends and family code</span>
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
      ) : (
        <>
          <p className="access-confirmed">Code accepted.</p>
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
      )}

      {error && <p className="access-error">{error}</p>}
    </div>
  )
}

function ResultsDialog({
  onClose,
  onCopy,
  result,
}: {
  onClose: () => void
  onCopy: () => void
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

        <a className="results-link-card results-link-card--stats" href="/stats">
          <InlineIcon markup={statsIconMarkup} />
          <span>
            <strong>Detailed stats</strong>
            <span>Compare streaks, dates, and solve patterns.</span>
          </span>
          <span className="results-link-card__arrow" aria-hidden="true">
            ›
          </span>
        </a>

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

function SettingsDialog({
  accessState,
  effectiveDarkTheme,
  onAccessLogin,
  onClose,
  onSettingChange,
  settings,
}: {
  accessState: AccessState | null
  effectiveDarkTheme: boolean
  onAccessLogin: (accessState: FriendsFamilyAccess) => void
  onClose: () => void
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
            checked={settings.hardMode}
            description="Any revealed hints must be used in subsequent guesses"
            label="Hard Mode"
            onChange={(checked) => onSettingChange('hardMode', checked)}
          />
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
            <SettingsIdentityRow label="Friends and family" value={accessState.displayName} />
          )}
          {accessState?.kind === 'guest' && (
            <SettingsAccessSection onLogin={onAccessLogin} />
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
  onLogin,
}: {
  onLogin: (accessState: FriendsFamilyAccess) => void
}) {
  return (
    <div className="settings-access-section">
      <span className="settings-row__label">Friends and family</span>
      <FriendsFamilyAccessForm className="access-form--settings" onLogin={onLogin} />
    </div>
  )
}

function SettingsIdentityRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="settings-row">
      <span className="settings-row__text">
        <span className="settings-row__label">{label}</span>
      </span>
      <span className="settings-identity-value">{value}</span>
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
