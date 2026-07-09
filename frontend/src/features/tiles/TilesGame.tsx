import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearStoredAdditionalGameValue,
  getAdditionalGameStorageKey,
  loadAdditionalGameStatus,
  loadStatsForGameUser,
  loadStoredAdditionalGameValue,
  notifyDateClamp,
  saveAdditionalGameAttempt,
  saveStoredAdditionalGameValue,
  type SessionRequest,
} from '../games/game-utils'
import { requestJson } from '../../lib/api'
import type {
  AccessState,
  MultigameCompleteHandler,
  TilesPalette,
  TilesPuzzle,
  TilesResultResponse,
  TilesScore,
  TilesTile,
} from '../../types'

type Move = [number, number]
type LayerState = (string | null)[]

// The play state is kept in one object so the click reducer always sees fresh
// values (avoiding stale closures) and a mid-game refresh can be reconstructed
// by replaying the recorded moves.
type Play = {
  layers: LayerState[]
  selected: number | null
  combo: number
  longest: number
  wrong: number
  moves: Move[]
  solved: boolean
  errorTile: number | null
}

type TilesAttemptState = { moves: Move[] }

const BOARD_SIZE = 30

function isTileEmpty(layers: LayerState) {
  return layers.every((layer) => layer === null)
}

function initialLayers(board: TilesTile[]): LayerState[] {
  return board.map((tile) => [...tile.layers])
}

// Replay recorded moves onto a fresh board, mirroring the server's simulator, to
// reconstruct the current layers/combo/longest after a refresh or from storage.
function replayMoves(board: TilesTile[], moves: Move[]): Play {
  const layers = initialLayers(board)
  let combo = 0
  let longest = 0
  let wrong = 0
  let selected: number | null = null

  for (const [first, second] of moves) {
    if (first === second || !layers[first] || !layers[second]) continue
    selected = second
    if (isTileEmpty(layers[first])) continue // free pick — no scoring
    const shared: number[] = []
    for (let index = 0; index < layers[first].length; index += 1) {
      if (layers[first][index] !== null && layers[first][index] === layers[second][index]) {
        shared.push(index)
      }
    }
    if (shared.length > 0) {
      shared.forEach((index) => {
        layers[first][index] = null
        layers[second][index] = null
      })
      combo += 1
      longest = Math.max(longest, combo)
    } else {
      combo = 0
      wrong += 1
    }
  }

  return {
    layers,
    selected,
    combo,
    longest,
    wrong,
    moves: [...moves],
    solved: layers.every(isTileEmpty),
    errorTile: null,
  }
}

// Client-side random board for Zen mode (untracked), mirroring NYT's generator:
// each layer draws BOARD_SIZE/2 variants and duplicates them so every variant
// appears in pairs and the board is always clearable.
function generateZenBoard(zLayer: string[], layers: string[][]): TilesTile[] {
  const zPick =
    zLayer.length <= 2
      ? [...zLayer]
      : [zLayer[0], zLayer[1 + Math.floor(Math.random() * (zLayer.length - 1))]]

  const pools = layers.map((variants) => {
    const half = BOARD_SIZE / 2
    const picks = Array.from({ length: half }, () => variants[Math.floor(Math.random() * variants.length)])
    const pool = [...picks, ...picks]
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1))
      ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
    }
    return pool
  })

  return Array.from({ length: BOARD_SIZE }, (_, id) => ({
    id,
    z: zPick[id % 2],
    layers: pools.map((pool) => pool.pop() as string),
  }))
}

function reduceSelect(prev: Play, index: number): Play {
  if (prev.solved) return prev

  if (prev.selected === null) {
    if (isTileEmpty(prev.layers[index])) return prev
    return { ...prev, selected: index, errorTile: null }
  }

  const first = prev.selected
  const second = index
  if (first === second) return { ...prev, selected: null, errorTile: null } // deselect
  if (isTileEmpty(prev.layers[second])) return prev // can't match onto an empty tile

  const firstWasEmpty = isTileEmpty(prev.layers[first])
  const shared: number[] = []
  for (let layer = 0; layer < prev.layers[first].length; layer += 1) {
    if (prev.layers[first][layer] !== null && prev.layers[first][layer] === prev.layers[second][layer]) {
      shared.push(layer)
    }
  }

  const layers = prev.layers.map((tile) => [...tile])
  shared.forEach((layer) => {
    layers[first][layer] = null
    layers[second][layer] = null
  })

  const moves: Move[] = [...prev.moves, [first, second]]
  let { combo, longest, wrong } = prev
  let errorTile: number | null = null
  if (firstWasEmpty) {
    // Free pick after a tile cleared — carry the combo, no penalty.
  } else if (shared.length > 0) {
    combo += 1
    longest = Math.max(longest, combo)
  } else {
    combo = 0
    wrong += 1
    errorTile = second
  }

  return {
    layers,
    selected: second,
    combo,
    longest,
    wrong,
    moves,
    solved: layers.every(isTileEmpty),
    errorTile,
  }
}

