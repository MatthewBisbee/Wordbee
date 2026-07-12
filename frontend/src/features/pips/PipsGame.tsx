import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
  PipsDifficulty,
  PipsDomino,
  PipsPlacement,
  PipsPuzzle,
  PipsRegion,
  PipsSolution,
} from '../../types'

const difficulties: PipsDifficulty[] = ['easy', 'medium', 'hard']

// NYT cycles six region colours; index-by-region keeps the palette stable.
const REGION_COLORS = ['pink', 'teal', 'orange', 'purple', 'blue', 'green'] as const

// The four rotations of a domino: which cell the second half occupies relative
// to the anchor (which always holds the domino's first pip). Right, Down, Left,
// Up — tapping a domino cycles through these.
const DIRECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
]

// Which of a 3×3 dot grid are lit for each pip face (standard domino pips).
const PIP_FACES: number[][] = [
  [],
  [4],
  [0, 8],
  [0, 4, 8],
  [0, 2, 6, 8],
  [0, 2, 4, 6, 8],
  [0, 2, 3, 5, 6, 8],
]

const BOARD_PADDING = 8
const DRAG_THRESHOLD = 6

type Cell = [number, number]
type RegionStatus = 'satisfied' | 'violated' | 'neutral'

type PipsAttemptState = {
  anchors: (Cell | null)[]
  orientations: number[]
  elapsedSeconds: number
}

type DragState = {
  dominoIndex: number
  fromAnchor: Cell | null
  startX: number
  startY: number
  x: number
  y: number
  cellPx: number
  moved: boolean
  preview: { cells: [Cell, Cell]; valid: boolean } | null
}

type RotateAnim = {
  index: number
  origin: string
  fromDeg: number
  token: number
}

const cellKey = (row: number, col: number) => `${row}:${col}`

