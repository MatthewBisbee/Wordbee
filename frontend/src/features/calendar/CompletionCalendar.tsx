import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatDateInput } from '../../lib/date'
import { formatElapsedTime, loadGameCalendar, type SessionRequest } from '../games/game-utils'
import { SolveAnalysisPanel } from '../stats/FamilyStatsPage'
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
  history = [],
}: {
  gameKey: WordbeeGameKey
  userId: string
  accessState: FriendsFamilyAccess
  clientSessionId: string
  requestWithSessionRecovery: SessionRequest
  history?: any[]
}) {
  const [calendar, setCalendar] = useState<GameCalendar | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewMonth, setViewMonth] = useState<ViewMonth | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null)
  const holdRef = useRef<{ timeout?: number; interval?: number; repeated: boolean }>({
    repeated: false,
  })

  const historyItem = useMemo(() => {
    if (!selectedEntry) return null
    return history.find((h: any) => h.date === selectedEntry.date)
  }, [selectedEntry, history])





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

      {selectedEntry && createPortal(
        <CalendarDetailDialog
          entry={selectedEntry}
          gameKey={gameKey}
          historyItem={historyItem}
          onClose={() => setSelectedEntry(null)}
        />,
        document.querySelector('.wordbee-app') || document.body
      )}
    </section>
  )
}

function CalendarDetailDialog({
  entry,
  gameKey,
  historyItem,
  onClose,
}: {
  entry: CalendarEntry
  gameKey: WordbeeGameKey
  historyItem: any
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
        <CalendarDetailBody entry={entry} gameKey={gameKey} historyItem={historyItem} />
      </section>
    </div>
  )
}

function CalendarDetailBody({
  entry,
  gameKey,
  historyItem,
}: {
  entry: CalendarEntry
  gameKey: WordbeeGameKey
  historyItem: any
}) {
  const detail = (entry.detail ?? {}) as Record<string, any>

  if (gameKey === 'wordle') {
    const board: string[][] = Array.isArray(detail.board) ? detail.board : []
    const guesses: string[] = Array.isArray(detail.guesses) ? detail.guesses : []
    const analysis = historyItem?.analysis

    return (
      <div className="calendar-detail__body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="calendar-detail__meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '18px', fontWeight: 800 }}>
            {entry.outcome === 'won' ? `${detail.guessesUsed}/6` : 'X/6'}
          </span>
          {detail.answer && (
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-tone-2)' }}>
              Answer: <strong style={{ color: 'var(--color-tone-1)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{String(detail.answer)}</strong>
            </span>
          )}
        </div>
        <div className="calendar-board" aria-label="Solve board" style={{ margin: '0 auto', maxWidth: '280px', width: '100%' }}>
          {board.map((row, rowIndex) => (
            <div className="calendar-board__row" key={rowIndex} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', marginBottom: '6px' }}>
              {row.map((state, colIndex) => (
                <span
                  className="calendar-board__tile"
                  data-state={state}
                  key={colIndex}
                  style={{
                    aspectRatio: '1',
                    height: 'auto',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                    fontSize: '18px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: '#fff',
                  }}
                >
                  {guesses[rowIndex]?.[colIndex] ?? ''}
                </span>
              ))}
            </div>
          ))}
        </div>
        {analysis && (
          <div style={{ borderTop: '1px solid var(--settings-border)', paddingTop: '20px' }}>
            <SolveAnalysisPanel analysis={analysis} />
          </div>
        )}
      </div>
    )
  }

  const score = (detail.score ?? historyItem?.score ?? {}) as Record<string, any>
  const elapsed = typeof detail.elapsedSeconds === 'number' ? detail.elapsedSeconds : (typeof historyItem?.elapsedSeconds === 'number' ? historyItem.elapsedSeconds : null)

  return (
    <div className="calendar-detail__body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="calendar-detail__meta" style={{ display: 'flex', gap: '12px', fontSize: '13px', color: 'var(--color-tone-2)', fontWeight: 700 }}>
        {detail.variant && detail.variant !== 'daily' && <span style={{ textTransform: 'capitalize' }}>{String(detail.variant)}</span>}
        {elapsed !== null && elapsed > 0 && <span>{formatElapsedTime(elapsed)}</span>}
      </div>
      {gameKey === 'connections' && <ConnectionsDetail score={score} />}
      {gameKey === 'strands' && <StrandsDetail score={score} />}
      {gameKey === 'sudoku' && <SudokuDetail score={score} />}
      {gameKey === 'letterboxed' && <LetterboxedDetail score={score} />}
      {gameKey === 'spellingbee' && <SpellingBeeDetail score={score} />}
      {gameKey === 'tiles' && <TilesDetail score={score} />}
      {(gameKey === 'crossword' || gameKey === 'mini' || gameKey === 'midi') && (
        <CrosswordDetail score={score} />
      )}
    </div>
  )
}

function CrosswordDetail({ score }: { score: Record<string, any> }) {
  const checks = Number(score.checksUsed ?? 0)
  const reveals = Number(score.revealsUsed ?? 0)
  return (
    <div style={{ width: '100%' }}>
      <div className="strands-summary-preview" style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--result-link-bg)', padding: '12px', borderRadius: '6px' }}>
        {(score.width && score.height) ? (
          <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span>Grid</span>
            <strong>{Number(score.width)}×{Number(score.height)}</strong>
          </div>
        ) : null}
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Checks used</span>
          <strong>{checks}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Reveals used</span>
          <strong>{reveals}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Solve</span>
          <strong>{reveals > 0 ? 'Assisted' : checks > 0 ? 'Checked' : 'Clean'}</strong>
        </div>
      </div>
    </div>
  )
}

