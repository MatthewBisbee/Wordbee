import type { CSSProperties } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  EMPTY_STATS,
  GUESS_DISTRIBUTION_ROWS,
  LUCK_HELP_TEXT,
  SKILL_HELP_TEXT,
} from '../../config/constants'
import { AvatarImage } from '../avatar/avatar'
import { createDefaultAvatarConfig, sanitizeAvatarConfig } from '../avatar/avatar-config'
import type {
  AvatarConfig,
  FamilyDailyResult,
  FamilyGroupStats,
  FamilyStatsDashboard,
  FamilyStatsUser,
  FamilyStatsView,
  FamilyTimelineDay,
  GuessAnalysisStep,
  SolveAnalysis,
  StarterInsight,
  StarterStat,
} from '../../types'

export function FamilyStatsPage({
  currentUserId,
  dashboard,
  error,
  initialView,
  isLoading,
  onBack,
  onReload,
}: {
  currentUserId: string
  dashboard: FamilyStatsDashboard | null
  error: string
  initialView: FamilyStatsView
  isLoading: boolean
  onBack: () => void
  onReload: () => void
}) {
  const [selectedUserId, setSelectedUserId] = useState(currentUserId)
  const [selectedResultId, setSelectedResultId] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [view, setView] = useState<FamilyStatsView>(initialView)
  const users = dashboard?.users ?? []
  const group = dashboard?.group ?? createFallbackGroupStats(users)
  const selectedUser =
    users.find((user) => user.id === selectedUserId) ??
    users.find((user) => user.id === currentUserId) ??
    users[0]
  const selectedUserOpenHistory =
    selectedUser?.history.filter((result) => !isLockedResult(result)) ?? []
  const playerResult =
    selectedUserOpenHistory.find((result) => result.id === selectedResultId) ??
    selectedUserOpenHistory[0]
  const selectedDay =
    group.timeline.find((day) => day.date === selectedDate) ??
    group.timeline[group.timeline.length - 1]
  const selectedDayResults = selectedDay ? getResultsForDate(users, selectedDay.date) : []
  const selectedDayOpenResults = selectedDayResults.filter((result) => !isLockedResult(result))
  const dayResult =
    selectedDayOpenResults.find((result) => result.id === selectedResultId) ??
    selectedDayOpenResults[0]
  const isInitialStatsLoad = isLoading && !dashboard

  useEffect(() => {
    setView(initialView)
  }, [initialView])

  useEffect(() => {
    if (view !== 'players') return
    if (!selectedUser) return
    if (
      selectedUser.history.some(
        (result) => result.id === selectedResultId && !isLockedResult(result),
      )
    ) {
      return
    }
    setSelectedResultId(getFirstUnlockedResult(selectedUser.history)?.id ?? '')
  }, [selectedResultId, selectedUser, view])

  useEffect(() => {
    if (selectedDate && group.timeline.some((day) => day.date === selectedDate)) return
    setSelectedDate(group.timeline[group.timeline.length - 1]?.date ?? '')
  }, [group.timeline, selectedDate])

  useEffect(() => {
    if (view !== 'daily') return

    const dayResultId = dayResult?.id ?? ''
    if (selectedResultId === dayResultId) return

    setSelectedResultId(dayResultId)
  }, [dayResult?.id, selectedResultId, view])

  const openPlayer = (userId: string) => {
    setSelectedUserId(userId)
    setView('players')
  }

  return (
    <main className="stats-page" aria-labelledby="stats-page-title">
      <div className="stats-page__inner">
        <section className="stats-hero">
          <div>
            <span className="stats-kicker">Friends & family</span>
            <h2 id="stats-page-title">Stats</h2>
            <p>Daily play only. Random and past-date Wordle plays stay untracked.</p>
          </div>
          <div className="stats-hero__actions">
            <button className="stats-secondary-button" onClick={onBack} type="button">
              Back to game
            </button>
            <button
              className="stats-primary-button"
              disabled={isLoading}
              onClick={onReload}
              type="button"
            >
              Refresh
            </button>
          </div>
        </section>

        {error && (
          <div className="stats-error">
            <span>{error}</span>
            <button disabled={isLoading} onClick={onReload} type="button">
              Retry
            </button>
          </div>
        )}

        {isInitialStatsLoad ? null : users.length === 0 && !isLoading ? (
          <section className="stats-empty">
            <h3>No tracked daily results yet</h3>
            <p>Friends-and-family daily completions will appear here.</p>
          </section>
        ) : (
          <>
            <StatsPageTabs onChange={setView} view={view} />
            {view === 'overview' && (
              <StatsOverview group={group} onSelectUser={openPlayer} users={users} />
            )}
            {view === 'players' && selectedUser && (
              <StatsPlayerView
                onSelectResult={setSelectedResultId}
                onSelectUser={setSelectedUserId}
                result={playerResult}
                selectedUser={selectedUser}
                users={users}
              />
            )}
            {view === 'daily' && (
              <StatsDailyView
                day={selectedDay}
                onSelectDate={setSelectedDate}
                onSelectResult={setSelectedResultId}
                result={dayResult}
                results={selectedDayResults}
                selectedDate={selectedDate}
                timeline={group.timeline}
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}

function StatsPageTabs({
  onChange,
  view,
}: {
  onChange: (view: FamilyStatsView) => void
  view: FamilyStatsView
}) {
  return (
    <div className="stats-tabs" role="tablist" aria-label="Stats views">
      {(
        [
          ['overview', 'Overview'],
          ['players', 'Players'],
          ['daily', 'Daily review'],
        ] as const
      ).map(([value, label]) => (
        <button
          aria-selected={view === value}
          key={value}
          onClick={() => onChange(value)}
          role="tab"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function StatsOverview({
  group,
  onSelectUser,
  users,
}: {
  group: FamilyGroupStats
  onSelectUser: (userId: string) => void
  users: FamilyStatsUser[]
}) {
  const averageLeader = getAverageLeader(users)
  const winsLeader = getWinsLeader(users)
  const currentStreakLeader = getCurrentPlayStreakLeader(users)
  const playsLeader = getPlaysLeader(users)
  const winRateLeader = getWinRateLeader(users)

  return (
    <section className="stats-section" aria-label="Stats overview">
      <div className="stats-metric-grid">
        <StatsMetric label="Total plays" value={group.played} />
        <StatsMetric
          label="Lowest average"
          player={averageLeader}
          value={averageLeader ? formatAverage(averageLeader.stats.averageGuesses) : '--'}
        />
        <StatsMetric
          label="Most wins"
          player={winsLeader}
          value={winsLeader?.stats.wins ?? '--'}
        />
        <StatsMetric
          label="Longest current streak"
          player={currentStreakLeader}
          value={currentStreakLeader?.stats.currentPlayStreak ?? '--'}
        />
        <StatsMetric
          label="Most plays"
          player={playsLeader}
          value={playsLeader?.stats.played ?? '--'}
        />
        <StatsMetric
          label="Highest win rate"
          player={winRateLeader}
          value={winRateLeader ? `${winRateLeader.stats.winPercentage}%` : '--'}
        />
      </div>

      <div className="stats-chart-grid">
        <GuessDistributionChart distribution={group.guessDistribution} title="Solve distribution" />
        <StarterBarChart starters={group.topStarters} title="First-word habits" />
      </div>

      <TrendChart timeline={group.timeline} />
      <PlayerLeaderboard onSelectUser={onSelectUser} users={users} />
    </section>
  )
}

function StatsPlayerView({
  onSelectResult,
  onSelectUser,
  result,
  selectedUser,
  users,
}: {
  onSelectResult: (resultId: string) => void
  onSelectUser: (userId: string) => void
  result?: FamilyDailyResult
  selectedUser: FamilyStatsUser
  users: FamilyStatsUser[]
}) {
  return (
    <section className="stats-section" aria-label={`${selectedUser.displayName} stats`}>
      <div className="stats-player-tabs" aria-label="Players">
        {users.map((user) => (
          <button
            aria-pressed={user.id === selectedUser.id}
            key={user.id}
            onClick={() => onSelectUser(user.id)}
            type="button"
          >
            <PlayerAvatar
              avatar={user.avatar}
              displayName={user.displayName}
              size={30}
              userId={user.id}
            />
            <span>{user.displayName}</span>
          </button>
        ))}
      </div>

      <div className="stats-profile-heading">
        <div className="stats-profile-identity">
          <PlayerAvatar
            avatar={selectedUser.avatar}
            displayName={selectedUser.displayName}
            size={54}
            userId={selectedUser.id}
          />
          <div>
            <span className="stats-kicker">Player insight</span>
            <h3>{selectedUser.displayName}</h3>
          </div>
        </div>
        <span>{selectedUser.stats.played} daily plays</span>
      </div>

      <div className="stats-metric-grid stats-metric-grid--player">
        <StatsMetric label="Wins" value={selectedUser.stats.wins} />
        <StatsMetric label="Win rate" value={`${selectedUser.stats.winPercentage}%`} />
        <StatsMetric label="Avg guesses" value={formatAverage(selectedUser.stats.averageGuesses)} />
        <StatsMetric
          help={SKILL_HELP_TEXT}
          label="Skill"
          value={selectedUser.stats.averageSkill ?? 0}
        />
        <StatsMetric
          help={LUCK_HELP_TEXT}
          label="Luck"
          value={selectedUser.stats.averageLuck ?? 0}
        />
        <StatsMetric label="Best streak" value={selectedUser.stats.bestWinStreak} />
      </div>

      <div className="stats-chart-grid">
        <GuessDistributionChart
          distribution={selectedUser.stats.guessDistribution}
          title="Personal distribution"
        />
        <StarterBarChart starters={selectedUser.stats.topStarters} title="Favorite first words" />
      </div>

      <div className="stats-history-layout">
        <section className="stats-history-panel" aria-labelledby="player-history-title">
          <h4 id="player-history-title">Daily history</h4>
          {selectedUser.history.length > 0 ? (
            <div className="stats-history-list">
              {selectedUser.history.map((historyResult) => {
                const locked = isLockedResult(historyResult)

                return (
                  <button
                    data-locked={locked}
                    data-selected={!locked && historyResult.id === result?.id}
                    disabled={locked}
                    key={historyResult.id}
                    onClick={() => onSelectResult(historyResult.id)}
                    type="button"
                  >
                    <span>{formatHistoryDate(historyResult.date)}</span>
                    <strong>{formatOutcome(historyResult)}</strong>
                    <em>{locked ? 'Solve today to reveal' : historyResult.starterWord}</em>
                  </button>
                )
              })}
            </div>
          ) : (
            <p>No completed days yet.</p>
          )}
        </section>

        {result && <FamilyResultBoard result={result} />}
      </div>
    </section>
  )
}

function StatsDailyView({
  day,
  onSelectDate,
  onSelectResult,
  result,
  results,
  selectedDate,
  timeline,
}: {
  day?: FamilyTimelineDay
  onSelectDate: (dateValue: string) => void
  onSelectResult: (resultId: string) => void
  result?: FamilyDailyResult
  results: FamilyDailyResult[]
  selectedDate: string
  timeline: FamilyTimelineDay[]
}) {
  const isLockedDay = Boolean(day?.locked)

  return (
    <section className="stats-section" aria-label="Daily stats review">
      <div className="stats-day-rail" aria-label="Tracked days">
        {timeline.map((timelineDay) => (
          <button
            aria-pressed={timelineDay.date === selectedDate}
            data-locked={Boolean(timelineDay.locked)}
            key={timelineDay.date}
            onClick={() => onSelectDate(timelineDay.date)}
            type="button"
          >
            <strong>{formatHistoryDate(timelineDay.date)}</strong>
          </button>
        ))}
      </div>

      {day ? (
        <>
          <div className="stats-day-summary">
            <InsightCard
              detail={
                isLockedDay
                  ? `${day.players} player${day.players === 1 ? '' : 's'} finished`
                  : `${day.players} players, ${day.winPercentage}% wins`
              }
              label="Answer"
              locked={isLockedDay}
              value={isLockedDay ? 'Locked' : day.answer}
            />
            <InsightCard
              detail={isLockedDay ? 'Solve today to reveal' : `${day.bestScore} by ${day.bestPlayer}`}
              label="Best solve"
              locked={isLockedDay}
              value={isLockedDay ? 'Locked' : day.bestPlayer}
            />
          </div>

          <div className="stats-daily-results" aria-label={`${formatHistoryDate(day.date)} results`}>
            {results.map((dailyResult) => {
              const locked = isLockedResult(dailyResult)

              return (
                <button
                  data-locked={locked}
                  data-selected={!locked && dailyResult.id === result?.id}
                  disabled={locked}
                  key={dailyResult.id}
                  onClick={() => onSelectResult(dailyResult.id)}
                  type="button"
                >
                  <PlayerAvatar
                    avatar={dailyResult.avatar}
                    displayName={dailyResult.displayName}
                    size={48}
                    userId={dailyResult.userId}
                  />
                  <strong className="stats-daily-result-name">{dailyResult.displayName}</strong>
                  <span className="stats-daily-result-outcome">
                    {locked ? 'Solve today to reveal' : formatOutcomeWithGuesses(dailyResult)}
                  </span>
                </button>
              )
            })}
          </div>

          {result && !isLockedResult(result) && <FamilyResultBoard result={result} />}
        </>
      ) : (
        <section className="stats-empty">
          <h3>No daily results yet</h3>
          <p>Completed friends-and-family days will appear here.</p>
        </section>
      )}
    </section>
  )
}

function StatsMetric({
  help,
  label,
  player,
  value,
}: {
  help?: string
  label: string
  player?: FamilyStatsUser
  value: number | string
}) {
  const variant = player ? 'player' : 'number'

  return (
    <article className={`stats-metric stats-metric--${variant}`}>
      {player ? (
        <div className="stats-metric__value-row">
          <strong>{value}</strong>
          <span className="stats-metric__player">
            <PlayerAvatar
              avatar={player.avatar}
              displayName={player.displayName}
              size={28}
              userId={player.id}
            />
            <span>{player.displayName}</span>
          </span>
        </div>
      ) : (
        <strong>{value}</strong>
      )}
      <span>
        {label}
        {help && <StatsHelpTooltip text={help} />}
      </span>
    </article>
  )
}

function StatsHelpTooltip({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const contentRef = useRef<HTMLSpanElement | null>(null)
  const tooltipId = useId()

  const updatePopoverPosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return

    const buttonRect = button.getBoundingClientRect()
    const width = Math.min(286, Math.max(180, window.innerWidth - 24))
    const left = Math.min(
      Math.max(12, buttonRect.left + buttonRect.width / 2 - width / 2),
      window.innerWidth - width - 12,
    )
    const contentHeight = contentRef.current?.offsetHeight ?? 96
    const belowTop = buttonRect.bottom + 8
    const hasRoomBelow = belowTop + contentHeight + 12 <= window.innerHeight
    const top = hasRoomBelow
      ? belowTop
      : Math.max(12, buttonRect.top - contentHeight - 8)

    setPopoverStyle({
      left,
      top,
      width,
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return

    updatePopoverPosition()

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || contentRef.current?.contains(target)) return
      setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updatePopoverPosition)
    window.addEventListener('scroll', updatePopoverPosition, true)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updatePopoverPosition)
      window.removeEventListener('scroll', updatePopoverPosition, true)
    }
  }, [isOpen, updatePopoverPosition])

  return (
    <span className="stats-help-wrap">
      <button
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        aria-label={text}
        className="stats-help"
        ref={buttonRef}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
        type="button"
      >
        ?
      </button>
      {isOpen &&
        createPortal(
          <span
            className="stats-help__content"
            id={tooltipId}
            ref={contentRef}
            role="tooltip"
            style={popoverStyle}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}

function InsightCard({
  avatar,
  detail,
  label,
  locked = false,
  value,
}: {
  avatar?: { avatar?: AvatarConfig; displayName: string; userId: string }
  detail: string
  label: string
  locked?: boolean
  value: string
}) {
  return (
    <article className="stats-insight-card" data-locked={locked}>
      <span>{label}</span>
      <div className="stats-insight-card__value">
        {avatar && (
          <PlayerAvatar
            avatar={avatar.avatar}
            displayName={avatar.displayName}
            size={36}
            userId={avatar.userId}
          />
        )}
        <strong>{value}</strong>
      </div>
      <p>{detail}</p>
    </article>
  )
}

function GuessDistributionChart({
  distribution,
  title,
}: {
  distribution: Record<string, number>
  title: string
}) {
  const max = Math.max(1, ...GUESS_DISTRIBUTION_ROWS.map((row) => distribution[row.key] ?? 0))

  return (
    <section className="stats-chart-card" aria-labelledby={`${toSlug(title)}-title`}>
      <h4 id={`${toSlug(title)}-title`}>{title}</h4>
      <div className="stats-distribution-chart">
        {GUESS_DISTRIBUTION_ROWS.map((row) => {
          const count = distribution[row.key] ?? 0

          return (
            <div className="stats-distribution-row" key={row.key}>
              <span>{row.label}</span>
              <strong
                style={
                  {
                    '--bar-width': `${Math.max(4, (count / max) * 100)}%`,
                  } as CSSProperties
                }
              >
                {count}
              </strong>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function StarterBarChart({
  starters,
  title,
}: {
  starters: Array<StarterStat | StarterInsight>
  title: string
}) {
  const visibleStarters = starters.slice(0, 8)
  const max = Math.max(1, ...visibleStarters.map((starter) => starter.count))

  return (
    <section className="stats-chart-card" aria-labelledby={`${toSlug(title)}-title`}>
      <h4 id={`${toSlug(title)}-title`}>{title}</h4>
      {visibleStarters.length > 0 ? (
        <div className="stats-starter-bars">
          {visibleStarters.map((starter) => (
            <div className="stats-starter-bar" key={starter.word}>
              <div>
                <strong>{starter.word}</strong>
                <span>
                  {starter.count} plays · {starter.percentage}%
                </span>
              </div>
              <em
                style={
                  {
                    '--bar-width': `${Math.max(6, (starter.count / max) * 100)}%`,
                  } as CSSProperties
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="stats-muted">No first-word data yet.</p>
      )}
    </section>
  )
}

function TrendChart({ timeline }: { timeline: FamilyTimelineDay[] }) {
  const chartTitleId = useId()
  const [hoveredDate, setHoveredDate] = useState('')
  const visibleDays = timeline.filter((day) => !day.locked).slice(-18)
  const width = 360
  const height = 176
  const plotLeft = 34
  const plotRight = 14
  const plotTop = 16
  const plotBottom = 34
  const minValue = 1
  const maxValue = 6
  const yTicks = [1, 2, 3, 4, 5, 6]
  const plotWidth = width - plotLeft - plotRight
  const plotHeight = height - plotTop - plotBottom
  const yForValue = (value: number) =>
    plotTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight
  const points = visibleDays.map((day, index) => {
    const value = Math.min(maxValue, Math.max(minValue, day.averageGuesses))
    const x =
      visibleDays.length === 1
        ? width / 2
        : plotLeft + (index / (visibleDays.length - 1)) * plotWidth
    const y = yForValue(value)
    return { day, x, y }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const firstDay = visibleDays[0]
  const lastDay = visibleDays[visibleDays.length - 1]
  const tooltipPoint = points.find((point) => point.day.date === hoveredDate)
  const tooltipWidth = 116
  const tooltipHeight = 42
  const tooltipX = tooltipPoint
    ? Math.min(
        Math.max(plotLeft, tooltipPoint.x - tooltipWidth / 2),
        width - plotRight - tooltipWidth,
      )
    : 0
  const tooltipY = tooltipPoint
    ? Math.max(plotTop + 2, tooltipPoint.y - tooltipHeight - 12)
    : 0

  return (
    <section className="stats-chart-card stats-chart-card--wide" aria-labelledby="stats-trend-title">
      <div className="stats-chart-heading">
        <h4 id="stats-trend-title">Daily average guesses</h4>
        <span>{visibleDays.length} tracked days</span>
      </div>
      {points.length > 0 ? (
        <svg
          aria-labelledby={chartTitleId}
          className="stats-trend-chart"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <title id={chartTitleId}>Average guesses by day</title>
          {yTicks.map((tick) => {
            const y = yForValue(tick)

            return (
              <g key={tick}>
                <path className="stats-trend-grid" d={`M ${plotLeft} ${y} H ${width - plotRight}`} />
                <text
                  className="stats-trend-axis-label stats-trend-axis-label--y"
                  x={plotLeft - 9}
                  y={y}
                >
                  {tick}
                </text>
              </g>
            )
          })}
          <path
            className="stats-trend-axis"
            d={`M ${plotLeft} ${plotTop} V ${height - plotBottom} H ${width - plotRight}`}
          />
          <path className="stats-trend-line" d={path} />
          {points.map((point) => (
            <circle
              aria-label={`${point.day.date}: ${point.day.averageGuesses.toFixed(2)} average guesses`}
              className="stats-trend-point"
              cx={point.x}
              cy={point.y}
              key={point.day.date}
              onBlur={() => setHoveredDate('')}
              onFocus={() => setHoveredDate(point.day.date)}
              onMouseEnter={() => setHoveredDate(point.day.date)}
              onMouseLeave={() => setHoveredDate('')}
              r="4"
              tabIndex={0}
            />
          ))}
          {tooltipPoint && (
            <g className="stats-trend-tooltip" pointerEvents="none">
              <rect
                height={tooltipHeight}
                rx="6"
                width={tooltipWidth}
                x={tooltipX}
                y={tooltipY}
              />
              <text x={tooltipX + 10} y={tooltipY + 17}>
                {tooltipPoint.day.date}
              </text>
              <text x={tooltipX + 10} y={tooltipY + 33}>
                {tooltipPoint.day.averageGuesses.toFixed(2)} avg guesses
              </text>
            </g>
          )}
          {firstDay && (
            <text className="stats-trend-axis-label" x={plotLeft} y={height - 10}>
              {formatHistoryDate(firstDay.date)}
            </text>
          )}
          {lastDay && lastDay.date !== firstDay?.date && (
            <text
              className="stats-trend-axis-label stats-trend-axis-label--end"
              x={width - plotRight}
              y={height - 10}
            >
              {formatHistoryDate(lastDay.date)}
            </text>
          )}
          <text className="stats-trend-axis-title" x={plotLeft} y={10}>
            Avg guesses
          </text>
        </svg>
      ) : (
        <p className="stats-muted">Trend data will appear after daily completions.</p>
      )}
    </section>
  )
}

type LeaderboardSortKey =
  | 'averageGuesses'
  | 'winPercentage'
  | 'wins'
  | 'currentWinStreak'
  | 'bestWinStreak'
  | 'averageSkill'
  | 'played'

type LeaderboardSortOption = {
  direction: 'asc' | 'desc'
  formatValue: (user: FamilyStatsUser) => string
  getValue: (user: FamilyStatsUser) => number
  key: LeaderboardSortKey
  label: string
}

const LEADERBOARD_SORT_OPTIONS: LeaderboardSortOption[] = [
  {
    direction: 'asc',
    formatValue: (user) => `${formatAverage(user.stats.averageGuesses)} avg guesses`,
    getValue: (user) => user.stats.averageGuesses,
    key: 'averageGuesses',
    label: 'Average guesses',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.winPercentage}% win rate`,
    getValue: (user) => user.stats.winPercentage,
    key: 'winPercentage',
    label: 'Win rate',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.wins} wins`,
    getValue: (user) => user.stats.wins,
    key: 'wins',
    label: 'Wins',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.currentWinStreak} current streak`,
    getValue: (user) => user.stats.currentWinStreak,
    key: 'currentWinStreak',
    label: 'Current streak',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.bestWinStreak} best streak`,
    getValue: (user) => user.stats.bestWinStreak,
    key: 'bestWinStreak',
    label: 'Best streak',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.averageSkill ?? 0} skill`,
    getValue: (user) => user.stats.averageSkill ?? 0,
    key: 'averageSkill',
    label: 'Skill',
  },
  {
    direction: 'desc',
    formatValue: (user) => `${user.stats.played} plays`,
    getValue: (user) => user.stats.played,
    key: 'played',
    label: 'Total plays',
  },
]

function PlayerLeaderboard({
  onSelectUser,
  users,
}: {
  onSelectUser: (userId: string) => void
  users: FamilyStatsUser[]
}) {
  const [sortKey, setSortKey] = useState<LeaderboardSortKey>('averageGuesses')
  const selectedSort = getLeaderboardSortOption(sortKey)
  const rankedUsers = [...users].sort((first, second) =>
    compareLeaderboardUsers(first, second, sortKey),
  )

  return (
    <section className="stats-leaderboard" aria-labelledby="stats-leaderboard-title">
      <div className="stats-chart-heading">
        <h4 id="stats-leaderboard-title">Leaderboard</h4>
        <label className="stats-leaderboard-sort">
          <span>Ranked by</span>
          <select
            aria-label="Rank leaderboard by"
            onChange={(event) => setSortKey(event.target.value as LeaderboardSortKey)}
            value={sortKey}
          >
            {LEADERBOARD_SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="stats-leaderboard-list">
        {rankedUsers.map((user, index) => (
          <button key={user.id} onClick={() => onSelectUser(user.id)} type="button">
            <span>#{index + 1}</span>
            <PlayerAvatar
              avatar={user.avatar}
              displayName={user.displayName}
              size={34}
              userId={user.id}
            />
            <strong>{user.displayName}</strong>
            <em>{formatLeaderboardValue(user, selectedSort)}</em>
            <i>{formatLeaderboardSecondaryValue(user, sortKey)}</i>
          </button>
        ))}
      </div>
    </section>
  )
}

function FamilyResultBoard({ result }: { result: FamilyDailyResult }) {
  return (
    <section className="family-result-board" aria-label={`${result.displayName} ${result.date}`}>
      <div className="family-result-board__heading">
        <div className="family-result-board__player">
          <PlayerAvatar
            avatar={result.avatar}
            displayName={result.displayName}
            size={42}
            userId={result.userId}
          />
          <div>
            <span>{formatHistoryDate(result.date)}</span>
            <strong>{result.displayName}</strong>
          </div>
        </div>
        <em>{formatOutcomeWithGuesses(result)}</em>
      </div>
      <div className="family-result-board__body">
        <div className="family-mini-board">
          {result.guesses.map((guess, rowIndex) => (
            <div className="family-mini-board__row" key={`${result.id}-${rowIndex}`}>
              {guess.split('').map((letter, tileIndex) => (
                <span
                  data-state={result.board[rowIndex]?.[tileIndex] ?? 'absent'}
                  key={`${result.id}-${rowIndex}-${tileIndex}`}
                >
                  {letter}
                </span>
              ))}
            </div>
          ))}
        </div>
        {result.analysis && <SolveAnalysisPanel analysis={result.analysis} />}
      </div>
    </section>
  )
}

export function SolveAnalysisPanel({ analysis }: { analysis: SolveAnalysis }) {
  return (
    <div className="solve-analysis">
      <div className="solve-analysis__scores">
        <ScoreMeter help={SKILL_HELP_TEXT} label="Skill" value={analysis.skill} />
        <ScoreMeter help={LUCK_HELP_TEXT} label="Luck" value={analysis.luck} />
      </div>
      <div className="solve-analysis__path">
        <span>Solve path</span>
        <strong>{analysis.remainingAfterLast} left after final guess</strong>
      </div>
      <p className="solve-analysis__note">
        Counts show possible answers before and after each clue. Expected remaining is an
        average over possible clue patterns.
      </p>
      <ol className="solve-analysis__steps">
        {analysis.steps.map((step) => (
          <li key={`${step.turn}-${step.guess}`}>
            <div className="solve-analysis__step-heading">
              <strong>
                {step.turn}. {step.guess}
              </strong>
              <span>
                {formatCandidateCountChange(step)}
              </span>
            </div>
            <div className="solve-analysis__step-bar">
              <span
                style={
                  {
                    '--bar-width': `${Math.max(3, ((step.before - step.after) / step.before) * 100)}%`,
                  } as CSSProperties
                }
              />
            </div>
            <p>{formatStepInsight(step)}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function formatCandidateCountChange(step: GuessAnalysisStep) {
  return step.before <= 1
    ? '1 possible answer'
    : `${step.before} possible -> ${step.after}`
}

function formatStepInsight(step: GuessAnalysisStep) {
  if (step.before <= 1) {
    if (step.guess === step.bestWord) {
      return `${step.bestWord} was the only remaining answer; this guess confirmed it.`
    }

    return `${step.bestWord} was the only remaining answer; ${step.guess} could not improve the path.`
  }

  return `${step.eliminatedPercentage}% eliminated. Expected remaining for ${step.guess}: ${formatAverage(step.expectedRemaining)}. Best sampled play: ${step.bestWord} (${formatAverage(step.bestRemaining)} expected).`
}

function ScoreMeter({
  help,
  label,
  value,
}: {
  help?: string
  label: string
  value: number
}) {
  return (
    <div className="score-meter">
      <div>
        <span>
          {label}
          {help && <StatsHelpTooltip text={help} />}
        </span>
        <strong>{value}</strong>
      </div>
      <em
        style={
          {
            '--meter-width': `${Math.max(4, Math.min(100, value))}%`,
          } as CSSProperties
        }
      />
    </div>
  )
}

function PlayerAvatar({
  avatar,
  displayName,
  size,
}: {
  avatar?: AvatarConfig
  displayName: string
  size: number
  userId: string
}) {
  const displayAvatar =
    (avatar ? sanitizeAvatarConfig(avatar, displayName) : null) ??
    createDefaultAvatarConfig(displayName)

  return (
    <span
      aria-hidden="true"
      className="stats-player-avatar"
      style={{ height: size, width: size }}
    >
      <AvatarImage
        avatar={displayAvatar}
        className="stats-player-avatar__image"
        displayName={displayName}
        size={size * 3}
      />
    </span>
  )
}

function createFallbackGroupStats(users: FamilyStatsUser[]): FamilyGroupStats {
  const results = users.flatMap((user) => user.history)
  const wins = results.filter((result) => result.outcome === 'won')
  const distribution = { ...EMPTY_STATS.guessDistribution }
  wins.forEach((result) => {
    const distributionKey = String(result.guessesUsed)
    distribution[distributionKey] = (distribution[distributionKey] ?? 0) + 1
  })
  distribution.fail = results.length - wins.length

  return {
    played: results.length,
    wins: wins.length,
    winPercentage: results.length ? Math.round((wins.length / results.length) * 100) : 0,
    averageGuesses: results.length
      ? Number(formatAverage(results.reduce((total, result) => total + result.guessesUsed, 0) / results.length))
      : 0,
    averageSkill: 0,
    averageLuck: 0,
    daysTracked: new Set(results.map((result) => result.date)).size,
    players: users.length,
    guessDistribution: distribution,
    topStarters: [],
    timeline: [],
    recentResults: results.slice(0, 36),
    bestDay: null,
    toughestDay: null,
  }
}

function getResultsForDate(users: FamilyStatsUser[], dateValue: string) {
  return users
    .flatMap((user) => user.history)
    .filter((result) => result.date === dateValue)
    .sort((first, second) => {
      if (isLockedResult(first) !== isLockedResult(second)) {
        return isLockedResult(first) ? 1 : -1
      }
      if (first.outcome !== second.outcome) return first.outcome === 'won' ? -1 : 1
      if (first.guessesUsed !== second.guessesUsed) return first.guessesUsed - second.guessesUsed
      return first.completedAt.localeCompare(second.completedAt)
    })
}

function isLockedResult(result?: FamilyDailyResult) {
  return Boolean(result?.locked)
}

function getFirstUnlockedResult(results: FamilyDailyResult[]) {
  return results.find((result) => !isLockedResult(result))
}

function getAverageLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.played > 0)
    .sort((first, second) => first.stats.averageGuesses - second.stats.averageGuesses)[0]
}

function getWinsLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.wins > 0)
    .sort((first, second) => {
      if (second.stats.wins !== first.stats.wins) return second.stats.wins - first.stats.wins
      return first.stats.averageGuesses - second.stats.averageGuesses
    })[0]
}

function getCurrentPlayStreakLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.currentPlayStreak > 0)
    .sort((first, second) => {
      if (second.stats.currentPlayStreak !== first.stats.currentPlayStreak) {
        return second.stats.currentPlayStreak - first.stats.currentPlayStreak
      }
      return first.stats.averageGuesses - second.stats.averageGuesses
    })[0]
}

function getPlaysLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.played > 0)
    .sort((first, second) => {
      if (second.stats.played !== first.stats.played) return second.stats.played - first.stats.played
      return first.stats.averageGuesses - second.stats.averageGuesses
    })[0]
}

function getWinRateLeader(users: FamilyStatsUser[]) {
  return users
    .filter((user) => user.stats.played > 0)
    .sort((first, second) => {
      if (second.stats.winPercentage !== first.stats.winPercentage) {
        return second.stats.winPercentage - first.stats.winPercentage
      }
      if (second.stats.wins !== first.stats.wins) return second.stats.wins - first.stats.wins
      return first.stats.averageGuesses - second.stats.averageGuesses
    })[0]
}

function getLeaderboardSortOption(sortKey: LeaderboardSortKey) {
  return (
    LEADERBOARD_SORT_OPTIONS.find((option) => option.key === sortKey) ??
    LEADERBOARD_SORT_OPTIONS[0]
  )
}

function compareLeaderboardUsers(
  first: FamilyStatsUser,
  second: FamilyStatsUser,
  sortKey: LeaderboardSortKey,
) {
  if (first.stats.played === 0 || second.stats.played === 0) {
    if (first.stats.played !== second.stats.played) return first.stats.played === 0 ? 1 : -1
  }

  const sortOption = getLeaderboardSortOption(sortKey)
  const firstValue = sortOption.getValue(first)
  const secondValue = sortOption.getValue(second)

  if (firstValue !== secondValue) {
    return sortOption.direction === 'asc' ? firstValue - secondValue : secondValue - firstValue
  }

  return compareLeaderboardTiebreakers(first, second, sortKey)
}

function compareLeaderboardTiebreakers(
  first: FamilyStatsUser,
  second: FamilyStatsUser,
  sortKey: LeaderboardSortKey,
) {
  const tiebreakers =
    sortKey === 'averageGuesses'
      ? [
          compareStat(first.stats.averageSkill ?? 0, second.stats.averageSkill ?? 0, 'desc'),
          compareStat(first.stats.winPercentage, second.stats.winPercentage, 'desc'),
          compareStat(first.stats.wins, second.stats.wins, 'desc'),
        ]
      : [
          compareStat(first.stats.averageGuesses, second.stats.averageGuesses, 'asc'),
          compareStat(first.stats.averageSkill ?? 0, second.stats.averageSkill ?? 0, 'desc'),
          compareStat(first.stats.winPercentage, second.stats.winPercentage, 'desc'),
          compareStat(first.stats.wins, second.stats.wins, 'desc'),
        ]

  return (
    tiebreakers.find((result) => result !== 0) ??
    first.displayName.localeCompare(second.displayName)
  )
}

function compareStat(firstValue: number, secondValue: number, direction: 'asc' | 'desc') {
  return direction === 'asc' ? firstValue - secondValue : secondValue - firstValue
}

function formatLeaderboardValue(user: FamilyStatsUser, sortOption: LeaderboardSortOption) {
  if (user.stats.played === 0) return 'No plays yet'
  return sortOption.formatValue(user)
}

function formatLeaderboardSecondaryValue(user: FamilyStatsUser, sortKey: LeaderboardSortKey) {
  if (user.stats.played === 0) return ''
  if (sortKey === 'averageGuesses') return `${user.stats.averageSkill ?? 0} skill`
  return `${formatAverage(user.stats.averageGuesses)} avg guesses`
}

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function formatAverage(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatHistoryDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number)
  if (!year || !month || !day) return dateValue

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function formatOutcome(result: FamilyDailyResult) {
  if (isLockedResult(result)) return 'Locked'

  return result.outcome === 'won' ? `${result.guessesUsed}/6` : 'X/6'
}

function formatOutcomeWithGuesses(result: FamilyDailyResult) {
  if (isLockedResult(result)) return 'Locked'

  return `${formatOutcome(result)} guesses`
}