export function PipsGame({
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
  const [difficulty, setDifficulty] = useState<PipsDifficulty>('easy')
  const [puzzle, setPuzzle] = useState<PipsPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [anchors, setAnchors] = useState<(Cell | null)[]>([])
  const [orientations, setOrientations] = useState<number[]>([])
  const [isComplete, setIsComplete] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [drag, setDrag] = useState<DragState | null>(null)
  // Drives the rotate-in-place animation of the just-rotated placed domino: it
  // starts drawn in its previous orientation and eases to the new one.
  const [rotateAnim, setRotateAnim] = useState<RotateAnim | null>(null)
  const rotateTokenRef = useRef(0)
  const rotateAnimTimerRef = useRef<number | null>(null)

  const boardRef = useRef<HTMLDivElement | null>(null)
  const anchorsRef = useRef(anchors)
  const orientationsRef = useRef(orientations)
  const difficultyRef = useRef(difficulty)
  const puzzleRef = useRef(puzzle)
  const isCompleteRef = useRef(isComplete)
  const elapsedSecondsRef = useRef(elapsedSeconds)
  const dragRef = useRef<DragState | null>(null)
  useEffect(() => { anchorsRef.current = anchors }, [anchors])
  useEffect(() => { orientationsRef.current = orientations }, [orientations])
  useEffect(() => { difficultyRef.current = difficulty }, [difficulty])
  useEffect(() => { puzzleRef.current = puzzle }, [puzzle])
  useEffect(() => { isCompleteRef.current = isComplete }, [isComplete])
  useEffect(() => { elapsedSecondsRef.current = elapsedSeconds }, [elapsedSeconds])

  const geometry = useMemo(() => buildGeometry(puzzle), [puzzle])

  const filled = useMemo(
    () => computeFilled(anchors, orientations, puzzle),
    [anchors, orientations, puzzle],
  )

  const regionStatuses = useMemo(() => {
    if (!puzzle) return [] as RegionStatus[]
    return puzzle.regions.map((region) => evaluateRegion(region, filled))
  }, [puzzle, filled])

  const saveCurrentState = useCallback(() => {
    const currentPuzzle = puzzleRef.current
    if (!currentPuzzle || isCompleteRef.current) return
    const state: PipsAttemptState = {
      anchors: anchorsRef.current,
      orientations: orientationsRef.current,
      elapsedSeconds: elapsedSecondsRef.current,
    }
    if (accessState?.kind === 'friends-family') {
      void saveAdditionalGameAttempt({
        accessState,
        clientSessionId,
        date: currentPuzzle.date,
        gameKey: 'pips',
        requestWithSessionRecovery,
        state,
        variant: difficultyRef.current,
      }).catch((error) => console.warn('Could not save Pips attempt', error))
    } else {
      saveStoredAdditionalGameValue(
        getAdditionalGameStorageKey({
          date: currentPuzzle.date,
          gameKey: 'pips',
          kind: 'attempt',
          variant: difficultyRef.current,
        }),
        state,
      )
    }
  }, [accessState, clientSessionId, requestWithSessionRecovery])

  useEffect(() => () => saveCurrentState(), [saveCurrentState])
  useEffect(
    () => () => {
      if (rotateAnimTimerRef.current !== null) window.clearTimeout(rotateAnimTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveCurrentState()
    }
    window.addEventListener('visibilitychange', handleVisibilityChange)
    return () => window.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [saveCurrentState])

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

  const saveAttempt = useCallback(
    (nextAnchors: (Cell | null)[], nextOrientations: number[]) => {
      if (!puzzle) return
      const state: PipsAttemptState = {
        anchors: nextAnchors,
        orientations: nextOrientations,
        elapsedSeconds: elapsedSecondsRef.current,
      }
      if (accessState?.kind === 'friends-family') {
        void saveAdditionalGameAttempt({
          accessState,
          clientSessionId,
          date: puzzle.date,
          gameKey: 'pips',
          requestWithSessionRecovery,
          state,
          variant: difficulty,
        }).catch((error) => console.warn('Could not save Pips attempt', error))
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({ date: puzzle.date, gameKey: 'pips', kind: 'attempt', variant: difficulty }),
          state,
        )
      }
    },
    [accessState, clientSessionId, difficulty, puzzle, requestWithSessionRecovery],
  )

  const completeSolve = useCallback(
    async (placements: PipsPlacement[]) => {
      const currentPuzzle = puzzleRef.current
      if (!currentPuzzle) return
      setIsComplete(true)

      const completedScore = { placements }
      const completedResult: MultigameCompletionResult = {
        outcome: 'won',
        elapsedSeconds: elapsedSecondsRef.current,
        date: currentPuzzle.date,
        variant: difficulty,
        score: completedScore,
      }

      if (accessState?.kind === 'friends-family') {
        try {
          const resultResponse = await saveAdditionalGameResult({
            accessState,
            clientSessionId,
            date: currentPuzzle.date,
            elapsedSeconds: elapsedSecondsRef.current,
            gameKey: 'pips',
            outcome: 'won',
            requestWithSessionRecovery,
            score: completedScore,
            variant: difficulty,
          })
          const stats = await loadStatsForGameUser({
            accessState,
            clientSessionId,
            gameKey: 'pips',
            requestWithSessionRecovery,
          })
          onGameComplete(resultResponse.result ?? completedResult, stats)
        } catch (error) {
          console.warn('Could not save Pips result', error)
          showToast(error instanceof Error ? error.message : 'Could not save result')
        }
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({ date: currentPuzzle.date, gameKey: 'pips', kind: 'result', variant: difficulty }),
          completedResult,
        )
        clearStoredAdditionalGameValue(
          getAdditionalGameStorageKey({ date: currentPuzzle.date, gameKey: 'pips', kind: 'attempt', variant: difficulty }),
        )
        onGameComplete(completedResult, null)
      }
      showToast('Pips solved', 1800)
    },
    [accessState, clientSessionId, difficulty, onGameComplete, requestWithSessionRecovery, showToast],
  )

  const commit = useCallback(
    (nextAnchors: (Cell | null)[], nextOrientations: number[]) => {
      setAnchors(nextAnchors)
      setOrientations(nextOrientations)
      saveAttempt(nextAnchors, nextOrientations)

      const currentPuzzle = puzzleRef.current
      if (currentPuzzle && nextAnchors.every((anchor) => anchor !== null)) {
        const placements = nextAnchors.map(
          (anchor, index) => placementFor(anchor as Cell, nextOrientations[index]),
        )
        const solvedFilled = computeFilled(nextAnchors, nextOrientations, currentPuzzle)
        const solved = currentPuzzle.regions.every(
          (region) => evaluateRegion(region, solvedFilled) === 'satisfied',
        )
        if (solved) void completeSolve(placements)
        else showToast('The board is full, but a rule is broken')
      }
    },
    [completeSolve, saveAttempt, showToast],
  )

  const loadPuzzle = useCallback(
    async (nextDifficulty: PipsDifficulty) => {
      onGameReset()
      setPuzzleError('')
      setIsComplete(false)
      setDrag(null)
      dragRef.current = null
      setElapsedSeconds(0)

      try {
        const response = await requestJson<PipsPuzzle>(
          `/api/games/pips/today?difficulty=${nextDifficulty}&date=${encodeURIComponent(requestedDate)}`,
          { cache: 'no-store' },
        )
        setPuzzle(response)
        notifyDateClamp(response, 'pips', showToast)
        onResolvedDate(response.date)

        const count = response.dominoes.length
        const freshAnchors: (Cell | null)[] = Array.from({ length: count }, () => null)
        const freshOrientations: number[] = Array.from({ length: count }, () => 0)

        const applyCompleted = async (score: Record<string, unknown>) => {
          let placements = normalizePlacements(score.placements, count)
          if (!placements) {
            try {
              const reveal = await requestJson<PipsSolution>('/api/games/pips/reveal', {
                body: JSON.stringify({ date: response.date, difficulty: nextDifficulty }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
              })
              placements = normalizePlacements(reveal.solution, count)
            } catch {
              placements = null
            }
          }
          if (placements) {
            const { anchors: solvedAnchors, orientations: solvedOrientations } = placementsToState(placements, count)
            setAnchors(solvedAnchors)
            setOrientations(solvedOrientations)
          } else {
            setAnchors(freshAnchors)
            setOrientations(freshOrientations)
          }
          setIsComplete(true)
        }

        const applyAttempt = (state: Partial<PipsAttemptState>) => {
          const restored = normalizeAttempt(state, count)
          setAnchors(restored.anchors)
          setOrientations(restored.orientations)
          setElapsedSeconds(restored.elapsedSeconds)
        }

        if (accessState?.kind === 'friends-family') {
          const statusResponse = await loadAdditionalGameStatus({
            accessState,
            clientSessionId,
            date: response.date,
            gameKey: 'pips',
            requestWithSessionRecovery,
            variant: nextDifficulty,
          })
          if (statusResponse.completed && statusResponse.result) {
            const res = statusResponse.result
            await applyCompleted(res.score)
            const stats = await loadStatsForGameUser({
              accessState,
              clientSessionId,
              gameKey: 'pips',
              requestWithSessionRecovery,
            })
            onGameLoadedAndComplete(
              { outcome: res.outcome, elapsedSeconds: res.elapsedSeconds, date: res.date, variant: res.variant, score: res.score },
              stats,
            )
          } else if (statusResponse.attempt) {
            applyAttempt(statusResponse.attempt.state as Partial<PipsAttemptState>)
          } else {
            setAnchors(freshAnchors)
            setOrientations(freshOrientations)
          }
        } else {
          const localResult = loadStoredAdditionalGameValue<MultigameCompletionResult>(
            getAdditionalGameStorageKey({ date: response.date, gameKey: 'pips', kind: 'result', variant: nextDifficulty }),
          )
          if (localResult) {
            await applyCompleted(localResult.score)
            onGameLoadedAndComplete(localResult, null)
          } else {
            const localAttempt = loadStoredAdditionalGameValue<Partial<PipsAttemptState>>(
              getAdditionalGameStorageKey({ date: response.date, gameKey: 'pips', kind: 'attempt', variant: nextDifficulty }),
            )
            if (localAttempt) {
              applyAttempt(localAttempt)
            } else {
              setAnchors(freshAnchors)
              setOrientations(freshOrientations)
            }
          }
        }
      } catch (error) {
        setPuzzleError(error instanceof Error ? error.message : 'Could not load Pips')
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

  // Map a client point onto a board cell (or null when off the board shape).
  const cellFromPoint = useCallback(
    (x: number, y: number): Cell | null => {
      const currentPuzzle = puzzleRef.current
      const board = boardRef.current
      if (!currentPuzzle || !board) return null
      const rect = board.getBoundingClientRect()
      const stepX = (rect.width - 2 * BOARD_PADDING) / currentPuzzle.cols
      const stepY = (rect.height - 2 * BOARD_PADDING) / currentPuzzle.rows
      const col = Math.floor((x - rect.left - BOARD_PADDING) / stepX)
      const row = Math.floor((y - rect.top - BOARD_PADDING) / stepY)
      if (row < 0 || row >= currentPuzzle.rows || col < 0 || col >= currentPuzzle.cols) return null
      if (!geometry.boardSet.has(cellKey(row, col))) return null
      return [row, col]
    },
    [geometry.boardSet],
  )

  const rotateDomino = useCallback(
    (dominoIndex: number, pivotCell?: Cell | null) => {
      const currentPuzzle = puzzleRef.current
      if (!currentPuzzle) return
      const current = orientationsRef.current[dominoIndex]
      const anchor = anchorsRef.current[dominoIndex]

      if (!anchor) {
        // Tray domino: cycle its orientation freely (no board to pivot on).
        const nextOrientations = orientationsRef.current.map((value, index) =>
          index === dominoIndex ? (current + 1) % DIRECTIONS.length : value,
        )
        commit(anchorsRef.current, nextOrientations)
        return
      }

      // Pivot around the half the player actually touched: that cell stays put and
      // the other half swings to the next spot that fits (hopping over ones blocked
      // by a wall or a neighbour). Default to the anchor half.
      const [cellA, cellB] = placementFor(anchor, current)
      const pivotOnB =
        !!pivotCell && pivotCell[0] === cellB[0] && pivotCell[1] === cellB[1]
      const pivot: Cell = pivotOnB ? cellB : cellA
      // Direction from the pivot to the swinging half in the current placement.
      const currentSwing = pivotOnB ? (current + 2) % DIRECTIONS.length : current

      const others = computeFilled(anchorsRef.current, orientationsRef.current, currentPuzzle, dominoIndex)
      for (let step = 1; step < DIRECTIONS.length; step += 1) {
        const swing = (currentSwing + step) % DIRECTIONS.length
        // Keep pip a on the anchor: when pivoting on the b-half the anchor moves to
        // the swung cell and its orientation points back at the pivot.
        const nextAnchor: Cell = pivotOnB
          ? [pivot[0] + DIRECTIONS[swing][0], pivot[1] + DIRECTIONS[swing][1]]
          : pivot
        const nextOrientation = pivotOnB ? (swing + 2) % DIRECTIONS.length : swing
        if (canPlace(nextAnchor, nextOrientation, geometry.boardSet, others)) {
          // Animate the spin: rotate around the pivot half by the (shortest)
          // quarter-turn(s) between the old and new swing directions.
          const steps = (swing - currentSwing + DIRECTIONS.length) % DIRECTIONS.length
          const turn = steps === 3 ? -1 : steps
          const [na, nb] = placementFor(nextAnchor, nextOrientation)
          const minRow = Math.min(na[0], nb[0])
          const minCol = Math.min(na[1], nb[1])
          const isHorizontal = na[0] === nb[0]
          const xFrac = isHorizontal ? (pivot[1] - minCol + 0.5) / 2 : 0.5
          const yFrac = isHorizontal ? 0.5 : (pivot[0] - minRow + 0.5) / 2
          rotateTokenRef.current += 1
          if (rotateAnimTimerRef.current !== null) window.clearTimeout(rotateAnimTimerRef.current)
          setRotateAnim({
            index: dominoIndex,
            origin: `${xFrac * 100}% ${yFrac * 100}%`,
            fromDeg: -turn * 90,
            token: rotateTokenRef.current,
          })
          rotateAnimTimerRef.current = window.setTimeout(() => setRotateAnim(null), 260)

          const nextAnchors = anchorsRef.current.map((value, index) =>
            index === dominoIndex ? nextAnchor : value,
          )
          const nextOrientations = orientationsRef.current.map((value, index) =>
            index === dominoIndex ? nextOrientation : value,
          )
          commit(nextAnchors, nextOrientations)
          return
        }
      }
      // Boxed in on every side — leave it as-is.
    },
    [commit, geometry.boardSet],
  )

  const endDrag = useCallback(
    (clientX: number, clientY: number) => {
      const active = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!active) return
      const currentPuzzle = puzzleRef.current
      if (!currentPuzzle) return

      if (!active.moved) {
        // Rotate, pivoting on whichever half of the domino the tap landed on.
        const pivot = cellFromPoint(active.startX, active.startY)
        rotateDomino(active.dominoIndex, pivot)
        return
      }

      const target = cellFromPoint(clientX, clientY)
      const orientation = orientationsRef.current[active.dominoIndex]
      if (target) {
        const others = computeFilled(anchorsRef.current, orientationsRef.current, currentPuzzle, active.dominoIndex)
        if (canPlace(target, orientation, geometry.boardSet, others)) {
          const nextAnchors = anchorsRef.current.map((anchor, index) =>
            index === active.dominoIndex ? target : anchor,
          )
          commit(nextAnchors, orientationsRef.current)
          return
        }
      }
      // Invalid drop: send a placed domino back to the tray; a tray domino stays.
      if (active.fromAnchor) {
        const nextAnchors = anchorsRef.current.map((anchor, index) =>
          index === active.dominoIndex ? null : anchor,
        )
        commit(nextAnchors, orientationsRef.current)
      }
    },
    [cellFromPoint, commit, geometry.boardSet, rotateDomino],
  )

  const onPointerDownDomino = useCallback(
    (event: React.PointerEvent, dominoIndex: number) => {
      if (isComplete || isInputBlocked) return
      event.preventDefault()
      const board = boardRef.current
      const currentPuzzle = puzzleRef.current
      const cellPx = board && currentPuzzle ? board.getBoundingClientRect().width / currentPuzzle.cols : 48
      const next: DragState = {
        dominoIndex,
        fromAnchor: anchorsRef.current[dominoIndex],
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        cellPx,
        moved: false,
        preview: null,
      }
      dragRef.current = next
      setDrag(next)
    },
    [isComplete, isInputBlocked],
  )

  // Global move/up listeners run only while a drag is in progress.
  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent) => {
      const active = dragRef.current
      if (!active) return
      const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY)
      const moved = active.moved || distance > DRAG_THRESHOLD
      let preview: DragState['preview'] = null
      if (moved) {
        const target = cellFromPoint(event.clientX, event.clientY)
        const currentPuzzle = puzzleRef.current
        if (target && currentPuzzle) {
          const orientation = orientationsRef.current[active.dominoIndex]
          const others = computeFilled(anchorsRef.current, orientationsRef.current, currentPuzzle, active.dominoIndex)
          preview = {
            cells: placementFor(target, orientation),
            valid: canPlace(target, orientation, geometry.boardSet, others),
          }
        }
      }
      const nextState: DragState = { ...active, x: event.clientX, y: event.clientY, moved, preview }
      dragRef.current = nextState
      setDrag(nextState)
    }
    const onUp = (event: PointerEvent) => endDrag(event.clientX, event.clientY)
    const onCancel = () => {
      dragRef.current = null
      setDrag(null)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
    }
  }, [drag, cellFromPoint, endDrag, geometry.boardSet])

  const handleDifficultyChange = useCallback(
    (next: PipsDifficulty) => {
      if (next === difficulty) return
      saveCurrentState()
      setDifficulty(next)
    },
    [difficulty, saveCurrentState],
  )

  const previewKeys = useMemo(() => {
    if (!drag?.preview) return null
    const [a, b] = drag.preview.cells
    return { keys: new Set([cellKey(a[0], a[1]), cellKey(b[0], b[1])]), valid: drag.preview.valid }
  }, [drag])

  const draggingIndex = drag?.moved ? drag.dominoIndex : null

  return (
    <main className="game-page game-page--pips" aria-label="Pips game">
      <section className="game-panel pips-panel">
        <div className="pips-topbar">
          <div className="pips-difficulty" aria-label="Pips difficulty">
            {difficulties.map((option) => (
              <button
                aria-pressed={difficulty === option}
                key={option}
                onClick={() => handleDifficultyChange(option)}
                type="button"
              >
                {capitalize(option)}
              </button>
            ))}
          </div>
          <span className="pips-timer" aria-label="Elapsed time">
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

        {!puzzle && !puzzleError && <p className="game-loading">Loading Pips...</p>}

        {puzzle && (
          <>
            <div
              ref={boardRef}
              className={['pips-board', isComplete ? 'pips-board--complete' : ''].filter(Boolean).join(' ')}
              role="grid"
              aria-label="Pips board"
              style={
                {
                  '--cols': puzzle.cols,
                  '--rows': puzzle.rows,
                  gridTemplateColumns: `repeat(${puzzle.cols}, 1fr)`,
                  gridTemplateRows: `repeat(${puzzle.rows}, 1fr)`,
                } as CSSProperties
              }
            >
              {geometry.cells.map((cell) => {
                const status = regionStatuses[cell.regionIndex]
                const preview = previewKeys?.keys.has(cell.key)
                  ? previewKeys.valid
                    ? 'pips-cell--preview-ok'
                    : 'pips-cell--preview-bad'
                  : ''
                return (
                  <div
                    key={cell.key}
                    className={[
                      'pips-cell',
                      `pips-cell--${REGION_COLORS[cell.regionIndex % REGION_COLORS.length]}`,
                      `pips-cell--${status}`,
                      cell.classes,
                      preview,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
                    role="gridcell"
                    aria-label={`Cell ${cell.row + 1}, ${cell.col + 1}`}
                  >
                    <span className="pips-cell__fill" />
                    {cell.label && (
                      <span
                        className={`pips-chip pips-chip--${REGION_COLORS[cell.regionIndex % REGION_COLORS.length]} pips-chip--${cell.chipCorner}`}
                      >
                        <span className="pips-chip__text">{cell.label}</span>
                      </span>
                    )}
                  </div>
                )
              })}

              {anchors.map((anchor, dominoIndex) =>
                anchor && dominoIndex !== draggingIndex ? (
                  <PlacedDomino
                    key={`domino-${dominoIndex}`}
                    placement={placementFor(anchor, orientations[dominoIndex])}
                    values={puzzle.dominoes[dominoIndex]}
                    orientation={orientations[dominoIndex]}
                    disabled={isComplete}
                    dragging={dominoIndex === drag?.dominoIndex}
                    raised={rotateAnim?.index === dominoIndex}
                    flip={rotateAnim?.index === dominoIndex ? rotateAnim : undefined}
                    onPointerDown={(event) => onPointerDownDomino(event, dominoIndex)}
                  />
                ) : null,
              )}
            </div>

            <div className="pips-tray" aria-label="Available dominoes">
              {puzzle.dominoes.map((values, dominoIndex) =>
                anchors[dominoIndex] === null && dominoIndex !== draggingIndex ? (
                  <div
                    key={`tray-${dominoIndex}`}
                    className={[
                      'pips-tray-slot',
                      orientations[dominoIndex] % 2 === 1 ? 'pips-tray-slot--v' : 'pips-tray-slot--h',
                      dominoIndex === drag?.dominoIndex ? 'pips-tray-slot--active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    role="button"
                    tabIndex={isComplete ? -1 : 0}
                    aria-label={`Domino ${values[0]} and ${values[1]}. Tap to rotate, drag to place.`}
                    onPointerDown={(event) => onPointerDownDomino(event, dominoIndex)}
                  >
                    <DominoVisual values={values} orientation={orientations[dominoIndex]} />
                  </div>
                ) : null,
              )}
            </div>
          </>
        )}
      </section>

      {drag?.moved && puzzle && (
        <div
          className="pips-drag-ghost"
          style={{
            left: drag.x,
            top: drag.y,
            width: orientations[drag.dominoIndex] % 2 === 1 ? drag.cellPx : drag.cellPx * 2,
            height: orientations[drag.dominoIndex] % 2 === 1 ? drag.cellPx * 2 : drag.cellPx,
          }}
        >
          <DominoVisual values={puzzle.dominoes[drag.dominoIndex]} orientation={orientations[drag.dominoIndex]} />
        </div>
      )}
    </main>
  )
}

function PlacedDomino({
  placement,
  values,
  orientation,
  disabled,
  dragging,
  raised,
  flip,
  onPointerDown,
}: {
  placement: PipsPlacement
  values: PipsDomino
  orientation: number
  disabled: boolean
  dragging: boolean
  raised?: boolean
  flip?: RotateAnim
  onPointerDown: (event: React.PointerEvent) => void
}) {
  const elementRef = useRef<HTMLDivElement>(null)

  // FLIP the rotation: the element already renders at its NEW spot, so start it
  // drawn in the OLD orientation (rotate back around the pivot) and ease to 0.
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element) return
    if (!flip) {
      element.style.transition = ''
      element.style.transform = ''
      element.style.transformOrigin = ''
      return
    }
    element.style.transition = 'none'
    element.style.transformOrigin = flip.origin
    element.style.transform = `rotate(${flip.fromDeg}deg)`
    void element.getBoundingClientRect() // force the start frame before easing
    const raf = requestAnimationFrame(() => {
      element.style.transition = 'transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1)'
      element.style.transform = 'rotate(0deg)'
    })
    return () => cancelAnimationFrame(raf)
  }, [flip])

  const [[r1, c1], [r2, c2]] = placement
  const horizontal = r1 === r2
  const minRow = Math.min(r1, r2)
  const minCol = Math.min(c1, c2)
  return (
    <div
      ref={elementRef}
      className={['pips-placed', raised ? 'pips-placed--raised' : '', dragging ? 'pips-placed--dragging' : '']
        .filter(Boolean)
        .join(' ')}
      style={{
        gridColumn: horizontal ? `${minCol + 1} / span 2` : `${minCol + 1}`,
        gridRow: horizontal ? `${minRow + 1}` : `${minRow + 1} / span 2`,
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`Placed domino ${values[0]} and ${values[1]}. Tap to rotate, drag to move.`}
      onPointerDown={disabled ? undefined : onPointerDown}
    >
      <DominoVisual values={values} orientation={orientation} />
    </div>
  )
}

// One domino rendered in its current rotation. The anchor half (first pip) sits
// left/top for orientations 0/1 and right/bottom for 2/3.
function DominoVisual({ values, orientation }: { values: PipsDomino; orientation: number }) {
  const horizontal = orientation % 2 === 0
  const anchorFirst = orientation === 0 || orientation === 1
  const ordered: PipsDomino = anchorFirst ? values : [values[1], values[0]]
  return (
    <span className={['pips-domino', horizontal ? 'pips-domino--h' : 'pips-domino--v'].filter(Boolean).join(' ')}>
      <span className="pips-domino-half">
        <PipFace value={ordered[0]} />
      </span>
      <span className="pips-domino-divider" aria-hidden="true" />
      <span className="pips-domino-half">
        <PipFace value={ordered[1]} />
      </span>
    </span>
  )
}

function PipFace({ value }: { value: number }) {
  const lit = PIP_FACES[value] ?? []
  return (
    <span className="pips-pipface" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} className={lit.includes(index) ? 'pips-dot pips-dot--on' : 'pips-dot'} />
      ))}
    </span>
  )
}

