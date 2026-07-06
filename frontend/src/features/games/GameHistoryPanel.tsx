import { AvatarImage } from '../avatar/avatar'
import { formatElapsedTime } from './game-utils'
import type { AdditionalGameKey, MultigameDashboard } from '../../types'

const gameLabels: Record<AdditionalGameKey, string> = {
  connections: 'Connections',
  strands: 'Strands',
  sudoku: 'Sudoku',
}

export function GameHistoryPanel({
  dashboard,
  error,
  gameKey,
  isLoading,
  onReload,
}: {
  dashboard: MultigameDashboard | null
  error: string
  gameKey: AdditionalGameKey
  isLoading: boolean
  onReload: () => void
}) {
  const gameDashboard = dashboard?.games[gameKey]
  const users = gameDashboard?.users ?? []

  return (
    <section className="game-history" aria-label={`${gameLabels[gameKey]} family history`}>
      <div className="game-history__header">
        <div>
          <h2>{gameLabels[gameKey]} history</h2>
          <p>Family solve rate and recent daily plays.</p>
        </div>
        <button className="game-secondary-button" onClick={onReload} type="button">
          Reload
        </button>
      </div>

      {isLoading && <p className="game-history__empty">Loading history...</p>}
      {error && <p className="game-history__error">{error}</p>}
      {!isLoading && !error && users.length === 0 && (
        <p className="game-history__empty">No family plays saved yet.</p>
      )}

      {!isLoading && !error && users.length > 0 && (
        <div className="game-history__users">
          {users.map((user) => (
            <article className="game-history-user" key={user.id}>
              <div className="game-history-user__identity">
                {user.avatar && (
                  <span className="game-history-user__avatar">
                    <AvatarImage avatar={user.avatar} displayName={user.displayName} size={64} />
                  </span>
                )}
                <span>{user.displayName}</span>
              </div>
              <div className="game-history-user__stats">
                <span>
                  <strong>{user.stats.played}</strong>
                  plays
                </span>
                <span>
                  <strong>{user.stats.solveRate}%</strong>
                  solved
                </span>
                <span>
                  <strong>{formatElapsedTime(user.stats.averageSeconds)}</strong>
                  avg
                </span>
              </div>
              <div className="game-history-user__recent">
                {user.history.slice(0, 4).map((result) => (
                  <span
                    className={`game-history-pill game-history-pill--${result.outcome}`}
                    key={result.id}
                  >
                    {formatHistoryDate(result.date)}
                    {result.variant !== 'daily' && ` ${result.variant}`}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function formatHistoryDate(rawDate: string) {
  const [year, month, day] = rawDate.split('-').map(Number)
  if (!year || !month || !day) {
    return rawDate
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(new Date(year, month - 1, day))
}