export function TilesGame({
  accessState,
  clientSessionId,
  isInputBlocked,
  requestedDate,
  requestWithSessionRecovery,
  showToast,
  isZen: isZenProp = false,
  onToggleZen,
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
  isZen?: boolean
  onToggleZen?: (zen: boolean) => void
  onGameComplete: MultigameCompleteHandler
  onGameLoadedAndComplete: MultigameCompleteHandler
  onGameReset: () => void
  onResolvedDate: (date: string) => void
}) {
  const [puzzle, setPuzzle] = useState<TilesPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [board, setBoard] = useState<TilesTile[]>([])
  const [play, setPlay] = useState<Play | null>(null)
  const [palette, setPalette] = useState<TilesPalette | null>(null)
  const [isZen, setIsZen] = useState(false)
  const [alreadyCompleted, setAlreadyCompleted] = useState(false)

  const paletteCacheRef = useRef<Record<string, TilesPalette>>({})
  const savedResultRef = useRef(false)
  const attemptTimerRef = useRef<number | null>(null)

  const isSignedIn = accessState?.kind === 'friends-family'
  const canPlay = Boolean(play) && !play?.solved && !isInputBlocked && !alreadyCompleted

  const resultKey = (date: string, gameVariant: string) =>
    getAdditionalGameStorageKey({ date, gameKey: 'tiles', kind: 'result', variant: gameVariant })
  const attemptStorageKey = (date: string, gameVariant: string) =>
    getAdditionalGameStorageKey({ date, gameKey: 'tiles', kind: 'attempt', variant: gameVariant })

  const persistAttempt = useCallback(
    (date: string, moves: Move[]) => {
      const key = attemptStorageKey(date, 'daily')
      if (moves.length > 0) {
        saveStoredAdditionalGameValue(key, { moves } satisfies TilesAttemptState)
      } else {
        clearStoredAdditionalGameValue(key)
      }
      if (attemptTimerRef.current !== null) window.clearTimeout(attemptTimerRef.current)
      attemptTimerRef.current = window.setTimeout(() => {
        attemptTimerRef.current = null
        void saveAdditionalGameAttempt({
          accessState,
          clientSessionId,
          date,
          gameKey: 'tiles',
          requestWithSessionRecovery,
          state: { moves },
          variant: 'daily',
        })
      }, 700)
    },
    [accessState, clientSessionId, requestWithSessionRecovery],
  )

  const activatePalette = useCallback(
    async (filename: string, fallback: TilesPalette): Promise<TilesPalette | null> => {
      const cached = paletteCacheRef.current[filename]
      if (cached) {
        setPalette(cached)
        return cached
      }
      paletteCacheRef.current[fallback.filename] = fallback
      if (filename === fallback.filename) {
        setPalette(fallback)
        return fallback
      }
      try {
        const fetched = await requestJson<TilesPalette>('/api/games/tiles/palette', {
          body: JSON.stringify({ filename }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        paletteCacheRef.current[filename] = fetched
        setPalette(fetched)
        return fetched
      } catch {
        showToast('Could not load that palette')
        return null
      }
    },
    [showToast],
  )

  const loadPuzzle = useCallback(async () => {
    onGameReset()
    setPuzzleError('')
    setPlay(null)
    setIsZen(false)
    setAlreadyCompleted(false)
    savedResultRef.current = false

    try {
      const activePuzzle = await requestJson<TilesPuzzle>(
        `/api/games/tiles/today?date=${encodeURIComponent(requestedDate)}`,
        { cache: 'no-store' },
      )
      setPuzzle(activePuzzle)
      setBoard(activePuzzle.board)
      setPalette(activePuzzle.palette)
      paletteCacheRef.current = { [activePuzzle.palette.filename]: activePuzzle.palette }
      notifyDateClamp(activePuzzle, 'tiles', showToast)
      onResolvedDate(activePuzzle.date)

      // Prefer a finished result, then a stored/in-flight attempt.
      const status = await loadAdditionalGameStatus({
        accessState,
        clientSessionId,
        date: activePuzzle.date,
        gameKey: 'tiles',
        requestWithSessionRecovery,
        variant: 'daily',
      })

      let moves: Move[] = []
      if (status.completed && status.result) {
        // The board is deterministic, so a completed day is just fully cleared.
        const cleared = replayMoves(activePuzzle.board, [])
        cleared.layers = activePuzzle.board.map((tile) => tile.layers.map(() => null))
        cleared.solved = true
        cleared.longest = Number((status.result.score as TilesScore).longestCombo) || 0
        setPlay(cleared)
        setAlreadyCompleted(true)
        savedResultRef.current = true
        onGameLoadedAndComplete(
          {
            date: activePuzzle.date,
            elapsedSeconds: null,
            outcome: 'won',
            variant: 'daily',
            score: status.result.score,
          },
          null,
        )
        return
      }

      const attemptMoves = (status.attempt?.state as TilesAttemptState | undefined)?.moves
      const localAttempt = loadStoredAdditionalGameValue<TilesAttemptState>(
        attemptStorageKey(activePuzzle.date, 'daily'),
      )
      moves = Array.isArray(attemptMoves) ? attemptMoves : localAttempt?.moves ?? []

      setPlay(replayMoves(activePuzzle.board, Array.isArray(moves) ? moves : []))
    } catch (error) {
      setPuzzleError(error instanceof Error ? error.message : 'Could not load Tiles')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDate])

  useEffect(() => {
    void loadPuzzle()
  }, [loadPuzzle])

  // Save the result once the (tracked) board is cleared.
  useEffect(() => {
    if (!puzzle || !play?.solved || isZen || savedResultRef.current) return
    savedResultRef.current = true
    clearStoredAdditionalGameValue(attemptStorageKey(puzzle.date, 'daily'))
    clearStoredAdditionalGameValue(resultKey(puzzle.date, 'daily'))

    const finish = async () => {
      try {
        const response = await requestWithSessionRecovery<TilesResultResponse>(
          '/api/games/tiles/result',
          () => ({
            body: JSON.stringify({
              clientSessionId,
              date: puzzle.date,
              friendsFamilyToken:
                accessState?.kind === 'friends-family' ? accessState.token : '',
              moves: play.moves,
              variant: 'daily',
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          }),
        )
        const stats = isSignedIn
          ? await loadStatsForGameUser({
              accessState,
              clientSessionId,
              gameKey: 'tiles',
              requestWithSessionRecovery,
            })
          : null
        showToast(response.score.perfect ? 'Perfect solve!' : `Longest combo ×${response.score.longestCombo}`, 2600)
        onGameComplete(
          {
            date: puzzle.date,
            elapsedSeconds: null,
            outcome: 'won',
            variant: 'daily',
            score: response.score as unknown as Record<string, unknown>,
          },
          stats,
        )
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not save result')
      }
    }
    void finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play?.solved])

  const handleTileClick = useCallback(
    (index: number) => {
      if (!canPlay) return
      setPlay((prev) => {
        if (!prev) return prev
        const next = reduceSelect(prev, index)
        if (next !== prev && !isZen && puzzle) {
          persistAttempt(puzzle.date, next.moves)
        }
        return next
      })
    },
    [canPlay, isZen, persistAttempt, puzzle],
  )

  // Clear the transient error highlight shortly after a wrong match.
  useEffect(() => {
    if (play?.errorTile === null || play?.errorTile === undefined) return
    const timer = window.setTimeout(() => {
      setPlay((prev) => (prev ? { ...prev, errorTile: null } : prev))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [play?.errorTile])

  const startZen = useCallback(async () => {
    if (!puzzle) return
    const randomPaletteMeta = puzzle.palettes[Math.floor(Math.random() * puzzle.palettes.length)]
    const loadedPalette = await activatePalette(randomPaletteMeta.filename, puzzle.palette)
    if (!loadedPalette) return

    const zLayer = loadedPalette.zLayer
    const layers = loadedPalette.layers
    const zenBoard = generateZenBoard(zLayer, layers)
    setBoard(zenBoard)
    setPlay(replayMoves(zenBoard, []))
    setIsZen(true)
    setAlreadyCompleted(false)
    savedResultRef.current = false
    showToast('Endless Random — this one is just for fun', 2200)
    if (onToggleZen) onToggleZen(true)
  }, [puzzle, activatePalette, showToast, onToggleZen])

  const backToDaily = useCallback(() => {
    if (onToggleZen) onToggleZen(false)
    void loadPuzzle()
  }, [loadPuzzle, onToggleZen])

  useEffect(() => {
    if (isZenProp !== isZen) {
      if (isZenProp) {
        void startZen()
      } else {
        backToDaily()
      }
    }
  }, [isZenProp, isZen, startZen, backToDaily])

  const paletteStyle = useMemo(
    () =>
      palette
        ? ({
            '--tiles-bg': palette.bgColor,
            '--tiles-font': palette.fontColor,
            '--tiles-selection': palette.selectionColor,
          } as CSSProperties)
        : undefined,
    [palette],
  )

  const remaining = play ? play.layers.filter((layers) => !isTileEmpty(layers)).length : BOARD_SIZE

  return (
    <main className="game-page game-page--tiles" aria-label="Tiles game" style={paletteStyle}>
      <section className="game-panel tiles-panel">
        {puzzleError && (
          <div className="game-error">
            <span>{puzzleError}</span>
            <button className="game-secondary-button" onClick={() => void loadPuzzle()} type="button">
              Retry
            </button>
          </div>
        )}

        {!puzzle && !puzzleError && <p className="game-loading">Loading Tiles...</p>}

        {puzzle && palette && play && (
          <>
            {/* Active palette's art definitions (referenced by <use> below). */}
            <div className="tiles-defs" aria-hidden dangerouslySetInnerHTML={{ __html: palette.svg }} />

            <div className="tiles-hud">
              <div className="tiles-hud__combo" aria-live="polite">
                <span className="tiles-hud__combo-value">{play.combo}</span>
                <span className="tiles-hud__combo-label">combo</span>
              </div>
              <div className="tiles-hud__meta">
                <span className="tiles-hud__longest">Longest ×{play.longest}</span>
                <span className="tiles-hud__remaining">{remaining} left</span>
              </div>
            </div>

            <div
              className="tiles-board"
              style={{ gridTemplateColumns: `repeat(${puzzle.cols}, 1fr)` }}
              role="grid"
              aria-label="Tiles board"
            >
              {play.layers.map((layers, index) => {
                const empty = isTileEmpty(layers)
                const selected = play.selected === index
                const errored = play.errorTile === index
                return (
                  <button
                    key={board[index]?.id ?? index}
                    type="button"
                    className={[
                      'tiles-tile',
                      empty ? 'tiles-tile--empty' : '',
                      selected ? 'tiles-tile--selected' : '',
                      selected && empty ? 'tiles-tile--free' : '',
                      errored ? 'tiles-tile--error' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => handleTileClick(index)}
                    disabled={!canPlay || empty}
                    aria-label={empty ? 'Cleared tile' : `Tile ${index + 1}`}
                  >
                    <svg viewBox="0 0 44 44" className="tiles-tile__art" aria-hidden>
                      {board[index] && <use href={`#${board[index].z}`} xlinkHref={`#${board[index].z}`} />}
                      {layers.map((layerId, layer) =>
                        layerId ? <use key={layer} href={`#${layerId}`} xlinkHref={`#${layerId}`} /> : null,
                      )}
                    </svg>
                  </button>
                )
              })}
            </div>

            {play.solved && (
              <div className="tiles-solved" role="status">
                <strong>{alreadyCompleted ? 'Solved' : isZen ? 'Endless Random cleared!' : 'Board cleared!'}</strong>
              </div>
            )}

            <div className="tiles-actions">
              {isZen ? (
                <>
                  <button className="game-secondary-button" onClick={startZen} type="button">
                    New Endless Random
                  </button>
                  <button className="game-primary-button" onClick={backToDaily} type="button">
                    Back to daily
                  </button>
                </>
              ) : (
                <button
                  className="game-secondary-button"
                  onClick={startZen}
                  type="button"
                  title="Play an untracked random board"
                >
                  Endless random
                </button>
              )}
            </div>

            {/* Palette switcher disabled per user request (fixed sequential alphabetical palettes only) */}

            <p className="tiles-credit">
              Tile Art: {palette.displayName}
            </p>
          </>
        )}
      </section>
    </main>
  )
}


