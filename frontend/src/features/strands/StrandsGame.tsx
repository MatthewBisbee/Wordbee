import type { CSSProperties } from 'react'
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

type StrandsAttemptState = {
  foundBonusWords: string[]
  foundPaths: Record<string, StrandsCoord[]>
  foundSpangram: string
  foundThemeWords: string[]
  submittedWords: string[]
  hintsUsed: number
}

export function StrandsGame({
  accessState,
  clientSessionId,
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
  requestedDate: string
  requestWithSessionRecovery: SessionRequest
  showToast: (message: string, durationMs?: number) => void
  onGameComplete: MultigameCompleteHandler
  onGameLoadedAndComplete: MultigameCompleteHandler
  onGameReset: () => void
  onResolvedDate: (date: string) => void
}) {
  const [puzzle, setPuzzle] = useState<StrandsPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [selectedPath, setSelectedPath] = useState<StrandsCoord[]>([])
  const [foundThemeWords, setFoundThemeWords] = useState<string[]>([])
  const [foundSpangram, setFoundSpangram] = useState('')
  const [foundBonusWords, setFoundBonusWords] = useState<string[]>([])
  const [foundPaths, setFoundPaths] = useState<Record<string, StrandsCoord[]>>({})
  const [submittedWords, setSubmittedWords] = useState<string[]>([])
  const [celebratingKeys, setCelebratingKeys] = useState<string[]>([])
  const [celebrateKind, setCelebrateKind] = useState<'theme' | 'spangram'>('theme')
  const [hintCells, setHintCells] = useState<string[]>([])
  const [hintsUsed, setHintsUsed] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const startedAtRef = useRef(Date.now())

  // Charging animation state for the Hint button
  const [animateCharge, setAnimateCharge] = useState(false)
  const prevBonusCountRef = useRef(0)

  useEffect(() => {
    // Only animate if the count increases and it's not the initial mount
    if (foundBonusWords.length > 0 && prevBonusCountRef.current > 0 && foundBonusWords.length > prevBonusCountRef.current) {
      setAnimateCharge(true)
      const timer = setTimeout(() => setAnimateCharge(false), 600)
      return () => clearTimeout(timer)
    }
    prevBonusCountRef.current = foundBonusWords.length
  }, [foundBonusWords.length])

  // SVG drawing state
  const [cellCenters, setCellCenters] = useState<Record<string, { x: number; y: number }>>({})
  const boardRef = useRef<HTMLDivElement | null>(null)

  const isDraggingRef = useRef(false)
  const hasDraggedRef = useRef(false)
  const selectedPathRef = useRef<StrandsCoord[]>([])

  const selectedWord = selectedPath
    .map(([row, column]) => puzzle?.board[row]?.[column] ?? '')
    .join('')
  const spangramKey = foundSpangram.toUpperCase()
  const foundCellKinds = useMemo(() => {
    const cells: Record<string, 'theme' | 'spangram'> = {}
    Object.entries(foundPaths).forEach(([word, path]) => {
      const kind = word.toUpperCase() === spangramKey ? 'spangram' : 'theme'
      path.forEach(([row, column]) => {
        cells[coordKey(row, column)] = kind
      })
    })
    return cells
  }, [foundPaths, spangramKey])

  const updateCenters = useCallback(() => {
    if (!boardRef.current) return
    const buttons = boardRef.current.querySelectorAll('.strands-cell')
    const newCenters: Record<string, { x: number; y: number }> = {}
    buttons.forEach((btn) => {
      const r = btn.getAttribute('data-row')
      const c = btn.getAttribute('data-col')
      if (r !== null && c !== null) {
        const htmlBtn = btn as HTMLButtonElement
        const x = htmlBtn.offsetLeft + htmlBtn.offsetWidth / 2
        const y = htmlBtn.offsetTop + htmlBtn.offsetHeight / 2
        newCenters[`${r}:${c}`] = { x, y }
      }
    })
    setCellCenters(newCenters)
  }, [])

  const updateSelectedPath = useCallback(
    (updater: (previousPath: StrandsCoord[]) => StrandsCoord[]) => {
      setSelectedPath((previousPath) => {
        const nextPath = updater(previousPath)
        selectedPathRef.current = nextPath
        return nextPath
      })
    },
    [],
  )

  useEffect(() => {
    updateCenters()
    window.addEventListener('resize', updateCenters)
    return () => window.removeEventListener('resize', updateCenters)
  }, [updateCenters, puzzle])

  const saveAttempt = useCallback(
    async (
      nextThemeWords: string[],
      nextSpangram: string,
      nextBonusWords: string[],
      nextPaths: Record<string, StrandsCoord[]>,
      nextSubmittedWords: string[],
    ) => {
      if (!puzzle) return

      const state: StrandsAttemptState = {
        foundBonusWords: nextBonusWords,
        foundPaths: nextPaths,
        foundSpangram: nextSpangram,
        foundThemeWords: nextThemeWords,
        submittedWords: nextSubmittedWords,
        hintsUsed,
      }

      if (accessState?.kind === 'friends-family') {
        try {
          await saveAdditionalGameAttempt({
            accessState,
              clientSessionId,
            date: puzzle.date,
            gameKey: 'strands',
            requestWithSessionRecovery,
            state,
            variant: 'daily',
          })
        } catch (error) {
          console.warn('Could not save Strands attempt', error)
        }
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'strands',
            kind: 'attempt',
            variant: 'daily',
          }),
          state,
        )
      }
    },
    [accessState, clientSessionId, hintsUsed, puzzle, requestWithSessionRecovery],
  )

  const saveResult = useCallback(
    async (
      outcome: 'won' | 'lost',
      nextThemeWords: string[],
      nextSpangram: string,
      nextBonusWords: string[],
      nextPaths: Record<string, StrandsCoord[]>,
      nextSubmittedWords: string[],
      revealed = false,
    ) => {
      if (!puzzle) return

      const completedScore = {
        bonusWords: nextBonusWords,
        foundSpangram: Boolean(nextSpangram),
        foundSpangramWord: nextSpangram,
        foundPaths: nextPaths,
        foundThemeWords: nextThemeWords,
        revealed,
        submittedWords: nextSubmittedWords,
      }
      const completedResult = {
        date: puzzle.date,
        // NYT Strands has no timer, so time is intentionally not tracked.
        elapsedSeconds: 0,
        outcome,
        score: completedScore,
        variant: 'daily',
      }

      if (accessState?.kind === 'friends-family') {
        try {
          const response = await saveAdditionalGameResult({
            accessState,
            clientSessionId,
            date: puzzle.date,
            elapsedSeconds: completedResult.elapsedSeconds,
            gameKey: 'strands',
            outcome,
            requestWithSessionRecovery,
            score: completedScore,
            variant: 'daily',
          })
          const stats = await loadStatsForGameUser({
            accessState,
            clientSessionId,
            gameKey: 'strands',
            requestWithSessionRecovery,
          })
          onGameComplete(response.result ?? completedResult, stats)
        } catch (error) {
          console.warn('Could not save Strands result', error)
          showToast(error instanceof Error ? error.message : 'Could not save result')
        }
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'strands',
            kind: 'result',
            variant: 'daily',
          }),
          completedResult,
        )
        clearStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'strands',
            kind: 'attempt',
            variant: 'daily',
          }),
        )
        onGameComplete(completedResult, null)
      }
    },
    [accessState, clientSessionId, puzzle, requestWithSessionRecovery, showToast, onGameComplete],
  )

  const loadPuzzle = useCallback(async () => {
    onGameReset()
    setPuzzleError('')
    setSelectedPath([])
    selectedPathRef.current = []
    setFoundThemeWords([])
    setFoundSpangram('')
    setFoundBonusWords([])
    setFoundPaths({})
    setSubmittedWords([])
    setCelebratingKeys([])
    setHintCells([])
    setHintsUsed(0)
    setIsComplete(false)
    startedAtRef.current = Date.now()

    try {
      const activePuzzle = await requestJson<StrandsPuzzle>(
        `/api/games/strands/today?date=${encodeURIComponent(requestedDate)}`,
        { cache: 'no-store' },
      )
      setPuzzle(activePuzzle)
      notifyDateClamp(activePuzzle, 'strands', showToast)
      onResolvedDate(activePuzzle.date)

      // Get cell centers on next frame
      setTimeout(updateCenters, 30)

      if (accessState?.kind === 'friends-family') {
        const statusResponse = await loadAdditionalGameStatus({
          accessState,
          clientSessionId,
          date: activePuzzle.date,
          gameKey: 'strands',
          requestWithSessionRecovery,
          variant: 'daily',
        })

        if (statusResponse.completed && statusResponse.result) {
          const res = statusResponse.result
          setFoundThemeWords(Array.isArray(res.score?.foundThemeWords) ? res.score.foundThemeWords : [])
          setFoundSpangram(typeof res.score?.foundSpangramWord === 'string' ? res.score.foundSpangramWord : '')
          setFoundBonusWords(Array.isArray(res.score?.bonusWords) ? res.score.bonusWords : [])
          setSubmittedWords(Array.isArray(res.score?.submittedWords) ? res.score.submittedWords : [])
          if (res.score?.foundPaths && typeof res.score.foundPaths === 'object') {
            setFoundPaths(res.score.foundPaths as Record<string, StrandsCoord[]>)
          }
          setIsComplete(true)
          const stats = await loadStatsForGameUser({
            accessState,
            clientSessionId,
            gameKey: 'strands',
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
          if (!res.score?.foundPaths) {
            try {
              const solution = await requestJson<StrandsSolution>('/api/games/strands/reveal', {
                body: JSON.stringify({ date: activePuzzle.date }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
              })
              setFoundThemeWords(solution.themeWords)
              setFoundSpangram(solution.spangram)
              setFoundPaths({ ...solution.themePaths, [solution.spangram]: solution.spangramPath })
            } catch (e) {
              console.warn('Could not load solution paths', e)
            }
          }
        } else if (statusResponse.attempt) {
          const state = statusResponse.attempt.state as Partial<StrandsAttemptState>
          setFoundThemeWords(Array.isArray(state.foundThemeWords) ? state.foundThemeWords : [])
          setFoundSpangram(typeof state.foundSpangram === 'string' ? state.foundSpangram : '')
          setFoundBonusWords(Array.isArray(state.foundBonusWords) ? state.foundBonusWords : [])
          setFoundPaths(state.foundPaths && typeof state.foundPaths === 'object' ? state.foundPaths : {})
          setSubmittedWords(Array.isArray(state.submittedWords) ? state.submittedWords : [])
          setHintsUsed(Number(state.hintsUsed ?? 0))
        }
      } else {
        const localResult = loadStoredAdditionalGameValue<MultigameCompletionResult>(
          getAdditionalGameStorageKey({
            date: activePuzzle.date,
            gameKey: 'strands',
            kind: 'result',
            variant: 'daily',
          }),
        )
        if (localResult) {
          const res = localResult
          setFoundThemeWords(Array.isArray(res.score?.foundThemeWords) ? res.score.foundThemeWords : [])
          setFoundSpangram(typeof res.score?.foundSpangramWord === 'string' ? res.score.foundSpangramWord : '')
          setFoundBonusWords(Array.isArray(res.score?.bonusWords) ? res.score.bonusWords : [])
          setSubmittedWords(Array.isArray(res.score?.submittedWords) ? res.score.submittedWords : [])
          if (res.score?.foundPaths && typeof res.score.foundPaths === 'object') {
            setFoundPaths(res.score.foundPaths as Record<string, StrandsCoord[]>)
          }
          setIsComplete(true)
          onGameLoadedAndComplete(res, null)
          if (!res.score?.foundPaths) {
            try {
              const solution = await requestJson<StrandsSolution>('/api/games/strands/reveal', {
                body: JSON.stringify({ date: activePuzzle.date }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
              })
              setFoundThemeWords(solution.themeWords)
              setFoundSpangram(solution.spangram)
              setFoundPaths({ ...solution.themePaths, [solution.spangram]: solution.spangramPath })
            } catch (e) {
              console.warn('Could not load solution paths', e)
            }
          }
        } else {
          const localAttempt = loadStoredAdditionalGameValue<Partial<StrandsAttemptState>>(
            getAdditionalGameStorageKey({
              date: activePuzzle.date,
              gameKey: 'strands',
              kind: 'attempt',
              variant: 'daily',
            }),
          )
          if (localAttempt) {
            setFoundThemeWords(Array.isArray(localAttempt.foundThemeWords) ? localAttempt.foundThemeWords : [])
            setFoundSpangram(typeof localAttempt.foundSpangram === 'string' ? localAttempt.foundSpangram : '')
            setFoundBonusWords(Array.isArray(localAttempt.foundBonusWords) ? localAttempt.foundBonusWords : [])
            setFoundPaths(
              localAttempt.foundPaths && typeof localAttempt.foundPaths === 'object'
                ? localAttempt.foundPaths
                : {},
            )
            setSubmittedWords(Array.isArray(localAttempt.submittedWords) ? localAttempt.submittedWords : [])
            setHintsUsed(Number(localAttempt.hintsUsed ?? 0))
          }
        }
      }
    } catch (error) {
      setPuzzleError(error instanceof Error ? error.message : 'Could not load Strands')
    }
  }, [
    accessState,
    clientSessionId,
    onGameLoadedAndComplete,
    onGameReset,
    onResolvedDate,
    requestedDate,
    requestWithSessionRecovery,
    showToast,
    updateCenters,
  ])

  useEffect(() => {
    void loadPuzzle()
  }, [loadPuzzle])

  // Every 3 non-theme words found unlocks a hint that circles a theme word.
  const hintsAvailable = Math.floor(foundBonusWords.length / 3) - hintsUsed

  const applyHint = useCallback(async () => {
    if (!puzzle || isComplete) return
    try {
      const hint = await requestJson<{ word: string; path: StrandsCoord[] }>(
        '/api/games/strands/hint',
        {
          body: JSON.stringify({ date: puzzle.date, foundThemeWords }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      )
      if (!hint.path || hint.path.length === 0) {
        showToast('No hint available')
        return
      }
      setHintCells(hint.path.map(([row, column]) => coordKey(row, column)))
      setHintsUsed((used) => used + 1)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not get a hint')
    }
  }, [foundThemeWords, isComplete, puzzle, showToast])

  const handleDragOverCell = useCallback((row: number, col: number) => {
    updateSelectedPath((prev) => {
      const last = prev.at(-1)
      if (!last) return [[row, col]]
      if (last[0] === row && last[1] === col) return prev

      const secondLast = prev.at(-2)
      if (secondLast && secondLast[0] === row && secondLast[1] === col) {
        return prev.slice(0, -1) // Backtrack
      }

      const exists = prev.some(([r, c]) => r === row && c === col)
      if (exists) return prev

      if (areAdjacent(last, [row, col])) {
        hasDraggedRef.current = true
        return [...prev, [row, col]]
      }
      return prev
    })
  }, [updateSelectedPath])

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, row: number, col: number) => {
    if (isComplete || !puzzle || isSubmitting) return
    if (event.button !== 0) return

    event.preventDefault()

    isDraggingRef.current = true
    hasDraggedRef.current = false

    updateSelectedPath((prev) => {
      const last = prev.at(-1)
      if (last) {
        if (last[0] === row && last[1] === col) {
          return prev.slice(0, -1)
        }
        const clickedKey = coordKey(row, col)
        if (prev.some(([r, c]) => coordKey(r, c) === clickedKey)) {
          return [[row, col]]
        }
        if (areAdjacent(last, [row, col])) {
          return [...prev, [row, col]]
        }
      }
      return [[row, col]]
    })
  }

  const submitSelection = useCallback(async (pathOverride?: StrandsCoord[]) => {
    const activePath = pathOverride ?? selectedPathRef.current
    if (!puzzle || activePath.length < 4 || isSubmitting || isComplete) return

    setIsSubmitting(true)
    try {
      const response = await requestJson<StrandsGuessResponse>('/api/games/strands/guess', {
        body: JSON.stringify({ date: puzzle.date, path: activePath }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })

      if (!response.valid) {
        showToast('Not in word list')
        setSelectedPath([])
        selectedPathRef.current = []
        return
      }

      const nextSubmittedWords = submittedWords.includes(response.word)
        ? submittedWords
        : [...submittedWords, response.word]
      setSubmittedWords(nextSubmittedWords)

      if (response.kind === 'bonus') {
        if (!foundBonusWords.includes(response.word)) {
          const nextBonus = [...foundBonusWords, response.word]
          setFoundBonusWords(nextBonus)
          showToast('Bonus word')
          void saveAttempt(foundThemeWords, foundSpangram, nextBonus, foundPaths, nextSubmittedWords)
        }
        setSelectedPath([])
        selectedPathRef.current = []
        return
      }

      const responsePath = response.path ?? activePath
      const nextPaths = { ...foundPaths, [response.word]: responsePath }
      setFoundPaths(nextPaths)
      setSelectedPath([])
      selectedPathRef.current = []

      let nextThemeWords = foundThemeWords
      let nextSpangram = foundSpangram

      const celebrationKeys = responsePath.map(([row, column]) => coordKey(row, column))
      if (response.kind === 'spangram') {
        nextSpangram = response.word
        setFoundSpangram(response.word)
        setCelebrateKind('spangram')
        setCelebratingKeys(celebrationKeys)
        window.setTimeout(() => setCelebratingKeys([]), 900)
        showToast('Spangram')
      } else {
        if (!foundThemeWords.includes(response.word)) {
          nextThemeWords = [...foundThemeWords, response.word].sort()
          setFoundThemeWords(nextThemeWords)
        }
        setHintCells([])
        setCelebrateKind('theme')
        setCelebratingKeys(celebrationKeys)
        window.setTimeout(() => setCelebratingKeys([]), 700)
        showToast('Theme word')
      }

      if (nextThemeWords.length === puzzle.themeWordCount && nextSpangram) {
        setIsComplete(true)
        await saveResult(
          'won',
          nextThemeWords,
          nextSpangram,
          foundBonusWords,
          nextPaths,
          nextSubmittedWords,
        )
        showToast('Strands solved', 1800)
      } else {
        void saveAttempt(nextThemeWords, nextSpangram, foundBonusWords, nextPaths, nextSubmittedWords)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not check word')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    puzzle,
    isSubmitting,
    isComplete,
    submittedWords,
    foundBonusWords,
    foundThemeWords,
    foundSpangram,
    foundPaths,
    saveAttempt,
    saveResult,
    showToast,
  ])

  const endDrag = useCallback(async () => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false

    if (hasDraggedRef.current) {
      const activePath = selectedPathRef.current
      if (activePath.length >= 4) {
        await submitSelection(activePath)
      } else {
        setSelectedPath([])
        selectedPathRef.current = []
      }
    }
  }, [submitSelection])

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current) return
    if (event.cancelable) event.preventDefault()

    const element = document.elementFromPoint(event.clientX, event.clientY)
    if (!element) return
    const cell = element.closest('.strands-cell')
    if (cell) {
      const r = Number(cell.getAttribute('data-row'))
      const c = Number(cell.getAttribute('data-col'))
      if (!isNaN(r) && !isNaN(c)) {
        handleDragOverCell(r, c)
      }
    }
  }, [handleDragOverCell])

  useEffect(() => {
    const handleWindowPointerUp = () => {
      void endDrag()
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerUp)
    }
  }, [handlePointerMove, endDrag])

  return (
    <main className="game-page game-page--strands" aria-label="Strands game">
      <section className="game-panel strands-panel">
        {puzzle && (
          <div className="strands-clue-card">
            <span className="strands-clue-label">TODAY'S THEME</span>
            <h2 className="strands-clue-text">{puzzle.clue}</h2>
          </div>
        )}

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

            <div className="strands-board-wrapper">
              <svg className="strands-svg">
                {/* Draw already solved theme words and the spangram */}
                {Object.entries(foundPaths).map(([word, path]) => {
                  const points = path
                    .map(([r, c]) => {
                      const center = cellCenters[coordKey(r, c)]
                      return center ? `${center.x},${center.y}` : ''
                    })
                    .filter(Boolean)
                    .join(' ')
                  if (!points) return null
                  const isSpangram = word.toUpperCase() === spangramKey
                  return (
                    <polyline
                      key={word}
                      points={points}
                      className={`strands-line ${isSpangram ? 'strands-line--spangram' : 'strands-line--theme'}`}
                    />
                  )
                })}

                {/* Draw current dragging/active path */}
                {selectedPath.length > 1 && (
                  <polyline
                    points={selectedPath
                      .map(([r, c]) => {
                        const center = cellCenters[coordKey(r, c)]
                        return center ? `${center.x},${center.y}` : ''
                      })
                      .filter(Boolean)
                      .join(' ')}
                    className="strands-line strands-line--active"
                  />
                )}
              </svg>

              <div className="strands-board" ref={boardRef}>
                {puzzle.board.map((rowText, row) =>
                  rowText.split('').map((letter, column) => {
                    const key = coordKey(row, column)
                    const isSelected = selectedPath.some(
                      ([selectedRow, selectedColumn]) =>
                        coordKey(selectedRow, selectedColumn) === key,
                    )
                    const foundKind = foundCellKinds[key]
                    const celebrationIndex = celebratingKeys.indexOf(key)
                    return (
                      <button
                        className={[
                          'strands-cell',
                          isSelected ? 'strands-cell--selected' : '',
                          foundKind ? `strands-cell--${foundKind}` : '',
                          hintCells.includes(key) ? 'strands-cell--hint' : '',
                          celebrationIndex >= 0
                            ? celebrateKind === 'spangram'
                              ? 'strands-cell--celebrate'
                              : 'strands-cell--celebrate-theme'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={key}
                        data-row={row}
                        data-col={column}
                        onPointerDown={(event) => startDrag(event, row, column)}
                        type="button"
                        style={
                          {
                            '--strands-jump-delay': `${Math.max(0, celebrationIndex) * 45}ms`,
                          } as CSSProperties
                        }
                      >
                        {letter}
                      </button>
                    )
                  }),
                )}
              </div>
            </div>

            <div className="strands-current-word" aria-live="polite">
              {selectedWord || 'Select letters'}
            </div>

            <div className="game-actions">
              <button
                className="game-secondary-button"
                onClick={() => {
                  setSelectedPath([])
                  selectedPathRef.current = []
                }}
                type="button"
              >
                Clear
              </button>
              <button
                className={`game-secondary-button strands-hint-button ${
                  hintsAvailable > 0 ? 'strands-hint-button--active' : ''
                } ${animateCharge ? 'strands-hint-button--charging' : ''}`}
                disabled={isComplete || hintsAvailable <= 0}
                onClick={() => void applyHint()}
                style={
                  {
                    '--hint-progress': `${hintsAvailable > 0 ? 100 : ((foundBonusWords.length % 3) / 3) * 100}%`,
                  } as CSSProperties
                }
                type="button"
              >
                <div className="strands-hint-fill" />
                <span className="strands-hint-label">
                  Hint{hintsAvailable > 0 ? ` (${hintsAvailable})` : ''}
                </span>
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
    </main>
  )
}

function coordKey(row: number, column: number) {
  return `${row}:${column}`
}

function areAdjacent(first: StrandsCoord, second: StrandsCoord) {
  return Math.max(Math.abs(first[0] - second[0]), Math.abs(first[1] - second[1])) <= 1
}
