import { useCallback, useState } from 'react'
import closeIconMarkup from '../../assets/icons/icon-close.svg?raw'
import statsIconMarkup from '../../assets/icons/icon-stats.svg?raw'
import { InlineIcon } from '../../components/InlineIcon'
import { ADDITIONAL_GAME_LABELS } from '../../config/constants'
import { copyTextToClipboard } from '../../lib/clipboard'
import { formatPuzzleHeaderDate, getTodayDate } from '../../lib/date'
import { formatElapsedTime } from '../games/game-utils'
import type {
  AdditionalGameKey,
  MultigameCompletionResult,
  MultigameStatsSummary,
} from '../../types'

// The Crossword, Mini and Midi share the same grid result summary + share text.
const isGridCrossword = (gameKey: AdditionalGameKey): boolean =>
  gameKey === 'crossword' || gameKey === 'mini' || gameKey === 'midi'

export function MultigameResultsDialog({
  onClose,
  canOpenStats = false,
  activeGame,
  onOpenStats,
  result,
  stats,
  showToast,
}: {
  onClose: () => void
  canOpenStats?: boolean
  activeGame: AdditionalGameKey
  onOpenStats?: () => void
  result: MultigameCompletionResult
  stats: MultigameStatsSummary | null
  showToast: (message: string, durationMs?: number) => void
}) {
  const [copied, setCopied] = useState(false)
  const score = result.score as Record<string, any>
  const isTracked = result.date === getTodayDate()
  const gameLabel = ADDITIONAL_GAME_LABELS[activeGame]
  const emojiPreview = buildEmojiPreview(activeGame, score)

  const getShareText = useCallback(() => {
    const outcomeText = result.outcome === 'won' ? 'Solved' : 'Missed'
    const showTime = activeGame !== 'strands' && activeGame !== 'connections' && activeGame !== 'letterboxed' && activeGame !== 'spellingbee' && activeGame !== 'tiles'
    const timeText = (showTime && result.elapsedSeconds) ? ` in ${formatElapsedTime(result.elapsedSeconds)}` : ''
    const heading = `Wordbee ${gameLabel} · ${result.date}\n${outcomeText}${timeText}`
    const preview = buildEmojiPreview(activeGame, result.score as Record<string, any>)
    return `${heading}\n\n${preview}`.trim()
  }, [activeGame, gameLabel, result])

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(getShareText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1300)
    } catch {
      showToast('Copy failed')
    }
  }

  return (
    <div className="results-backdrop" aria-live="polite" onClick={onClose} role="presentation">
      <section
        aria-label={`${gameLabel} results summary`}
        aria-modal="true"
        className="results-panel"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
        role="dialog"
      >
        <button className="results-close" type="button" aria-label="Close" onClick={onClose}>
          <InlineIcon markup={closeIconMarkup} />
        </button>

        <section className="definition-panel" aria-label="Result summary">
          <div className="definition-panel__heading">
            <strong>{activeGame === 'spellingbee' ? (score.isQueenBee ? 'Queen Bee!' : score.reachedGenius ? 'Genius!' : 'Summary') : (result.outcome === 'won' ? 'Solved' : 'Not solved')}</strong>
            {activeGame !== 'strands' && activeGame !== 'connections' && activeGame !== 'letterboxed' && activeGame !== 'spellingbee' && activeGame !== 'tiles' && result.elapsedSeconds ? <em>{formatElapsedTime(result.elapsedSeconds)}</em> : null}
          </div>
          <span className="definition-panel__part">{gameLabel}</span>
          <p>
            {formatPuzzleHeaderDate(result.date)}
            {result.variant && result.variant !== 'daily' ? ` · ${result.variant}` : ''}
          </p>
        </section>

        {isTracked && (
          <section className="results-section" aria-labelledby="multigame-summary-title">
            <h3 id="multigame-summary-title">Statistics</h3>
            <div className="results-stat-grid">
              <StatValue label="Played" value={stats?.played ?? 1} />
              {activeGame !== 'strands' && activeGame !== 'sudoku' && activeGame !== 'letterboxed' && activeGame !== 'spellingbee' && activeGame !== 'tiles' && !isGridCrossword(activeGame) && (
                <StatValue
                  label="Solve %"
                  value={stats && stats.solveRate !== undefined ? stats.solveRate : result.outcome === 'won' ? 100 : 0}
                />
              )}
              {activeGame === 'tiles' && (
                <>
                  <StatValue label="Longest combo" value={score.longestCombo ? `×${score.longestCombo}` : '--'} />
                  <StatValue label="Avg combo" value={stats?.averageLongestCombo ? `×${stats.averageLongestCombo.toFixed(1)}` : '--'} />
                </>
              )}
              {activeGame === 'spellingbee' && (
                <>
                  <StatValue label="Genius rate" value={`${stats?.geniusRate ?? 0}%`} />
                </>
              )}
              {activeGame === 'letterboxed' && (
                <>
                  <StatValue
                    label="This solve"
                    value={result.outcome === 'won' && score.wordCount ? `${score.wordCount} words` : '--'}
                  />
                  <StatValue
                    label="Avg words"
                    value={stats?.averageWords ? stats.averageWords.toFixed(2) : '--'}
                  />
                </>
              )}
              {activeGame !== 'strands' && activeGame !== 'connections' && activeGame !== 'letterboxed' && activeGame !== 'spellingbee' && activeGame !== 'tiles' && (
                <>
                  <StatValue
                    label="This time"
                    value={result.elapsedSeconds ? formatElapsedTime(result.elapsedSeconds) : '--'}
                  />
                  <StatValue
                    label="Avg time"
                    value={stats && stats.averageSeconds > 0 ? formatElapsedTime(stats.averageSeconds) : '--'}
                  />
                </>
              )}
            </div>
          </section>
        )}

        <section className="results-section" aria-labelledby="multigame-board-title">
          <h3 id="multigame-board-title">Solve summary</h3>
          <SolveSummary activeGame={activeGame} result={result} score={score} />
        </section>

        {canOpenStats && isTracked && onOpenStats && (
          <button
            className="results-link-card results-link-card--stats"
            onClick={onOpenStats}
            type="button"
          >
            <InlineIcon markup={statsIconMarkup} />
            <span>
              <strong>Detailed stats</strong>
              <span>History, leaderboard, and your calendar.</span>
            </span>
            <span className="results-link-card__arrow" aria-hidden="true">
              ›
            </span>
          </button>
        )}

        {!isTracked && (
          <p className="results-note">Archive plays are saved to your calendar but not counted in stats.</p>
        )}

        {emojiPreview && (
          <div className="results-copy-area">
            <button
              aria-label="Copy results"
              className={['results-copy-button', activeGame === 'spellingbee' ? 'results-copy-button--text-style' : ''].filter(Boolean).join(' ')}
              type="button"
              onClick={() => void handleCopy()}
            >
              {activeGame === 'spellingbee' ? (
                <span className="results-copy-label">Copy Share Summary</span>
              ) : (
                <span className="results-copy-button__emoji">{emojiPreview}</span>
              )}
            </button>
            <span
              aria-live="polite"
              aria-hidden={!copied}
              className="results-copy-feedback"
              data-visible={copied}
            >
              Copied!
            </span>
          </div>
        )}
      </section>
    </div>
  )
}

