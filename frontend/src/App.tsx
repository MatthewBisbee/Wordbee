import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import menuIconMarkup from './assets/icons/icon-menu.svg?raw'
import settingsIconMarkup from './assets/icons/icon-settings.svg?raw'
import statsIconMarkup from './assets/icons/icon-stats.svg?raw'
import { InlineIcon } from './components/InlineIcon'
import {
  ACCESS_STORAGE_KEY,
  ADDITIONAL_GAME_LABELS,
  COMPLETION_TOAST_MS,
  COPY_FEEDBACK_MS,
  DANCE_STEP_MS,
  EMPTY_STATS,
  FIRST_OFFICIAL_PUZZLE_DATE,
  FLIP_HALF_MS,
  LEGACY_AVATAR_STORAGE_KEY,
  MAX_GUESSES,
  RESULTS_REVEAL_DELAY_MS,
  REVEAL_DONE_MS,
  REVEAL_STEP_MS,
  SETTINGS_STORAGE_KEY,
  WORD_LENGTH,
  keyboardRows,
  statePriority,
} from './config/constants'
import { AccessDialog } from './features/access/AccessDialog'
import {
  AvatarDialog,
  AvatarImage,
} from './features/avatar/avatar'
import {
  createDefaultAvatarConfig,
  sanitizeAvatarConfig,
} from './features/avatar/avatar-config'
import { ConnectionsGame } from './features/connections/ConnectionsGame'
import { LetterboxedGame } from './features/letterboxed/LetterboxedGame'
import { WordbeeMenu } from './features/navigation/WordbeeMenu'
import { ResultsDialog } from './features/results/ResultsDialog'
import { MultigameResultsDialog } from './features/results/MultigameResultsDialog'
import { SettingsDialog } from './features/settings/SettingsDialog'
import { SpellingBeeGame } from './features/spellingbee/SpellingBeeGame'
import { FamilyStatsPage } from './features/stats/FamilyStatsPage'
import { MultigameStatsPage } from './features/stats/MultigameStatsPage'
import { StatsGameSwitcher } from './features/stats/StatsGameSwitcher'
import { StrandsGame } from './features/strands/StrandsGame'
import { SudokuGame } from './features/sudoku/SudokuGame'
import { TilesGame } from './features/tiles/TilesGame'
import { PipsGame } from './features/pips/PipsGame'
import { CrosswordGame } from './features/crossword/CrosswordGame'
import { HintButton } from './features/wordle/HintButton'
import { Keyboard } from './features/wordle/Keyboard'
import {
  applyAutofillRow,
  getGreenLetters,
  patchTile,
  createBoard,
  createShareText,
  getCompletedBoard,
  getCompletedGuesses,
  getKeyboardStateFromResult,
  hydrateBoardFromResult,
  tileAriaLabel,
} from './features/wordle/wordle-utils'
import { AutofillToggle } from './features/wordle/AutofillToggle'
import { isSessionConflict, formatFirstName, formatLastInitial, formatDisplayName } from './lib/access'
import { ApiError, requestJson } from './lib/api'
import { copyTextToClipboard } from './lib/clipboard'
import {
  formatPuzzleHeaderDate,
  getDefaultPastDate,
  getDevicePrefersDark,
  getIsStandaloneApp,
  getPuzzleHeaderLabel,
  getTodayDate,
} from './lib/date'
import { createGameId } from './lib/ids'
import { useDeployRefresh } from './lib/useDeployRefresh'
import {
  getClientSessionId,
  hasUsedHintForDate,
  loadAccessState,
  loadLastGameState,
  loadSettings,
  markHintUsedForDate,
  saveLastGameState,
} from './lib/storage'
import type {
  AccessState,
  AccessVerifyResponse,
  AdditionalGameKey,
  AvatarConfig,
  CompletedResultInput,
  EvaluatedState,
  FamilyStatsDashboard,
  FamilyStatsView,
  FamilyTodayStatus,
  FriendsFamilyAccess,
  GameResult,
  GameStatus,
  GuessResponse,
  MultigameCompleteHandler,
  MultigameCompletionResult,
  MultigameStatsSummary,
  PuzzleMetadata,
  ResultsResponse,
  Settings,
  StatsSummary,
  TileState,
  WordbeeGameKey,
} from './types'
import './styles/index.css'

const initialLastGame = loadLastGameState()
const ANNOUNCEMENT_DISMISSAL_STORAGE_PREFIX = 'wordbee.announcement.dismissed'

type BeginPuzzleOptions = { switchToWordle?: boolean }

type OperatorAnnouncement = {
  id: string
  date: string
  message: string
  signature: string
  createdAt: string
  expiresAt: string
}

