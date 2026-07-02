import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const WORD_LENGTH = 5
const MAX_GUESSES = 6
const FLIP_HALF_MS = 250
const REVEAL_STEP_MS = 250
const DANCE_STEP_MS = 100
const REVEAL_DONE_MS = (WORD_LENGTH - 1) * REVEAL_STEP_MS + FLIP_HALF_MS * 2 + 100
const SETTINGS_STORAGE_KEY = 'wordbee.settings.v1'

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
type Settings = {
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
      const response = await fetch('/api/guess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: puzzle.date,
          guess,
          reveal: isLastRow,
        }),
      })
      const responseBody = (await response.json()) as Partial<GuessResponse> & {
        error?: string
      }

      if (!response.ok) {
        throw new Error(responseBody.error || 'Could not check guess')
      }

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

  useEffect(() => {
    let isMounted = true

    async function loadPuzzle() {
      try {
        const response = await fetch('/api/today')
        const responseBody = (await response.json()) as Partial<PuzzleMetadata> & {
          error?: string
        }

        if (!response.ok) {
          throw new Error(responseBody.error || 'Could not load daily answer')
        }

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
        setPuzzleError('')
      } catch (error) {
        if (!isMounted) return

        const message = error instanceof Error ? error.message : 'Could not load daily answer'
        setPuzzleError(message)
        showToast(message, true)
      }
    }

    loadPuzzle()

    return () => {
      isMounted = false
    }
  }, [showToast])

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
          <button className="wordbee-icon-button" type="button" aria-label="Menu">
            <MenuIcon />
          </button>
        </div>

        <h1 className="wordbee-title">Wordbee</h1>

        <div className="wordbee-header__side wordbee-header__side--right">
          <button className="wordbee-icon-button" type="button" aria-label="Statistics">
            <StatsIcon />
          </button>
          <button className="wordbee-icon-button" type="button" aria-label="Help">
            <HelpIcon />
          </button>
          <button
            className="wordbee-icon-button"
            type="button"
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={isSettingsOpen}
            onClick={() => setIsSettingsOpen(true)}
          >
            <SettingsIcon />
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
            <CloseIcon />
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

function MenuIcon() {
  return (
    <svg aria-hidden="true" className="wordbee-icon" viewBox="0 0 24 24">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

function StatsIcon() {
  return (
    <svg aria-hidden="true" className="wordbee-icon" viewBox="0 0 24 24">
      <path d="M5 20V10h4v10M10 20V4h4v16M15 20v-7h4v7" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg aria-hidden="true" className="wordbee-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9a2.6 2.6 0 0 1 5.05.9c0 2.1-2.65 2.3-2.65 4.5M12 18h.01" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" className="wordbee-icon" viewBox="0 0 24 24">
      <path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
      <path d="m4.9 9.2 1.5-2.6 2 .8a7 7 0 0 1 1.5-.9L10.2 4h3.6l.4 2.5c.5.2 1 .5 1.5.9l2-.8 1.5 2.6-2 1.6v2.4l2 1.6-1.5 2.6-2-.8c-.5.4-1 .7-1.5.9l-.4 2.5h-3.6l-.4-2.5a7 7 0 0 1-1.5-.9l-2 .8-1.5-2.6 2-1.6v-2.4l-1.9-1.6Z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="settings-close-icon" viewBox="0 0 24 24">
      <path d="M4.5 4.5 19.5 19.5M19.5 4.5 4.5 19.5" />
    </svg>
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