// --- Geometry & rules -------------------------------------------------------

type CellRender = {
  key: string
  row: number
  col: number
  regionIndex: number
  label: string | null
  chipCorner: string
  classes: string
}

function buildGeometry(puzzle: PipsPuzzle | null) {
  const boardSet = new Set<string>()
  const regionOf = new Map<string, number>()
  const cells: CellRender[] = []
  if (!puzzle) return { boardSet, cells }

  puzzle.regions.forEach((region, regionIndex) => {
    region.indices.forEach(([row, col]) => {
      const key = cellKey(row, col)
      boardSet.add(key)
      regionOf.set(key, regionIndex)
    })
  })

  const sameRegion = (row: number, col: number, regionIndex: number) =>
    regionOf.get(cellKey(row, col)) === regionIndex
  const onBoard = (row: number, col: number) => boardSet.has(cellKey(row, col))

  puzzle.regions.forEach((region, regionIndex) => {
    const sorted = [...region.indices].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const anchor = sorted[0]
    // Prefer to hang the chip on an outer corner of the puzzle for that "tag"
    // look; fall back to the region's top-left.
    const chipHost = pickChipHost(region.indices, onBoard) ?? anchor

    region.indices.forEach(([row, col]) => {
      const key = cellKey(row, col)
      const top = sameRegion(row - 1, col, regionIndex)
      const right = sameRegion(row, col + 1, regionIndex)
      const bottom = sameRegion(row + 1, col, regionIndex)
      const left = sameRegion(row, col - 1, regionIndex)
      const classList: string[] = []
      if (!top) classList.push('pips-edge-top')
      if (!right) classList.push('pips-edge-right')
      if (!bottom) classList.push('pips-edge-bottom')
      if (!left) classList.push('pips-edge-left')
      // Round the region tint at convex region corners.
      if (!top && !left) classList.push('pips-r-tl')
      if (!top && !right) classList.push('pips-r-tr')
      if (!bottom && !left) classList.push('pips-r-bl')
      if (!bottom && !right) classList.push('pips-r-br')
      // Round the beige backing at convex corners of the whole puzzle shape.
      const offTop = !onBoard(row - 1, col)
      const offRight = !onBoard(row, col + 1)
      const offBottom = !onBoard(row + 1, col)
      const offLeft = !onBoard(row, col - 1)
      if (offTop && offLeft) classList.push('pips-b-tl')
      if (offTop && offRight) classList.push('pips-b-tr')
      if (offBottom && offLeft) classList.push('pips-b-bl')
      if (offBottom && offRight) classList.push('pips-b-br')

      const isChipHost = chipHost[0] === row && chipHost[1] === col
      cells.push({
        key,
        row,
        col,
        regionIndex,
        label: isChipHost ? regionLabel(region) : null,
        chipCorner: isChipHost ? chipCornerFor(row, col, onBoard) : 'tl',
        classes: classList.join(' '),
      })
    })
  })

  return { boardSet, cells }
}

