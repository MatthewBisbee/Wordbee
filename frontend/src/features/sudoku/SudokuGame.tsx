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
import type {
  AccessState,
  MultigameCompleteHandler,
  MultigameCompletionResult,
  SudokuCheckResponse,
  SudokuDifficulty,
  SudokuPuzzle,
} from '../../types'

const difficulties: SudokuDifficulty[] = ['easy', 'medium', 'hard']
const MAX_HISTORY = 80

type Grid = (number | null)[]
type Notes = number[][]

type SudokuAttemptState = {
  grid: Grid
  notes: Notes
  selectedCell: number
  elapsedSeconds: number
  hintsUsed: number
  mistakes: number
}

type HistorySnapshot = { grid: Grid; notes: Notes }

export function SudokuGame({
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
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>('medium')
  const [puzzle, setPuzzle] = useState<SudokuPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [grid, setGrid] = useState<Grid>(() => Array(81).fill(null))
  const [notes, setNotes] = useState<Notes>(createEmptyNotes)
  const [selectedCell, setSelectedCell] = useState(0)
  const [isNotesMode, setIsNotesMode] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [hintsUsed, setHintsUsed] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const historyRef = useRef<HistorySnapshot[]>([])
  const mistakeCountRef = useRef(0)
  const [canUndo, setCanUndo] = useState(false)

  const givenCells = useMemo(
    () =>
      new Set(
        puzzle?.puzzle.map((value, index) => (value ? index : -1)).filter((index) => index >= 0) ??
          [],
      ),
    [puzzle],
  )
  const selectedValue = grid[selectedCell]
  const conflicts = useMemo(() => computeConflicts(grid), [grid])
  const valueCounts = useMemo(() => {
    const counts = Array(10).fill(0)
    grid.forEach((value) => {
      if (value) counts[value] += 1
    })
    return counts
  }, [grid])
  const remainingCells = useMemo(() => grid.filter((value) => value === null).length, [grid])

  // Timer ticks while a loaded board is unsolved.
  useEffect(() => {
    if (!puzzle || isComplete) return
    const interval = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(interval)
  }, [puzzle, isComplete])

  const saveAttempt = useCallback(
    (nextGrid: Grid, nextNotes: Notes, nextSelectedCell: number, nextHints: number) => {
      if (!puzzle) return
      const state: SudokuAttemptState = {
        grid: nextGrid,
        notes: nextNotes,
        selectedCell: nextSelectedCell,
        elapsedSeconds,
        hintsUsed: nextHints,
        mistakes: mistakeCountRef.current,
      }

      if (accessState?.kind === 'friends-family') {
        void saveAdditionalGameAttempt({
          accessState,
          clientSessionId,
          date: puzzle.date,
          gameKey: 'sudoku',
          requestWithSessionRecovery,
          state,
          variant: difficulty,
        }).catch((error) => console.warn('Could not save Sudoku attempt', error))
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'sudoku',
            kind: 'attempt',
            variant: difficulty,
          }),
          state,
        )
      }
    },
    [accessState, clientSessionId, difficulty, elapsedSeconds, puzzle, requestWithSessionRecovery],
  )

  const loadPuzzle = useCallback(
    async (nextDifficulty: SudokuDifficulty) => {
      onGameReset()
      setPuzzleError('')
      setIsComplete(false)
      setIsNotesMode(false)
      setHintsUsed(0)
      setElapsedSeconds(0)
      historyRef.current = []
      mistakeCountRef.current = 0
      setCanUndo(false)

      try {
        const response = await requestJson<SudokuPuzzle>(
          `/api/games/sudoku/today?difficulty=${nextDifficulty}&date=${encodeURIComponent(requestedDate)}`,
          { cache: 'no-store' },
        )
        setPuzzle(response)
        notifyDateClamp(response, 'sudoku', showToast)
        onResolvedDate(response.date)

        const baseGrid = response.puzzle.map((value) => (value ? value : null))
        const firstEmpty = response.puzzle.findIndex((value) => value === 0)
        const fallbackCell = firstEmpty >= 0 ? firstEmpty : 0

        const applyCompleted = (score: Record<string, unknown>) => {
          const savedGrid = Array.isArray(score.grid)
            ? (score.grid as unknown[]).map((value) => (value ? Number(value) : null))
            : baseGrid
          setGrid(savedGrid)
          setNotes(createEmptyNotes())
          setIsComplete(true)
        }

        const applyAttempt = (state: Partial<SudokuAttemptState>) => {
          setGrid(Array.isArray(state.grid) ? state.grid : baseGrid)
          setNotes(normalizeNotes(state.notes))
          setSelectedCell(Number(state.selectedCell ?? fallbackCell))
          setHintsUsed(Number(state.hintsUsed ?? 0))
          setElapsedSeconds(Number(state.elapsedSeconds ?? 0))
          mistakeCountRef.current = Number(state.mistakes ?? 0)
        }

        const applyFresh = () => {
          setGrid(baseGrid)
          setNotes(createEmptyNotes())
          setSelectedCell(fallbackCell)
        }

        if (accessState?.kind === 'friends-family') {
          const statusResponse = await loadAdditionalGameStatus({
            accessState,
            clientSessionId,
            date: response.date,
            gameKey: 'sudoku',
            requestWithSessionRecovery,
            variant: nextDifficulty,
          })

          if (statusResponse.completed && statusResponse.result) {
            const res = statusResponse.result
            applyCompleted(res.score)
            const stats = await loadStatsForGameUser({
              accessState,
              clientSessionId,
              gameKey: 'sudoku',
              requestWithSessionRecovery,
            })
            onGameLoadedAndComplete(
              {
                outcome: res.outcome,
                elapsedSeconds: res.elapsedSeconds,
                date: res.date,
                variant: res.variant,
                score: res.score,
              },
              stats,
            )
          } else if (statusResponse.attempt) {
            applyAttempt(statusResponse.attempt.state as Partial<SudokuAttemptState>)
          } else {
            applyFresh()
          }
        } else {
          const localResult = loadStoredAdditionalGameValue<MultigameCompletionResult>(
            getAdditionalGameStorageKey({
              date: response.date,
              gameKey: 'sudoku',
              kind: 'result',
              variant: nextDifficulty,
            }),
          )
          if (localResult) {
            applyCompleted(localResult.score)
            onGameLoadedAndComplete(localResult, null)
          } else {
            const localAttempt = loadStoredAdditionalGameValue<Partial<SudokuAttemptState>>(
              getAdditionalGameStorageKey({
                date: response.date,
                gameKey: 'sudoku',
                kind: 'attempt',
                variant: nextDifficulty,
              }),
            )
            if (localAttempt) {
              applyAttempt(localAttempt)
            } else {
              applyFresh()
            }
          }
        }
      } catch (error) {
        setPuzzleError(error instanceof Error ? error.message : 'Could not load Sudoku')
      }
    },
    [
      accessState,
      clientSessionId,
      onGameLoadedAndComplete,
      onGameReset,
      onResolvedDate,
      requestedDate,
      requestWithSessionRecovery,
      showToast,
    ],
  )

  useEffect(() => {
    void loadPuzzle(difficulty)
  }, [difficulty, loadPuzzle])

  const completeSolve = useCallback(
    async (finalGrid: Grid, finalHints: number) => {
      if (!puzzle) return
      try {
        const check = await requestJson<SudokuCheckResponse>('/api/games/sudoku/check', {
          body: JSON.stringify({ date: puzzle.date, difficulty, grid: finalGrid }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        if (!check.solved) {
          if (check.mistakes.length > 0) showToast('Something is off')
          return
        }

        setIsComplete(true)
        // grid is sent for server validation but stripped before storage
        // (everyone's daily grid is identical); only hints/mistakes are logged.
        const completedScore = { grid: finalGrid, hints: finalHints, mistakes: mistakeCountRef.current }
        const completedResult: MultigameCompletionResult = {
          outcome: 'won',
          elapsedSeconds,
          date: puzzle.date,
          variant: difficulty,
          score: completedScore,
        }

        if (accessState?.kind === 'friends-family') {
          try {
            const resultResponse = await saveAdditionalGameResult({
              accessState,
              clientSessionId,
              date: puzzle.date,
              elapsedSeconds,
              gameKey: 'sudoku',
              outcome: 'won',
              requestWithSessionRecovery,
              score: completedScore,
              variant: difficulty,
            })
            const stats = await loadStatsForGameUser({
              accessState,
              clientSessionId,
              gameKey: 'sudoku',
              requestWithSessionRecovery,
            })
            onGameComplete(resultResponse.result ?? completedResult, stats)
          } catch (error) {
            console.warn('Could not save Sudoku result', error)
            showToast(error instanceof Error ? error.message : 'Could not save result')
          }
        } else {
          saveStoredAdditionalGameValue(
            getAdditionalGameStorageKey({
              date: puzzle.date,
              gameKey: 'sudoku',
              kind: 'result',
              variant: difficulty,
            }),
            completedResult,
          )
          clearStoredAdditionalGameValue(
            getAdditionalGameStorageKey({
              date: puzzle.date,
              gameKey: 'sudoku',
              kind: 'attempt',
              variant: difficulty,
            }),
          )
          onGameComplete(completedResult, null)
        }
        showToast('Sudoku solved', 1800)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not check Sudoku')
      }
    },
    [
      accessState,
      clientSessionId,
      difficulty,
      elapsedSeconds,
      onGameComplete,
      puzzle,
      requestWithSessionRecovery,
      showToast,
    ],
  )

  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), { grid, notes }]
    setCanUndo(true)
  }, [grid, notes])

  const undo = useCallback(() => {
    const previous = historyRef.current.pop()
    if (!previous) return
    setGrid(previous.grid)
    setNotes(previous.notes)
    setCanUndo(historyRef.current.length > 0)
    saveAttempt(previous.grid, previous.notes, selectedCell, hintsUsed)
  }, [hintsUsed, saveAttempt, selectedCell])

  const enterValue = useCallback(
    (value: number | null) => {
      if (isComplete || givenCells.has(selectedCell)) return
      pushHistory()

      if (isNotesMode && value !== null) {
        const current = notes[selectedCell]
        const nextCellNotes = current.includes(value)
          ? current.filter((candidate) => candidate !== value)
          : [...current, value].sort((first, second) => first - second)
        const nextNotes = notes.map((cell, index) => (index === selectedCell ? nextCellNotes : cell))
        const nextGrid = grid.map((cell, index) => (index === selectedCell ? null : cell))
        setNotes(nextNotes)
        setGrid(nextGrid)
        saveAttempt(nextGrid, nextNotes, selectedCell, hintsUsed)
        return
      }

      const nextGrid = grid.map((cell, index) => (index === selectedCell ? value : cell))
      // Placing a number clears that cell's pencil marks and removes the value
      // from the pencil marks of its peers, like NYT auto-notes cleanup.
      const peers = value === null ? new Set<number>() : peerSet(selectedCell)
      const nextNotes = notes.map((cell, index) => {
        if (index === selectedCell) return []
        if (value !== null && peers.has(index) && cell.includes(value)) {
          return cell.filter((candidate) => candidate !== value)
        }
        return cell
      })
      if (value !== null && computeConflicts(nextGrid).has(selectedCell)) {
        mistakeCountRef.current += 1
      }
      setGrid(nextGrid)
      setNotes(nextNotes)
      saveAttempt(nextGrid, nextNotes, selectedCell, hintsUsed)

      if (value !== null && nextGrid.every((cell) => cell !== null)) {
        void completeSolve(nextGrid, hintsUsed)
      }
    },
    [
      completeSolve,
      givenCells,
      grid,
      hintsUsed,
      isComplete,
      isNotesMode,
      notes,
      pushHistory,
      saveAttempt,
      selectedCell,
    ],
  )

  const eraseCell = useCallback(() => {
    if (isComplete || givenCells.has(selectedCell)) return
    if (grid[selectedCell] === null && notes[selectedCell].length === 0) return
    pushHistory()
    const nextGrid = grid.map((cell, index) => (index === selectedCell ? null : cell))
    const nextNotes = notes.map((cell, index) => (index === selectedCell ? [] : cell))
    setGrid(nextGrid)
    setNotes(nextNotes)
    saveAttempt(nextGrid, nextNotes, selectedCell, hintsUsed)
  }, [givenCells, grid, hintsUsed, isComplete, notes, pushHistory, saveAttempt, selectedCell])

  const applyHint = useCallback(async () => {
    if (!puzzle || isComplete) return
    const targetCell =
      grid[selectedCell] === null && !givenCells.has(selectedCell)
        ? selectedCell
        : grid.findIndex((value, index) => value === null && !givenCells.has(index))
    if (targetCell < 0) return

    try {
      const hint = await requestJson<{ index: number; value: number }>('/api/games/sudoku/hint', {
        body: JSON.stringify({ cell: targetCell, date: puzzle.date, difficulty }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      pushHistory()
      const nextHints = hintsUsed + 1
      const nextGrid = grid.map((cell, index) => (index === hint.index ? hint.value : cell))
      const nextNotes = notes.map((cell, index) => (index === hint.index ? [] : cell))
      setGrid(nextGrid)
      setNotes(nextNotes)
      setSelectedCell(hint.index)
      setHintsUsed(nextHints)
      saveAttempt(nextGrid, nextNotes, hint.index, nextHints)
      if (nextGrid.every((cell) => cell !== null)) {
        void completeSolve(nextGrid, nextHints)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not get a hint')
    }
  }, [
    completeSolve,
    difficulty,
    givenCells,
    grid,
    hintsUsed,
    isComplete,
    notes,
    puzzle,
    pushHistory,
    saveAttempt,
    selectedCell,
    showToast,
  ])

  const moveSelection = useCallback(
    (rowDelta: number, columnDelta: number) => {
      const row = Math.floor(selectedCell / 9)
      const column = selectedCell % 9
      const nextRow = Math.min(Math.max(row + rowDelta, 0), 8)
      const nextColumn = Math.min(Math.max(column + columnDelta, 0), 8)
      setSelectedCell(nextRow * 9 + nextColumn)
    },
    [selectedCell],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isInputBlocked || isComplete) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault()
        enterValue(Number(event.key))
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        eraseCell()
      } else if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        setIsNotesMode((mode) => !mode)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelection(-1, 0)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelection(1, 0)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveSelection(0, -1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveSelection(0, 1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enterValue, eraseCell, isComplete, isInputBlocked, moveSelection])

  return (
    <main className="game-page game-page--sudoku" aria-label="Sudoku game">
      <section className="game-panel sudoku-panel">
        <div className="sudoku-topbar">
          <div className="sudoku-difficulty" aria-label="Sudoku difficulty">
            {difficulties.map((option) => (
              <button
                aria-pressed={difficulty === option}
                key={option}
                onClick={() => setDifficulty(option)}
                type="button"
              >
                {capitalize(option)}
              </button>
            ))}
          </div>
          <span className="sudoku-timer" aria-label="Elapsed time">
            {formatTimer(elapsedSeconds)}
          </span>
        </div>

        {puzzleError && (
          <div className="game-error">
            <span>{puzzleError}</span>
            <button className="game-secondary-button" onClick={() => void loadPuzzle(difficulty)} type="button">
              Retry
            </button>
          </div>
        )}

        {!puzzle && !puzzleError && <p className="game-loading">Loading Sudoku...</p>}

        {puzzle && (
          <>
            <div className="sudoku-board" role="grid" aria-label="Sudoku board">
              {grid.map((value, index) => {
                const isGiven = givenCells.has(index)
                const isSelected = index === selectedCell
                const isPeer = !isSelected && isSelectedCellPeer(selectedCell, index)
                const isSameValue = value !== null && value === selectedValue && !isSelected
                const isConflict = conflicts.has(index)

                return (
                  <button
                    aria-label={`Cell ${Math.floor(index / 9) + 1}, ${(index % 9) + 1}`}
                    className={[
                      'sudoku-cell',
                      isGiven ? 'sudoku-cell--given' : 'sudoku-cell--entered',
                      isSelected ? 'sudoku-cell--selected' : '',
                      isPeer ? 'sudoku-cell--peer' : '',
                      isSameValue ? 'sudoku-cell--same' : '',
                      isConflict ? 'sudoku-cell--error' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={isComplete}
                    key={index}
                    onClick={() => setSelectedCell(index)}
                    role="gridcell"
                    type="button"
                  >
                    {value !== null ? (
                      value
                    ) : notes[index].length > 0 ? (
                      <span className="sudoku-notes">
                        {Array.from({ length: 9 }, (_, noteIndex) => (
                          <span key={noteIndex}>
                            {notes[index].includes(noteIndex + 1) ? noteIndex + 1 : ''}
                          </span>
                        ))}
                      </span>
                    ) : (
                      ''
                    )}
                  </button>
                )
              })}
            </div>

            <div className="sudoku-tools" aria-label="Sudoku tools">
              <button
                className="sudoku-tool"
                disabled={isComplete || !canUndo}
                onClick={undo}
                type="button"
              >
                <UndoIcon />
                <span>Undo</span>
              </button>
              <button className="sudoku-tool" disabled={isComplete} onClick={eraseCell} type="button">
                <EraseIcon />
                <span>Erase</span>
              </button>
              <button
                aria-pressed={isNotesMode}
                className="sudoku-tool sudoku-tool--toggle"
                disabled={isComplete}
                onClick={() => setIsNotesMode((mode) => !mode)}
                type="button"
              >
                <PencilIcon />
                <span>Notes {isNotesMode ? 'On' : 'Off'}</span>
              </button>
              <button
                className="sudoku-tool"
                disabled={isComplete || remainingCells === 0}
                onClick={() => void applyHint()}
                type="button"
              >
                <HintIcon />
                <span>Hint</span>
              </button>
            </div>

            <div className="sudoku-keypad" aria-label="Number keypad">
              {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
                <button
                  aria-label={`Enter ${value}`}
                  className={[
                    'sudoku-keypad-button',
                    valueCounts[value] >= 9 ? 'sudoku-keypad-button--done' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={isComplete || valueCounts[value] >= 9}
                  key={value}
                  onClick={() => enterValue(value)}
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

function UndoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="sudoku-tool__icon">
      <path
        d="M12.5 8H7.8l1.9-1.9L8.3 4.7 4 9l4.3 4.3 1.4-1.4L7.8 10h4.7a4 4 0 1 1 0 8H7v2h5.5a6 6 0 0 0 0-12Z"
        fill="currentColor"
      />
    </svg>
  )
}

function EraseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="sudoku-tool__icon">
      <path
        d="m16.2 3.3 4.5 4.5c.8.8.8 2 0 2.8l-8 8H18v2H7.5l-4.2-4.2c-.8-.8-.8-2 0-2.8l10-10c.8-.8 2-.8 2.9 0Zm-2.8 3.5-6.4 6.4 3.5 3.5 6.4-6.4-3.5-3.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="sudoku-tool__icon">
      <path
        d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25ZM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.63Z"
        fill="currentColor"
      />
    </svg>
  )
}

function HintIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="sudoku-tool__icon">
      <path
        d="M9 21h6v-1H9v1Zm3-19a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2Z"
        fill="currentColor"
      />
    </svg>
  )
}

function createEmptyNotes(): Notes {
  return Array.from({ length: 81 }, () => [])
}

function normalizeNotes(raw: unknown): Notes {
  if (!Array.isArray(raw) || raw.length !== 81) return createEmptyNotes()
  return raw.map((cell) =>
    Array.isArray(cell)
      ? cell.filter((value): value is number => typeof value === 'number' && value >= 1 && value <= 9)
      : [],
  )
}

function peerSet(cell: number): Set<number> {
  const peers = new Set<number>()
  const row = Math.floor(cell / 9)
  const column = cell % 9
  const boxRow = Math.floor(row / 3) * 3
  const boxColumn = Math.floor(column / 3) * 3
  for (let index = 0; index < 9; index += 1) {
    peers.add(row * 9 + index)
    peers.add(index * 9 + column)
  }
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      peers.add((boxRow + r) * 9 + (boxColumn + c))
    }
  }
  peers.delete(cell)
  return peers
}

function computeConflicts(grid: Grid): Set<number> {
  const conflicts = new Set<number>()
  const units: number[][] = []
  for (let row = 0; row < 9; row += 1) {
    units.push(Array.from({ length: 9 }, (_, column) => row * 9 + column))
  }
  for (let column = 0; column < 9; column += 1) {
    units.push(Array.from({ length: 9 }, (_, row) => row * 9 + column))
  }
  for (let boxRow = 0; boxRow < 3; boxRow += 1) {
    for (let boxColumn = 0; boxColumn < 3; boxColumn += 1) {
      const box: number[] = []
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
          box.push((boxRow * 3 + r) * 9 + (boxColumn * 3 + c))
        }
      }
      units.push(box)
    }
  }

  for (const unit of units) {
    const seen = new Map<number, number[]>()
    for (const index of unit) {
      const value = grid[index]
      if (value === null) continue
      const cells = seen.get(value) ?? []
      cells.push(index)
      seen.set(value, cells)
    }
    for (const cells of seen.values()) {
      if (cells.length > 1) cells.forEach((index) => conflicts.add(index))
    }
  }

  return conflicts
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function isSelectedCellPeer(selected: number, current: number) {
  const selectedRow = Math.floor(selected / 9)
  const selectedCol = selected % 9
  const currentRow = Math.floor(current / 9)
  const currentCol = current % 9

  if (selectedRow === currentRow || selectedCol === currentCol) {
    return true
  }

  const selectedBoxRow = Math.floor(selectedRow / 3) * 3
  const selectedBoxCol = Math.floor(selectedCol / 3) * 3
  const currentBoxRow = Math.floor(currentRow / 3) * 3
  const currentBoxCol = Math.floor(currentCol / 3) * 3

  return selectedBoxRow === currentBoxRow && selectedBoxCol === currentBoxCol
}
