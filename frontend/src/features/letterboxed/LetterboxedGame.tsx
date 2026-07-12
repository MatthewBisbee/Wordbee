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
  LetterboxedGuessResponse,
  LetterboxedPuzzle,
  LetterboxedSolution,
  MultigameCompleteHandler,
  MultigameCompletionResult,
} from '../../types'

type LetterboxedAttemptState = {
  words: string[]
  currentWord: string
}

// A distinct hue per completed word, echoing NYT's rainbow of connection lines.
// The pastel set keeps contrast comfortable in both light and dark themes.
const WORD_COLORS = ['#f2836b', '#6bbf73', '#6fa3e0', '#c58ac9', '#e6b455', '#59c2be']

const REASON_MESSAGES: Record<string, string> = {
  'too-short': 'Words must be at least 3 letters',
  'not-on-board': 'Use only letters on the box',
  chain: 'Start with the previous word’s last letter',
  'not-a-word': 'Not in word list',
}

export function LetterboxedGame({
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
  const [puzzle, setPuzzle] = useState<LetterboxedPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [words, setWords] = useState<string[]>([])
  const [currentWord, setCurrentWord] = useState('')
  // Letter Boxed is replayable: `bestWords` is the fewest-word solve recorded
  // today (null until the first solve); `replaying` is true while re-attempting
  // after a solve; `isRevealed` locks the day once the fewest solution is shown.
  const [bestWords, setBestWords] = useState<string[] | null>(null)
  const [replaying, setReplaying] = useState(false)
  const [isRevealed, setIsRevealed] = useState(false)
  const [nytSolution, setNytSolution] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [shakeWord, setShakeWord] = useState(false)
  const isDraggingRef = useRef(false)
  const lastDragLetterRef = useRef('')

  const boardLetters = useMemo(() => (puzzle ? puzzle.sides.join('') : ''), [puzzle])
  const letterToSide = useMemo(() => {
    const map = new Map<string, number>()
    puzzle?.sides.forEach((side, index) => {
      side.split('').forEach((letter) => map.set(letter, index))
    })
    return map
  }, [puzzle])

  const usedLetters = useMemo(() => new Set(words.join('').split('')), [words])
  const currentLetters = useMemo(() => new Set(currentWord.split('')), [currentWord])

  // The 12 dots live on the four edges of the square; labels sit just outside it.
  const points = useMemo(() => buildBoardPoints(puzzle?.sides ?? []), [puzzle])
  const coordByLetter = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    points.forEach((point) => map.set(point.letter, { x: point.x, y: point.y }))
    return map
  }, [points])

  const hasSolved = bestWords !== null
  const isPlaying = !isRevealed && (!hasSolved || replaying)
  const canPlay = Boolean(puzzle) && isPlaying && !isInputBlocked

  const saveAttempt = useCallback(
    async (nextWords: string[], nextCurrentWord: string) => {
      // Only the pre-solve attempt is persisted; once solved, replays are
      // ephemeral (the stored result already holds the best) and the attempts
      // endpoint rejects writes for a day that has a result anyway.
      if (!puzzle || bestWords !== null) return
      const state: LetterboxedAttemptState = { words: nextWords, currentWord: nextCurrentWord }

      if (accessState?.kind === 'friends-family') {
        try {
          await saveAdditionalGameAttempt({
            accessState,
            clientSessionId,
            date: puzzle.date,
            gameKey: 'letterboxed',
            requestWithSessionRecovery,
            state,
            variant: 'daily',
          })
        } catch (error) {
          console.warn('Could not save Letter Boxed attempt', error)
        }
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'letterboxed',
            kind: 'attempt',
            variant: 'daily',
          }),
          state,
        )
      }
    },
    [accessState, bestWords, clientSessionId, puzzle, requestWithSessionRecovery],
  )

  // Takes the date explicitly (not from `puzzle` state) so its identity stays
  // stable and it can sit in loadPuzzle's deps without causing a reload loop.
  const revealSolution = useCallback(async (puzzleDate: string): Promise<string[]> => {
    try {
      const solution = await requestJson<LetterboxedSolution>('/api/games/letterboxed/reveal', {
        body: JSON.stringify({ date: puzzleDate }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      setNytSolution(solution.ourSolution)
      return solution.ourSolution
    } catch (error) {
      console.warn('Could not load Letter Boxed solution', error)
      return []
    }
  }, [])

  const saveResult = useCallback(
    async (outcome: 'won' | 'lost', finalWords: string[], revealed: boolean, announce: boolean) => {
      if (!puzzle) return

      // First solve opens the results dialog; replays/reveal update quietly.
      const notify = announce ? onGameComplete : onGameLoadedAndComplete
      const score = {
        words: finalWords,
        wordCount: finalWords.length,
        par: puzzle.par,
        nytWordCount: puzzle.nytSolutionWordCount,
        revealed,
      }
      const completedResult = {
        date: puzzle.date,
        // Letter Boxed has no timer, so time is intentionally not tracked.
        elapsedSeconds: 0,
        outcome,
        score,
        variant: 'daily',
      }

      if (accessState?.kind === 'friends-family') {
        try {
          const response = await saveAdditionalGameResult({
            accessState,
            clientSessionId,
            date: puzzle.date,
            elapsedSeconds: 0,
            gameKey: 'letterboxed',
            outcome,
            requestWithSessionRecovery,
            score,
            variant: 'daily',
          })
          const stats = await loadStatsForGameUser({
            accessState,
            clientSessionId,
            gameKey: 'letterboxed',
            requestWithSessionRecovery,
          })
          notify(response.result ?? completedResult, stats)
        } catch (error) {
          console.warn('Could not save Letter Boxed result', error)
          showToast(error instanceof Error ? error.message : 'Could not save result')
        }
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'letterboxed',
            kind: 'result',
            variant: 'daily',
          }),
          completedResult,
        )
        clearStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'letterboxed',
            kind: 'attempt',
            variant: 'daily',
          }),
        )
        notify(completedResult, null)
      }
    },
    [accessState, clientSessionId, puzzle, requestWithSessionRecovery, showToast, onGameComplete, onGameLoadedAndComplete],
  )

  const loadPuzzle = useCallback(async () => {
    onGameReset()
    setPuzzleError('')
    setWords([])
    setCurrentWord('')
    setBestWords(null)
    setReplaying(false)
    setIsRevealed(false)
    setNytSolution([])

    try {
      const activePuzzle = await requestJson<LetterboxedPuzzle>(
        `/api/games/letterboxed/today?date=${encodeURIComponent(requestedDate)}`,
        { cache: 'no-store' },
      )
      setPuzzle(activePuzzle)
      notifyDateClamp(activePuzzle, 'letterboxed', showToast)
      onResolvedDate(activePuzzle.date)

      const hydrateCompleted = async (res: MultigameCompletionResult, stats: unknown) => {
        const solvedWords = Array.isArray(res.score?.words) ? (res.score.words as string[]) : []
        const solved = res.outcome === 'won' && solvedWords.length > 0
        // A give-up (non-won) counts as revealed/locked. A solved day is locked
        // only once the player explicitly revealed the fewest solution.
        const revealed = Boolean(res.score?.revealed) || res.outcome !== 'won'
        setBestWords(solved ? solvedWords : null)
        setReplaying(false)
        setIsRevealed(revealed)
        setWords(solved ? solvedWords : [])
        setCurrentWord('')
        // The fewest solution is only fetched (and shown) once the day is locked.
        if (revealed) await revealSolution(activePuzzle.date)
        onGameLoadedAndComplete(res, stats as never)
      }

      if (accessState?.kind === 'friends-family') {
        const statusResponse = await loadAdditionalGameStatus({
          accessState,
          clientSessionId,
          date: activePuzzle.date,
          gameKey: 'letterboxed',
          requestWithSessionRecovery,
          variant: 'daily',
        })

        if (statusResponse.completed && statusResponse.result) {
          const res = statusResponse.result
          const stats = await loadStatsForGameUser({
            accessState,
            clientSessionId,
            gameKey: 'letterboxed',
            requestWithSessionRecovery,
          })
          await hydrateCompleted(res, stats)
        } else if (statusResponse.attempt) {
          const state = statusResponse.attempt.state as Partial<LetterboxedAttemptState>
          setWords(Array.isArray(state.words) ? state.words : [])
          setCurrentWord(typeof state.currentWord === 'string' ? state.currentWord : '')
        }
      } else {
        const localResult = loadStoredAdditionalGameValue<MultigameCompletionResult>(
          getAdditionalGameStorageKey({
            date: activePuzzle.date,
            gameKey: 'letterboxed',
            kind: 'result',
            variant: 'daily',
          }),
        )
        if (localResult) {
          await hydrateCompleted(localResult, null)
        } else {
          const localAttempt = loadStoredAdditionalGameValue<Partial<LetterboxedAttemptState>>(
            getAdditionalGameStorageKey({
              date: activePuzzle.date,
              gameKey: 'letterboxed',
              kind: 'attempt',
              variant: 'daily',
            }),
          )
          if (localAttempt) {
            setWords(Array.isArray(localAttempt.words) ? localAttempt.words : [])
            setCurrentWord(typeof localAttempt.currentWord === 'string' ? localAttempt.currentWord : '')
          }
        }
      }
    } catch (error) {
      setPuzzleError(error instanceof Error ? error.message : 'Could not load Letter Boxed')
    }
  }, [
    accessState,
    clientSessionId,
    onGameLoadedAndComplete,
    onGameReset,
    onResolvedDate,
    requestedDate,
    requestWithSessionRecovery,
    revealSolution,
    showToast,
  ])

  useEffect(() => {
    void loadPuzzle()
  }, [loadPuzzle])

  const addLetter = useCallback(
    (letter: string) => {
      if (!canPlay || isSubmitting) return
      if (!letterToSide.has(letter)) return

      const previousLetter = currentWord.at(-1)
      if (previousLetter && letterToSide.get(previousLetter) === letterToSide.get(letter)) {
        showToast('Consecutive letters can’t share a side')
        return
      }
      setCurrentWord((previous) => previous + letter)
    },
    [canPlay, currentWord, isSubmitting, letterToSide, showToast],
  )

  // Drag equivalent of addLetter: functional update (so rapid pointermoves chain
  // correctly before a re-render) and silent (no toast spam while sweeping over
  // same-side letters). Revisiting a letter non-consecutively is allowed.
  const dragAppendLetter = useCallback(
    (letter: string) => {
      if (!canPlay || isSubmitting) return
      if (!letterToSide.has(letter)) return
      setCurrentWord((previous) => {
        const previousLetter = previous.at(-1)
        if (previousLetter === letter) return previous
        if (previousLetter && letterToSide.get(previousLetter) === letterToSide.get(letter)) {
          return previous
        }
        return previous + letter
      })
    },
    [canPlay, isSubmitting, letterToSide],
  )

  const deleteLetter = useCallback(() => {
    if (!canPlay) return
    // The seed letter (last letter of the previous word) is normally locked.
    const seedLength = words.length > 0 ? 1 : 0
    if (currentWord.length > seedLength) {
      setCurrentWord(currentWord.slice(0, -1))
      return
    }
    // Sitting on just the seed: step back into the previous completed word so
    // deleting keeps working across the word boundary (that word's last letter
    // is this seed). The word returns to the input to be edited or removed.
    if (words.length > 0) {
      const restored = words[words.length - 1]
      const nextWords = words.slice(0, -1)
      setWords(nextWords)
      setCurrentWord(restored)
      void saveAttempt(nextWords, restored)
    }
  }, [canPlay, currentWord, saveAttempt, words])

  const restart = useCallback(() => {
    if (!isPlaying) return
    setWords([])
    setCurrentWord('')
    void saveAttempt([], '')
  }, [isPlaying, saveAttempt])

  // After a solve: clear the board for another attempt (best score is kept).
  const playAgain = useCallback(() => {
    if (isRevealed) return
    setReplaying(true)
    setWords([])
    setCurrentWord('')
  }, [isRevealed])

  // Give up on beating the score: show NYT's fewest solution and lock the day.
  const revealFewest = useCallback(async () => {
    if (!puzzle || bestWords === null || isRevealed) return
    setIsRevealed(true)
    setReplaying(false)
    setWords(bestWords)
    setCurrentWord('')
    await revealSolution(puzzle.date)
    await saveResult('won', bestWords, true, false)
  }, [bestWords, isRevealed, puzzle, revealSolution, saveResult])

  const submitWord = useCallback(async () => {
    if (!puzzle || !canPlay || isSubmitting) return
    if (currentWord.length < 3) {
      setShakeWord(true)
      window.setTimeout(() => setShakeWord(false), 500)
      showToast('Words must be at least 3 letters')
      return
    }
    if (words.includes(currentWord)) {
      setShakeWord(true)
      window.setTimeout(() => setShakeWord(false), 500)
      showToast('Already played that word')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await requestJson<LetterboxedGuessResponse>('/api/games/letterboxed/guess', {
        body: JSON.stringify({
          date: puzzle.date,
          word: currentWord,
          previousWord: words.at(-1) ?? '',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })

      if (!response.valid) {
        setShakeWord(true)
        window.setTimeout(() => setShakeWord(false), 500)
        showToast(REASON_MESSAGES[response.reason ?? ''] ?? 'Not in word list')
        return
      }

      const nextWords = [...words, response.word]
      const nextUsed = new Set(nextWords.join('').split(''))
      const seed = response.word.at(-1) ?? ''
      const solved = nextUsed.size === boardLetters.length

      setCurrentWord(solved ? '' : seed)

      if (solved) {
        const firstSolve = bestWords === null
        const isBest = firstSolve || nextWords.length < bestWords.length
        const nextBest = isBest ? nextWords : bestWords
        setWords(nextBest)
        setBestWords(nextBest)
        setReplaying(false)
        // Persist only a new best (the first solve always is). The fewest
        // solution stays hidden until the player chooses to reveal it.
        if (isBest) {
          await saveResult('won', nextBest, false, firstSolve)
        }
        showToast(
          firstSolve
            ? `Solved in ${nextWords.length} word${nextWords.length === 1 ? '' : 's'}!`
            : isBest
              ? `New best — ${nextWords.length} word${nextWords.length === 1 ? '' : 's'}!`
              : `Solved in ${nextWords.length}. Your best is ${bestWords.length}.`,
          1900,
        )
      } else {
        setWords(nextWords)
        void saveAttempt(nextWords, seed)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not check word')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    puzzle,
    canPlay,
    isSubmitting,
    currentWord,
    words,
    bestWords,
    boardLetters.length,
    saveResult,
    saveAttempt,
    showToast,
  ])


  // Physical keyboard: letters play a dot, Backspace deletes, Enter submits.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!canPlay || isSubmitting) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Enter') {
        event.preventDefault()
        void submitWord()
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        deleteLetter()
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        const letter = event.key.toUpperCase()
        if (letterToSide.has(letter)) {
          event.preventDefault()
          addLetter(letter)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addLetter, canPlay, deleteLetter, isSubmitting, letterToSide, submitWord])

  // Drag-to-spell: while a pointer is down, sweep across dots to append letters.
  // Derived from the Strands drag, but a release never auto-submits — Enter (or a
  // tap on the last letter) still commits the word, preserving tap-to-spell.
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current) return
      if (event.cancelable) event.preventDefault()
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const node = element instanceof Element ? element.closest('[data-letter]') : null
      const letter = node?.getAttribute('data-letter')
      if (letter && letter !== lastDragLetterRef.current) {
        lastDragLetterRef.current = letter
        dragAppendLetter(letter)
      }
    }
    const endDrag = () => {
      isDraggingRef.current = false
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [dragAppendLetter])

  const insight =
    puzzle && bestWords
      ? buildInsight(bestWords.length, puzzle.nytSolutionWordCount, puzzle.par, isRevealed)
      : null

  return (
    <main className="game-page game-page--letterboxed" aria-label="Letter Boxed game">
      <section className="game-panel letterboxed-panel">
        {puzzleError && (
          <div className="game-error">
            <span>{puzzleError}</span>
            <button className="game-secondary-button" onClick={() => void loadPuzzle()} type="button">
              Retry
            </button>
          </div>
        )}

        {!puzzle && !puzzleError && <p className="game-loading">Loading Letter Boxed...</p>}

        {puzzle && (
          <>
            <div
              className={[
                'letterboxed-current',
                currentWord ? '' : 'letterboxed-current--placeholder',
                shakeWord ? 'letterboxed-current--shake' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-live="polite"
            >
              {currentWord || (isPlaying ? '' : 'Solved')}
            </div>

            <div className="letterboxed-board-wrapper">
              <svg className="letterboxed-svg" viewBox="0 0 100 100" role="img" aria-label="Letter Boxed board">
                <rect className="letterboxed-box" x="20" y="20" width="60" height="60" rx="1.5" />

                {words.map((word, wordIndex) => (
                  <polyline
                    key={`${word}-${wordIndex}`}
                    className="letterboxed-line"
                    points={toPoints(word, coordByLetter)}
                    style={{ stroke: WORD_COLORS[wordIndex % WORD_COLORS.length] }}
                  />
                ))}

                {currentWord.length > 1 && (
                  <polyline
                    className="letterboxed-line letterboxed-line--active"
                    points={toPoints(currentWord, coordByLetter)}
                  />
                )}

                {points.map((point) => {
                  const isLast = currentWord.at(-1) === point.letter
                  const isUsed = usedLetters.has(point.letter) || currentLetters.has(point.letter)
                  return (
                    <g
                      key={point.letter}
                      className="letterboxed-node"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        if (!canPlay) return
                        isDraggingRef.current = true
                        lastDragLetterRef.current = point.letter
                        addLetter(point.letter)
                      }}
                    >
                      <circle
                        className="letterboxed-hit"
                        cx={point.x}
                        cy={point.y}
                        r="8"
                        data-letter={point.letter}
                      />
                      <circle
                        className={[
                          'letterboxed-dot',
                          isUsed ? 'letterboxed-dot--used' : '',
                          isLast ? 'letterboxed-dot--current' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        cx={point.x}
                        cy={point.y}
                        r={isLast ? 3.4 : 2.6}
                      />
                      <text
                        className="letterboxed-letter"
                        x={point.labelX}
                        y={point.labelY}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {point.letter}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>

            {words.length > 0 && (
              <ul className="letterboxed-word-list" aria-label="Words played">
                {words.map((word, wordIndex) => (
                  <li
                    key={`${word}-${wordIndex}`}
                    className="letterboxed-word-chip"
                    style={{ borderColor: WORD_COLORS[wordIndex % WORD_COLORS.length] }}
                  >
                    {word}
                  </li>
                ))}
              </ul>
            )}

            {isPlaying ? (
              <div className="game-actions">
                <button className="game-secondary-button" onClick={restart} type="button" disabled={words.length === 0 && currentWord.length === 0}>
                  Restart
                </button>
                <button className="game-secondary-button" onClick={deleteLetter} type="button" disabled={currentWord.length === 0}>
                  Delete
                </button>
                <button
                  className="game-primary-button"
                  onClick={() => void submitWord()}
                  type="button"
                  disabled={currentWord.length < 3 || isSubmitting}
                >
                  Enter
                </button>
              </div>
            ) : !isRevealed && bestWords ? (
              // Solved, not yet locked: keep the best, offer another go or reveal.
              <div className="letterboxed-complete">
                <strong className="letterboxed-complete__headline">
                  Solved in {bestWords.length} word{bestWords.length === 1 ? '' : 's'}
                </strong>
                <p className="letterboxed-complete__sub">
                  Play again to beat it, or reveal the fewest-word solution.
                </p>
                <div className="game-actions">
                  <button className="game-primary-button" onClick={playAgain} type="button">
                    Play again
                  </button>
                  <button className="game-secondary-button" onClick={() => void revealFewest()} type="button">
                    Reveal solution
                  </button>
                </div>
              </div>
            ) : (
              <div className="letterboxed-complete">
                {insight && (
                  <>
                    <strong className="letterboxed-complete__headline">{insight.headline}</strong>
                    <p className="letterboxed-complete__sub">{insight.detail}</p>
                  </>
                )}
                {nytSolution.length > 0 && (
                  <div className="letterboxed-solution">
                    <span className="letterboxed-solution__label">Fewest possible</span>
                    <div className="letterboxed-solution__words">
                      {nytSolution.map((word) => (
                        <span key={word} className="letterboxed-word-chip letterboxed-word-chip--nyt">
                          {word}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}

type BoardPoint = {
  letter: string
  side: number
  x: number
  y: number
  labelX: number
  labelY: number
}

// Lay the four three-letter sides onto the edges of a 100x100 viewBox square.
function buildBoardPoints(sides: string[]): BoardPoint[] {
  if (sides.length !== 4) return []
  const inset = 20
  const size = 60
  const fractions = [0.2, 0.5, 0.8]
  const labelGap = 11
  const points: BoardPoint[] = []

  sides.forEach((side, sideIndex) => {
    side.split('').forEach((letter, letterIndex) => {
      const offset = inset + size * fractions[letterIndex]
      let x = 0
      let y = 0
      let labelX = 0
      let labelY = 0
      if (sideIndex === 0) {
        // top
        x = offset
        y = inset
        labelX = offset
        labelY = inset - labelGap
      } else if (sideIndex === 1) {
        // right
        x = inset + size
        y = offset
        labelX = inset + size + labelGap
        labelY = offset
      } else if (sideIndex === 2) {
        // bottom
        x = offset
        y = inset + size
        labelX = offset
        labelY = inset + size + labelGap
      } else {
        // left
        x = inset
        y = offset
        labelX = inset - labelGap
        labelY = offset
      }
      points.push({ letter, side: sideIndex, x, y, labelX, labelY })
    })
  })

  return points
}

function toPoints(word: string, coordByLetter: Map<string, { x: number; y: number }>) {
  return word
    .split('')
    .map((letter) => {
      const coord = coordByLetter.get(letter)
      return coord ? `${coord.x},${coord.y}` : ''
    })
    .filter(Boolean)
    .join(' ')
}

function buildInsight(wordCount: number, targetWordCount: number, par: number, revealed: boolean) {
  if (revealed) {
    return {
      headline: 'Revealed',
      detail: `You unlocked the fewest possible solution (${targetWordCount} word${targetWordCount === 1 ? '' : 's'}).`,
    }
  }
  const wordLabel = `${wordCount} word${wordCount === 1 ? '' : 's'}`
  if (wordCount < targetWordCount) {
    return { headline: 'Better than target!', detail: `Solved in ${wordLabel} — fewer than the target of ${targetWordCount}.` }
  }
  if (wordCount === targetWordCount) {
    return { headline: 'Matched target', detail: `Solved in ${wordLabel}, same as the target solution.` }
  }
  if (wordCount <= par) {
    return { headline: 'Under par', detail: `Solved in ${wordLabel} (par ${par}).` }
  }
  return { headline: 'Solved', detail: `Solved in ${wordLabel}. Target was ${targetWordCount}.` }
}
