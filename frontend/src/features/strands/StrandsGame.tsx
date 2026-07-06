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
  StrandsCoord,
  StrandsGuessResponse,
  StrandsPuzzle,
} from '../../types'

type StrandsSolution = {
  themeWords: string[]
  spangram: string
  themePaths: Record<string, StrandsCoord[]>
  spangramPath: StrandsCoord[]
}

export function StrandsGame({
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
  const [puzzle, setPuzzle] = useState<StrandsPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [selectedPath, setSelectedPath] = useState<StrandsCoord[]>([])
  const [foundThemeWords, setFoundThemeWords] = useState<string[]>([])
  const [foundSpangram, setFoundSpangram] = useState('')
  const [foundBonusWords, setFoundBonusWords] = useState<string[]>([])
  const [foundPaths, setFoundPaths] = useState<Record<string, StrandsCoord[]>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [dashboard, setDashboard] = useState<MultigameDashboard | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const startedAtRef = useRef(Date.now())

  const selectedWord = selectedPath
    .map(([row, column]) => puzzle?.board[row]?.[column] ?? '')
    .join('')
  const foundCellKinds = useMemo(() => {
    const cells: Record<string, 'theme' | 'spangram'> = {}
    Object.entries(foundPaths).forEach(([word, path]) => {
      const kind = word === foundSpangram ? 'spangram' : 'theme'
      path.forEach(([row, column]) => {
        cells[coordKey(row, column)] = kind
      })
    })
    return cells
  }, [foundPaths, foundSpangram])

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

  const loadPuzzle = useCallback(async () => {
    setPuzzleError('')
    setSelectedPath([])
    setFoundThemeWords([])
    setFoundSpangram('')
    setFoundBonusWords([])
    setFoundPaths({})
    setIsComplete(false)
    startedAtRef.current = Date.now()

    try {
      setPuzzle(await requestJson<StrandsPuzzle>('/api/games/strands/today', { cache: 'no-store' }))
    } catch (error) {
      setPuzzleError(error instanceof Error ? error.message : 'Could not load Strands')
    }
  }, [])

  useEffect(() => {
    void loadPuzzle()
  }, [loadPuzzle])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const saveResult = useCallback(
    async (
      outcome: 'won' | 'lost',
      nextThemeWords: string[],
      nextSpangram: string,
      nextBonusWords: string[],
    ) => {
      if (!puzzle) return

      try {
        await saveAdditionalGameResult({
          accessState,
          clientSessionId,
          date: puzzle.date,
          elapsedSeconds: getElapsedSeconds(startedAtRef.current),
          gameKey: 'strands',
          outcome,
          requestWithSessionRecovery,
          score: {
            bonusWords: nextBonusWords,
            foundSpangram: Boolean(nextSpangram),
            foundThemeWords: nextThemeWords,
          },
          variant: 'daily',
        })
        void loadHistory()
      } catch (error) {
        console.warn('Could not save Strands result', error)
        showToast(error instanceof Error ? error.message : 'Could not save result')
      }
    },
    [accessState, clientSessionId, loadHistory, puzzle, requestWithSessionRecovery, showToast],
  )

  const revealSolution = useCallback(async () => {
    if (!puzzle) return

    try {
      const solution = await requestJson<StrandsSolution>('/api/games/strands/reveal', {
        body: JSON.stringify({ date: puzzle.date }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      setFoundThemeWords(solution.themeWords)
      setFoundSpangram(solution.spangram)
      setFoundPaths({ ...solution.themePaths, [solution.spangram]: solution.spangramPath })
      setSelectedPath([])
      setIsComplete(true)
      await saveResult('lost', solution.themeWords, solution.spangram, foundBonusWords)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not reveal Strands')
    }
  }, [foundBonusWords, puzzle, saveResult, showToast])

  const selectCell = (row: number, column: number) => {
    if (isComplete || !puzzle) return

    setSelectedPath((previousPath) => {
      const clicked: StrandsCoord = [row, column]
      const clickedKey = coordKey(row, column)
      const last = previousPath.at(-1)
      if (last && coordKey(last[0], last[1]) === clickedKey) {
        return previousPath.slice(0, -1)
      }
      if (previousPath.some(([pathRow, pathColumn]) => coordKey(pathRow, pathColumn) === clickedKey)) {
        return [clicked]
      }
      if (!last || areAdjacent(last, clicked)) {
        return [...previousPath, clicked]
      }
      return [clicked]
    })
  }

  const submitSelection = async () => {
    if (!puzzle || selectedPath.length < 4 || isSubmitting || isComplete) return

    setIsSubmitting(true)
    try {
      const response = await requestJson<StrandsGuessResponse>('/api/games/strands/guess', {
        body: JSON.stringify({ date: puzzle.date, path: selectedPath }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })

      if (!response.valid) {
        showToast('Not in word list')
        setSelectedPath([])
        return
      }

      if (response.kind === 'bonus') {
        if (!foundBonusWords.includes(response.word)) {
          setFoundBonusWords((words) => [...words, response.word])
          showToast('Bonus word')
        }
        setSelectedPath([])
        return
      }

      const responsePath = response.path ?? selectedPath
      const nextPaths = { ...foundPaths, [response.word]: responsePath }
      setFoundPaths(nextPaths)
      setSelectedPath([])

      if (response.kind === 'spangram') {
        setFoundSpangram(response.word)
        showToast('Spangram')
      } else {
        setFoundThemeWords((words) => {
          if (words.includes(response.word)) return words
          return [...words, response.word].sort()
        })
        showToast('Theme word')
      }

      const nextThemeWords =
        response.kind === 'theme' && !foundThemeWords.includes(response.word)
          ? [...foundThemeWords, response.word].sort()
          : foundThemeWords
      const nextSpangram = response.kind === 'spangram' ? response.word : foundSpangram
      if (nextThemeWords.length === puzzle.themeWordCount && nextSpangram) {
        setIsComplete(true)
        await saveResult('won', nextThemeWords, nextSpangram, foundBonusWords)
        showToast('Strands solved', 1800)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not check word')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="game-page game-page--strands" aria-label="Strands game">
      <section className="game-panel strands-panel">
        <div className="game-kicker">Strands</div>
        <h2>{puzzle?.clue ?? 'Find the theme words'}</h2>
        <p className="game-subtitle">
          Trace adjacent letters. Find every theme word and the spangram.
        </p>

        {puzzleError && (
          <div className="game-error">
            <span>{puzzleError}</span>
            <button className="game-secondary-button" onClick={() => void loadPuzzle()} type="button">
              Retry
            </button>
          </div>
        )}

        {!puzzle && !puzzleError && <p className="game-loading">Loading Strands...</p>}

        {puzzle && (
          <>
            <div className="strands-progress">
              <span>{foundThemeWords.length}/{puzzle.themeWordCount} theme</span>
              <span>{foundSpangram ? 'Spangram found' : `${puzzle.spangramLength}-letter spangram`}</span>
              <span>{foundBonusWords.length} bonus</span>
            </div>

            <div className="strands-board">
              {puzzle.board.map((rowText, row) =>
                rowText.split('').map((letter, column) => {
                  const key = coordKey(row, column)
                  const isSelected = selectedPath.some(
                    ([selectedRow, selectedColumn]) =>
                      coordKey(selectedRow, selectedColumn) === key,
                  )
                  const foundKind = foundCellKinds[key]
                  return (
                    <button
                      className={[
                        'strands-cell',
                        isSelected ? 'strands-cell--selected' : '',
                        foundKind ? `strands-cell--${foundKind}` : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      key={key}
                      onClick={() => selectCell(row, column)}
                      type="button"
                    >
                      {letter}
                    </button>
                  )
                }),
              )}
            </div>

            <div className="strands-current-word" aria-live="polite">
              {selectedWord || 'Select letters'}
            </div>

            <div className="game-actions">
              <button className="game-secondary-button" onClick={() => setSelectedPath([])} type="button">
                Clear
              </button>
              <button className="game-secondary-button" disabled={isComplete} onClick={() => void revealSolution()} type="button">
                Reveal
              </button>
              <button
                className="game-primary-button"
                disabled={selectedPath.length < 4 || isSubmitting || isComplete}
                onClick={() => void submitSelection()}
                type="button"
              >
                Submit
              </button>
            </div>
          </>
        )}
      </section>

      {accessState?.kind === 'friends-family' && (
        <GameHistoryPanel
          dashboard={dashboard}
          error={historyError}
          gameKey="strands"
          isLoading={isHistoryLoading}
          onReload={() => void loadHistory()}
        />
      )}
    </main>
  )
}

function coordKey(row: number, column: number) {
  return `${row}:${column}`
}

function areAdjacent(first: StrandsCoord, second: StrandsCoord) {
  return Math.max(Math.abs(first[0] - second[0]), Math.abs(first[1] - second[1])) <= 1
}