// Choose a cell whose corner lies on the puzzle's outer edge so the chip hangs
// off the silhouette (as in the real game). Falls back handled by the caller.
function pickChipHost(
  indices: PipsRegion['indices'],
  onBoard: (row: number, col: number) => boolean,
): [number, number] | null {
  const sorted = [...indices].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (const [row, col] of sorted) {
    if (!onBoard(row - 1, col) || !onBoard(row, col + 1) || !onBoard(row, col - 1)) {
      return [row, col]
    }
  }
  return sorted[0] ?? null
}

function chipCornerFor(row: number, col: number, onBoard: (row: number, col: number) => boolean): string {
  if (!onBoard(row, col + 1)) return 'tr'
  if (!onBoard(row - 1, col)) return 'tl'
  if (!onBoard(row, col - 1)) return 'tl'
  return 'tl'
}

function regionLabel(region: PipsRegion): string | null {
  switch (region.type) {
    case 'sum':
      return String(region.target ?? '')
    case 'less':
      return `<${region.target ?? ''}`
    case 'greater':
      return `>${region.target ?? ''}`
    case 'equals':
      return '='
    case 'unequal':
      return '≠'
    default:
      return null
  }
}

function evaluateRegion(
  region: PipsRegion,
  filled: Map<string, { value: number; dominoIndex: number }>,
): RegionStatus {
  const values: number[] = []
  for (const [row, col] of region.indices) {
    const cell = filled.get(cellKey(row, col))
    if (cell) values.push(cell.value)
  }
  const complete = values.length === region.indices.length
  const total = values.reduce((sum, value) => sum + value, 0)

  switch (region.type) {
    case 'sum':
      if (total > (region.target ?? 0)) return 'violated'
      if (complete) return total === region.target ? 'satisfied' : 'violated'
      return 'neutral'
    case 'less':
      if (total >= (region.target ?? 0)) return 'violated'
      return complete ? 'satisfied' : 'neutral'
    case 'greater':
      if (total > (region.target ?? 0)) return 'satisfied'
      return complete ? 'violated' : 'neutral'
    case 'equals':
      if (new Set(values).size > 1) return 'violated'
      return complete ? 'satisfied' : 'neutral'
    case 'unequal':
      if (new Set(values).size !== values.length) return 'violated'
      return complete ? 'satisfied' : 'neutral'
    default:
      return complete ? 'satisfied' : 'neutral'
  }
}