function SolveSummary({
  activeGame,
  result,
  score,
}: {
  activeGame: AdditionalGameKey
  result: MultigameCompletionResult
  score: Record<string, any>
}) {
  if (activeGame === 'connections') {
    const groups: any[] = Array.isArray(score.solvedGroups) ? score.solvedGroups : []
    const colorClasses = [
      'connections-group--yellow',
      'connections-group--green',
      'connections-group--blue',
      'connections-group--purple',
    ]
    return (
      <div className="connections-grid-preview">
        {groups.map((group) => (
          <div
            className={`connections-solved-preview-row ${colorClasses[group.rank] ?? colorClasses[0]}`}
            key={group.title}
          >
            <strong>{group.title}</strong>
          </div>
        ))}
        <p className="results-note">{Number(score.mistakes ?? 0)} mistakes</p>
      </div>
    )
  }

  if (activeGame === 'strands') {
    return (
      <div className="strands-summary-preview">
        <div className="strands-summary-row">
          <span>Theme words found</span>
          <strong>{Array.isArray(score.foundThemeWords) ? score.foundThemeWords.length : 0}</strong>
        </div>
        <div className="strands-summary-row">
          <span>Spangram</span>
          <strong>{score.foundSpangram ? 'Found' : 'Missed'}</strong>
        </div>
        <div className="strands-summary-row">
          <span>Bonus words</span>
          <strong>{Array.isArray(score.bonusWords) ? score.bonusWords.length : 0}</strong>
        </div>
      </div>
    )
  }

  if (activeGame === 'spellingbee') {
    const words: string[] = Array.isArray(score.words) ? score.words : []
    const pangramSet = new Set(words.filter((word) => new Set(word).size === 7))

    const scorePercent = score.maxScore ? Math.min(100, Math.max(0, Math.round(((score.score ?? 0) / score.maxScore) * 100))) : 0
    const totalWords = Number(score.totalWords ?? 0)
    const wordsPercent = totalWords ? Math.min(100, Math.max(0, Math.round((words.length / totalWords) * 100))) : 0
    const totalPangrams = Number(score.totalPangrams ?? 0)
    const pangramsPercent = totalPangrams ? Math.min(100, Math.max(0, Math.round((Number(score.pangramsFound ?? 0) / totalPangrams) * 100))) : 0

    let rankPercent = 0
    if (score.isQueenBee) {
      rankPercent = 100
    } else if (typeof score.rankIndex === 'number') {
      rankPercent = Math.min(100, Math.max(0, Math.round((score.rankIndex / 8) * 100)))
    } else {
      rankPercent = scorePercent
    }

    return (
      <div className="strands-summary-preview">
        <div className="spellingbee-summary-bar-group">
          <div className="spellingbee-summary-bar-item">
            <div className="spellingbee-summary-bar-meta">
              <span>Rank</span>
              <strong>{String(score.rank ?? '—')}</strong>
            </div>
            <div className="spellingbee-summary-progressbar">
              <div
                className="spellingbee-summary-progressbar__fill"
                style={{ width: `${rankPercent}%`, background: 'var(--spellingbee-accent, #f7da21)' }}
              />
            </div>
          </div>

          <div className="spellingbee-summary-bar-item">
            <div className="spellingbee-summary-bar-meta">
              <span>Score</span>
              <strong>{score.maxScore ? `${score.score ?? 0} / ${score.maxScore}` : Number(score.score ?? 0)}</strong>
            </div>
            <div className="spellingbee-summary-progressbar">
              <div
                className="spellingbee-summary-progressbar__fill"
                style={{ width: `${scorePercent}%`, background: '#22c55e' }}
              />
            </div>
          </div>

          <div className="spellingbee-summary-bar-item">
            <div className="spellingbee-summary-bar-meta">
              <span>Words</span>
              <strong>{words.length} / {Number(score.totalWords ?? 0)}</strong>
            </div>
            <div className="spellingbee-summary-progressbar">
              <div
                className="spellingbee-summary-progressbar__fill"
                style={{ width: `${wordsPercent}%`, background: '#3b82f6' }}
              />
            </div>
          </div>

          <div className="spellingbee-summary-bar-item">
            <div className="spellingbee-summary-bar-meta">
              <span>Pangrams</span>
              <strong>{Number(score.pangramsFound ?? 0)} / {Number(score.totalPangrams ?? 0)}</strong>
            </div>
            <div className="spellingbee-summary-progressbar">
              <div
                className="spellingbee-summary-progressbar__fill"
                style={{ width: `${pangramsPercent}%`, background: '#a855f7' }}
              />
            </div>
          </div>
        </div>

        {words.length > 0 && (
          <div className="spellingbee-found-grid spellingbee-found-grid--result">
            {[...words].sort().map((word) => (
              <span
                key={word}
                className={pangramSet.has(word) ? 'spellingbee-word--pangram' : ''}
              >
                {word}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (activeGame === 'letterboxed') {
    const words: string[] = Array.isArray(score.words) ? score.words : []
    const nytWordCount = Number(score.nytWordCount ?? 0)
    return (
      <div className="strands-summary-preview">
        <div className="strands-summary-row">
          <span>Words used</span>
          <strong>{score.revealed ? '—' : words.length}</strong>
        </div>
        <div className="strands-summary-row">
          <span>Fewest possible</span>
          <strong>{nytWordCount} word{nytWordCount === 1 ? '' : 's'}</strong>
        </div>
        {words.length > 0 && (
          <div className="letterboxed-word-list letterboxed-word-list--result">
            {words.map((word, index) => (
              <span key={`${word}-${index}`} className="letterboxed-word-chip">
                {word}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (isGridCrossword(activeGame)) {
    const checks = Number(score.checksUsed ?? 0)
    const reveals = Number(score.revealsUsed ?? 0)
    return (
      <div className="strands-summary-preview">
        <div className="strands-summary-row">
          <span>Grid</span>
          <strong>{Number(score.width ?? 0)}×{Number(score.height ?? 0)}</strong>
        </div>
        <div className="strands-summary-row">
          <span>Time</span>
          <strong>{result.elapsedSeconds ? formatElapsedTime(result.elapsedSeconds) : '--'}</strong>
        </div>
        <div className="strands-summary-row">
          <span>Checks used</span>
          <strong>{checks}</strong>
        </div>
        <div className="strands-summary-row">
          <span>Reveals used</span>
          <strong>{reveals}</strong>
        </div>
        <div className="strands-summary-row">
          <span>Solve</span>
          <strong>{reveals > 0 ? 'Assisted' : checks > 0 ? 'Checked' : 'Clean'}</strong>
        </div>
      </div>
    )
  }

  if (activeGame === 'tiles') {
    return (
      <div className="strands-summary-preview">
        <div className="strands-summary-row">
          <span>Longest combo</span>
          <strong>×{Number(score.longestCombo ?? 0)}</strong>
        </div>
        <div className="strands-summary-row">
          <span>Matches made</span>
          <strong>{Number(score.moves ?? 0)}</strong>
        </div>
        <div className="strands-summary-row">
          <span>Perfect solve</span>
          <strong>{score.perfect ? 'Yes' : 'No'}</strong>
        </div>
      </div>
    )
  }

  return (
    <div className="strands-summary-preview">
      <div className="strands-summary-row">
        <span>Difficulty</span>
        <strong style={{ textTransform: 'capitalize' }}>{result.variant}</strong>
      </div>
      <div className="strands-summary-row">
        <span>Result</span>
        <strong>{result.outcome === 'won' ? 'Board solved' : 'Incomplete'}</strong>
      </div>
    </div>
  )
}

function StatValue({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="results-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

// Only Connections has a real NYT emoji-grid share (colored squares in guess
// order). The other games get a clean text summary with no decorative emoji.
function buildEmojiPreview(activeGame: AdditionalGameKey, score: Record<string, any>) {
  if (activeGame === 'spellingbee') {
    return ''
  }

  if (activeGame === 'letterboxed') {
    const words: string[] = Array.isArray(score.words) ? score.words : []
    if (score.revealed || words.length === 0) return ''
    return `${words.length} words\n${words.join(' → ')}`
  }

  if (activeGame === 'tiles') {
    return ''
  }

  if (isGridCrossword(activeGame)) {
    const checks = Number(score.checksUsed ?? 0)
    const reveals = Number(score.revealsUsed ?? 0)
    const assists: string[] = []
    if (checks) assists.push(`${checks} check${checks === 1 ? '' : 's'}`)
    if (reveals) assists.push(`${reveals} reveal${reveals === 1 ? '' : 's'}`)
    return assists.length ? `Solved with ${assists.join(' · ')}` : 'Clean solve — no checks or reveals'
  }

  if (activeGame !== 'connections') return ''

  const colors = ['🟨', '🟩', '🟦', '🟪']
  const guesses: unknown[] = Array.isArray(score.guesses) ? score.guesses : []
  const groups: any[] = Array.isArray(score.solvedGroups) ? score.solvedGroups : []

  // Prefer the actual guess order (like NYT); fall back to solved-group order.
  const rows =
    guesses.length > 0
      ? guesses.map((guess) => guessRow(guess, groups, colors))
      : groups.map((group) => (colors[group.rank] ?? colors[0]).repeat(4))

  return rows.filter(Boolean).join('\n')
}

function guessRow(guess: unknown, groups: any[], colors: string[]) {
  if (!Array.isArray(guess)) return ''
  return guess
    .map((card) => {
      const group = groups.find(
        (candidate) => Array.isArray(candidate.cards) && candidate.cards.includes(card),
      )
      return group ? (colors[group.rank] ?? colors[0]) : '⬜'
    })
    .join('')
}