function App() {
  // Reload the client when a new build is deployed (see hook for details).
  useDeployRefresh()

  const [activeGame, setActiveGame] = useState<WordbeeGameKey>(
    initialLastGame?.activeGame ?? 'wordle',
  )
  const [board, setBoard] = useState(createBoard)
  const [settings, setSettings] = useState(loadSettings)
  const [accessState, setAccessState] = useState<AccessState | null>(loadAccessState)
  const [devicePrefersDark, setDevicePrefersDark] = useState(getDevicePrefersDark)
  const [currentRow, setCurrentRow] = useState(0)
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
  const [isOtherGameResultsOpen, setIsOtherGameResultsOpen] = useState(false)
  const [otherGameCompletedResult, setOtherGameCompletedResult] =
    useState<MultigameCompletionResult | null>(null)
  const [otherGameStats, setOtherGameStats] = useState<MultigameStatsSummary | null>(null)
  const [additionalGameDate, setAdditionalGameDate] = useState(
    () => initialLastGame?.additionalGameDate || getTodayDate(),
  )
  const [additionalPastDate, setAdditionalPastDate] = useState(
    () => initialLastGame?.additionalGameDate || getTodayDate(),
  )
  const [disabledGames, setDisabledGames] = useState<string[]>([])
  const [operatorAnnouncement, setOperatorAnnouncement] = useState<OperatorAnnouncement | null>(
    null,
  )
  const [tilesMode, setTilesMode] = useState<'daily' | 'zen'>('daily')
  const [usedHint, setUsedHint] = useState(false)
  const usedHintRef = useRef(false)
  const gameIdRef = useRef('')
  const clientSessionIdRef = useRef('')
  const menuAreaRef = useRef<HTMLDivElement | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const resultsRevealTimerRef = useRef<number | null>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  // Mirror the autofill preference in a ref so deferred callbacks (the post-reveal
  // row advance, async daily-status hydration) read the current value.
  const autofillEnabledRef = useRef(settings.wordleAutofill)
  autofillEnabledRef.current = settings.wordleAutofill
  // Latest board, readable synchronously by the autofill flip choreography (which
  // needs the current tiles/greens without waiting for a setBoard updater).
  const boardRef = useRef(board)
  boardRef.current = board
  // Invalidates the in-flight flip choreography when the active row is re-toggled.
  const autofillFlipTokenRef = useRef(0)
  const isDarkTheme = settings.darkThemeOverride ?? devicePrefersDark
  const friendsFamilyToken = accessState?.kind === 'friends-family' ? accessState.token : ''
  const isAccessPromptOpen = accessState === null
  const isOperatorAnnouncementOpen = operatorAnnouncement !== null
  if (!clientSessionIdRef.current) {
    clientSessionIdRef.current = getClientSessionId()
  }
  const clientSessionId = clientSessionIdRef.current
  const puzzleHeaderLabel = getPuzzleHeaderLabel(puzzle)
  const todayDate = getTodayDate()
  // Snapshot of what the daily-rollover watcher needs, refreshed every render so
  // the (stable) watcher effect can read current values without re-subscribing.
  const rolloverStateRef = useRef({ activeGame, puzzle, additionalGameDate })
  rolloverStateRef.current = { activeGame, puzzle, additionalGameDate }
  const lastSeenDateRef = useRef(todayDate)
  const activeGameName = activeGame === 'wordle' ? 'Wordle' : ADDITIONAL_GAME_LABELS[activeGame]
  // Like Wordle: no title on daily play, a date descriptor for a past archive day.
  const additionalGameHeaderLabel =
    activeGame === 'wordle' || additionalGameDate === todayDate
      ? ''
      : formatPuzzleHeaderDate(additionalGameDate)
  // The stats page owns the header (Back button); never show a puzzle descriptor there.
  const headerDescriptor = isFamilyStatsOpen
    ? ''
    : activeGame === 'wordle'
      ? puzzleHeaderLabel
      : additionalGameHeaderLabel
  // Only daily/past plays are dated real puzzles whose hint usage we persist and
  // log; random plays keep the state in memory for the current game only.
  const hintPersistDate =
    puzzle && (puzzle.mode === 'daily' || puzzle.mode === 'past') ? puzzle.date : ''
  const isStandaloneApp = getIsStandaloneApp()
  const isSolvedUntrackedPuzzle = Boolean(
    completedResult && puzzle?.mode !== 'daily' && completedResult.mode === puzzle?.mode,
  )
  // Left-anchor the descriptor so it never collides with the "See results"
  // button. Letter Boxed has no such button (it shows results in-panel), so it
  // never needs the left anchor.
  const anchorHeaderLeft =
    Boolean(headerDescriptor) &&
    (activeGame === 'wordle'
      ? isSolvedUntrackedPuzzle
      : (activeGame === 'letterboxed' || activeGame === 'connections')
        ? false
        : Boolean(otherGameCompletedResult))

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

      if (responseBody) {
        if (Array.isArray(responseBody.users)) {
          responseBody.users = responseBody.users.map((u) => ({
            ...u,
            displayName: formatDisplayName(u.displayName),
            firstName: formatFirstName(u.firstName),
            lastInitial: formatLastInitial(u.lastInitial),
          }))
        }
        if (responseBody.group && Array.isArray(responseBody.group.recentResults)) {
          responseBody.group.recentResults = responseBody.group.recentResults.map((r) => ({
            ...r,
            displayName: formatDisplayName(r.displayName),
          }))
        }
      }

      setFamilyStats(responseBody)
    } catch (error) {
      setFamilyStatsError(error instanceof Error ? error.message : 'Could not load stats')
    } finally {
      setIsFamilyStatsLoading(false)
    }
  }, [clientSessionId, friendsFamilyToken, requestWithSessionRecovery])

  // `switchToWordle: false` marks a *background* load of the Wordle puzzle — app
  // bootstrap, the midnight rollover, "not available yet" recovery. Those must
  // refresh Wordle's own state without yanking the player out of whichever game
  // they are actually on (which would undo the restored last-game state on every
  // reload). Only explicit Wordle choices from the menu switch the view.
  const beginPuzzle = useCallback(
    (nextPuzzle: PuzzleMetadata, { switchToWordle = true }: BeginPuzzleOptions = {}) => {
      if (switchToWordle) {
        setActiveGame('wordle')
        setIsMenuOpen(false)
      }
      setPuzzle(nextPuzzle)
      setPuzzleError('')
      setIsFamilyDailyStatusLoading(false)
      resetGameState(nextPuzzle)

      if (nextPuzzle.mode === 'daily') {
        setTodayStatusReloadKey((reloadKey) => reloadKey + 1)
      }
    },
    [resetGameState],
  )

  const loadDailyPuzzle = useCallback(
    async (options: BeginPuzzleOptions = {}) => {
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

        beginPuzzle(
          {
            date: responseBody.date,
            answerLength: responseBody.answerLength,
            confidence: responseBody.confidence,
            mode: 'daily',
            status: responseBody.status,
          },
          options,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load daily Wordle'
        console.warn('Could not load daily Wordle', error)
        setPuzzleError(message)
      }
    },
    [beginPuzzle],
  )

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
      if (activeGame === 'wordle') {
        void loadFamilyStats()
      }
    },
    [activeGame, loadFamilyStats],
  )
  const closeFamilyStats = useCallback(() => {
    setIsFamilyStatsOpen(false)
  }, [])

  // Switch which game's stats are shown, from the stats page's game dropdown.
  const selectStatsGame = useCallback(
    (gameKey: WordbeeGameKey) => {
      setActiveGame(gameKey)
      setOtherGameCompletedResult(null)
      setOtherGameStats(null)
      setIsOtherGameResultsOpen(false)
      if (gameKey === 'wordle') {
        void loadFamilyStats()
      } else {
        const today = getTodayDate()
        setAdditionalGameDate(today)
        setAdditionalPastDate(today)
      }
    },
    [loadFamilyStats],
  )

  const selectAdditionalGame = useCallback((gameKey: AdditionalGameKey) => {
    // Selecting a game only switches to it and expands its submenu; the menu
    // stays open until a specific daily/past option is chosen.
    setActiveGame(gameKey)
    setIsFamilyStatsOpen(false)
    setIsResultsOpen(false)
    setIsOtherGameResultsOpen(false)
    setOtherGameCompletedResult(null)
    setOtherGameStats(null)
    const today = getTodayDate()
    setAdditionalGameDate(today)
    setAdditionalPastDate(today)
    setTilesMode('daily')
  }, [])

  const shakeRow = useCallback((row: number) => {
    setInvalidRow(row)
    window.setTimeout(() => setInvalidRow(null), 650)
  }, [])

  const handleOtherGameComplete = useCallback<MultigameCompleteHandler>((result, stats) => {
    setOtherGameCompletedResult(result)
    setOtherGameStats(stats)
    setIsOtherGameResultsOpen(true)
  }, [])

  const handleOtherGameLoadedAndComplete = useCallback<MultigameCompleteHandler>((result, stats) => {
    setOtherGameCompletedResult(result)
    setOtherGameStats(stats)
  }, [])

  const handleAdditionalResolvedDate = useCallback((resolvedDate: string) => {
    setAdditionalGameDate(resolvedDate)
    setAdditionalPastDate(resolvedDate)
  }, [])

  // Fired whenever an additional game (re)loads a puzzle, so a stale completed
  // result from a previous date/difficulty cannot leak into the new board.
  const handleAdditionalGameReset = useCallback(() => {
    setOtherGameCompletedResult(null)
    setOtherGameStats(null)
    setIsOtherGameResultsOpen(false)
  }, [])

  const playAdditionalDaily = useCallback(() => {
    const today = getTodayDate()
    setAdditionalGameDate(today)
    setAdditionalPastDate(today)
    setTilesMode('daily')
    setIsMenuOpen(false)
  }, [])

  const playAdditionalPast = useCallback(() => {
    setAdditionalGameDate(additionalPastDate)
    setTilesMode('daily')
    setIsMenuOpen(false)
  }, [additionalPastDate])

  const addLetter = useCallback(
    (letter: string) => {
      const row = currentRow
      // Fill the first open slot from the left, skipping any autofilled green
      // tiles (state 'correct') that are locked in place.
      const column = board[row].findIndex((tile) => tile.state === 'empty')
      if (column === -1) return

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
    },
    [board, currentRow],
  )

  const removeLetter = useCallback(() => {
    const row = currentRow
    // Only typed letters (state 'tbd') can be deleted; autofilled greens stay put.
    let column = -1
    for (let tileIndex = board[row].length - 1; tileIndex >= 0; tileIndex -= 1) {
      if (board[row][tileIndex].state === 'tbd') {
        column = tileIndex
        break
      }
    }
    if (column === -1) return

    setBoard((previousBoard) =>
      previousBoard.map((boardRow, rowIndex) =>
        rowIndex === row
          ? boardRow.map((tile, tileIndex) =>
              tileIndex === column
                ? { letter: '', state: 'empty', animation: 'idle' }
                : tile,
            )
          : boardRow,
      ),
    )
  }, [board, currentRow])

  // Transition each changed column of the active row to its target content with
  // the same two-phase flip the reveal uses: the current content rotates to
  // edge-on (flip-in), the content is swapped at the invisible midpoint, then the
  // new content rotates back to face (flip-out). Content is always present, so it
  // never blanks or pops. Staggered left-to-right; token-guarded so a re-toggle
  // cancels an in-flight run.
  const flipRowTo = useCallback(
    (targetRow: number, targets: { letter: string; state: TileState }[]) => {
      const current = boardRef.current[targetRow]
      const token = (autofillFlipTokenRef.current += 1)
      const isCurrent = () => autofillFlipTokenRef.current === token

      targets.forEach((target, column) => {
        const tile = current[column]
        if (tile.letter === target.letter && tile.state === target.state) return

        const start = column * REVEAL_STEP_MS
        // Revealing a letter: hold it as a grey tile through the first half (so
        // the slot is never empty — a stray keystroke can't slip in — and it
        // reads like a normal grey→colour reveal). Removing a letter: keep the
        // current content flipping away, then swap to empty at the midpoint.
        const firstHalf =
          target.letter !== ''
            ? { letter: target.letter, state: 'tbd' as TileState, animation: 'flip-in' as const }
            : { animation: 'flip-in' as const }

        window.setTimeout(() => {
          if (!isCurrent()) return
          setBoard((previousBoard) => patchTile(previousBoard, targetRow, column, firstHalf))
        }, start)

        window.setTimeout(() => {
          if (!isCurrent()) return
          setBoard((previousBoard) =>
            patchTile(previousBoard, targetRow, column, {
              letter: target.letter,
              state: target.state,
              animation: 'flip-out',
            }),
          )
        }, start + FLIP_HALF_MS)

        window.setTimeout(() => {
          if (!isCurrent()) return
          setBoard((previousBoard) => patchTile(previousBoard, targetRow, column, { animation: 'idle' }))
        }, start + FLIP_HALF_MS * 2)
      })
    },
    [],
  )

  // Flip confirmed greens into the active row (empty gaps and any stray typed
  // letters resolve to their autofill target).
  const flipInAutofillRow = useCallback(
    (targetRow: number) => {
      const greens = getGreenLetters(boardRef.current, targetRow)
      const targets = greens.map((letter) =>
        letter
          ? { letter, state: 'correct' as TileState }
          : { letter: '', state: 'empty' as TileState },
      )
      flipRowTo(targetRow, targets)
    },
    [flipRowTo],
  )

  // Reverse: flip every filled tile in the active row away, revealing empty tiles.
  const flipOutAutofillRow = useCallback(
    (targetRow: number) => {
      const targets = boardRef.current[targetRow].map(() => ({
        letter: '',
        state: 'empty' as TileState,
      }))
      flipRowTo(targetRow, targets)
    },
    [flipRowTo],
  )

  // Flip the autofill preference and rebuild the active row to match: switching
  // on seeds it with confirmed greens (flipping into place), switching off clears
  // it (typed letters included). Only the in-progress row is touched; completed
  // rows never change.
  const toggleAutofill = useCallback(() => {
    const nextEnabled = !settings.wordleAutofill
    updateSetting('wordleAutofill', nextEnabled)

    if (status !== 'playing' || isRevealing) return

    if (nextEnabled) {
      flipInAutofillRow(currentRow)
    } else {
      flipOutAutofillRow(currentRow)
    }
  }, [
    currentRow,
    flipInAutofillRow,
    flipOutAutofillRow,
    isRevealing,
    settings.wordleAutofill,
    status,
    updateSetting,
  ])

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
            // Send the token for daily and past plays so archive solves are saved
            // (as retro); random plays stay untracked.
            friendsFamilyToken: puzzle.mode === 'random' ? '' : friendsFamilyToken,
            gameId: gameIdRef.current,
            guesses,
            guessesUsed,
            mode: puzzle.mode,
            outcome,
            puzzleId: puzzle.puzzleId,
            usedHint: usedHintRef.current,
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

  // Ask the server for the answer's anonymized repeated-letter structure and
  // mark the hint as used for this puzzle (persisted for daily/past plays).
  const requestHint = useCallback(async (): Promise<number[] | null> => {
    if (!puzzle) return null

    try {
      const response = await requestJson<{ repeats?: number[]; error?: string }>('/api/hint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: puzzle.date,
          mode: puzzle.mode,
          puzzleId: puzzle.puzzleId,
        }),
      })

      if (!Array.isArray(response.repeats)) {
        return null
      }

      usedHintRef.current = true
      setUsedHint(true)
      if (hintPersistDate) {
        markHintUsedForDate(hintPersistDate)
      }

      return response.repeats.filter((count) => Number.isInteger(count) && count >= 2)
    } catch (error) {
      console.warn('Could not load hint', error)
      return null
    }
  }, [hintPersistDate, puzzle])

  const revealGuess = useCallback(async () => {
    if (!puzzle) {
      showToast(puzzleError || 'Loading puzzle')
      return
    }

    const row = currentRow
    // The row is ready once every slot (typed or autofilled) holds a letter.
    if (board[row].some((tile) => tile.letter === '')) {
      shakeRow(row)
      showToast('Not enough letters')
      return
    }

    const guess = board[row].map((tile) => tile.letter).join('')
    // In autofill mode the row arrives with locked green tiles (already scored
    // 'correct'). Those shouldn't flip on reveal — only the newly typed tiles do.
    const prefilledColumns = board[row].map((tile) => tile.state === 'correct')

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
      // Leave already-correct autofilled tiles untouched (no flip, keyboard
      // state unchanged) so only newly typed letters animate.
      if (prefilledColumns[index]) return

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

      const nextRow = row + 1
      setCurrentRow(nextRow)
      // Carry confirmed greens into the next row when autofill is on (flipping
      // them into place); otherwise leave it blank. The just-revealed row's
      // scores are already applied here.
      if (autofillEnabledRef.current) {
        flipInAutofillRow(nextRow)
      }
    }, REVEAL_DONE_MS)
  }, [
	    board,
	    clientSessionId,
	    currentRow,
	    flipInAutofillRow,
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
	      if (puzzle?.mode !== 'random' && isFamilyDailyStatusLoading) return
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

  const dismissOperatorAnnouncement = useCallback(() => {
    if (!operatorAnnouncement) return

    try {
      window.localStorage.setItem(getAnnouncementDismissalKey(operatorAnnouncement), '1')
    } catch (error) {
      console.warn('Could not save announcement dismissal', error)
    }

    setOperatorAnnouncement(null)
  }, [operatorAnnouncement])

  // Bootstrap Wordle's daily in the background. It must not steal the view: on a
  // reload we may have restored a different active game (see loadLastGameState).
  useEffect(() => {
    void loadDailyPuzzle({ switchToWordle: false })
  }, [loadDailyPuzzle])

  // Refresh the daily when the local calendar date rolls over, so the app never
  // keeps showing yesterday's puzzle after midnight while it stays open. Driven
  // purely by a one-shot timer to just after the next local midnight (re-armed
  // each day) — NOT by focus/visibility, so returning to the app mid-day never
  // reloads it. A timer scheduled for a past time (app backgrounded across
  // midnight) fires as soon as the JS loop resumes, so a next-morning return
  // still rolls forward; a same-day return does nothing. Only date-bound *daily*
  // play is refreshed — random/past/archive views are left untouched.
  useEffect(() => {
    const refreshForNewDay = () => {
      const current = getTodayDate()
      const previous = lastSeenDateRef.current
      if (current === previous) return
      lastSeenDateRef.current = current
      const { activeGame: game, puzzle: activePuzzle, additionalGameDate: gameDate } =
        rolloverStateRef.current
      if (game === 'wordle') {
        if (activePuzzle?.mode === 'daily') void loadDailyPuzzle({ switchToWordle: false })
      } else if (gameDate === previous) {
        setAdditionalGameDate(current)
        setAdditionalPastDate(current)
      }
    }

    let midnightTimer: number | null = null
    const armMidnight = () => {
      const now = new Date()
      // A few seconds past midnight so the backend has rolled over too.
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 10)
      midnightTimer = window.setTimeout(() => {
        refreshForNewDay()
        armMidnight()
      }, Math.max(1000, nextMidnight.getTime() - now.getTime()))
    }
    armMidnight()

    return () => {
      if (midnightTimer !== null) window.clearTimeout(midnightTimer)
    }
  }, [loadDailyPuzzle])

  // Restore the "hint used" button state for the active puzzle.
  useEffect(() => {
    const alreadyUsed = hintPersistDate ? hasUsedHintForDate(hintPersistDate) : false
    usedHintRef.current = alreadyUsed
    setUsedHint(alreadyUsed)
  }, [hintPersistDate])

  useEffect(() => {
	    if (!puzzle || puzzle.mode === 'random' || !friendsFamilyToken) {
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
          setStatus(serverResult.outcome)
          setWinningRow(serverResult.outcome === 'won' ? serverResult.guessesUsed - 1 : null)
          setCompletedResult({
            answer: serverResult.answer,
            board: serverResult.board,
            copied: false,
            definition: responseBody.definition,
            guesses: serverResult.guesses,
            guessesUsed: serverResult.guessesUsed,
            mode: puzzle?.mode ?? 'daily',
            outcome: serverResult.outcome,
            saved: true,
            stats: responseBody.stats,
          })
        } else if (
          puzzle?.mode === 'daily' &&
          responseBody.attempt &&
          responseBody.attempt.guessesUsed > 0
        ) {
          const serverAttempt = responseBody.attempt
          const activeRow = Math.min(serverAttempt.guessesUsed, MAX_GUESSES - 1)
          const hydratedBoard = hydrateBoardFromResult(serverAttempt)
          setBoard(
            autofillEnabledRef.current
              ? applyAutofillRow(hydratedBoard, activeRow)
              : hydratedBoard,
          )
          setKeyboardState(getKeyboardStateFromResult(serverAttempt))
          setCurrentRow(activeRow)
          setStatus('playing')
          setWinningRow(null)
          setCompletedResult(null)
          setIsResultsOpen(false)
        } else if (completedResult?.saved) {
          resetCurrentGame()
        }
      } catch (error) {
        if (error instanceof ApiError && error.message === 'Daily Wordle is not available yet') {
          void loadDailyPuzzle({ switchToWordle: false })
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

      if (activeGame !== 'wordle') {
        return
      }

      if (
        isSettingsOpen ||
	        isAccessPromptOpen ||
	        isFamilyStatsOpen ||
	        isResultsOpen ||
	        isMenuOpen ||
        isOperatorAnnouncementOpen
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
    activeGame,
    handleKey,
    isAccessPromptOpen,
    isFamilyStatsOpen,
    isMenuOpen,
    isOperatorAnnouncementOpen,
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

  // Persist the active game so a reload the player never asked for resumes it.
  // Re-stamped as the app is backgrounded — that is the last moment iOS lets us
  // say "they were still here", and the resume window is measured from it rather
  // than from whenever they last switched games.
  useEffect(() => {
    const persist = () => saveLastGameState({ activeGame, additionalGameDate })
    persist()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persist()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', persist)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', persist)
    }
  }, [activeGame, additionalGameDate])

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
    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault()
      }
    }
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    return () => document.removeEventListener('touchmove', handleTouchMove)
  }, [])

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
    fetch('/maintenance.json')
      .then((res) => (res.ok ? res.json() : { disabledGames: [] }))
      .then((data) => {
        if (Array.isArray(data.disabledGames)) {
          setDisabledGames(data.disabledGames)
        }
      })
      .catch(() => {
        // Silently ignore if maintenance.json is missing or fails to load
      })
  }, [])

  useEffect(() => {
    fetch('/announcement.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const announcement = normalizeOperatorAnnouncement(data)
        if (!announcement) return

        try {
          if (window.localStorage.getItem(getAnnouncementDismissalKey(announcement)) === '1') {
            return
          }
        } catch (error) {
          console.warn('Could not read announcement dismissal', error)
        }

        setOperatorAnnouncement(announcement)
      })
      .catch(() => {
        // Silently ignore if announcement.json is missing or fails to load
      })
  }, [])

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
      <div className="portrait-lock-overlay">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <path d="M12 18h.01" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <h3>Rotate Your Device</h3>
        <p>This app is designed to be played in portrait mode.</p>
      </div>

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
                <div
                  className="wordbee-menu-scrim"
                  aria-hidden="true"
                  onClick={() => setIsMenuOpen(false)}
                />
              )}
              {isMenuOpen && (
                <WordbeeMenu
                  additionalMaxPastDate={todayDate}
                  additionalPastDate={additionalPastDate}
                  disabledGames={disabledGames}
                  maxPastDate={getDefaultPastDate()}
                  minPastDate={FIRST_OFFICIAL_PUZZLE_DATE}
                  onAdditionalDaily={playAdditionalDaily}
                  onAdditionalPast={playAdditionalPast}
                  onAdditionalPastDateChange={setAdditionalPastDate}
                  onDaily={() => void loadDailyPuzzle()}
                  onPast={() => void startPastPuzzle(pastWordDate)}
                  onPastDateChange={setPastWordDate}
                  onRandom={() => void startRandomPuzzle()}
                  onSelectGame={(gameKey) => {
                    if (gameKey === 'wordle') {
                      setActiveGame('wordle')
                      setIsFamilyStatsOpen(false)
                      setIsOtherGameResultsOpen(false)
                      setOtherGameCompletedResult(null)
                      setOtherGameStats(null)
                      return
                    }
                    selectAdditionalGame(gameKey)
                  }}
                  onTilesRandom={() => {
                    selectAdditionalGame('tiles')
                    setTilesMode('zen')
                    setIsMenuOpen(false)
                  }}
                  pastDate={pastWordDate}
                  selectedGame={activeGame}
                  showAdditionalDaily={
                    additionalGameDate !== todayDate || (activeGame === 'tiles' && tilesMode === 'zen')
                  }
                  showDaily={activeGame !== 'wordle' || puzzle?.mode !== 'daily'}
                />
              )}
            </>
          )}
        </div>

        {isFamilyStatsOpen ? (
          <div className="wordbee-header-stats-switcher">
            <StatsGameSwitcher activeGame={activeGame} disabledGames={disabledGames} onSelect={selectStatsGame} />
          </div>
        ) : (
          <h1
            className={[
              'wordbee-title',
              headerDescriptor ? 'wordbee-title--visible' : '',
              anchorHeaderLeft ? 'wordbee-title--left-anchor' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {headerDescriptor || activeGameName}
          </h1>
        )}

        <div className="wordbee-header__side wordbee-header__side--right">
          {activeGame === 'wordle' && !isFamilyStatsOpen && puzzle && status === 'playing' && (
            <>
              <AutofillToggle
                enabled={settings.wordleAutofill}
                disabled={isRevealing}
                onToggle={toggleAutofill}
              />
              <HintButton onReveal={requestHint} used={usedHint} />
            </>
          )}
          {activeGame === 'wordle' && !isFamilyStatsOpen && completedResult && (
            <button
              className="wordbee-results-reopen-button"
              type="button"
              onClick={() => setIsResultsOpen(true)}
            >
              See results
            </button>
          )}
          {activeGame !== 'wordle' &&
            activeGame !== 'letterboxed' &&
            activeGame !== 'connections' &&
            !isFamilyStatsOpen &&
            otherGameCompletedResult && (
              <button
                className="wordbee-results-reopen-button"
                type="button"
                onClick={() => setIsOtherGameResultsOpen(true)}
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
        activeGame === 'wordle' ? (
          <FamilyStatsPage
            accessState={accessState}
            clientSessionId={clientSessionId}
            currentUserId={accessState.userId}
            dashboard={familyStats}
            error={familyStatsError}
            initialView={familyStatsView}
            isLoading={isFamilyStatsLoading}
            onBack={closeFamilyStats}
            onReload={() => void loadFamilyStats()}
            requestWithSessionRecovery={requestWithSessionRecovery}
          />
        ) : (
          <MultigameStatsPage
            activeGame={activeGame as AdditionalGameKey}
            currentUserId={accessState.userId}
            accessState={accessState}
            clientSessionId={clientSessionId}
            requestWithSessionRecovery={requestWithSessionRecovery}
            onBack={closeFamilyStats}
          />
        )
      ) : activeGame === 'wordle' ? (
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
            onKey={(key) => {
              if (!isOperatorAnnouncementOpen) {
                handleKey(key, 'onscreen')
              }
            }}
            states={keyboardState}
          />
        </main>
      ) : activeGame === 'connections' ? (
        <ConnectionsGame
          accessState={accessState}
          clientSessionId={clientSessionId}
          requestedDate={additionalGameDate}
          requestWithSessionRecovery={requestWithSessionRecovery}
          showToast={showToast}
          onGameComplete={handleOtherGameLoadedAndComplete}
          onGameLoadedAndComplete={handleOtherGameLoadedAndComplete}
          onGameReset={handleAdditionalGameReset}
          onResolvedDate={handleAdditionalResolvedDate}
        />
      ) : activeGame === 'strands' ? (
        <StrandsGame
          accessState={accessState}
          clientSessionId={clientSessionId}
          requestedDate={additionalGameDate}
          requestWithSessionRecovery={requestWithSessionRecovery}
          showToast={showToast}
          onGameComplete={handleOtherGameComplete}
          onGameLoadedAndComplete={handleOtherGameLoadedAndComplete}
          onGameReset={handleAdditionalGameReset}
          onResolvedDate={handleAdditionalResolvedDate}
        />
      ) : activeGame === 'letterboxed' ? (
        <LetterboxedGame
          accessState={accessState}
          clientSessionId={clientSessionId}
          isInputBlocked={
            isAccessPromptOpen ||
            isFamilyStatsOpen ||
            isMenuOpen ||
	            isOtherGameResultsOpen ||
	            isSettingsOpen ||
            isOperatorAnnouncementOpen
          }
          requestedDate={additionalGameDate}
          requestWithSessionRecovery={requestWithSessionRecovery}
          showToast={showToast}
          // Letter Boxed shows its outcome in-panel (solve count, insight,
          // fewest solution, play-again/reveal) and deliberately has no shared
          // results dialog, so completion is recorded quietly (no auto-open).
          onGameComplete={handleOtherGameLoadedAndComplete}
          onGameLoadedAndComplete={handleOtherGameLoadedAndComplete}
          onGameReset={handleAdditionalGameReset}
          onResolvedDate={handleAdditionalResolvedDate}
        />
      ) : activeGame === 'spellingbee' ? (
        <SpellingBeeGame
          accessState={accessState}
          clientSessionId={clientSessionId}
          isInputBlocked={
            isAccessPromptOpen ||
            isFamilyStatsOpen ||
            isMenuOpen ||
	            isOtherGameResultsOpen ||
	            isSettingsOpen ||
            isOperatorAnnouncementOpen
          }
          requestedDate={additionalGameDate}
          requestWithSessionRecovery={requestWithSessionRecovery}
          showToast={showToast}
          onGameComplete={handleOtherGameComplete}
          onGameLoadedAndComplete={handleOtherGameLoadedAndComplete}
          onGameReset={handleAdditionalGameReset}
          onResolvedDate={handleAdditionalResolvedDate}
        />
      ) : activeGame === 'tiles' ? (
        <TilesGame
          accessState={accessState}
          clientSessionId={clientSessionId}
          isInputBlocked={
            isAccessPromptOpen ||
            isFamilyStatsOpen ||
            isMenuOpen ||
	            isOtherGameResultsOpen ||
	            isSettingsOpen ||
            isOperatorAnnouncementOpen
          }
          requestedDate={additionalGameDate}
          requestWithSessionRecovery={requestWithSessionRecovery}
          showToast={showToast}
          isZen={tilesMode === 'zen'}
          onToggleZen={(zen) => setTilesMode(zen ? 'zen' : 'daily')}
          onGameComplete={handleOtherGameComplete}
          onGameLoadedAndComplete={handleOtherGameLoadedAndComplete}
          onGameReset={handleAdditionalGameReset}
          onResolvedDate={handleAdditionalResolvedDate}
        />
      ) : activeGame === 'pips' ? (
        <PipsGame
          accessState={accessState}
          clientSessionId={clientSessionId}
          isInputBlocked={
            isAccessPromptOpen ||
            isFamilyStatsOpen ||
            isMenuOpen ||
	            isOtherGameResultsOpen ||
	            isSettingsOpen ||
            isOperatorAnnouncementOpen
          }
          requestedDate={additionalGameDate}
          requestWithSessionRecovery={requestWithSessionRecovery}
          showToast={showToast}
          onGameComplete={handleOtherGameComplete}
          onGameLoadedAndComplete={handleOtherGameLoadedAndComplete}
          onGameReset={handleAdditionalGameReset}
          onResolvedDate={handleAdditionalResolvedDate}
        />
      ) : activeGame === 'crossword' || activeGame === 'mini' || activeGame === 'midi' ? (
        <CrosswordGame
          gameKey={activeGame}
          accessState={accessState}
          clientSessionId={clientSessionId}
          isInputBlocked={
            isAccessPromptOpen ||
            isFamilyStatsOpen ||
            isMenuOpen ||
	            isOtherGameResultsOpen ||
	            isSettingsOpen ||
            isOperatorAnnouncementOpen
          }
          requestedDate={additionalGameDate}
          requestWithSessionRecovery={requestWithSessionRecovery}
          showToast={showToast}
          onGameComplete={handleOtherGameComplete}
          onGameLoadedAndComplete={handleOtherGameLoadedAndComplete}
          onGameReset={handleAdditionalGameReset}
          onResolvedDate={handleAdditionalResolvedDate}
        />
      ) : (
        <SudokuGame
          accessState={accessState}
          clientSessionId={clientSessionId}
          isInputBlocked={
            isAccessPromptOpen ||
            isFamilyStatsOpen ||
            isMenuOpen ||
	            isOtherGameResultsOpen ||
	            isSettingsOpen ||
            isOperatorAnnouncementOpen
          }
          requestedDate={additionalGameDate}
          requestWithSessionRecovery={requestWithSessionRecovery}
          showToast={showToast}
          onGameComplete={handleOtherGameComplete}
          onGameLoadedAndComplete={handleOtherGameLoadedAndComplete}
          onGameReset={handleAdditionalGameReset}
          onResolvedDate={handleAdditionalResolvedDate}
        />
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
          onOpenStats={() => {
            setIsResultsOpen(false)
            openFamilyStats('overview')
          }}
          result={completedResult}
        />
      )}

      {isOtherGameResultsOpen &&
        otherGameCompletedResult &&
        activeGame !== 'letterboxed' &&
        activeGame !== 'connections' && (
          <MultigameResultsDialog
            activeGame={activeGame as AdditionalGameKey}
            canOpenStats={accessState?.kind === 'friends-family'}
            onClose={() => setIsOtherGameResultsOpen(false)}
            onOpenStats={() => {
              setIsOtherGameResultsOpen(false)
              openFamilyStats('overview')
            }}
            result={otherGameCompletedResult}
            stats={otherGameStats}
            showToast={showToast}
          />
        )}

      {operatorAnnouncement && (
        <OperatorAnnouncementDialog
          announcement={operatorAnnouncement}
          onDismiss={dismissOperatorAnnouncement}
        />
      )}

    </div>
  )
}