function placementFor(anchor: Cell, orientation: number): PipsPlacement {
  const [dr, dc] = DIRECTIONS[orientation]
  return [anchor, [anchor[0] + dr, anchor[1] + dc]]
}

function computeFilled(
  anchors: (Cell | null)[],
  orientations: number[],
  puzzle: PipsPuzzle | null,
  excludeIndex?: number,
): Map<string, { value: number; dominoIndex: number }> {
  const map = new Map<string, { value: number; dominoIndex: number }>()
  if (!puzzle) return map
  anchors.forEach((anchor, dominoIndex) => {
    if (!anchor || dominoIndex === excludeIndex) return
    const [[r1, c1], [r2, c2]] = placementFor(anchor, orientations[dominoIndex])
    const [a, b] = puzzle.dominoes[dominoIndex]
    map.set(cellKey(r1, c1), { value: a, dominoIndex })
    map.set(cellKey(r2, c2), { value: b, dominoIndex })
  })
  return map
}

function canPlace(
  anchor: Cell,
  orientation: number,
  boardSet: Set<string>,
  others: Map<string, { value: number; dominoIndex: number }>,
): boolean {
  const [[r1, c1], [r2, c2]] = placementFor(anchor, orientation)
  for (const [row, col] of [
    [r1, c1],
    [r2, c2],
  ]) {
    const key = cellKey(row, col)
    if (!boardSet.has(key) || others.has(key)) return false
  }
  return true
}

