import { useCallback, useEffect, useMemo, useState } from 'react'
import { AvatarImage } from '../avatar/avatar'
import { CompletionCalendar } from '../calendar/CompletionCalendar'
import {
  formatElapsedTime,
  loadAdditionalGameStats,
  type SessionRequest,
} from '../games/game-utils'
import type {
  AccessState,
  AdditionalGameKey,
  MultigameDashboard,
  MultigameResult,
} from '../../types'

const gameLabels: Record<AdditionalGameKey, string> = {
  connections: 'Connections',
  strands: 'Strands',
  sudoku: 'Sudoku',
}

type StatsView = 'overview' | 'players' | 'daily'

export function MultigameStatsPage({
  activeGame,
  currentUserId,
  accessState,
  clientSessionId,
  requestWithSessionRecovery,
  onBack,
}: {
  activeGame: AdditionalGameKey
  currentUserId: string
  accessState: AccessState | null
  clientSessionId: string
  requestWithSessionRecovery: SessionRequest
  onBack: () => void
}) {
  const [dashboard, setDashboard] = useState<MultigameDashboard | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<StatsView>('overview')
  const [selectedUserId, setSelectedUserId] = useState(currentUserId)
  const [selectedDate, setSelectedDate] = useState('')

  const loadStats = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      setDashboard(
        await loadAdditionalGameStats({
          accessState,
          clientSessionId,
          requestWithSessionRecovery,
        }),
      )
    } catch (statsError) {
      setError(statsError instanceof Error ? statsError.message : 'Could not load stats')
    } finally {
      setIsLoading(false)
    }
  }, [accessState, clientSessionId, requestWithSessionRecovery])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  useEffect(() => {
    setSelectedUserId(currentUserId)
  }, [currentUserId])

  const gameDashboard = dashboard?.games[activeGame]
  const users = useMemo(
    () => dashboard?.games[activeGame]?.users ?? [],
    [activeGame, dashboard],
  )
  const groupStats = gameDashboard?.groupStats
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? users[0]
  // Show the current user's own tab first (Wordle does the same).
  const orderedUsers = useMemo(() => {
    const self = users.find((user) => user.id === currentUserId)
    const others = users.filter((user) => user.id !== currentUserId)
    return self ? [self, ...others] : users
  }, [currentUserId, users])

  const allHistory = useMemo(
    () => users.flatMap((user) => user.history),
    [users],
  )
  const uniqueDates = useMemo(
    () => Array.from(new Set(allHistory.map((result) => result.date))).sort().reverse(),
    [allHistory],
  )
  const dailyResults = allHistory.filter((result) => result.date === selectedDate)

  useEffect(() => {
    if (uniqueDates.length === 0) {
      setSelectedDate('')
      return
    }
    if (!selectedDate || !uniqueDates.includes(selectedDate)) {
      setSelectedDate(uniqueDates[0])
    }
  }, [selectedDate, uniqueDates])

  return (
    <main className="stats-page" aria-label={`${gameLabels[activeGame]} stats`}>
      <div className="stats-page__inner">
        <section className="stats-hero">
          <div>
            <span className="stats-kicker">Daily play only</span>
            <h2>{gameLabels[activeGame]} Stats</h2>
          </div>
          <div className="stats-hero__actions">
            <button className="stats-secondary-button" onClick={onBack} type="button">
              Back to game
            </button>
            <button className="stats-primary-button" disabled={isLoading} onClick={() => void loadStats()} type="button">
              Refresh
            </button>
          </div>
        </section>

        {error && (
          <div className="stats-error">
            <span>{error}</span>
            <button disabled={isLoading} onClick={() => void loadStats()} type="button">
              Retry
            </button>
          </div>
        )}

        {isLoading && !dashboard && <p className="game-loading">Loading stats...</p>}

        {!isLoading && users.length === 0 && !error && (
          <section className="stats-empty">
            <h3>No stats recorded yet</h3>
            <p>Complete a daily puzzle while signed in to start compiling stats.</p>
          </section>
        )}

        {users.length > 0 && (
          <>
            <div className="stats-tabs" role="tablist" aria-label="Stats views">
              {([
                ['overview', 'Overview'],
                ['players', 'Players'],
                ['daily', 'Daily review'],
              ] as const).map(([value, label]) => (
                <button
                  aria-selected={view === value}
                  key={value}
                  onClick={() => setView(value)}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            {view === 'overview' && groupStats && (
              <section className="stats-section">
                <div className="stats-metric-grid">
                  <Metric label="Total plays" value={groupStats.played} />
                  {activeGame !== 'strands' && (
                    <>
                      <Metric label="Wins" value={groupStats.wins} />
                      <Metric label="Solve rate" value={`${groupStats.solveRate}%`} />
                    </>
                  )}
                  {activeGame !== 'strands' && activeGame !== 'connections' && (
                    <Metric label="Avg time" value={formatElapsedTime(groupStats.averageSeconds)} />
                  )}
                </div>

                <div className="stats-history-panel">
                  <h4>Leaderboard</h4>
                  <div className="stats-table-wrap">
                    <table className="stats-table">
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th>Played</th>
                          {activeGame !== 'strands' && (
                            <>
                              <th>Wins</th>
                              <th>Solve rate</th>
                            </>
                          )}
                          {activeGame !== 'strands' && activeGame !== 'connections' && <th>Avg time</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {[...users]
                          .sort((first, second) => {
                            if (activeGame !== 'strands') {
                              if (first.stats.solveRate !== second.stats.solveRate) {
                                return second.stats.solveRate - first.stats.solveRate
                              }
                              if (activeGame !== 'connections') {
                                if (first.stats.averageSeconds && second.stats.averageSeconds) {
                                  return first.stats.averageSeconds - second.stats.averageSeconds
                                }
                              }
                              return (second.stats.wins ?? 0) - (first.stats.wins ?? 0)
                            }
                            return second.stats.played - first.stats.played
                          })
                          .map((user) => (
                            <tr key={user.id}>
                              <td>
                                <span className="stats-player-cell">
                                  {user.avatar && (
                                    <AvatarImage avatar={user.avatar} displayName={user.displayName} size={28} />
                                  )}
                                  {user.displayName}
                                </span>
                              </td>
                              <td>{user.stats.played}</td>
                              {activeGame !== 'strands' && (
                                <>
                                  <td>{user.stats.wins}</td>
                                  <td>{user.stats.solveRate}%</td>
                                </>
                              )}
                              {activeGame !== 'strands' && activeGame !== 'connections' && (
                                <td>{formatElapsedTime(user.stats.averageSeconds)}</td>
                              )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {view === 'players' && selectedUser && (
              <section className="stats-section">
                <div className="stats-player-tabs" aria-label="Players">
                  {orderedUsers.map((user) => (
                    <button
                      aria-pressed={selectedUser.id === user.id}
                      key={user.id}
                      onClick={() => setSelectedUserId(user.id)}
                      type="button"
                    >
                      {user.avatar && <AvatarImage avatar={user.avatar} displayName={user.displayName} size={24} />}
                      <span>{user.displayName}</span>
                    </button>
                  ))}
                </div>

                <div className="stats-metric-grid">
                  <Metric label="Played" value={selectedUser.stats.played} />
                  {activeGame !== 'strands' && (
                    <>
                      <Metric label="Wins" value={selectedUser.stats.wins} />
                      <Metric label="Solve rate" value={`${selectedUser.stats.solveRate}%`} />
                    </>
                  )}
                  {activeGame !== 'strands' && activeGame !== 'connections' && (
                    <Metric label="Avg time" value={formatElapsedTime(selectedUser.stats.averageSeconds)} />
                  )}
                </div>

                {accessState?.kind === 'friends-family' && (
                  <div className="stats-history-panel">
                    <h4>Calendar</h4>
                    <CompletionCalendar
                      accessState={accessState}
                      clientSessionId={clientSessionId}
                      gameKey={activeGame}
                      requestWithSessionRecovery={requestWithSessionRecovery}
                      userId={selectedUser.id}
                    />
                  </div>
                )}
              </section>
            )}

            {view === 'daily' && (
              <section className="stats-section">
                {uniqueDates.length === 0 ? (
                  <p className="stats-muted">No plays recorded yet.</p>
                ) : (
                  <>
                    <div className="stats-day-rail" aria-label="Tracked days">
                      {uniqueDates.map((date) => (
                        <button
                          aria-pressed={date === selectedDate}
                          key={date}
                          onClick={() => setSelectedDate(date)}
                          type="button"
                        >
                          <strong>{formatShortDate(date)}</strong>
                        </button>
                      ))}
                    </div>

                    <div className="stats-multigame-results">
                      {dailyResults.map((result) => (
                        <ResultCard activeGame={activeGame} key={result.id} result={result} />
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}

          </>
        )}
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stats-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function ResultCard({
  activeGame,
  result,
}: {
  activeGame: AdditionalGameKey
  result: MultigameResult
}) {
  if (result.locked) {
    return (
      <article className="stats-multigame-result" data-locked="true">
        <ResultIdentity result={result} />
        <p className="stats-muted">Solve today&apos;s {gameLabels[activeGame]} to reveal this result.</p>
      </article>
    )
  }

  return (
    <article className="stats-multigame-result">
      <div className="stats-multigame-result__topline">
        <ResultIdentity result={result} />
        <span className={`game-history-pill game-history-pill--${result.outcome}`}>
          {result.outcome.toUpperCase()}
        </span>
      </div>
      <div className="stats-multigame-result__meta">
        <span>{formatLongDate(result.date)}</span>
        {result.variant !== 'daily' && <span>{result.variant}</span>}
        {activeGame !== 'strands' && activeGame !== 'connections' && result.elapsedSeconds ? (
          <span>{formatElapsedTime(result.elapsedSeconds)}</span>
        ) : null}
      </div>
      <ResultPlayback activeGame={activeGame} result={result} />
    </article>
  )
}

function ResultIdentity({ result }: { result: MultigameResult }) {
  return (
    <div className="stats-player-cell">
      {result.avatar && <AvatarImage avatar={result.avatar} displayName={result.displayName} size={28} />}
      <strong>{result.displayName}</strong>
    </div>
  )
}

function ResultPlayback({
  activeGame,
  result,
}: {
  activeGame: AdditionalGameKey
  result: MultigameResult
}) {
  if (activeGame === 'connections') {
    return <ConnectionsPlayback result={result} />
  }
  if (activeGame === 'strands') {
    return <StrandsPlayback result={result} />
  }
  return <SudokuPlayback result={result} />
}

function ConnectionsPlayback({ result }: { result: MultigameResult }) {
  const score = result.score as Record<string, any>
  const groups = Array.isArray(score.solvedGroups) ? score.solvedGroups : []
  const guesses: string[][] = Array.isArray(score.guesses) ? score.guesses : []
  // The solved board is identical for everyone; what's unique is this player's
  // guess path, so show each guess and whether it landed a group.
  const groupCardSets = groups.map(
    (group: any) => new Set<string>(Array.isArray(group.cards) ? group.cards : []),
  )

  return (
    <div className="stats-playback">
      <div className="stats-playback__summary">
        <span>{guesses.length} guesses</span>
        <span>{Number(score.mistakes ?? 0)} mistakes</span>
      </div>
      {guesses.length > 0 && (
        <ol className="stats-guess-list">
          {guesses.map((guess, index) => {
            const isCorrect = groupCardSets.some(
              (cards) => cards.size === guess.length && guess.every((card) => cards.has(card)),
            )
            return (
              <li
                className={`stats-guess stats-guess--${isCorrect ? 'correct' : 'wrong'}`}
                key={`${index}-${guess.join('-')}`}
              >
                {guess.join(', ')}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function StrandsPlayback({ result }: { result: MultigameResult }) {
  const score = result.score as Record<string, any>
  const themeWords = getStringArray(score.foundThemeWords)
  const bonusWords = getStringArray(score.bonusWords)
  const submittedWords = getStringArray(score.submittedWords)

  return (
    <div className="stats-playback">
      <div className="stats-playback__summary">
        <span>{themeWords.length} theme words</span>
        <span>{score.foundSpangram ? 'Spangram found' : 'No spangram'}</span>
        <span>{bonusWords.length} bonus</span>
      </div>
      {score.revealed && <p className="stats-muted">Solution was revealed from the board.</p>}
      <div className="stats-word-cloud">
        {[...themeWords, ...bonusWords].map((word) => (
          <span key={word}>{word}</span>
        ))}
      </div>
      {submittedWords.length > 0 && (
        <ol className="stats-submission-list">
          {submittedWords.map((word, index) => (
            <li key={`${index}-${word}`}>{word}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

function SudokuPlayback({ result }: { result: MultigameResult }) {
  const score = result.score as Record<string, any>

  return (
    <div className="stats-playback">
      <div className="stats-playback__summary">
        <span>{formatElapsedTime(result.elapsedSeconds)}</span>
        <span>{Number(score.mistakes ?? 0)} mistakes</span>
        <span>{Number(score.hints ?? 0)} hints</span>
      </div>
    </div>
  )
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function formatShortDate(rawDate: string) {
  return formatDate(rawDate, { day: 'numeric', month: 'short' })
}

function formatLongDate(rawDate: string) {
  return formatDate(rawDate, { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDate(rawDate: string, options: Intl.DateTimeFormatOptions) {
  const [year, month, day] = rawDate.split('-').map(Number)
  if (!year || !month || !day) {
    return rawDate
  }
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day))
}
