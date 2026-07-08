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
} from '../../types'

const gameLabels: Record<AdditionalGameKey, string> = {
  connections: 'Connections',
  strands: 'Strands',
  sudoku: 'Sudoku',
}

type StatsView = 'overview' | 'players'

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




