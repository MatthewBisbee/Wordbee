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
  ConnectionsGuessResponse,
  ConnectionsGroup,
  ConnectionsPuzzle,
  MultigameCompleteHandler,
  MultigameCompletionResult,
} from '../../types'

const groupClassNames = ['connections-group--yellow', 'connections-group--green', 'connections-group--blue', 'connections-group--purple']

// Matches the NYT card bounce (staggered) and shake timings.
const CONNECTIONS_BOUNCE_MS = 650
const CONNECTIONS_SHAKE_MS = 500

type ConnectionsAttemptState = {
  cards: ConnectionsPuzzle['cards']
  mistakes: number
  solvedGroups: ConnectionsGroup[]
  submittedGuesses: string[][]
}

export function ConnectionsGame({
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
  const [puzzle, setPuzzle] = useState<ConnectionsPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [selectedCards, setSelectedCards] = useState<string[]>([])
  const [solvedGroups, setSolvedGroups] = useState<ConnectionsGroup[]>([])
  const [mistakes, setMistakes] = useState(0)
  const [submittedGuesses, setSubmittedGuesses] = useState<string[][]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [bouncingCards, setBouncingCards] = useState<string[]>([])
  const [shakingCards, setShakingCards] = useState<string[]>([])
  const [poppingDotIndex, setPoppingDotIndex] = useState(-1)
  const [recentSolvedTitle, setRecentSolvedTitle] = useState('')
  const startedAtRef = useRef(Date.now())
  const isAnimating = bouncingCards.length > 0 || shakingCards.length > 0

  const solvedCards = useMemo(
    () => new Set(solvedGroups.flatMap((group) => group.cards)),
    [solvedGroups],
  )
  const unsolvedCards = puzzle?.cards.filter((card) => !solvedCards.has(card.content)) ?? []
  const mistakesLeft = Math.max(0, (puzzle?.mistakesAllowed ?? 4) - mistakes)

  const saveAttempt = useCallback(
    async (
      nextSolvedGroups: ConnectionsGroup[],
      nextMistakes: number,
      nextCards: ConnectionsPuzzle['cards'],
      nextSubmittedGuesses: string[][],
    ) => {
      if (!puzzle) return

      const state: ConnectionsAttemptState = {
        cards: nextCards,
        mistakes: nextMistakes,
        solvedGroups: nextSolvedGroups,
        submittedGuesses: nextSubmittedGuesses,
      }

      if (accessState?.kind === 'friends-family') {
        try {
          await saveAdditionalGameAttempt({
            accessState,
              clientSessionId,
            date: puzzle.date,
            gameKey: 'connections',
            requestWithSessionRecovery,
            state,
            variant: 'daily',
          })
        } catch (error) {
          console.warn('Could not save Connections attempt', error)
        }
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'connections',
            kind: 'attempt',
            variant: 'daily',
          }),
          state,
        )
      }
    },
    [accessState, clientSessionId, puzzle, requestWithSessionRecovery],
  )

  const saveResult = useCallback(
    async (
      outcome: 'won' | 'lost',
      nextSolvedGroups: ConnectionsGroup[],
      nextMistakes: number,
      nextSubmittedGuesses: string[][],
    ) => {
      if (!puzzle) return

      const completedScore = {
        guesses: nextSubmittedGuesses,
        mistakes: nextMistakes,
        solvedGroups: nextSolvedGroups,
      }
      const completedResult = {
        date: puzzle.date,
        elapsedSeconds: null,
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
            elapsedSeconds: null,
            gameKey: 'connections',
            outcome,
            requestWithSessionRecovery,
            score: completedScore,
            variant: 'daily',
          })
          const stats = await loadStatsForGameUser({
            accessState,
            clientSessionId,
            gameKey: 'connections',
            requestWithSessionRecovery,
          })
          onGameComplete(response.result ?? completedResult, stats)
        } catch (error) {
          console.warn('Could not save Connections result', error)
          showToast(error instanceof Error ? error.message : 'Could not save result')
        }
      } else {
        saveStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'connections',
            kind: 'result',
            variant: 'daily',
          }),
          completedResult,
        )
        clearStoredAdditionalGameValue(
          getAdditionalGameStorageKey({
            date: puzzle.date,
            gameKey: 'connections',
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
    setSelectedCards([])
    setSolvedGroups([])
    setMistakes(0)
    setSubmittedGuesses([])
    setIsComplete(false)
    setBouncingCards([])
    setShakingCards([])
    setPoppingDotIndex(-1)
    setRecentSolvedTitle('')
    startedAtRef.current = Date.now()

    try {
      const activePuzzle = await requestJson<ConnectionsPuzzle>(
        `/api/games/connections/today?date=${encodeURIComponent(requestedDate)}`,
        { cache: 'no-store' },
      )
      setPuzzle(activePuzzle)
      notifyDateClamp(activePuzzle, 'connections', showToast)
      onResolvedDate(activePuzzle.date)

      if (accessState?.kind === 'friends-family') {
        const statusResponse = await loadAdditionalGameStatus({
          accessState,
          clientSessionId,
          date: activePuzzle.date,
          gameKey: 'connections',
          requestWithSessionRecovery,
          variant: 'daily',
        })

        if (statusResponse.completed && statusResponse.result) {
          const res = statusResponse.result
          setSolvedGroups(Array.isArray(res.score?.solvedGroups) ? res.score.solvedGroups : [])
          setMistakes(Number(res.score?.mistakes ?? 0))
          setSubmittedGuesses(Array.isArray(res.score?.guesses) ? res.score.guesses : [])
          setIsComplete(true)
          const stats = await loadStatsForGameUser({
            accessState,
            clientSessionId,
            gameKey: 'connections',
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
          const state = statusResponse.attempt.state as Partial<ConnectionsAttemptState>
          setSolvedGroups(Array.isArray(state.solvedGroups) ? state.solvedGroups : [])
          setMistakes(Number(state.mistakes ?? 0))
          setSubmittedGuesses(Array.isArray(state.submittedGuesses) ? state.submittedGuesses : [])
          if (Array.isArray(state.cards)) {
            setPuzzle({ ...activePuzzle, cards: state.cards })
          }
        }
      } else {
        const localResult = loadStoredAdditionalGameValue<MultigameCompletionResult>(
          getAdditionalGameStorageKey({
            date: activePuzzle.date,
            gameKey: 'connections',
            kind: 'result',
            variant: 'daily',
          }),
        )
        if (localResult) {
          const res = localResult
          setSolvedGroups(Array.isArray(res.score?.solvedGroups) ? res.score.solvedGroups : [])
          setMistakes(Number(res.score?.mistakes ?? 0))
          setSubmittedGuesses(Array.isArray(res.score?.guesses) ? res.score.guesses : [])
          setIsComplete(true)
          onGameLoadedAndComplete(res, null)
        } else {
          const localAttempt = loadStoredAdditionalGameValue<Partial<ConnectionsAttemptState>>(
            getAdditionalGameStorageKey({
              date: activePuzzle.date,
              gameKey: 'connections',
              kind: 'attempt',
              variant: 'daily',
            }),
          )
          if (localAttempt) {
            setSolvedGroups(Array.isArray(localAttempt.solvedGroups) ? localAttempt.solvedGroups : [])
            setMistakes(Number(localAttempt.mistakes ?? 0))
            setSubmittedGuesses(
              Array.isArray(localAttempt.submittedGuesses) ? localAttempt.submittedGuesses : [],
            )
            if (Array.isArray(localAttempt.cards)) {
              setPuzzle({ ...activePuzzle, cards: localAttempt.cards })
            }
          }
        }
      }
    } catch (error) {
      setPuzzleError(error instanceof Error ? error.message : 'Could not load Connections')
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
  ])

  useEffect(() => {
    void loadPuzzle()
  }, [loadPuzzle])

  const revealSolution = useCallback(async () => {
    if (!puzzle) return solvedGroups

    try {
      const response = await requestJson<{ groups: ConnectionsGroup[] }>(
        '/api/games/connections/reveal',
        {
          body: JSON.stringify({ date: puzzle.date }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      )
      setSolvedGroups(response.groups)
      return response.groups
    } catch (error) {
      console.warn('Could not reveal Connections solution', error)
      return solvedGroups
    }
  }, [puzzle, solvedGroups])

  const toggleCard = (content: string) => {
    if (isComplete || isSubmitting || isAnimating || solvedCards.has(content)) return

    setSelectedCards((previousSelection) => {
      if (previousSelection.includes(content)) {
        return previousSelection.filter((card) => card !== content)
      }
      if (previousSelection.length >= 4) {
        return previousSelection
      }
      return [...previousSelection, content]
    })
  }

  const submitSelection = async () => {
    if (!puzzle || selectedCards.length !== 4 || isSubmitting || isComplete || isAnimating) return
    const guessedCards = [...selectedCards]
    if (submittedGuesses.some((guess) => normalizeGuess(guess) === normalizeGuess(guessedCards))) {
      showToast('Already guessed')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await requestJson<ConnectionsGuessResponse>(
        '/api/games/connections/guess',
        {
          body: JSON.stringify({ cards: guessedCards, date: puzzle.date }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      )
      const nextSubmittedGuesses = [...submittedGuesses, guessedCards]
      setSubmittedGuesses(nextSubmittedGuesses)

      if (response.correct && response.group) {
        const solvedGroup = response.group
        // Bounce the four cards in place, then collapse them into the solved row.
        setBouncingCards(guessedCards)
        window.setTimeout(() => {
          setBouncingCards([])
          const nextSolvedGroups = [...solvedGroups, solvedGroup].sort((a, b) => a.rank - b.rank)
          setSolvedGroups(nextSolvedGroups)
          setSelectedCards([])
          setRecentSolvedTitle(solvedGroup.title)
          window.setTimeout(() => setRecentSolvedTitle(''), 700)

          if (nextSolvedGroups.length === 4) {
            setIsComplete(true)
            showToast('Solved!', 1800)
            void saveResult('won', nextSolvedGroups, mistakes, nextSubmittedGuesses)
          } else {
            void saveAttempt(nextSolvedGroups, mistakes, puzzle.cards, nextSubmittedGuesses)
          }
        }, CONNECTIONS_BOUNCE_MS)
        return
      }

      // Wrong group: shake the guessed cards and pop a mistake dot.
      const nextMistakes = mistakes + 1
      setShakingCards(guessedCards)
      setPoppingDotIndex(puzzle.mistakesAllowed - mistakes - 1)
      showToast(response.oneAway ? 'One away...' : 'Not a group', 1200)
      window.setTimeout(() => {
        setShakingCards([])
        setPoppingDotIndex(-1)
        setMistakes(nextMistakes)
        setSelectedCards([])

        if (nextMistakes >= puzzle.mistakesAllowed) {
          setIsComplete(true)
          void (async () => {
            const revealedGroups = await revealSolution()
            await saveResult('lost', revealedGroups, nextMistakes, nextSubmittedGuesses)
          })()
        } else {
          void saveAttempt(solvedGroups, nextMistakes, puzzle.cards, nextSubmittedGuesses)
        }
      }, CONNECTIONS_SHAKE_MS)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not check group')
    } finally {
      setIsSubmitting(false)
    }
  }

  const shuffleCards = () => {
    if (!puzzle || isComplete || isAnimating) return
    const shuffled = shuffleArray(puzzle.cards)
    setPuzzle({
      ...puzzle,
      cards: shuffled,
    })
    void saveAttempt(solvedGroups, mistakes, shuffled, submittedGuesses)
  }

  return (
    <main className="game-page game-page--connections" aria-label="Connections game">
      <section className="game-panel connections-panel">
        {puzzleError && (
          <div className="game-error">
            <span>{puzzleError}</span>
            <button className="game-secondary-button" onClick={() => void loadPuzzle()} type="button">
              Retry
            </button>
          </div>
        )}

        {!puzzle && !puzzleError && <p className="game-loading">Loading Connections...</p>}

        {puzzle && (
          <>
            <div className="connections-groups" aria-live="polite">
              {solvedGroups.map((group) => (
                <div
                  className={[
                    'connections-solved-group',
                    groupClassNames[group.rank],
                    recentSolvedTitle === group.title ? 'connections-solved-group--recent' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={group.title}
                >
                  <strong>{group.title}</strong>
                  <span>{group.cards.join(', ')}</span>
                </div>
              ))}
            </div>

            <div className="connections-grid">
              {unsolvedCards.map((card) => {
                const bounceIndex = bouncingCards.indexOf(card.content)
                return (
                  <button
                    aria-pressed={selectedCards.includes(card.content)}
                    className={[
                      'connections-card',
                      bounceIndex >= 0 ? 'connections-card--bounce' : '',
                      shakingCards.includes(card.content) ? 'connections-card--shake' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={isComplete || isSubmitting}
                    key={card.id}
                    onClick={() => toggleCard(card.content)}
                    style={
                      {
                        '--connections-bounce-delay': `${Math.max(0, bounceIndex) * 100}ms`,
                      } as CSSProperties
                    }
                    type="button"
                  >
                    {card.content}
                  </button>
                )
              })}
            </div>

            <div className="connections-status">
              {(mistakesLeft > 0 || poppingDotIndex >= 0) && (
                <span className="connections-mistakes">
                  Mistakes remaining:
                  <span className="connections-mistakes__dots" aria-hidden="true">
                    {Array.from({ length: puzzle.mistakesAllowed }, (_, index) => (
                      <i
                        className={[
                          'connections-dot',
                          index < mistakesLeft ? 'connections-dot--filled' : '',
                          index === poppingDotIndex ? 'connections-dot--popping' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={index}
                      />
                    ))}
                  </span>
                  <span className="wordbee-sr-only">{mistakesLeft} remaining</span>
                </span>
              )}
            </div>

            <div className="game-actions">
              <button
                className="game-secondary-button"
                disabled={isComplete || isAnimating || selectedCards.length === 0}
                onClick={() => setSelectedCards([])}
                type="button"
              >
                Deselect all
              </button>
              <button
                className="game-secondary-button"
                disabled={isComplete || isAnimating}
                onClick={shuffleCards}
                type="button"
              >
                Shuffle
              </button>
              <button
                className="game-primary-button"
                disabled={selectedCards.length !== 4 || isSubmitting || isComplete || isAnimating}
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

function normalizeGuess(cards: string[]) {
  return [...cards].sort().join('|')
}

function shuffleArray<Item>(items: Item[]): Item[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}
