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
import { WordbeeMenu } from './features/navigation/WordbeeMenu'
import { ResultsDialog } from './features/results/ResultsDialog'
import { MultigameResultsDialog } from './features/results/MultigameResultsDialog'
import { SettingsDialog } from './features/settings/SettingsDialog'
import { FamilyStatsPage } from './features/stats/FamilyStatsPage'
import { MultigameStatsPage } from './features/stats/MultigameStatsPage'
import { StatsGameSwitcher } from './features/stats/StatsGameSwitcher'
import { StrandsGame } from './features/strands/StrandsGame'
import { SudokuGame } from './features/sudoku/SudokuGame'
import { Keyboard } from './features/wordle/Keyboard'
import {
  createBoard,
  createShareText,
  getCompletedBoard,
  getCompletedGuesses,
  getKeyboardStateFromResult,
  hydrateBoardFromResult,
  tileAriaLabel,
} from './features/wordle/wordle-utils'
import { isSessionConflict } from './lib/access'
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
import {
  getClientSessionId,
  loadAccessState,
  loadLastGameState,
  loadSettings,
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
  WordbeeGameKey,
} from './types'
import './styles/index.css'

const initialLastGame = loadLastGameState()

function App() {
  const [activeGame, setActiveGame] = useState<WordbeeGameKey>(
    initialLastGame?.activeGame ?? 'wordle',
  )
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
  const todayDate = getTodayDate()
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
  const isStandaloneApp = getIsStandaloneApp()
  const isSolvedUntrackedPuzzle = Boolean(
    completedResult && puzzle?.mode !== 'daily' && completedResult.mode === puzzle?.mode,
  )
  // Left-anchor the descriptor so it never collides with the "See results" button.
  const anchorHeaderLeft =
    Boolean(headerDescriptor) &&
    (activeGame === 'wordle'
      ? isSolvedUntrackedPuzzle
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
      setActiveGame('wordle')
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
    setIsMenuOpen(false)
  }, [])

  const playAdditionalPast = useCallback(() => {
    setAdditionalGameDate(additionalPastDate)
    setIsMenuOpen(false)
  }, [additionalPastDate])

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
            // Send the token for daily and past plays so archive solves are saved
            // (as retro); random plays stay untracked.
            friendsFamilyToken: puzzle.mode === 'random' ? '' : friendsFamilyToken,
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

  useEffect(() => {
    void loadDailyPuzzle()
  }, [loadDailyPuzzle])

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

      if (activeGame !== 'wordle') {
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
    activeGame,
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
    saveLastGameState({ activeGame, additionalGameDate })
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
                <WordbeeMenu
                  additionalMaxPastDate={todayDate}
                  additionalPastDate={additionalPastDate}
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
                  pastDate={pastWordDate}
                  selectedGame={activeGame}
                  showAdditionalDaily={additionalGameDate !== todayDate}
                  showDaily={activeGame !== 'wordle' || puzzle?.mode !== 'daily'}
                />
              )}
            </>
          )}
        </div>

        {isFamilyStatsOpen ? (
          <div className="wordbee-header-stats-switcher">
            <StatsGameSwitcher activeGame={activeGame} onSelect={selectStatsGame} />
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
          {activeGame === 'wordle' && !isFamilyStatsOpen && completedResult && (
            <button
              className="wordbee-results-reopen-button"
              type="button"
              onClick={() => setIsResultsOpen(true)}
            >
              See results
            </button>
          )}
          {activeGame !== 'wordle' && !isFamilyStatsOpen && otherGameCompletedResult && (
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
            activeGame={activeGame as 'connections' | 'strands' | 'sudoku'}
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
            onKey={(key) => handleKey(key, 'onscreen')}
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
          onGameComplete={handleOtherGameComplete}
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
      ) : (
        <SudokuGame
          accessState={accessState}
          clientSessionId={clientSessionId}
          isInputBlocked={
            isAccessPromptOpen ||
            isFamilyStatsOpen ||
            isMenuOpen ||
            isOtherGameResultsOpen ||
            isSettingsOpen
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

      {isOtherGameResultsOpen && otherGameCompletedResult && (
        <MultigameResultsDialog
          activeGame={activeGame as 'connections' | 'strands' | 'sudoku'}
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

    </div>
  )
}

export default App
