import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import closeIconMarkup from './assets/icons/icon-close.svg?raw'
import forumIconMarkup from './assets/icons/icon-forum.svg?raw'
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
const SETTINGS_STORAGE_KEY = 'wordbee.settings.v1'
const DEV_FALLBACK_ANSWER = 'MAVEN'
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
  isDevFallback?: boolean
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
  familyDisplayName: string
  hardMode: boolean
  darkThemeOverride: boolean | null
  highContrast: boolean
  onscreenKeyboardOnly: boolean
}

type Tile = {
  letter: string
  state: TileState
  animation: TileAnimation
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
  familyDisplayName: '',
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
      familyDisplayName:
        typeof storedSettings.familyDisplayName === 'string'
          ? storedSettings.familyDisplayName.slice(0, 64)
          : '',
    }
  } catch {
    return defaultSettings
  }
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

function scoreDevGuess(answer: string, guess: string) {
  const answerLetters = answer.split('')
  const guessLetters = guess.split('')
  const result = Array.from({ length: WORD_LENGTH }, () => 'absent' as EvaluatedState)

  guessLetters.forEach((letter, index) => {
    if (letter === answerLetters[index]) {
      result[index] = 'correct'
      answerLetters[index] = ''
      guessLetters[index] = ''
    }
  })

  guessLetters.forEach((letter, index) => {
    if (!letter) return

    const answerIndex = answerLetters.indexOf(letter)
    if (answerIndex !== -1) {
      result[index] = 'present'
      answerLetters[answerIndex] = ''
    }
  })

  return result
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

function createLocalStats(
  stats: StatsSummary,
  outcome: GameStatus,
  guessesUsed: number,
) {
  const won = outcome === 'won'
  const played = stats.played + 1
  const previousWins = Math.round((stats.played * stats.winPercentage) / 100)
  const wins = previousWins + (won ? 1 : 0)
  const guessDistribution = { ...stats.guessDistribution }

  if (won) {
    guessDistribution[guessesUsed] = (guessDistribution[guessesUsed] ?? 0) + 1
  }

  const currentStreak = won ? stats.currentStreak + 1 : 0

  return {
    played,
    winPercentage: Math.round((wins / played) * 100),
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    guessDistribution,
  }
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

function App() {
  const [board, setBoard] = useState(createBoard)
  const [settings, setSettings] = useState(loadSettings)
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
  const [gameResult, setGameResult] = useState<GameResult | null>(null)
  const gameIdRef = useRef('')
  const toastTimerRef = useRef<number | null>(null)
  const isDarkTheme = settings.darkThemeOverride ?? devicePrefersDark

  const showToast = useCallback((message: string, persistent = false) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }

    setToast(message)

    if (!persistent) {
      toastTimerRef.current = window.setTimeout(() => {
        setToast('')
        toastTimerRef.current = null
      }, 1200)
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
    }: {
      answer?: string
      board: EvaluatedState[][]
      guessesUsed: number
      outcome: GameStatus
    }) => {
      const baseResult: GameResult = {
        answer,
        board,
        copied: false,
        guessesUsed,
        outcome,
        saved: false,
        stats,
      }

      setGameResult(baseResult)

      if (!puzzle || puzzle.isDevFallback) {
        const nextStats = createLocalStats(stats, outcome, guessesUsed)
        setStats(nextStats)
        setGameResult({ ...baseResult, saved: false, stats: nextStats })
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
            familyDisplayName: settings.familyDisplayName.trim(),
            gameId: gameIdRef.current,
            guessesUsed,
            hardMode: settings.hardMode,
            outcome,
          }),
        })

        setStats(result.stats)
        setGameResult({
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
    [puzzle, settings.familyDisplayName, settings.hardMode, stats],
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

    if (puzzle.isDevFallback) {
      const scores = scoreDevGuess(DEV_FALLBACK_ANSWER, guess)
      guessResult = {
        answer: isLastRow ? DEV_FALLBACK_ANSWER : undefined,
        didWin: scores.every((score) => score === 'correct'),
        scores,
      }
    } else {
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
        void submitResult({
          board: getCompletedBoard(board, row, scores),
          guessesUsed: row + 1,
          outcome: 'won',
        })
        showToast(
          ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew'][
            row
          ],
          true,
        )
        return
      }

      if (isLastRow) {
        setStatus('lost')
        void submitResult({
          answer: guessResult.answer,
          board: getCompletedBoard(board, row, scores),
          guessesUsed: MAX_GUESSES,
          outcome: 'lost',
        })
        showToast(guessResult.answer || 'Answer unavailable', true)
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
    showToast,
    submitResult,
  ])

  const handleKey = useCallback(
    (rawKey: string, source: 'physical' | 'onscreen' = 'physical') => {
      if (status !== 'playing' || isRevealing || !puzzle) return
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
      status,
    ],
  )

  const copyResult = useCallback(async () => {
    if (!gameResult) return

    try {
      await copyTextToClipboard(createShareText(gameResult))
      setGameResult({ ...gameResult, copied: true })
      showToast('Copied')
    } catch (error) {
      console.warn('Could not copy result', error)
      showToast('Copy failed')
    }
  }, [gameResult, showToast])

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
        console.warn('Using local dev answer fallback', error)

        if (import.meta.env.DEV) {
          const fallbackDate = new Date().toISOString().slice(0, 10)
          setPuzzle({
            answerLength: WORD_LENGTH,
            confidence: 0,
            date: fallbackDate,
            isDevFallback: true,
            status: 'dev-fallback',
          })
          gameIdRef.current = createGameId(fallbackDate)
          setPuzzleError('')
          return
        }

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

    if (!puzzle?.isDevFallback) {
      loadStats()
    }

    return () => {
      isMounted = false
    }
  }, [puzzle])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSettingsOpen) return
      handleKey(event.key)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [handleKey, isSettingsOpen])

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

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
          effectiveDarkTheme={isDarkTheme}
          onClose={() => setIsSettingsOpen(false)}
          onSettingChange={updateSetting}
          settings={settings}
        />
      )}

      {gameResult && (
        <ResultsDialog
          onClose={() => setGameResult(null)}
          onCopy={copyResult}
          result={gameResult}
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

        <a className="results-link-card" href="/stats">
          <InlineIcon markup={forumIconMarkup} />
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
          <a href="/history">Play history</a>
        </div>
        <p className="results-note">Random and history plays are not tracked.</p>

        <button className="results-copy-button" type="button" onClick={onCopy}>
          <span>{result.copied ? 'Copied:' : 'Copy:'}</span>
          <span className="results-copy-button__emoji">{emojiRows}</span>
        </button>
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
      <p>{definition?.definition || 'Definition unavailable for now.'}</p>
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
  effectiveDarkTheme,
  onClose,
  onSettingChange,
  settings,
}: {
  effectiveDarkTheme: boolean
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
          <SettingsTextRow
            label="Family Name"
            onChange={(value) => onSettingChange('familyDisplayName', value)}
            placeholder="Firstname L"
            value={settings.familyDisplayName}
          />
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

function SettingsTextRow({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  const inputId = `setting-${label.toLowerCase().replaceAll(' ', '-')}`

  return (
    <label className="settings-row" htmlFor={inputId}>
      <span className="settings-row__text">
        <span className="settings-row__label">{label}</span>
      </span>
      <input
        autoComplete="name"
        className="settings-text-input"
        id={inputId}
        maxLength={64}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </label>
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
