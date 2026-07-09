import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearStoredAdditionalGameValue,
  getAdditionalGameStorageKey,
  loadAdditionalGameStatus,
  loadStatsForGameUser,
  loadStoredAdditionalGameValue,
  notifyDateClamp,
  saveAdditionalGameAttempt,
  saveAdditionalGameResult,
  saveStoredAdditionalGameValue,
  type SessionRequest,
} from '../games/game-utils'
import { requestJson } from '../../lib/api'
import { ADDITIONAL_GAME_LABELS } from '../../config/constants'
import type {
  AccessState,
  CrosswordCheckResponse,
  CrosswordClue,
  CrosswordPuzzle,
  CrosswordSolution,
  GridGameKey,
  MultigameCompleteHandler,
  MultigameCompletionResult,
} from '../../types'

type Direction = 'across' | 'down'

type CrosswordAttemptState = {
  entries: string[]
  selectedCell: number
  direction: Direction
  elapsedSeconds: number
  checksUsed: number
  revealsUsed: number
  autocheck: boolean
  revealedCells: number[]
  wrongCells: number[]
}

const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Enter', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace'],
]

export function CrosswordGame({
  gameKey = 'crossword',
  accessState,
  clientSessionId,
  isInputBlocked,
  requestedDate,
  requestWithSessionRecovery,
  showToast,
  onGameComplete,
  onGameLoadedAndComplete,
  onGameReset,
  onResolvedDate,
}: {
  gameKey?: GridGameKey
  accessState: AccessState | null
  clientSessionId: string
  isInputBlocked: boolean
  requestedDate: string
  requestWithSessionRecovery: SessionRequest
  showToast: (message: string, durationMs?: number) => void
  onGameComplete: MultigameCompleteHandler
  onGameLoadedAndComplete: MultigameCompleteHandler
  onGameReset: () => void
  onResolvedDate: (date: string) => void
}) {
  const gameName = ADDITIONAL_GAME_LABELS[gameKey]
  const [puzzle, setPuzzle] = useState<CrosswordPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [entries, setEntries] = useState<string[]>([])
  const [selectedCell, setSelectedCell] = useState(0)
  const [direction, setDirection] = useState<Direction>('across')
  const [isComplete, setIsComplete] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [autocheck, setAutocheck] = useState(false)
  const [checksUsed, setChecksUsed] = useState(0)
  const [revealsUsed, setRevealsUsed] = useState(0)
  const [revealedCells, setRevealedCells] = useState<Set<number>>(() => new Set())
  const [wrongCells, setWrongCells] = useState<Set<number>>(() => new Set())
  const solutionRef = useRef<(string | null)[] | null>(null)
  const [checkMenuOpen, setCheckMenuOpen] = useState(false)
  const [revealMenuOpen, setRevealMenuOpen] = useState(false)
  const [clearMenuOpen, setClearMenuOpen] = useState(false)
  const [isRebusActive, setIsRebusActive] = useState(false)
  const [isPencilActive, setIsPencilActive] = useState(false)
  const [pencilCells, setPencilCells] = useState<Set<number>>(() => new Set())
  const [showClueList, setShowClueList] = useState(false)

  // Latest-state refs so the timer/persistence can read without re-subscribing.
  const stateRef = useRef({
    entries,
    selectedCell,
    direction,
    elapsedSeconds,
    autocheck,
    checksUsed,
    revealsUsed,
    revealedCells,
    wrongCells,
    pencilCells,
    isComplete,
    puzzle,
  })
  stateRef.current = {
    entries,
    selectedCell,
    direction,
    elapsedSeconds,
    autocheck,
    checksUsed,
    revealsUsed,
    revealedCells,
    wrongCells,
    pencilCells,
    isComplete,
    puzzle,
  }

  const isBlock = useCallback(
    (index: number) => !puzzle || puzzle.cells[index] === null,
    [puzzle],
  )

  // Per-direction map from a cell index to the clue that runs through it, plus
  // ordered clue lists for the clue bar / list navigation.
  const clueMaps = useMemo(() => {
    const across = new Map<number, number>()
    const down = new Map<number, number>()
    const acrossClues: number[] = []
    const downClues: number[] = []
    puzzle?.clues.forEach((clue, index) => {
      const target = clue.direction === 'across' ? across : down
      clue.cells.forEach((cell) => target.set(cell, index))
      if (clue.direction === 'across') acrossClues.push(index)
      else downClues.push(index)
    })
    return { across, down, acrossClues, downClues }
  }, [puzzle])

  const clueForCell = useCallback(
    (cell: number, dir: Direction): number | undefined =>
      (dir === 'across' ? clueMaps.across : clueMaps.down).get(cell),
    [clueMaps],
  )

  const activeClueIndex = clueForCell(selectedCell, direction)
  const activeClue: CrosswordClue | undefined =
    activeClueIndex !== undefined ? puzzle?.clues[activeClueIndex] : undefined
  const activeCells = useMemo(() => activeClue?.cells ?? [], [activeClue])
  const activeCellSet = useMemo(() => new Set(activeCells), [activeCells])

  const canPlay = Boolean(puzzle) && !isComplete && !isInputBlocked

  // --- Persistence ----------------------------------------------------------

  const persist = useCallback(() => {
    const snapshot = stateRef.current
    if (!snapshot.puzzle || snapshot.isComplete) return
    const state: CrosswordAttemptState & { pencilCells?: number[] } = {
      entries: snapshot.entries,
      selectedCell: snapshot.selectedCell,
      direction: snapshot.direction,
      elapsedSeconds: snapshot.elapsedSeconds,
      checksUsed: snapshot.checksUsed,
      revealsUsed: snapshot.revealsUsed,
      autocheck: snapshot.autocheck,
      revealedCells: [...snapshot.revealedCells],
      wrongCells: [...snapshot.wrongCells],
      pencilCells: [...snapshot.pencilCells],
    }
    if (accessState?.kind === 'friends-family') {
      void saveAdditionalGameAttempt({
        accessState,
        clientSessionId,
        date: snapshot.puzzle.date,
        gameKey,
        requestWithSessionRecovery,
        state,
        variant: 'daily',
      }).catch((error) => console.warn('Could not save Crossword attempt', error))
    } else {
      saveStoredAdditionalGameValue(
        getAdditionalGameStorageKey({
          date: snapshot.puzzle.date,
          gameKey,
          kind: 'attempt',
          variant: 'daily',
        }),
        state,
      )
    }
  }, [accessState, clientSessionId, gameKey, requestWithSessionRecovery])

  // Save on unmount and when the tab is hidden (mirrors Sudoku).
  useEffect(() => () => persist(), [persist])
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') persist()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [persist])

  // Timer ticks while a loaded board is unsolved; pauses when hidden.
  useEffect(() => {
    if (!puzzle || isComplete) return
    let interval: number | null = null
    const start = () => {
      if (interval === null) {
        interval = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000)
      }
    }
    const stop = () => {
      if (interval !== null) {
        window.clearInterval(interval)
        interval = null
      }
    }
    if (document.visibilityState === 'visible') start()
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop())
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [puzzle, isComplete])

  // --- Solution / reveal ----------------------------------------------------

  const loadSolution = useCallback(
    async (puzzleDate: string): Promise<(string | null)[] | null> => {
      if (solutionRef.current) return solutionRef.current
      try {
        const res = await requestJson<CrosswordSolution>(`/api/games/${gameKey}/reveal`, {
          body: JSON.stringify({ date: puzzleDate }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        solutionRef.current = res.answers
        return res.answers
      } catch (error) {
        console.warn('Could not load Crossword solution', error)
        return null
      }
    },
    [gameKey],
  )

  // --- Result ---------------------------------------------------------------

  const saveResult = useCallback(
    async (finalEntries: string[], revealed: boolean, checks: number, reveals: number) => {
      const activePuzzle = stateRef.current.puzzle
      if (!activePuzzle) return
      const score = {
        entries: finalEntries,
        title: activePuzzle.title,
        width: activePuzzle.width,
        height: activePuzzle.height,
        checksUsed: checks,
        revealsUsed: reveals,
        revealed,
      }
      const seconds = stateRef.current.elapsedSeconds
      const completedResult: MultigameCompletionResult = {
        date: activePuzzle.date,
        elapsedSeconds: seconds,
        outcome: 'won',
        score,
        variant: 'daily',
      }

      if (accessState?.kind === 'friends-family') {
        try {
          const response = await saveAdditionalGameResult({
            accessState,
            clientSessionId,
            date: activePuzzle.date,
            elapsedSeconds: seconds,
            gameKey,
            outcome: 'won',
            requestWithSessionRecovery,
            score,
            variant: 'daily',
          })
          const stats = await loadStatsForGameUser({
            accessState,
            clientSessionId,
            gameKey,
            requestWithSessionRecovery,
          })
          onGameComplete(response.result ?? completedResult, stats)
        } catch (error) {
          console.warn('Could not save Crossword result', error)
          showToast(error instanceof Error ? error.message : 'Could not save result')
        }
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: activePuzzle.date,
            gameKey,
            kind: 'result',
            variant: 'daily',
          }),
          completedResult,
        )
        clearStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: activePuzzle.date,
            gameKey,
            kind: 'attempt',
            variant: 'daily',
          }),
        )
        onGameComplete(completedResult, null)
      }
    },
    [accessState, clientSessionId, gameKey, onGameComplete, requestWithSessionRecovery, showToast],
  )

  const finishAsSolved = useCallback(
    async (finalEntries: string[], revealed: boolean) => {
      setIsComplete(true)
      await loadSolution(stateRef.current.puzzle?.date ?? '')
      showToast(revealed ? 'Crossword revealed' : 'Crossword solved!', 1800)
      await saveResult(
        finalEntries,
        revealed,
        stateRef.current.checksUsed,
        stateRef.current.revealsUsed,
      )
    },
    [loadSolution, saveResult, showToast],
  )

  // Server-authoritative check for the current grid. Updates the wrong-cell
  // marks for the requested scope and detects a completed solve.
  const runCheck = useCallback(
    async (scope: number[] | 'all', options: { silent?: boolean } = {}) => {
      const activePuzzle = stateRef.current.puzzle
      if (!activePuzzle) return
      try {
        const checkEntries = stateRef.current.entries.map((val, idx) =>
          stateRef.current.pencilCells.has(idx) ? '' : val
        )
        const res = await requestJson<CrosswordCheckResponse>(`/api/games/${gameKey}/check`, {
          body: JSON.stringify({ date: activePuzzle.date, entries: checkEntries }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        const incorrect = new Set(res.incorrect)
        const inScope = (cell: number) => scope === 'all' || scope.includes(cell)
        setWrongCells((previous) => {
          const next = new Set(previous)
          scopeCells(scope, activePuzzle.width * activePuzzle.height).forEach((cell) => next.delete(cell))
          res.incorrect.forEach((cell) => {
            if (inScope(cell)) next.add(cell)
          })
          return next
        })
        if (res.solved) {
          void finishAsSolved(stateRef.current.entries, stateRef.current.revealsUsed > 0)
        } else if (!options.silent && res.complete) {
          showToast('Something isn’t right', 1600)
        }
        return incorrect
      } catch (error) {
        if (!options.silent) showToast(error instanceof Error ? error.message : 'Could not check')
      }
    },
    [finishAsSolved, gameKey, showToast],
  )

  // --- Load -----------------------------------------------------------------

  const loadPuzzle = useCallback(async () => {
    onGameReset()
    setPuzzleError('')
    setPuzzle(null)
    setEntries([])
    setSelectedCell(0)
    setDirection('across')
    setIsComplete(false)
    setElapsedSeconds(0)
    setChecksUsed(0)
    setRevealsUsed(0)
    setRevealedCells(new Set())
    setWrongCells(new Set())
    solutionRef.current = null
    setAutocheck(false)
    setIsRebusActive(false)
    setIsPencilActive(false)
    setPencilCells(new Set())

    try {
      const activePuzzle = await requestJson<CrosswordPuzzle>(
        `/api/games/${gameKey}/today?date=${encodeURIComponent(requestedDate)}`,
        { cache: 'no-store' },
      )
      setPuzzle(activePuzzle)
      notifyDateClamp(activePuzzle, gameKey, showToast)
      onResolvedDate(activePuzzle.date)
      // A requested gap date snaps to the nearest published puzzle.
      if (
        activePuzzle.date !== requestedDate &&
        !activePuzzle.clampedToOldest &&
        !activePuzzle.clampedToNewest
      ) {
        showToast(`No puzzle that day — showing the nearest, ${activePuzzle.date}.`, 2600)
      }

      const cellCount = activePuzzle.width * activePuzzle.height
      const firstOpen = activePuzzle.cells.findIndex((cell) => cell !== null)
      const emptyEntries = Array(cellCount).fill('')

      const hydrateCompleted = async (res: MultigameCompletionResult, stats: unknown) => {
        setIsComplete(true)
        const answers = await loadSolution(activePuzzle.date)
        setEntries(answers ? answers.map((value) => value ?? '') : emptyEntries)
        const revealed = Boolean((res.score as Record<string, unknown>)?.revealed)
        setChecksUsed(Number((res.score as Record<string, unknown>)?.checksUsed ?? 0))
        setRevealsUsed(Number((res.score as Record<string, unknown>)?.revealsUsed ?? 0))
        if (revealed) setRevealedCells(new Set(rangeOpenCells(activePuzzle)))
        onGameLoadedAndComplete(res, stats as never)
      }

      const applyAttempt = (state: Partial<CrosswordAttemptState>) => {
        setEntries(
          Array.isArray(state.entries) && state.entries.length === cellCount
            ? state.entries.map((value) => (typeof value === 'string' ? value : ''))
            : emptyEntries,
        )
        setSelectedCell(Number(state.selectedCell ?? (firstOpen >= 0 ? firstOpen : 0)))
        setDirection(state.direction === 'down' ? 'down' : 'across')
        setElapsedSeconds(Number(state.elapsedSeconds ?? 0))
        setChecksUsed(Number(state.checksUsed ?? 0))
        setRevealsUsed(Number(state.revealsUsed ?? 0))
        setAutocheck(Boolean(state.autocheck))
        setRevealedCells(new Set(Array.isArray(state.revealedCells) ? state.revealedCells : []))
        setWrongCells(new Set(Array.isArray(state.wrongCells) ? state.wrongCells : []))
        setPencilCells(new Set(Array.isArray((state as any).pencilCells) ? (state as any).pencilCells : []))
      }

      const applyFresh = () => {
        setEntries(emptyEntries)
        setSelectedCell(firstOpen >= 0 ? firstOpen : 0)
        setPencilCells(new Set())
      }

      if (accessState?.kind === 'friends-family') {
        const statusResponse = await loadAdditionalGameStatus({
          accessState,
          clientSessionId,
          date: activePuzzle.date,
          gameKey,
          requestWithSessionRecovery,
          variant: 'daily',
        })
        if (statusResponse.completed && statusResponse.result) {
          const stats = await loadStatsForGameUser({
            accessState,
            clientSessionId,
            gameKey,
            requestWithSessionRecovery,
          })
          await hydrateCompleted(statusResponse.result, stats)
        } else if (statusResponse.attempt) {
          applyAttempt(statusResponse.attempt.state as Partial<CrosswordAttemptState>)
        } else {
          applyFresh()
        }
      } else {
        const localResult = loadStoredAdditionalGameValue<MultigameCompletionResult>(
          getAdditionalGameStorageKey({
            date: activePuzzle.date,
            gameKey,
            kind: 'result',
            variant: 'daily',
          }),
        )
        if (localResult) {
          await hydrateCompleted(localResult, null)
        } else {
          const localAttempt = loadStoredAdditionalGameValue<Partial<CrosswordAttemptState>>(
            getAdditionalGameStorageKey({
              date: activePuzzle.date,
              gameKey,
              kind: 'attempt',
              variant: 'daily',
            }),
          )
          if (localAttempt) applyAttempt(localAttempt)
          else applyFresh()
        }
      }
    } catch (error) {
      setPuzzleError(error instanceof Error ? error.message : `Could not load ${gameName}`)
    }
  }, [
    accessState,
    clientSessionId,
    gameKey,
    gameName,
    loadSolution,
    onGameLoadedAndComplete,
    onGameReset,
    onResolvedDate,
    requestedDate,
    requestWithSessionRecovery,
    showToast,
  ])

  useEffect(() => {
    void loadPuzzle()
  }, [loadPuzzle])

  // --- Navigation -----------------------------------------------------------

  const selectCell = useCallback(
    (index: number) => {
      if (isBlock(index)) return
      setIsRebusActive(false)
      if (index === selectedCell) {
        // Re-selecting the current cell flips direction (if it has both words).
        setDirection((previous) => {
          const other = previous === 'across' ? 'down' : 'across'
          return clueForCell(index, other) !== undefined ? other : previous
        })
        return
      }
      setSelectedCell(index)
      if (clueForCell(index, direction) === undefined) {
        setDirection((previous) => (previous === 'across' ? 'down' : 'across'))
      }
    },
    [clueForCell, direction, isBlock, selectedCell],
  )

  const toggleDirection = useCallback(() => {
    setDirection((previous) => {
      const other = previous === 'across' ? 'down' : 'across'
      return clueForCell(selectedCell, other) !== undefined ? other : previous
    })
  }, [clueForCell, selectedCell])

  const moveStep = useCallback(
    (rowDelta: number, columnDelta: number) => {
      if (!puzzle) return
      const { width, height } = puzzle
      let row = Math.floor(selectedCell / width)
      let column = selectedCell % width
      for (let step = 0; step < Math.max(width, height); step += 1) {
        row += rowDelta
        column += columnDelta
        if (row < 0 || row >= height || column < 0 || column >= width) return
        const candidate = row * width + column
        if (!isBlock(candidate)) {
          setSelectedCell(candidate)
          return
        }
      }
    },
    [isBlock, puzzle, selectedCell],
  )

  const goToClue = useCallback(
    (clueIndex: number) => {
      const clue = puzzle?.clues[clueIndex]
      if (!clue) return
      setDirection(clue.direction)
      const firstEmpty = clue.cells.find((cell) => !entries[cell])
      setSelectedCell(firstEmpty ?? clue.cells[0])
    },
    [entries, puzzle],
  )

  const stepClue = useCallback(
    (delta: number) => {
      if (activeClueIndex === undefined) return
      const list = direction === 'across' ? clueMaps.acrossClues : clueMaps.downClues
      const position = list.indexOf(activeClueIndex)
      if (position < 0) return
      const nextPosition = position + delta
      if (nextPosition < 0 || nextPosition >= list.length) {
        // Roll over into the other direction's list at the appropriate end.
        const otherList = direction === 'across' ? clueMaps.downClues : clueMaps.acrossClues
        if (otherList.length > 0) goToClue(delta > 0 ? otherList[0] : otherList[otherList.length - 1])
        return
      }
      goToClue(list[nextPosition])
    },
    [activeClueIndex, clueMaps, direction, goToClue],
  )

  // --- Entry ----------------------------------------------------------------

  const clearMark = useCallback((cell: number) => {
    setWrongCells((previous) => {
      if (!previous.has(cell)) return previous
      const next = new Set(previous)
      next.delete(cell)
      return next
    })
    setRevealedCells((previous) => {
      if (!previous.has(cell)) return previous
      const next = new Set(previous)
      next.delete(cell)
      return next
    })
  }, [])

  const advanceWithinWord = useCallback(
    (fromCell: number) => {
      if (!activeCells.length) return
      const position = activeCells.indexOf(fromCell)
      if (position < 0) return
      const nextEmpty = activeCells.slice(position + 1).find((cell) => !entries[cell])
      if (nextEmpty !== undefined) {
        setSelectedCell(nextEmpty)
        return
      }
      if (position + 1 < activeCells.length) setSelectedCell(activeCells[position + 1])
    },
    [activeCells, entries],
  )

  const typeLetter = useCallback(
    (letter: string) => {
      if (!canPlay || isBlock(selectedCell)) return
      const cell = selectedCell
      const nextEntries = entries.map((value, index) => {
        if (index !== cell) return value
        return isRebusActive ? (value + letter) : letter
      })
      setEntries(nextEntries)
      clearMark(cell)

      const nextPencilCells = new Set(pencilCells)
      if (isPencilActive) {
        nextPencilCells.add(cell)
      } else {
        nextPencilCells.delete(cell)
      }
      setPencilCells(nextPencilCells)

      if (!isRebusActive) {
        advanceWithinWord(cell)
      }

      // Detect a completed grid; otherwise autocheck the just-typed cell.
      // Pencil cells are ignored/treated as empty for solve attempts.
      const filledAll = puzzle
        ? nextEntries.every((value, index) => isBlock(index) || (value !== '' && !nextPencilCells.has(index)))
        : false

      stateRef.current.entries = nextEntries
      stateRef.current.pencilCells = nextPencilCells
      if (filledAll) {
        void runCheck('all')
      } else if (stateRef.current.autocheck) {
        void runCheck([cell], { silent: true })
      }
      persist()
    },
    [advanceWithinWord, canPlay, clearMark, entries, isBlock, isPencilActive, isRebusActive, pencilCells, persist, puzzle, runCheck, selectedCell],
  )

  const deleteLetter = useCallback(() => {
    if (!canPlay) return
    const currentValue = entries[selectedCell]
    if (currentValue) {
      const nextValue = isRebusActive ? currentValue.slice(0, -1) : ''
      const nextEntries = entries.map((value, index) => (index === selectedCell ? nextValue : value))
      setEntries(nextEntries)
      clearMark(selectedCell)

      const nextPencilCells = new Set(pencilCells)
      if (!nextValue) nextPencilCells.delete(selectedCell)
      setPencilCells(nextPencilCells)
      stateRef.current.pencilCells = nextPencilCells

      stateRef.current.entries = nextEntries
      persist()
      return
    }
    // Empty cell: step back within the word and clear that one.
    const position = activeCells.indexOf(selectedCell)
    if (position > 0) {
      const previousCell = activeCells[position - 1]
      const nextEntries = entries.map((value, index) => (index === previousCell ? '' : value))
      setEntries(nextEntries)
      setSelectedCell(previousCell)
      clearMark(previousCell)

      const nextPencilCells = new Set(pencilCells)
      nextPencilCells.delete(previousCell)
      setPencilCells(nextPencilCells)
      stateRef.current.pencilCells = nextPencilCells

      stateRef.current.entries = nextEntries
      persist()
    }
  }, [activeCells, canPlay, clearMark, entries, isRebusActive, pencilCells, persist, selectedCell])

  // Physical keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canPlay) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault()
        typeLetter(event.key.toUpperCase())
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        deleteLetter()
      } else if (event.key === ' ' || event.key === 'Tab') {
        event.preventDefault()
        if (event.key === 'Tab') stepClue(event.shiftKey ? -1 : 1)
        else toggleDirection()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (direction !== 'across') setDirection('across')
        else moveStep(0, -1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (direction !== 'across') setDirection('across')
        else moveStep(0, 1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (direction !== 'down') setDirection('down')
        else moveStep(-1, 0)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (direction !== 'down') setDirection('down')
        else moveStep(1, 0)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setIsRebusActive((active) => !active)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (isRebusActive) {
          setIsRebusActive(false)
          advanceWithinWord(selectedCell)
        } else {
          stepClue(1)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canPlay, deleteLetter, direction, moveStep, stepClue, toggleDirection, typeLetter, isRebusActive, selectedCell, advanceWithinWord])

  // --- Check / reveal actions ----------------------------------------------

  const doCheck = useCallback(
    (scope: 'square' | 'word' | 'puzzle') => {
      setCheckMenuOpen(false)
      if (!puzzle) return
      const cells =
        scope === 'square' ? [selectedCell] : scope === 'word' ? activeCells : 'all'
      setChecksUsed((count) => count + 1)
      void runCheck(cells)
    },
    [activeCells, puzzle, runCheck, selectedCell],
  )

  const doReveal = useCallback(
    async (scope: 'square' | 'word' | 'puzzle') => {
      setRevealMenuOpen(false)
      if (!puzzle) return
      const answers = await loadSolution(puzzle.date)
      if (!answers) {
        showToast('Could not reveal')
        return
      }
      const targets =
        scope === 'square'
          ? [selectedCell]
          : scope === 'word'
            ? activeCells
            : rangeOpenCells(puzzle)
      const nextEntries = entries.slice()
      const nextRevealed = new Set(revealedCells)
      const nextPencilCells = new Set(pencilCells)
      targets.forEach((cell) => {
        if (isBlock(cell)) return
        nextEntries[cell] = answers[cell] ?? ''
        nextRevealed.add(cell)
        nextPencilCells.delete(cell)
      })
      setEntries(nextEntries)
      setRevealedCells(nextRevealed)
      setPencilCells(nextPencilCells)
      stateRef.current.pencilCells = nextPencilCells
      setWrongCells((previous) => {
        const next = new Set(previous)
        targets.forEach((cell) => next.delete(cell))
        return next
      })
      const reveals = revealsUsed + 1
      setRevealsUsed(reveals)
      stateRef.current.entries = nextEntries
      stateRef.current.revealsUsed = reveals

      const solved = nextEntries.every(
        (value, index) => isBlock(index) || value === (answers[index] ?? ''),
      )
      if (solved) void finishAsSolved(nextEntries, true)
      else persist()
    },
    [
      activeCells,
      entries,
      finishAsSolved,
      isBlock,
      loadSolution,
      pencilCells,
      persist,
      puzzle,
      revealedCells,
      revealsUsed,
      selectedCell,
      showToast,
    ],
  )

  const doClear = useCallback(
    async (scope: 'incomplete' | 'word' | 'puzzle' | 'puzzle-timer') => {
      setClearMenuOpen(false)
      if (!puzzle || isComplete) return

      if (scope === 'incomplete') {
        const incorrect = await runCheck('all', { silent: true })
        if (incorrect) {
          const nextEntries = entries.map((value, index) => incorrect.has(index) ? '' : value)
          setEntries(nextEntries)
          setWrongCells((previous) => {
            const next = new Set(previous)
            incorrect.forEach((cell) => next.delete(cell))
            return next
          })
          stateRef.current.entries = nextEntries
          persist()
        }
      } else if (scope === 'word') {
        const nextEntries = entries.map((value, index) =>
          activeCells.includes(index) && !revealedCells.has(index) ? '' : value
        )
        setEntries(nextEntries)
        setWrongCells((previous) => {
          const next = new Set(previous)
          activeCells.forEach((cell) => next.delete(cell))
          return next
        })
        const nextPencilCells = new Set(pencilCells)
        activeCells.forEach((cell) => nextPencilCells.delete(cell))
        setPencilCells(nextPencilCells)
        stateRef.current.pencilCells = nextPencilCells
        stateRef.current.entries = nextEntries
        persist()
      } else if (scope === 'puzzle' || scope === 'puzzle-timer') {
        const nextEntries = entries.map((value, index) => revealedCells.has(index) ? value : '')
        setEntries(nextEntries)
        setWrongCells(new Set())
        setPencilCells(new Set())
        stateRef.current.pencilCells = new Set()
        if (scope === 'puzzle-timer') {
          setElapsedSeconds(0)
          stateRef.current.elapsedSeconds = 0
        }
        stateRef.current.entries = nextEntries
        persist()
      }
    },
    [activeCells, entries, isComplete, pencilCells, persist, puzzle, revealedCells, runCheck],
  )

  const toggleAutocheck = useCallback(() => {
    setAutocheck((previous) => {
      const next = !previous
      stateRef.current.autocheck = next
      if (next) void runCheck('all', { silent: true })
      else setWrongCells(new Set())
      return next
    })
  }, [runCheck])

  // --- Render ---------------------------------------------------------------

  const cellNumbers = useMemo(() => {
    const map = new Map<number, string>()
    puzzle?.cells.forEach((cell, index) => {
      if (cell && cell.label) map.set(index, cell.label)
    })
    return map
  }, [puzzle])

  if (puzzleError) {
    return (
      <main className="game-page game-page--crossword" aria-label={`${gameName} game`}>
        <section className="game-panel crossword-panel">
          <div className="game-error">
            <span>{puzzleError}</span>
            <button className="game-secondary-button" onClick={() => void loadPuzzle()} type="button">
              Retry
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (!puzzle) {
    return (
      <main className="game-page game-page--crossword" aria-label={`${gameName} game`}>
        <section className="game-panel crossword-panel">
          <p className="game-loading">Loading {gameName}...</p>
        </section>
      </main>
    )
  }

  const activeClueLabel = activeClue ? `${activeClue.label}${activeClue.direction === 'across' ? 'A' : 'D'}` : ''

  return (
    <main className="game-page game-page--crossword" aria-label={`${gameName} game`}>
      <section className="game-panel crossword-panel">
        <div className="crossword-topbar">
          <div className="crossword-meta">
            {puzzle.title && isRealTitle(puzzle.title) && (
              <span className="crossword-meta__title">
                {puzzle.title}
              </span>
            )}
          </div>
          <div className="crossword-topbar__tools">
            <button
              aria-pressed={autocheck}
              className="crossword-chip"
              onClick={toggleAutocheck}
              type="button"
              disabled={isComplete}
            >
              Autocheck
            </button>
            <div className="crossword-menu-wrap">
              <button
                className="crossword-chip"
                onClick={() => {
                  setCheckMenuOpen((open) => !open)
                  setRevealMenuOpen(false)
                  setClearMenuOpen(false)
                }}
                type="button"
                disabled={isComplete || autocheck}
              >
                Check ▾
              </button>
              {checkMenuOpen && (
                <div className="crossword-menu" role="menu">
                  <button onClick={() => doCheck('square')} role="menuitem" type="button">Square</button>
                  <button onClick={() => doCheck('word')} role="menuitem" type="button">Word</button>
                  <button onClick={() => doCheck('puzzle')} role="menuitem" type="button">Puzzle</button>
                </div>
              )}
            </div>
            <button
              aria-pressed={isRebusActive}
              className="crossword-chip"
              onClick={() => setIsRebusActive((active) => !active)}
              type="button"
              disabled={isComplete}
            >
              Rebus
            </button>
            <div className="crossword-menu-wrap">
              <button
                className="crossword-chip"
                onClick={() => {
                  setClearMenuOpen((open) => !open)
                  setCheckMenuOpen(false)
                  setRevealMenuOpen(false)
                }}
                type="button"
                disabled={isComplete}
              >
                Clear ▾
              </button>
              {clearMenuOpen && (
                <div className="crossword-menu" role="menu">
                  <button onClick={() => void doClear('incomplete')} role="menuitem" type="button">Incomplete</button>
                  <button onClick={() => void doClear('word')} role="menuitem" type="button">Word</button>
                  <button onClick={() => void doClear('puzzle')} role="menuitem" type="button">Puzzle</button>
                  <button onClick={() => void doClear('puzzle-timer')} role="menuitem" type="button">Puzzle & Timer</button>
                </div>
              )}
            </div>
            <div className="crossword-menu-wrap">
              <button
                className="crossword-chip"
                onClick={() => {
                  setRevealMenuOpen((open) => !open)
                  setCheckMenuOpen(false)
                  setClearMenuOpen(false)
                }}
                type="button"
                disabled={isComplete}
              >
                Reveal ▾
              </button>
              {revealMenuOpen && (
                <div className="crossword-menu" role="menu">
                  <button onClick={() => void doReveal('square')} role="menuitem" type="button">Square</button>
                  <button onClick={() => void doReveal('word')} role="menuitem" type="button">Word</button>
                  <button onClick={() => void doReveal('puzzle')} role="menuitem" type="button">Puzzle</button>
                </div>
              )}
            </div>
          </div>
          <span className="crossword-timer" aria-label="Elapsed time">{formatTimer(elapsedSeconds)}</span>
        </div>

        <div
          className="crossword-board"
          role="grid"
          aria-label="Crossword grid"
          style={{ gridTemplateColumns: `repeat(${puzzle.width}, 1fr)` }}
        >
          {puzzle.cells.map((cell, index) => {
            if (cell === null) {
              return <div className="crossword-cell crossword-cell--block" key={index} aria-hidden="true" />
            }
            const isSelected = index === selectedCell
            const inActiveWord = activeCellSet.has(index)
            const value = entries[index] ?? ''
            return (
              <button
                key={index}
                className={[
                  'crossword-cell',
                  isSelected ? 'crossword-cell--selected' : '',
                  isSelected && isRebusActive ? 'crossword-cell--rebus' : '',
                  !isSelected && inActiveWord ? 'crossword-cell--highlight' : '',
                  wrongCells.has(index) ? 'crossword-cell--wrong' : '',
                  revealedCells.has(index) ? 'crossword-cell--revealed' : '',
                  value.length > 1 ? 'crossword-cell--has-rebus' : '',
                  pencilCells.has(index) ? 'crossword-cell--pencil' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => selectCell(index)}
                type="button"
                role="gridcell"
                aria-label={`Cell ${Math.floor(index / puzzle.width) + 1}, ${(index % puzzle.width) + 1}${value ? `, ${value}` : ''}`}
              >
                {cellNumbers.has(index) && (
                  <span className="crossword-cell__number">{cellNumbers.get(index)}</span>
                )}
                <span className="crossword-cell__letter">{value}</span>
              </button>
            )
          })}
        </div>

        {activeClue && (
          <div className="crossword-clue-bar">
            <button className="crossword-clue-bar__nav" onClick={() => stepClue(-1)} type="button" aria-label="Previous clue">‹</button>
            <button
              className="crossword-clue-bar__text"
              onClick={toggleDirection}
              type="button"
            >
              <strong>{activeClueLabel}</strong>
              <span>{activeClue.text}</span>
            </button>
            <button className="crossword-clue-bar__nav" onClick={() => stepClue(1)} type="button" aria-label="Next clue">›</button>
          </div>
        )}

        {!isComplete && (
          <div className="crossword-keyboard" aria-label="Keyboard">
            {KEYBOARD_ROWS.map((row, rowIndex) => (
              <div className="crossword-keyboard__row" key={rowIndex}>
                {row.map((key) =>
                  key === 'Backspace' ? (
                    <button
                      key={key}
                      className="crossword-key crossword-key--wide"
                      onClick={deleteLetter}
                      type="button"
                      aria-label="Backspace"
                    >
                      ⌫
                    </button>
                  ) : key === 'Enter' ? (
                    <button
                      key={key}
                      className="crossword-key crossword-key--wide crossword-key--enter"
                      onClick={() => stepClue(1)}
                      type="button"
                      aria-label="Enter"
                    >
                      ENTER
                    </button>
                  ) : (
                    <button
                      key={key}
                      className="crossword-key"
                      onClick={() => typeLetter(key)}
                      type="button"
                    >
                      {key}
                    </button>
                  ),
                )}
              </div>
            ))}
          </div>
        )}

        <div className="crossword-actions">
          <button
            className="crossword-clue-toggle"
            onClick={() => setShowClueList((open) => !open)}
            type="button"
          >
            {showClueList ? 'Hide clues' : 'All clues'}
          </button>

          {!isComplete && (
            <button
              className="crossword-pencil-toggle"
              onClick={() => setIsPencilActive((active) => !active)}
              type="button"
              aria-pressed={isPencilActive}
              aria-label="Pencil"
            >
              ✏️
            </button>
          )}
        </div>

        {isComplete && (
          <div className="crossword-complete">
            <strong>{revealsUsed > 0 ? 'Revealed' : 'Solved!'}</strong>
            <p>
              {formatTimer(elapsedSeconds)} · {checksUsed} check{checksUsed === 1 ? '' : 's'} ·{' '}
              {revealsUsed} reveal{revealsUsed === 1 ? '' : 's'}
            </p>
          </div>
        )}

        {showClueList && (
          <div className="crossword-clue-lists">
            <ClueColumn
              title="Across"
              clueIndices={clueMaps.acrossClues}
              clues={puzzle.clues}
              activeClueIndex={activeClueIndex}
              onSelect={goToClue}
            />
            <ClueColumn
              title="Down"
              clueIndices={clueMaps.downClues}
              clues={puzzle.clues}
              activeClueIndex={activeClueIndex}
              onSelect={goToClue}
            />
          </div>
        )}
        {puzzle.author && (
          <p className="crossword-credit">
            Author: {puzzle.author}
          </p>
        )}
      </section>
    </main>
  )
}

function ClueColumn({
  title,
  clueIndices,
  clues,
  activeClueIndex,
  onSelect,
}: {
  title: string
  clueIndices: number[]
  clues: CrosswordClue[]
  activeClueIndex: number | undefined
  onSelect: (clueIndex: number) => void
}) {
  return (
    <div className="crossword-clue-column">
      <h4>{title}</h4>
      <ul>
        {clueIndices.map((clueIndex) => {
          const clue = clues[clueIndex]
          return (
            <li key={clueIndex}>
              <button
                className={activeClueIndex === clueIndex ? 'crossword-clue-item crossword-clue-item--active' : 'crossword-clue-item'}
                onClick={() => onSelect(clueIndex)}
                type="button"
              >
                <span className="crossword-clue-item__label">{clue.label}</span>
                <span>{clue.text}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function scopeCells(scope: number[] | 'all', cellCount: number): number[] {
  if (scope === 'all') return Array.from({ length: cellCount }, (_, index) => index)
  return scope
}

function rangeOpenCells(puzzle: CrosswordPuzzle): number[] {
  const open: number[] = []
  puzzle.cells.forEach((cell, index) => {
    if (cell !== null) open.push(index)
  })
  return open
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function isRealTitle(title: string | undefined): boolean {
  if (!title) return false
  const upper = title.toUpperCase()
  if (upper.includes('NY TIMES') || upper.includes('NYTIMES') || upper.includes('NEW YORK TIMES')) {
    return false
  }
  return true
}

