import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDateInput } from '../../lib/date'
import { formatElapsedTime, loadGameCalendar, type SessionRequest } from '../games/game-utils'
import type {
  CalendarEntry,
  FriendsFamilyAccess,
  GameCalendar,
  WordbeeGameKey,
} from '../../types'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

type ViewMonth = { year: number; month: number }

export function CompletionCalendar({
  gameKey,
  userId,
  accessState,
  clientSessionId,
  requestWithSessionRecovery,
}: {
  gameKey: WordbeeGameKey
  userId: string
  accessState: FriendsFamilyAccess
  clientSessionId: string
  requestWithSessionRecovery: SessionRequest
}) {
  const [calendar, setCalendar] = useState<GameCalendar | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewMonth, setViewMonth] = useState<ViewMonth | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null)
  const holdRef = useRef<{ timeout?: number; interval?: number; repeated: boolean }>({
    repeated: false,
  })

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    setSelectedEntry(null)
    try {
      const nextCalendar = await loadGameCalendar({
        accessState,
        clientSessionId,
        gameKey,
        requestWithSessionRecovery,
        userId,
      })
      setCalendar(nextCalendar)
      const current = parseDate(nextCalendar.currentDate)
      setViewMonth({ year: current.getFullYear(), month: current.getMonth() })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load calendar')
    } finally {
      setIsLoading(false)
    }
  }, [accessState, clientSessionId, gameKey, requestWithSessionRecovery, userId])

  useEffect(() => {
    void load()
  }, [load])

  const entriesByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry>()
    calendar?.entries.forEach((entry) => map.set(entry.date, entry))
    return map
  }, [calendar])

  const bounds = useMemo(() => {
    if (!calendar) return null
    return { first: parseDate(calendar.firstDate), last: parseDate(calendar.currentDate) }
  }, [calendar])

  const solvedCount = useMemo(
    () => calendar?.entries.filter((entry) => entry.outcome === 'won').length ?? 0,
    [calendar],
  )

  const canGoPrev = Boolean(viewMonth && bounds && !isBeforeOrSameMonth(viewMonth, bounds.first))
  const canGoNext = Boolean(viewMonth && bounds && !isAfterOrSameMonth(viewMonth, bounds.last))

  const advanceMonth = useCallback(
    (delta: number) => {
      setViewMonth((current) => {
        if (!current || !bounds) return current
        if (delta < 0 && isBeforeOrSameMonth(current, bounds.first)) return current
        if (delta > 0 && isAfterOrSameMonth(current, bounds.last)) return current
        return shiftMonth(current, delta)
      })
    },
    [bounds],
  )

  const endHold = useCallback(() => {
    window.clearTimeout(holdRef.current.timeout)
    window.clearInterval(holdRef.current.interval)
    holdRef.current.timeout = undefined
    holdRef.current.interval = undefined
  }, [])

  const startHold = useCallback(
    (delta: number) => {
      holdRef.current.repeated = false
      holdRef.current.timeout = window.setTimeout(() => {
        holdRef.current.interval = window.setInterval(() => {
          holdRef.current.repeated = true
          advanceMonth(delta)
        }, 110)
      }, 340)
    },
    [advanceMonth],
  )

  const handleNavClick = useCallback(
    (delta: number) => {
      // A hold already advanced repeatedly; don't double-advance on the trailing click.
      if (holdRef.current.repeated) {
        holdRef.current.repeated = false
        return
      }
      advanceMonth(delta)
    },
    [advanceMonth],
  )

  useEffect(() => endHold, [endHold])

  const monthCells = useMemo(
    () => (viewMonth ? buildMonthCells(viewMonth.year, viewMonth.month) : []),
    [viewMonth],
  )

  return (
    <section className="calendar" aria-label={`${gameKey} completion calendar`}>
      {error && (
        <div className="calendar-error">
          <span>{error}</span>
          <button className="game-secondary-button" onClick={() => void load()} type="button">
            Retry
          </button>
        </div>
      )}

      {isLoading && !calendar && <p className="game-loading">Loading calendar...</p>}

      {calendar && viewMonth && (
        <>
          <div className="calendar-summary">
            <strong>{solvedCount}</strong> solved since {formatMonthYear(parseDate(calendar.firstDate))}
          </div>

          <div className="calendar-nav">
            <button
              aria-label="Previous month"
              className="calendar-nav__button"
              disabled={!canGoPrev}
              onClick={() => handleNavClick(-1)}
              onPointerCancel={endHold}
              onPointerDown={() => startHold(-1)}
              onPointerLeave={endHold}
              onPointerUp={endHold}
              type="button"
            >
              ‹
            </button>
            <span className="calendar-nav__label">
              {MONTH_NAMES[viewMonth.month]} {viewMonth.year}
            </span>
            <button
              aria-label="Next month"
              className="calendar-nav__button"
              disabled={!canGoNext}
              onClick={() => handleNavClick(1)}
              onPointerCancel={endHold}
              onPointerDown={() => startHold(1)}
              onPointerLeave={endHold}
              onPointerUp={endHold}
              type="button"
            >
              ›
            </button>
          </div>

          <div className="calendar-grid" role="grid">
            {WEEKDAYS.map((weekday, index) => (
              <span className="calendar-weekday" key={`weekday-${index}`}>
                {weekday}
              </span>
            ))}
            {monthCells.map((day, index) => {
              if (day === null) {
                return <span className="calendar-day calendar-day--blank" key={`blank-${index}`} />
              }

              const date = formatDateInput(new Date(viewMonth.year, viewMonth.month, day))
              const inRange = bounds ? isDateInRange(date, bounds.first, bounds.last) : false
              const entry = entriesByDate.get(date)

              if (!inRange) {
                return (
                  <span className="calendar-day calendar-day--out" key={date}>
                    {day}
                  </span>
                )
              }

              return (
                <button
                  className={['calendar-day', cellClass(entry)].filter(Boolean).join(' ')}
                  disabled={!entry || entry.outcome === 'locked'}
                  key={date}
                  onClick={() => entry && setSelectedEntry(entry)}
                  type="button"
                >
                  {day}
                </button>
              )
            })}
          </div>

          <ul className="calendar-legend" aria-label="Legend">
            <li><span className="calendar-swatch calendar-day--daily-won" /> Solved (daily)</li>
            <li><span className="calendar-swatch calendar-day--retro-won" /> Solved (archive)</li>
            <li><span className="calendar-swatch calendar-day--daily-lost" /> Missed (daily)</li>
            <li><span className="calendar-swatch calendar-day--retro-lost" /> Missed (archive)</li>
          </ul>
        </>
      )}

      {selectedEntry && (
        <CalendarDetailDialog
          entry={selectedEntry}
          gameKey={gameKey}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </section>
  )
}

function CalendarDetailDialog({
  entry,
  gameKey,
  onClose,
}: {
  entry: CalendarEntry
  gameKey: WordbeeGameKey
  onClose: () => void
}) {
  const playedLabel = entry.playType === 'daily' ? 'Played live' : 'Played from archive'
  const outcomeLabel = entry.outcome === 'won' ? 'Solved' : 'Missed'

  return (
    <div className="results-backdrop" onClick={onClose} role="presentation">
      <section
        aria-label="Solve detail"
        aria-modal="true"
        className="results-panel calendar-detail"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
        role="dialog"
      >
        <button className="results-close" type="button" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <div className="calendar-detail__header">
          <span className="results-kicker">{formatLongDate(entry.date)}</span>
          <h2>{outcomeLabel}</h2>
          <p className="game-subtitle">{playedLabel}</p>
        </div>
        <CalendarDetailBody entry={entry} gameKey={gameKey} />
      </section>
    </div>
  )
}

function CalendarDetailBody({ entry, gameKey }: { entry: CalendarEntry; gameKey: WordbeeGameKey }) {
  const detail = (entry.detail ?? {}) as Record<string, any>

  if (gameKey === 'wordle') {
    const board: string[][] = Array.isArray(detail.board) ? detail.board : []
    const guesses: string[] = Array.isArray(detail.guesses) ? detail.guesses : []
    return (
      <div className="calendar-detail__body">
        <div className="calendar-detail__meta">
          <span>{entry.outcome === 'won' ? `${detail.guessesUsed}/6` : 'X/6'}</span>
          {detail.answer && <span>Answer: {String(detail.answer)}</span>}
        </div>
        <div className="calendar-board" aria-label="Solve board">
          {board.map((row, rowIndex) => (
            <div className="calendar-board__row" key={rowIndex}>
              {row.map((state, colIndex) => (
                <span className="calendar-board__tile" data-state={state} key={colIndex}>
                  {guesses[rowIndex]?.[colIndex] ?? ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const score = (detail.score ?? {}) as Record<string, any>
  const elapsed = typeof detail.elapsedSeconds === 'number' ? detail.elapsedSeconds : null

  return (
    <div className="calendar-detail__body">
      <div className="calendar-detail__meta">
        {detail.variant && detail.variant !== 'daily' && <span>{String(detail.variant)}</span>}
        {elapsed !== null && elapsed > 0 && <span>{formatElapsedTime(elapsed)}</span>}
      </div>
      {gameKey === 'connections' && <ConnectionsDetail score={score} />}
      {gameKey === 'strands' && <StrandsDetail score={score} />}
      {gameKey === 'sudoku' && <SudokuDetail score={score} />}
    </div>
  )
}

function ConnectionsDetail({ score }: { score: Record<string, any> }) {
  const groups: any[] = Array.isArray(score.solvedGroups) ? score.solvedGroups : []
  const colors = ['yellow', 'green', 'blue', 'purple']
  return (
    <div className="calendar-connections">
      {groups.map((group) => (
        <div
          className={`connections-solved-preview-row connections-group--${colors[group.rank] ?? 'yellow'}`}
          key={group.title}
        >
          <strong>{group.title}</strong>
        </div>
      ))}
      <p className="stats-muted">{Number(score.mistakes ?? 0)} mistakes</p>
    </div>
  )
}

function StrandsDetail({ score }: { score: Record<string, any> }) {
  const themeWords: string[] = Array.isArray(score.foundThemeWords) ? score.foundThemeWords : []
  const bonusWords: string[] = Array.isArray(score.bonusWords) ? score.bonusWords : []
  return (
    <div className="stats-playback">
      <div className="stats-playback__summary">
        <span>{themeWords.length} theme words</span>
        <span>{score.foundSpangram ? 'Spangram found' : 'No spangram'}</span>
        <span>{bonusWords.length} bonus</span>
      </div>
      <div className="stats-word-cloud">
        {[...themeWords, ...bonusWords].map((word) => (
          <span key={word}>{word}</span>
        ))}
      </div>
    </div>
  )
}

function SudokuDetail({ score }: { score: Record<string, any> }) {
  return (
    <div className="stats-playback__summary">
      <span>{Number(score.mistakes ?? 0)} mistakes</span>
      <span>{Number(score.hints ?? 0)} hints</span>
    </div>
  )
}

function cellClass(entry: CalendarEntry | undefined) {
  if (!entry) return 'calendar-day--none'
  if (entry.outcome === 'locked') return 'calendar-day--locked'
  const won = entry.outcome === 'won'
  const daily = entry.playType === 'daily'
  if (won) return daily ? 'calendar-day--daily-won' : 'calendar-day--retro-won'
  return daily ? 'calendar-day--daily-lost' : 'calendar-day--retro-lost'
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function buildMonthCells(year: number, month: number): (number | null)[] {
  const startWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = Array.from({ length: startWeekday }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(day)
  }
  return cells
}

function shiftMonth({ year, month }: ViewMonth, delta: number): ViewMonth {
  const shifted = new Date(year, month + delta, 1)
  return { year: shifted.getFullYear(), month: shifted.getMonth() }
}

function isBeforeOrSameMonth(view: ViewMonth, date: Date) {
  return view.year < date.getFullYear() || (view.year === date.getFullYear() && view.month <= date.getMonth())
}

function isAfterOrSameMonth(view: ViewMonth, date: Date) {
  return view.year > date.getFullYear() || (view.year === date.getFullYear() && view.month >= date.getMonth())
}

function isDateInRange(date: string, first: Date, last: Date) {
  const value = parseDate(date).getTime()
  return value >= startOfDay(first) && value <= startOfDay(last)
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function formatMonthYear(date: Date) {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`
}

function formatLongDate(rawDate: string) {
  const date = parseDate(rawDate)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
