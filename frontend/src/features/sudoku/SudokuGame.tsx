import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GameHistoryPanel } from '../games/GameHistoryPanel'
import {
  getElapsedSeconds,
  loadAdditionalGameStats,
  saveAdditionalGameResult,
  type SessionRequest,
} from '../games/game-utils'
import { requestJson } from '../../lib/api'
import type {
  AccessState,
  MultigameDashboard,
  SudokuCheckResponse,
  SudokuDifficulty,
  SudokuPuzzle,
} from '../../types'

const difficulties: SudokuDifficulty[] = ['easy', 'medium', 'hard']

export function SudokuGame({
  accessState,
  clientSessionId,
  requestWithSessionRecovery,
  showToast,
}: {
  accessState: AccessState | null
  clientSessionId: string
  requestWithSessionRecovery: SessionRequest
  showToast: (message: string, durationMs?: number) => void
}) {
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>('medium')
  const [puzzle, setPuzzle] = useState<SudokuPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [grid, setGrid] = useState<(number | null)[]>(Array(81).fill(null))
  const [selectedCell, setSelectedCell] = useState(0)
  const [mistakes, setMistakes] = useState<number[]>([])
  const [isComplete, setIsComplete] = useState(false)
  const [dashboard, setDashboard] = useState<MultigameDashboard | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const startedAtRef = useRef(Date.now())

  const givenCells = useMemo(
    () => new Set(puzzle?.puzzle.map((value, index) => (value ? index : -1)).filter((index) => index >= 0) ?? []),
    [puzzle],
  )
  const selectedValue = grid[selectedCell]

  const loadHistory = useCallback(async () => {
    if (accessState?.kind !== 'friends-family') {
      setDashboard(null)
      setHistoryError('')
      return
    }

    setIsHistoryLoading(true)
    setHistoryError('')
    try {
      setDashboard(
        await loadAdditionalGameStats({
          accessState,
          clientSessionId,
          requestWithSessionRecovery,
        }),
      )
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Could not load game history')
    } finally {
      setIsHistoryLoading(false)
    }
  }, [accessState, clientSessionId, requestWithSessionRecovery])

  const loadPuzzle = useCallback(async (nextDifficulty: SudokuDifficulty) => {
    setPuzzleError('')
    setMistakes([])
    setIsComplete(false)
    startedAtRef.current = Date.now()

    try {
      const response = await requestJson<SudokuPuzzle>(
        `/api/games/sudoku/today?difficulty=${nextDifficulty}`,
        { cache: 'no-store' },
      )
      setPuzzle(response)
      setGrid(response.puzzle.map((value) => (value ? value : null)))
      const firstEmptyCell = response.puzzle.findIndex((value) => value === 0)
      setSelectedCell(firstEmptyCell >= 0 ? firstEmptyCell : 0)
    } catch (error) {
      setPuzzleError(error instanceof Error ? error.message : 'Could not load Sudoku')
    }
  }, [])

  useEffect(() => {
    void loadPuzzle(difficulty)
  }, [difficulty, loadPuzzle])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const enterValue = useCallback(
    (value: number | null) => {
      if (isComplete || givenCells.has(selectedCell)) return

      setGrid((previousGrid) =>
        previousGrid.map((cellValue, index) => (index === selectedCell ? value : cellValue)),
      )
      setMistakes((previousMistakes) =>
        previousMistakes.filter((mistakeIndex) => mistakeIndex !== selectedCell),
      )
    },
    [givenCells, isComplete, selectedCell],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (/^[1-9]$/.test(event.key)) {
        enterValue(Number(event.key))
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        enterValue(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enterValue])

  const checkGrid = async () => {
    if (!puzzle || isComplete) return

    try {
      const response = await requestJson<SudokuCheckResponse>('/api/games/sudoku/check', {
        body: JSON.stringify({
          date: puzzle.date,
          difficulty,
          grid,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      setMistakes(response.mistakes)

      if (!response.complete) {
        showToast('Keep going')
        return
      }
      if (!response.solved) {
        showToast('Some cells are incorrect')
        return
      }

      setIsComplete(true)
      await saveAdditionalGameResult({
        accessState,
        clientSessionId,
        date: puzzle.date,
        elapsedSeconds: getElapsedSeconds(startedAtRef.current),
        gameKey: 'sudoku',
        outcome: 'won',
        requestWithSessionRecovery,
        score: { grid },
        variant: difficulty,
      })
      void loadHistory()
      showToast('Sudoku solved', 1800)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not check Sudoku')
    }
  }

  return (
    <main className="game-page game-page--sudoku" aria-label="Sudoku game">
      <section className="game-panel sudoku-panel">
        <div className="game-kicker">Sudoku</div>
        <h2>Fill every row, column, and box</h2>
        <p className="game-subtitle">Use each number once in every row, column, and 3x3 box.</p>

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
            <div className="sudoku-board" aria-label={`${capitalize(difficulty)} Sudoku board`}>
              {grid.map((value, index) => {
                const isGiven = givenCells.has(index)
                const row = Math.floor(index / 9)
                const column = index % 9
                const selectedRow = Math.floor(selectedCell / 9)
                const selectedColumn = selectedCell % 9
                const isPeer = row === selectedRow || column === selectedColumn || getBox(row, column) === getBox(selectedRow, selectedColumn)
                const isSameValue = value !== null && selectedValue === value
                return (
                  <button
                    className={[
                      'sudoku-cell',
                      isGiven ? 'sudoku-cell--given' : '',
                      selectedCell === index ? 'sudoku-cell--selected' : '',
                      isPeer ? 'sudoku-cell--peer' : '',
                      isSameValue ? 'sudoku-cell--same' : '',
                      mistakes.includes(index) ? 'sudoku-cell--mistake' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    key={index}
                    onClick={() => setSelectedCell(index)}
                    type="button"
                  >
                    {value ?? ''}
                  </button>
                )
              })}
            </div>

            <div className="sudoku-keypad" aria-label="Sudoku number pad">
              {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
                <button key={value} onClick={() => enterValue(value)} type="button">
                  {value}
                </button>
              ))}
            </div>

            <div className="game-actions">
              <button className="game-secondary-button" onClick={() => enterValue(null)} type="button">
                Erase
              </button>
              <button className="game-primary-button" disabled={isComplete} onClick={() => void checkGrid()} type="button">
                Check
              </button>
            </div>
          </>
        )}
      </section>

      {accessState?.kind === 'friends-family' && (
        <GameHistoryPanel
          dashboard={dashboard}
          error={historyError}
          gameKey="sudoku"
          isLoading={isHistoryLoading}
          onReload={() => void loadHistory()}
        />
      )}
    </main>
  )
}

function getBox(row: number, column: number) {
  return Math.floor(row / 3) * 3 + Math.floor(column / 3)
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
