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
  ConnectionsGuessResponse,
  ConnectionsGroup,
  ConnectionsPuzzle,
  MultigameDashboard,
} from '../../types'

const groupClassNames = ['connections-group--yellow', 'connections-group--green', 'connections-group--blue', 'connections-group--purple']

export function ConnectionsGame({
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
  const [puzzle, setPuzzle] = useState<ConnectionsPuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [selectedCards, setSelectedCards] = useState<string[]>([])
  const [solvedGroups, setSolvedGroups] = useState<ConnectionsGroup[]>([])
  const [mistakes, setMistakes] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [dashboard, setDashboard] = useState<MultigameDashboard | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const startedAtRef = useRef(Date.now())

  const solvedCards = useMemo(
    () => new Set(solvedGroups.flatMap((group) => group.cards)),
    [solvedGroups],
  )
  const unsolvedCards = puzzle?.cards.filter((card) => !solvedCards.has(card.content)) ?? []
  const mistakesLeft = Math.max(0, (puzzle?.mistakesAllowed ?? 4) - mistakes)

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
    setSelectedCards([])
    setSolvedGroups([])
    setMistakes(0)
    setIsComplete(false)
    startedAtRef.current = Date.now()

    try {
      setPuzzle(await requestJson<ConnectionsPuzzle>('/api/games/connections/today', { cache: 'no-store' }))
    } catch (error) {
      setPuzzleError(error instanceof Error ? error.message : 'Could not load Connections')
    }
  }, [])

  useEffect(() => {
    void loadPuzzle()
  }, [loadPuzzle])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const saveResult = useCallback(
    async (outcome: 'won' | 'lost', nextSolvedGroups: ConnectionsGroup[], nextMistakes: number) => {
      if (!puzzle) return

      try {
        await saveAdditionalGameResult({
          accessState,
          clientSessionId,
          date: puzzle.date,
          elapsedSeconds: getElapsedSeconds(startedAtRef.current),
          gameKey: 'connections',
          outcome,
          requestWithSessionRecovery,
          score: {
            mistakes: nextMistakes,
            solvedGroups: nextSolvedGroups,
          },
          variant: 'daily',
        })
        void loadHistory()
      } catch (error) {
        console.warn('Could not save Connections result', error)
        showToast(error instanceof Error ? error.message : 'Could not save result')
      }
    },
    [accessState, clientSessionId, loadHistory, puzzle, requestWithSessionRecovery, showToast],
  )

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
    if (isComplete || isSubmitting || solvedCards.has(content)) return

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
    if (!puzzle || selectedCards.length !== 4 || isSubmitting || isComplete) return

    setIsSubmitting(true)
    try {
      const response = await requestJson<ConnectionsGuessResponse>(
        '/api/games/connections/guess',
        {
          body: JSON.stringify({ cards: selectedCards, date: puzzle.date }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      )

      if (response.correct && response.group) {
        const nextSolvedGroups = [...solvedGroups, response.group].sort((a, b) => a.rank - b.rank)
        setSolvedGroups(nextSolvedGroups)
        setSelectedCards([])
        showToast('Correct', 900)

        if (nextSolvedGroups.length === 4) {
          setIsComplete(true)
          await saveResult('won', nextSolvedGroups, mistakes)
          showToast('Perfect connection', 1800)
        }
        return
      }

      const nextMistakes = mistakes + 1
      setMistakes(nextMistakes)
      setSelectedCards([])
      showToast(response.oneAway ? 'One away...' : 'Not a group', 1200)

      if (nextMistakes >= puzzle.mistakesAllowed) {
        setIsComplete(true)
        const revealedGroups = await revealSolution()
        await saveResult('lost', revealedGroups, nextMistakes)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not check group')
    } finally {
      setIsSubmitting(false)
    }
  }

  const shuffleCards = () => {
    if (!puzzle || isComplete) return
    setPuzzle({
      ...puzzle,
      cards: [...puzzle.cards].sort(() => Math.random() - 0.5),
    })
  }

  return (
    <main className="game-page game-page--connections" aria-label="Connections game">
      <section className="game-panel connections-panel">
        <div className="game-kicker">Connections</div>
        <h2>Create four groups of four</h2>
        <p className="game-subtitle">Find groups of items that share something in common.</p>

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
                  className={`connections-solved-group ${groupClassNames[group.rank]}`}
                  key={group.title}
                >
                  <strong>{group.title}</strong>
                  <span>{group.cards.join(', ')}</span>
                </div>
              ))}
            </div>

            <div className="connections-grid">
              {unsolvedCards.map((card) => (
                <button
                  aria-pressed={selectedCards.includes(card.content)}
                  className="connections-card"
                  disabled={isComplete || isSubmitting}
                  key={card.id}
                  onClick={() => toggleCard(card.content)}
                  type="button"
                >
                  {card.content}
                </button>
              ))}
            </div>

            <div className="connections-status">
              <span>Mistakes remaining: {Array.from({ length: mistakesLeft }, (_, index) => (
                <i aria-hidden="true" key={index} />
              ))}</span>
            </div>

            <div className="game-actions">
              <button className="game-secondary-button" disabled={isComplete} onClick={() => setSelectedCards([])} type="button">
                Deselect all
              </button>
              <button className="game-secondary-button" disabled={isComplete} onClick={shuffleCards} type="button">
                Shuffle
              </button>
              <button
                className="game-primary-button"
                disabled={selectedCards.length !== 4 || isSubmitting || isComplete}
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
          gameKey="connections"
          isLoading={isHistoryLoading}
          onReload={() => void loadHistory()}
        />
      )}
    </main>
  )
}