function TilesDetail({ score }: { score: Record<string, any> }) {
  return (
    <div style={{ width: '100%' }}>
      <div className="strands-summary-preview" style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--result-link-bg)', padding: '12px', borderRadius: '6px' }}>
        {score.paletteName && (
          <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span>Theme played</span>
            <strong>{String(score.paletteName)}</strong>
          </div>
        )}
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Longest combo</span>
          <strong>×{Number(score.longestCombo ?? 0)}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Matches made</span>
          <strong>{Number(score.moves ?? 0)}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Perfect solve</span>
          <strong>{score.perfect ? 'Yes' : 'No'}</strong>
        </div>
      </div>
    </div>
  )
}

function SpellingBeeDetail({ score }: { score: Record<string, any> }) {
  const words: string[] = Array.isArray(score.words) ? score.words : []
  const isPangram = (word: string) => new Set(word).size === 7

  return (
    <div style={{ width: '100%' }}>
      <div className="strands-summary-preview" style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--result-link-bg)', padding: '12px', borderRadius: '6px' }}>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Rank</span>
          <strong>{String(score.rank ?? '—')}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Score</span>
          <strong>{score.maxScore ? `${score.score ?? 0} / ${score.maxScore}` : Number(score.score ?? 0)}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Words</span>
          <strong>{words.length} / {Number(score.totalWords ?? 0)}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Pangrams</span>
          <strong>{Number(score.pangramsFound ?? 0)} / {Number(score.totalPangrams ?? 0)}</strong>
        </div>
      </div>
      {words.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-tone-2)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>WORDS FOUND</span>
          <div className="stats-word-cloud" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {[...words].sort().map((word: string) => (
              <span
                key={word}
                style={{
                  background: 'var(--result-link-bg)',
                  border: '1px solid var(--settings-border)',
                  borderRadius: '16px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: isPangram(word) ? 800 : 700,
                  color: isPangram(word) ? 'var(--spellingbee-accent, #b59f00)' : undefined,
                }}
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ConnectionsDetail({ score }: { score: Record<string, any> }) {
  const groups: any[] = Array.isArray(score.solvedGroups) ? score.solvedGroups : []
  const mistakes = Number(score.mistakes ?? 0)
  const colorClasses = [
    'connections-group--yellow',
    'connections-group--green',
    'connections-group--blue',
    'connections-group--purple',
  ]

  return (
    <div className="connections-grid-preview" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {groups.map((group) => (
        <div
          className={`connections-solved-preview-row ${colorClasses[group.rank] ?? colorClasses[0]}`}
          key={group.title}
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            fontWeight: 800,
            fontSize: '14px',
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}
        >
          <strong>{group.title}</strong>
          {Array.isArray(group.cards) && (
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 500, marginTop: '2px', opacity: 0.9 }}>
              {group.cards.join(', ')}
            </span>
          )}
        </div>
      ))}
      <p className="results-note" style={{ textAlign: 'center', fontWeight: 600, margin: '12px 0 0' }}>
        {mistakes} mistakes
      </p>
    </div>
  )
}

function StrandsDetail({ score }: { score: Record<string, any> }) {
  const themeWords: string[] = Array.isArray(score.foundThemeWords) ? score.foundThemeWords : []
  const bonusWords: string[] = Array.isArray(score.bonusWords) ? score.bonusWords : []

  return (
    <div style={{ width: '100%' }}>
      <div className="strands-summary-preview" style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--result-link-bg)', padding: '12px', borderRadius: '6px' }}>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Theme words found</span>
          <strong>{themeWords.length}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Spangram</span>
          <strong>{score.foundSpangram ? 'Found' : 'Missed'}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Bonus words</span>
          <strong>{bonusWords.length}</strong>
        </div>
      </div>
      {themeWords.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-tone-2)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>WORDS FOUND</span>
          <div className="stats-word-cloud" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {themeWords.map((word: string) => (
              <span
                key={word}
                style={{
                  background: 'var(--result-link-bg)',
                  border: '1px solid var(--settings-border)',
                  borderRadius: '16px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 700
                }}
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LetterboxedDetail({ score }: { score: Record<string, any> }) {
  const words: string[] = Array.isArray(score.words) ? score.words : []
  const nytWordCount = Number(score.nytWordCount ?? 0)
  const revealed = Boolean(score.revealed)

  return (
    <div style={{ width: '100%' }}>
      <div className="strands-summary-preview" style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--result-link-bg)', padding: '12px', borderRadius: '6px' }}>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Words used</span>
          <strong>{revealed ? '—' : words.length}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Fewest possible</span>
          <strong>{nytWordCount} word{nytWordCount === 1 ? '' : 's'}</strong>
        </div>
      </div>
      {words.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-tone-2)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>YOUR WORDS</span>
          <div className="stats-word-cloud" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {words.map((word: string, index: number) => (
              <span
                key={`${word}-${index}`}
                style={{
                  background: 'var(--result-link-bg)',
                  border: '1px solid var(--settings-border)',
                  borderRadius: '16px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SudokuDetail({ score }: { score: Record<string, any> }) {
  const mistakes = Number(score.mistakes ?? 0)
  const hints = Number(score.hints ?? 0)

  return (
    <div style={{ width: '100%' }}>
      <div className="strands-summary-preview" style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--result-link-bg)', padding: '12px', borderRadius: '6px' }}>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Mistakes</span>
          <strong>{mistakes}</strong>
        </div>
        <div className="strands-summary-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Hints used</span>
          <strong>{hints}</strong>
        </div>
      </div>
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
  while (cells.length < 42) {
    cells.push(null)
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



function formatLongDate(rawDate: string) {
  const date = parseDate(rawDate)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