function placementsToState(
  placements: PipsPlacement[],
  count: number,
): { anchors: (Cell | null)[]; orientations: number[] } {
  const anchors: (Cell | null)[] = Array.from({ length: count }, () => null)
  const orientations: number[] = Array.from({ length: count }, () => 0)
  placements.slice(0, count).forEach((placement, index) => {
    const [[r1, c1], [r2, c2]] = placement
    const dr = r2 - r1
    const dc = c2 - c1
    const orientation = DIRECTIONS.findIndex(([ddr, ddc]) => ddr === dr && ddc === dc)
    anchors[index] = [r1, c1]
    orientations[index] = orientation >= 0 ? orientation : 0
  })
  return { anchors, orientations }
}

function normalizeAttempt(state: Partial<PipsAttemptState>, count: number): PipsAttemptState {
  const anchors: (Cell | null)[] = Array.from({ length: count }, () => null)
  const orientations: number[] = Array.from({ length: count }, () => 0)
  if (Array.isArray(state.anchors)) {
    state.anchors.slice(0, count).forEach((anchor, index) => {
      if (Array.isArray(anchor) && anchor.length === 2 && anchor.every((n) => typeof n === 'number')) {
        anchors[index] = [anchor[0], anchor[1]]
      }
    })
  }
  if (Array.isArray(state.orientations)) {
    state.orientations.slice(0, count).forEach((value, index) => {
      if (typeof value === 'number' && value >= 0 && value < DIRECTIONS.length) orientations[index] = value
    })
  }
  return { anchors, orientations, elapsedSeconds: Number(state.elapsedSeconds ?? 0) }
}

function normalizePlacements(raw: unknown, count: number): PipsPlacement[] | null {
  if (!Array.isArray(raw)) return null
  const placements = raw.filter(isPlacement) as PipsPlacement[]
  if (placements.length === 0) return null
  return placements.slice(0, count)
}

function isPlacement(entry: unknown): entry is PipsPlacement {
  return (
    Array.isArray(entry) &&
    entry.length === 2 &&
    entry.every((cell) => Array.isArray(cell) && cell.length === 2 && cell.every((n) => typeof n === 'number'))
  )
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
