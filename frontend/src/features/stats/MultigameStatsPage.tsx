import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AvatarImage } from '../avatar/avatar'
import { createDefaultAvatarConfig, sanitizeAvatarConfig } from '../avatar/avatar-config'
import { CompletionCalendar } from '../calendar/CompletionCalendar'
import {
  formatElapsedTime,
  loadAdditionalGameStats,
  type SessionRequest,
} from '../games/game-utils'
import type {
  AccessState,
  AdditionalGameKey,
  LetterboxedTimelineDay,
  MultigameDashboard,
  MultigameStatsUser,
  SpellingBeeTimelineDay,
  TilesTimelineDay,
} from '../../types'

const gameLabels: Record<AdditionalGameKey, string> = {
  connections: 'Connections',
  strands: 'Strands',
  sudoku: 'Sudoku',
  letterboxed: 'Letter Boxed',
  spellingbee: 'Spelling Bee',
  tiles: 'Tiles',
  pips: 'Pips',
  crossword: 'The Crossword',
  mini: 'The Mini',
  midi: 'The Midi',
}

// The Crossword, Mini and Midi are all timed grid games with identical metrics.
const isGridCrossword = (gameKey: AdditionalGameKey): boolean =>
  gameKey === 'crossword' || gameKey === 'mini' || gameKey === 'midi'

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

  const defaultSortKey = useMemo<MultigameSortKey>(() => {
    if (activeGame === 'letterboxed') return 'averageWords'
    if (activeGame === 'spellingbee') return 'geniusRate'
    if (activeGame === 'sudoku' || activeGame === 'pips' || isGridCrossword(activeGame)) return 'averageSeconds'
    if (activeGame === 'tiles') return 'averageLongestCombo'
    return 'solveRate'
  }, [activeGame])

  const [sortKey, setSortKey] = useState<MultigameSortKey>(defaultSortKey)

  useEffect(() => {
    setSortKey(defaultSortKey)
  }, [defaultSortKey])

  // Per-game metric shape. Letter Boxed has no way to fail a day, so it tracks
  // words-used instead of a solve rate; Sudoku is the only timed game.
  const showsWinRate = activeGame === 'connections' || activeGame === 'sudoku'
  const showsTime = activeGame === 'sudoku' || activeGame === 'pips' || isGridCrossword(activeGame)
  const showsWords = activeGame === 'letterboxed'
  const showsBee = activeGame === 'spellingbee'
  const showsTiles = activeGame === 'tiles'

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

  const leaderboardUsers = useMemo(
    () => [...users].sort((a, b) => compareMultigameUsers(a, b, activeGame, sortKey)),
    [activeGame, users, sortKey],
  )

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
                  {showsWinRate && (
                    <>
                      <Metric label="Wins" value={groupStats.wins ?? 0} />
                      <Metric label="Solve rate" value={`${groupStats.solveRate ?? 0}%`} />
                    </>
                  )}
                  {showsTime && (
                    <Metric label="Avg time" value={formatElapsedTime(groupStats.averageSeconds)} />
                  )}
                  {showsWords && (
                    <>
                      <Metric label="Avg words" value={formatWords(groupStats.averageWords)} />
                      <Metric label="Best" value={groupStats.bestWords ? `${groupStats.bestWords} words` : '--'} />
                    </>
                  )}
                  {showsBee && (
                    <>
                      <Metric label="Genius rate" value={`${groupStats.geniusRate ?? 0}%`} />
                      <Metric label="Avg puzzle" value={`${groupStats.averagePercent ?? 0}%`} />
                      <Metric label="Pangrams" value={groupStats.pangramsFound ?? 0} />
                      <Metric label="Queen Bees" value={groupStats.queenBeeCount ?? 0} />
                    </>
                  )}
                  {showsTiles && (
                    <>
                      <Metric label="Avg combo" value={formatCombo(groupStats.averageLongestCombo)} />
                      <Metric label="Best combo" value={groupStats.bestLongestCombo ? `×${groupStats.bestLongestCombo}` : '--'} />
                      <Metric label="Perfect solves" value={groupStats.perfectCount ?? 0} />
                    </>
                  )}
                </div>

                {showsWords && groupStats.wordsTimeline && (
                  <WordsTrendChart timeline={groupStats.wordsTimeline} />
                )}

                {showsBee && groupStats.percentTimeline && (
                  <PercentTrendChart timeline={groupStats.percentTimeline} />
                )}

                {showsTiles && groupStats.comboTimeline && (
                  <ComboTrendChart timeline={groupStats.comboTimeline} />
                )}

                <div className="stats-history-panel">
                  <div className="stats-chart-heading">
                    <h4 id="stats-leaderboard-title">Leaderboard</h4>
                    <label className="stats-leaderboard-sort">
                      <span>Ranked by</span>
                      <select
                        aria-label="Rank leaderboard by"
                        onChange={(e) => setSortKey(e.target.value as MultigameSortKey)}
                        value={sortKey}
                      >
                        {getSortOptions(activeGame).map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="stats-leaderboard-list">
                    {leaderboardUsers.map((user) => {
                      const options = getSortOptions(activeGame)
                      const selectedOption = options.find((o) => o.key === sortKey) || options[0]
                      const displayAvatar =
                        (user.avatar ? sanitizeAvatarConfig(user.avatar, user.displayName) : null) ??
                        createDefaultAvatarConfig(user.displayName)

                      return (
                        <button
                          key={user.id}
                          onClick={() => {
                            setSelectedUserId(user.id)
                            setView('players')
                          }}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className="stats-player-avatar"
                            style={{ height: 34, width: 34 }}
                          >
                            <AvatarImage
                              avatar={displayAvatar}
                              className="stats-player-avatar__image"
                              displayName={user.displayName}
                              size={102}
                            />
                          </span>
                          <strong>{user.displayName}</strong>
                          <em>{user.stats.played === 0 ? 'No plays yet' : selectedOption.formatValue(user.stats)}</em>
                          <i>{formatSecondaryValue(activeGame, user, sortKey)}</i>
                        </button>
                      )
                    })}
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
                  {showsWinRate && (
                    <>
                      <Metric label="Wins" value={selectedUser.stats.wins ?? 0} />
                      <Metric label="Solve rate" value={`${selectedUser.stats.solveRate ?? 0}%`} />
                    </>
                  )}
                  {showsTime && (
                    <Metric label="Avg time" value={formatElapsedTime(selectedUser.stats.averageSeconds)} />
                  )}
                  {showsWords && (
                    <>
                      <Metric label="Avg words" value={formatWords(selectedUser.stats.averageWords)} />
                      <Metric label="Best" value={selectedUser.stats.bestWords ? `${selectedUser.stats.bestWords} words` : '--'} />
                    </>
                  )}
                  {showsBee && (
                    <>
                      <Metric label="Genius rate" value={`${selectedUser.stats.geniusRate ?? 0}%`} />
                      <Metric label="Avg puzzle" value={`${selectedUser.stats.averagePercent ?? 0}%`} />
                      <Metric label="Best puzzle" value={`${selectedUser.stats.bestPercent ?? 0}%`} />
                      <Metric label="Pangrams" value={selectedUser.stats.pangramsFound ?? 0} />
                      <Metric label="Queen Bees" value={selectedUser.stats.queenBeeCount ?? 0} />
                    </>
                  )}
                  {showsTiles && (
                    <>
                      <Metric label="Avg combo" value={formatCombo(selectedUser.stats.averageLongestCombo)} />
                      <Metric label="Best combo" value={selectedUser.stats.bestLongestCombo ? `×${selectedUser.stats.bestLongestCombo}` : '--'} />
                      <Metric label="Perfect solves" value={selectedUser.stats.perfectCount ?? 0} />
                    </>
                  )}
                </div>

                {showsWords && selectedUser.stats.wordsTimeline && selectedUser.stats.wordsTimeline.length > 0 && (
                  <WordsTrendChart timeline={selectedUser.stats.wordsTimeline} personal />
                )}

                {showsBee && selectedUser.stats.percentTimeline && selectedUser.stats.percentTimeline.length > 0 && (
                  <PercentTrendChart timeline={selectedUser.stats.percentTimeline} personal />
                )}

                {showsTiles && selectedUser.stats.comboTimeline && selectedUser.stats.comboTimeline.length > 0 && (
                  <ComboTrendChart timeline={selectedUser.stats.comboTimeline} personal />
                )}

                {accessState?.kind === 'friends-family' && (
                  <div className="stats-history-panel">
                    <h4>Calendar</h4>
                    <CompletionCalendar
                      accessState={accessState}
                      clientSessionId={clientSessionId}
                      gameKey={activeGame}
                      requestWithSessionRecovery={requestWithSessionRecovery}
                      userId={selectedUser.id}
                      history={selectedUser.history}
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

function formatWords(averageWords: number | undefined) {
  return averageWords && averageWords > 0 ? averageWords.toFixed(2) : '--'
}

function formatCombo(averageCombo: number | undefined) {
  return averageCombo && averageCombo > 0 ? `×${averageCombo.toFixed(1)}` : '--'
}

// Ranks the leaderboard per game: fewest average words (Letter Boxed), highest
// solve rate then fastest (timed games), else most plays.
type MultigameSortKey =
  | 'played'
  | 'wins'
  | 'solveRate'
  | 'averageSeconds'
  | 'averageWords'
  | 'geniusRate'
  | 'averagePercent'
  | 'queenBeeCount'
  | 'averageLongestCombo'
  | 'bestLongestCombo'

interface MultigameSortOption {
  key: MultigameSortKey
  label: string
  direction: 'asc' | 'desc'
  formatValue: (stats: MultigameStatsUser['stats']) => string
}

function getSortOptions(gameKey: AdditionalGameKey): MultigameSortOption[] {
  if (gameKey === 'letterboxed') {
    return [
      {
        key: 'averageWords',
        label: 'Avg words',
        direction: 'asc',
        formatValue: (s) => s.averageWords && s.averageWords > 0 ? `${s.averageWords.toFixed(2)} avg words` : '--',
      },
      {
        key: 'played',
        label: 'Total plays',
        direction: 'desc',
        formatValue: (s) => `${s.played} play${s.played === 1 ? '' : 's'}`,
      },
    ]
  }
  if (gameKey === 'spellingbee') {
    return [
      {
        key: 'geniusRate',
        label: 'Genius rate',
        direction: 'desc',
        formatValue: (s) => `${s.geniusRate ?? 0}% Genius`,
      },
      {
        key: 'averagePercent',
        label: 'Avg percent',
        direction: 'desc',
        formatValue: (s) => `${s.averagePercent ?? 0}% avg percent`,
      },
      {
        key: 'queenBeeCount',
        label: 'Queen Bees',
        direction: 'desc',
        formatValue: (s) => `${s.queenBeeCount ?? 0} Queen Bee${s.queenBeeCount === 1 ? '' : 's'}`,
      },
      {
        key: 'played',
        label: 'Total plays',
        direction: 'desc',
        formatValue: (s) => `${s.played} play${s.played === 1 ? '' : 's'}`,
      },
    ]
  }
  if (gameKey === 'tiles') {
    return [
      {
        key: 'averageLongestCombo',
        label: 'Avg combo',
        direction: 'desc',
        formatValue: (s) => (s.averageLongestCombo ? `×${s.averageLongestCombo.toFixed(1)} avg combo` : '--'),
      },
      {
        key: 'bestLongestCombo',
        label: 'Best combo',
        direction: 'desc',
        formatValue: (s) => (s.bestLongestCombo ? `×${s.bestLongestCombo} best combo` : '--'),
      },
      {
        key: 'played',
        label: 'Total plays',
        direction: 'desc',
        formatValue: (s) => `${s.played} play${s.played === 1 ? '' : 's'}`,
      },
    ]
  }
  if (isGridCrossword(gameKey) || gameKey === 'pips') {
    return [
      {
        key: 'averageSeconds',
        label: 'Avg time',
        direction: 'asc',
        formatValue: (s) => s.averageSeconds ? `${formatElapsedTime(s.averageSeconds)} avg time` : '--',
      },
      {
        key: 'played',
        label: 'Total plays',
        direction: 'desc',
        formatValue: (s) => `${s.played} play${s.played === 1 ? '' : 's'}`,
      },
    ]
  }
  if (gameKey === 'sudoku') {
    return [
      {
        key: 'averageSeconds',
        label: 'Avg time',
        direction: 'asc',
        formatValue: (s) => s.averageSeconds ? `${formatElapsedTime(s.averageSeconds)} avg time` : '--',
      },
      {
        key: 'wins',
        label: 'Wins',
        direction: 'desc',
        formatValue: (s) => `${s.wins ?? 0} win${s.wins === 1 ? '' : 's'}`,
      },
      {
        key: 'played',
        label: 'Total plays',
        direction: 'desc',
        formatValue: (s) => `${s.played} play${s.played === 1 ? '' : 's'}`,
      },
    ]
  }
  return [
    {
      key: 'solveRate',
      label: 'Solve rate',
      direction: 'desc',
      formatValue: (s) => `${s.solveRate ?? 0}% solve rate`,
    },
    {
      key: 'wins',
      label: 'Wins',
      direction: 'desc',
      formatValue: (s) => `${s.wins ?? 0} win${s.wins === 1 ? '' : 's'}`,
    },
    {
      key: 'played',
      label: 'Total plays',
      direction: 'desc',
      formatValue: (s) => `${s.played} play${s.played === 1 ? '' : 's'}`,
    },
  ]
}

function formatSecondaryValue(
  gameKey: AdditionalGameKey,
  user: MultigameStatsUser,
  sortKey: MultigameSortKey,
): string {
  const s = user.stats
  if (user.stats.played === 0) return ''

  if (gameKey === 'letterboxed') {
    if (sortKey === 'averageWords') return `${s.played} plays`
    return s.averageWords && s.averageWords > 0 ? `${s.averageWords.toFixed(2)} avg words` : '--'
  }
  if (gameKey === 'spellingbee') {
    if (sortKey === 'played') return `${s.geniusRate ?? 0}% Genius`
    return `${s.played} plays`
  }
  if (gameKey === 'tiles') {
    if (sortKey === 'played') return s.averageLongestCombo ? `×${s.averageLongestCombo.toFixed(1)} avg combo` : '--'
    return `${s.played} plays`
  }
  if (gameKey === 'sudoku' || gameKey === 'pips' || isGridCrossword(gameKey)) {
    if (sortKey === 'played') return s.averageSeconds ? `${formatElapsedTime(s.averageSeconds)} avg time` : '--'
    return `${s.played} plays`
  }
  if (sortKey === 'played') return `${s.solveRate ?? 0}% solve rate`
  return `${s.played} plays`
}

function compareMultigameUsers(
  first: MultigameStatsUser,
  second: MultigameStatsUser,
  gameKey: AdditionalGameKey,
  sortKey: MultigameSortKey,
) {
  if (first.stats.played === 0 || second.stats.played === 0) {
    if (first.stats.played !== second.stats.played) {
      return first.stats.played === 0 ? 1 : -1
    }
  }

  const options = getSortOptions(gameKey)
  const option = options.find((opt) => opt.key === sortKey) || options[0]

  let firstValue = 0
  let secondValue = 0

  if (option.key === 'averageSeconds') {
    firstValue = first.stats.averageSeconds ?? 0
    secondValue = second.stats.averageSeconds ?? 0
    if (!firstValue) return secondValue ? 1 : 0
    if (!secondValue) return -1
  } else if (option.key === 'averageWords') {
    firstValue = first.stats.averageWords ?? 0
    secondValue = second.stats.averageWords ?? 0
    if (!firstValue) return secondValue ? 1 : 0
    if (!secondValue) return -1
  } else {
    firstValue = (first.stats[option.key] as number) ?? 0
    secondValue = (second.stats[option.key] as number) ?? 0
  }

  if (firstValue !== secondValue) {
    return option.direction === 'asc' ? firstValue - secondValue : secondValue - firstValue
  }

  // Tiebreaker
  if (first.stats.played !== second.stats.played) {
    return second.stats.played - first.stats.played
  }
  return first.displayName.localeCompare(second.displayName)
}

// Daily average words-used trend, mirroring the Wordle stats "Daily average
// guesses" line chart but with an auto-scaled y-axis (word counts vary per board).
function WordsTrendChart({
  timeline,
  personal = false,
}: {
  timeline: LetterboxedTimelineDay[]
  personal?: boolean
}) {
  const chartTitleId = useId()
  const [hoveredDate, setHoveredDate] = useState('')
  const visibleDays = timeline.slice(-18)
  const width = 360
  const height = 176
  const plotLeft = 34
  const plotRight = 14
  const plotTop = 16
  const plotBottom = 34
  const values = visibleDays.map((day) => day.averageWords)
  const minValue = Math.max(1, Math.floor(Math.min(...values, 3)))
  const maxValue = Math.max(minValue + 1, Math.ceil(Math.max(...values, minValue + 1)))
  const yTicks = tickRange(minValue, maxValue)
  const plotWidth = width - plotLeft - plotRight
  const plotHeight = height - plotTop - plotBottom
  const yForValue = (value: number) =>
    plotTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight
  const points = visibleDays.map((day, index) => {
    const value = Math.min(maxValue, Math.max(minValue, day.averageWords))
    const x =
      visibleDays.length === 1
        ? width / 2
        : plotLeft + (index / (visibleDays.length - 1)) * plotWidth
    return { day, x, y: yForValue(value) }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const firstDay = visibleDays[0]
  const lastDay = visibleDays[visibleDays.length - 1]
  const tooltipPoint = points.find((point) => point.day.date === hoveredDate)
  const tooltipWidth = 128
  const tooltipHeight = 42
  const tooltipX = tooltipPoint
    ? Math.min(Math.max(plotLeft, tooltipPoint.x - tooltipWidth / 2), width - plotRight - tooltipWidth)
    : 0
  const tooltipY = tooltipPoint ? Math.max(plotTop + 2, tooltipPoint.y - tooltipHeight - 12) : 0

  return (
    <section className="stats-chart-card stats-chart-card--wide" aria-labelledby="lb-words-trend-title">
      <div className="stats-chart-heading">
        <h4 id="lb-words-trend-title">{personal ? 'Your daily words' : 'Daily average words'}</h4>
        <span>{visibleDays.length} tracked days</span>
      </div>
      {points.length > 0 ? (
        <svg aria-labelledby={chartTitleId} className="stats-trend-chart" role="img" viewBox={`0 0 ${width} ${height}`}>
          <title id={chartTitleId}>Average words by day</title>
          {yTicks.map((tick) => {
            const y = yForValue(tick)
            return (
              <g key={tick}>
                <path className="stats-trend-grid" d={`M ${plotLeft} ${y} H ${width - plotRight}`} />
                <text className="stats-trend-axis-label stats-trend-axis-label--y" x={plotLeft - 9} y={y}>
                  {tick}
                </text>
              </g>
            )
          })}
          <path className="stats-trend-axis" d={`M ${plotLeft} ${plotTop} V ${height - plotBottom} H ${width - plotRight}`} />
          <path className="stats-trend-line" d={path} />
          {points.map((point) => (
            <g key={point.day.date}>
              <circle
                aria-label={`${formatHistoryDate(point.day.date)}: ${point.day.averageWords.toFixed(2)} average words`}
                className="stats-trend-hit"
                cx={point.x}
                cy={point.y}
                fill="transparent"
                onBlur={() => setHoveredDate('')}
                onFocus={() => setHoveredDate(point.day.date)}
                onMouseEnter={() => setHoveredDate(point.day.date)}
                onMouseLeave={() => setHoveredDate('')}
                r="13"
                tabIndex={0}
              />
              <circle
                className={[
                  'stats-trend-point',
                  hoveredDate === point.day.date ? 'stats-trend-point--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                cx={point.x}
                cy={point.y}
                pointerEvents="none"
                r="4"
              />
            </g>
          ))}
          {tooltipPoint && (
            <g className="stats-trend-tooltip" pointerEvents="none">
              <rect height={tooltipHeight} rx="6" width={tooltipWidth} x={tooltipX} y={tooltipY} />
              <text x={tooltipX + 10} y={tooltipY + 17}>
                {formatHistoryDate(tooltipPoint.day.date)}
              </text>
              <text x={tooltipX + 10} y={tooltipY + 33}>
                {tooltipPoint.day.averageWords.toFixed(2)} avg words
              </text>
            </g>
          )}
          {firstDay && (
            <text className="stats-trend-axis-label" x={plotLeft} y={height - 10}>
              {formatHistoryDate(firstDay.date)}
            </text>
          )}
          {lastDay && lastDay.date !== firstDay?.date && (
            <text className="stats-trend-axis-label stats-trend-axis-label--end" x={width - plotRight} y={height - 10}>
              {formatHistoryDate(lastDay.date)}
            </text>
          )}

        </svg>
      ) : (
        <p className="stats-muted">Trend data will appear after daily completions.</p>
      )}
    </section>
  )
}

// Daily average longest-combo trend (auto-scaled y-axis, like the words chart).
function ComboTrendChart({
  timeline,
  personal = false,
}: {
  timeline: TilesTimelineDay[]
  personal?: boolean
}) {
  const chartTitleId = useId()
  const [hoveredDate, setHoveredDate] = useState('')
  const visibleDays = timeline.slice(-18)
  const width = 360
  const height = 176
  const plotLeft = 34
  const plotRight = 14
  const plotTop = 16
  const plotBottom = 34
  const values = visibleDays.map((day) => day.averageLongestCombo)
  const minValue = Math.max(0, Math.floor(Math.min(...values, 0)))
  const maxValue = Math.max(minValue + 1, Math.ceil(Math.max(...values, minValue + 1)))
  const yTicks = tickRange(minValue, maxValue)
  const plotWidth = width - plotLeft - plotRight
  const plotHeight = height - plotTop - plotBottom
  const yForValue = (value: number) =>
    plotTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight
  const points = visibleDays.map((day, index) => {
    const value = Math.min(maxValue, Math.max(minValue, day.averageLongestCombo))
    const x =
      visibleDays.length === 1
        ? width / 2
        : plotLeft + (index / (visibleDays.length - 1)) * plotWidth
    return { day, x, y: yForValue(value) }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const firstDay = visibleDays[0]
  const lastDay = visibleDays[visibleDays.length - 1]
  const tooltipPoint = points.find((point) => point.day.date === hoveredDate)
  const tooltipWidth = 132
  const tooltipHeight = 42
  const tooltipX = tooltipPoint
    ? Math.min(Math.max(plotLeft, tooltipPoint.x - tooltipWidth / 2), width - plotRight - tooltipWidth)
    : 0
  const tooltipY = tooltipPoint ? Math.max(plotTop + 2, tooltipPoint.y - tooltipHeight - 12) : 0

  return (
    <section className="stats-chart-card stats-chart-card--wide" aria-labelledby="tiles-combo-trend-title">
      <div className="stats-chart-heading">
        <h4 id="tiles-combo-trend-title">{personal ? 'Your daily longest combo' : 'Daily average longest combo'}</h4>
        <span>{visibleDays.length} tracked days</span>
      </div>
      {points.length > 0 ? (
        <svg aria-labelledby={chartTitleId} className="stats-trend-chart" role="img" viewBox={`0 0 ${width} ${height}`}>
          <title id={chartTitleId}>Average longest combo by day</title>
          {yTicks.map((tick) => {
            const y = yForValue(tick)
            return (
              <g key={tick}>
                <path className="stats-trend-grid" d={`M ${plotLeft} ${y} H ${width - plotRight}`} />
                <text className="stats-trend-axis-label stats-trend-axis-label--y" x={plotLeft - 9} y={y}>
                  {tick}
                </text>
              </g>
            )
          })}
          <path className="stats-trend-axis" d={`M ${plotLeft} ${plotTop} V ${height - plotBottom} H ${width - plotRight}`} />
          <path className="stats-trend-line" d={path} />
          {points.map((point) => (
            <g key={point.day.date}>
              <circle
                aria-label={`${formatHistoryDate(point.day.date)}: ${point.day.averageLongestCombo.toFixed(1)} average longest combo`}
                className="stats-trend-hit"
                cx={point.x}
                cy={point.y}
                fill="transparent"
                onBlur={() => setHoveredDate('')}
                onFocus={() => setHoveredDate(point.day.date)}
                onMouseEnter={() => setHoveredDate(point.day.date)}
                onMouseLeave={() => setHoveredDate('')}
                r="13"
                tabIndex={0}
              />
              <circle
                className={[
                  'stats-trend-point',
                  hoveredDate === point.day.date ? 'stats-trend-point--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                cx={point.x}
                cy={point.y}
                pointerEvents="none"
                r="4"
              />
            </g>
          ))}
          {tooltipPoint && (
            <g className="stats-trend-tooltip" pointerEvents="none">
              <rect height={tooltipHeight} rx="6" width={tooltipWidth} x={tooltipX} y={tooltipY} />
              <text x={tooltipX + 10} y={tooltipY + 17}>
                {formatHistoryDate(tooltipPoint.day.date)}
              </text>
              <text x={tooltipX + 10} y={tooltipY + 33}>
                ×{tooltipPoint.day.averageLongestCombo.toFixed(1)} avg combo
              </text>
            </g>
          )}
          {firstDay && (
            <text className="stats-trend-axis-label" x={plotLeft} y={height - 10}>
              {formatHistoryDate(firstDay.date)}
            </text>
          )}
          {lastDay && lastDay.date !== firstDay?.date && (
            <text className="stats-trend-axis-label stats-trend-axis-label--end" x={width - plotRight} y={height - 10}>
              {formatHistoryDate(lastDay.date)}
            </text>
          )}
        </svg>
      ) : (
        <p className="stats-muted">Trend data will appear after daily completions.</p>
      )}
    </section>
  )
}

// Daily average puzzle-completion % trend, with a dashed reference line at the
// 70% Genius threshold so a family can see how often they clear the bar.
function PercentTrendChart({
  timeline,
  personal = false,
}: {
  timeline: SpellingBeeTimelineDay[]
  personal?: boolean
}) {
  const chartTitleId = useId()
  const [hoveredDate, setHoveredDate] = useState('')
  const visibleDays = timeline.slice(-18)
  const width = 360
  const height = 176
  const plotLeft = 34
  const plotRight = 14
  const plotTop = 16
  const plotBottom = 34
  const plotWidth = width - plotLeft - plotRight
  const plotHeight = height - plotTop - plotBottom
  const yForValue = (value: number) => plotTop + ((100 - value) / 100) * plotHeight
  const yTicks = [0, 25, 50, 75, 100]
  const points = visibleDays.map((day, index) => {
    const x =
      visibleDays.length === 1
        ? width / 2
        : plotLeft + (index / (visibleDays.length - 1)) * plotWidth
    return { day, x, y: yForValue(Math.min(100, Math.max(0, day.averagePercent))) }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const firstDay = visibleDays[0]
  const lastDay = visibleDays[visibleDays.length - 1]
  const geniusY = yForValue(70)
  const tooltipPoint = points.find((point) => point.day.date === hoveredDate)
  const tooltipWidth = 132
  const tooltipHeight = 42
  const tooltipX = tooltipPoint
    ? Math.min(Math.max(plotLeft, tooltipPoint.x - tooltipWidth / 2), width - plotRight - tooltipWidth)
    : 0
  const tooltipY = tooltipPoint ? Math.max(plotTop + 2, tooltipPoint.y - tooltipHeight - 12) : 0

  return (
    <section className="stats-chart-card stats-chart-card--wide" aria-labelledby="sb-percent-trend-title">
      <div className="stats-chart-heading">
        <h4 id="sb-percent-trend-title">{personal ? 'Your daily puzzle %' : 'Daily average puzzle %'}</h4>
        <span>{visibleDays.length} tracked days</span>
      </div>
      {points.length > 0 ? (
        <svg aria-labelledby={chartTitleId} className="stats-trend-chart" role="img" viewBox={`0 0 ${width} ${height}`}>
          <title id={chartTitleId}>Average puzzle completion percent by day</title>
          {yTicks.map((tick) => {
            const y = yForValue(tick)
            return (
              <g key={tick}>
                <path className="stats-trend-grid" d={`M ${plotLeft} ${y} H ${width - plotRight}`} />
                <text className="stats-trend-axis-label stats-trend-axis-label--y" x={plotLeft - 9} y={y}>
                  {tick}
                </text>
              </g>
            )
          })}
          <path
            className="stats-trend-grid stats-trend-grid--genius"
            d={`M ${plotLeft} ${geniusY} H ${width - plotRight}`}
            strokeDasharray="4 3"
          />
          <text className="stats-trend-axis-label stats-trend-axis-label--end" x={width - plotRight} y={geniusY - 4}>
            Genius
          </text>
          <path className="stats-trend-axis" d={`M ${plotLeft} ${plotTop} V ${height - plotBottom} H ${width - plotRight}`} />
          <path className="stats-trend-line" d={path} />
          {points.map((point) => (
            <g key={point.day.date}>
              <circle
                aria-label={`${formatHistoryDate(point.day.date)}: ${point.day.averagePercent}% average`}
                className="stats-trend-hit"
                cx={point.x}
                cy={point.y}
                fill="transparent"
                onBlur={() => setHoveredDate('')}
                onFocus={() => setHoveredDate(point.day.date)}
                onMouseEnter={() => setHoveredDate(point.day.date)}
                onMouseLeave={() => setHoveredDate('')}
                r="13"
                tabIndex={0}
              />
              <circle
                className={[
                  'stats-trend-point',
                  hoveredDate === point.day.date ? 'stats-trend-point--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                cx={point.x}
                cy={point.y}
                pointerEvents="none"
                r="4"
              />
            </g>
          ))}
          {tooltipPoint && (
            <g className="stats-trend-tooltip" pointerEvents="none">
              <rect height={tooltipHeight} rx="6" width={tooltipWidth} x={tooltipX} y={tooltipY} />
              <text x={tooltipX + 10} y={tooltipY + 17}>
                {formatHistoryDate(tooltipPoint.day.date)}
              </text>
              <text x={tooltipX + 10} y={tooltipY + 33}>
                {tooltipPoint.day.averagePercent}% avg · {tooltipPoint.day.plays} play{tooltipPoint.day.plays === 1 ? '' : 's'}
              </text>
            </g>
          )}
          {firstDay && (
            <text className="stats-trend-axis-label" x={plotLeft} y={height - 10}>
              {formatHistoryDate(firstDay.date)}
            </text>
          )}
          {lastDay && lastDay.date !== firstDay?.date && (
            <text className="stats-trend-axis-label stats-trend-axis-label--end" x={width - plotRight} y={height - 10}>
              {formatHistoryDate(lastDay.date)}
            </text>
          )}
        </svg>
      ) : (
        <p className="stats-muted">Trend data will appear after daily plays.</p>
      )}
    </section>
  )
}

function tickRange(min: number, max: number) {
  const ticks: number[] = []
  for (let value = min; value <= max; value += 1) {
    ticks.push(value)
  }
  return ticks
}

function formatHistoryDate(rawDate: string) {
  const [year, month, day] = rawDate.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(year, (month || 1) - 1, day || 1),
  )
}