function normalizeOperatorAnnouncement(value: unknown): OperatorAnnouncement | null {
  if (!value || typeof value !== 'object') return null

  const candidate = value as Record<string, unknown>
  if (candidate.active !== true) return null

  const id = getNonEmptyString(candidate.id)
  const date = getNonEmptyString(candidate.date)
  const message = getNonEmptyString(candidate.message)
  const signature = getNonEmptyString(candidate.signature)
  const createdAt = getNonEmptyString(candidate.createdAt)
  const expiresAt = getNonEmptyString(candidate.expiresAt)

  if (!id || !date || !message || !signature || !createdAt || !expiresAt) return null
  if (date !== getTodayDate()) return null

  const now = Date.now()
  const createdTime = Date.parse(createdAt)
  const expiresTime = Date.parse(expiresAt)
  if (!Number.isFinite(createdTime) || !Number.isFinite(expiresTime)) return null
  if (now < createdTime || now >= expiresTime) return null

  return {
    id,
    date,
    message,
    signature,
    createdAt,
    expiresAt,
  }
}

function getNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function getAnnouncementDismissalKey(announcement: OperatorAnnouncement) {
  return `${ANNOUNCEMENT_DISMISSAL_STORAGE_PREFIX}.${announcement.date}.${announcement.id}`
}

function OperatorAnnouncementDialog({
  announcement,
  onDismiss,
}: {
  announcement: OperatorAnnouncement
  onDismiss: () => void
}) {
  return (
    <div className="operator-announcement-backdrop">
      <section
        aria-labelledby="operator-announcement-title"
        aria-modal="true"
        className="operator-announcement"
        role="dialog"
      >
        <h2 id="operator-announcement-title">Message</h2>
        <p className="operator-announcement__message">{announcement.message}</p>
        <p className="operator-announcement__signature">{announcement.signature}</p>
        <button className="operator-announcement__button" onClick={onDismiss} type="button">
          OK
        </button>
      </section>
    </div>
  )
}

export default App
