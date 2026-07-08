import type { CSSProperties } from 'react'
import closeIconMarkup from '../../assets/icons/icon-close.svg?raw'
import statsIconMarkup from '../../assets/icons/icon-stats.svg?raw'
import { InlineIcon } from '../../components/InlineIcon'
import { GUESS_DISTRIBUTION_ROWS } from '../../config/constants'
import { createShareText, getDistributionMax } from '../wordle/wordle-utils'
import { SolveAnalysisPanel } from '../stats/FamilyStatsPage'
import type { DefinitionSummary, GameResult } from '../../types'

export function ResultsDialog({
  canOpenStats = false,
  onClose,
  onCopy,
  onOpenStats,
  result,
}: {
  canOpenStats?: boolean
  onClose: () => void
  onCopy: () => void
  onOpenStats: () => void
  result: GameResult
}) {
  const distributionMax = getDistributionMax(result.stats)
  const emojiRows = createShareText(result)
  const isDailyResult = result.mode === 'daily'

  return (
    <div className="results-backdrop" aria-live="polite" onClick={onClose} role="presentation">
      <section
        aria-label="Completed Wordle summary"
        aria-modal="true"
        className="results-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="results-close" type="button" aria-label="Close" onClick={onClose}>
          <InlineIcon markup={closeIconMarkup} />
        </button>
        <DefinitionPanel definition={result.definition} fallbackWord={result.answer} />

        {isDailyResult && (
          <>
            <section className="results-section" aria-labelledby="summary-title">
              <h3 id="summary-title">Statistics</h3>
              <div className="results-stat-grid">
                <StatValue label="Played" value={result.stats.played} />
                <StatValue label="Win %" value={result.stats.winPercentage} />
                <StatValue label="Current Streak" value={result.stats.currentStreak} />
                <StatValue label="Max Streak" value={result.stats.maxStreak} />
              </div>
            </section>

            <section className="results-section" aria-labelledby="distribution-title">
              <h3 id="distribution-title">Solve Distribution</h3>
              <div className="distribution-list">
                {GUESS_DISTRIBUTION_ROWS.map((row) => {
                  const count = result.stats.guessDistribution[row.key] ?? 0
                  const isCurrentGuess =
                    (result.outcome === 'won' && result.guessesUsed === Number(row.key)) ||
                    (result.outcome === 'lost' && row.key === 'fail')

                  return (
                    <div className="distribution-row" key={row.key}>
                      <span className="distribution-row__label">{row.label}</span>
                      <span
                        className={[
                          'distribution-row__bar',
                          isCurrentGuess ? 'distribution-row__bar--current' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={
                          {
                            '--bar-width': `${Math.max(8, (count / distributionMax) * 100)}%`,
                          } as CSSProperties
                        }
                      >
                        {count}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}

        {canOpenStats && isDailyResult && (
          <button
            className="results-link-card results-link-card--stats"
            onClick={onOpenStats}
            type="button"
          >
            <InlineIcon markup={statsIconMarkup} />
            <span>
              <strong>Detailed stats</strong>
              <span>Compare streaks, dates, and solve patterns.</span>
            </span>
            <span className="results-link-card__arrow" aria-hidden="true">
              ›
            </span>
          </button>
        )}

        {!isDailyResult && result.analysis && (
          <section
            className="results-section results-section--analysis"
            aria-labelledby="session-insights-title"
          >
            <h3 id="session-insights-title">Solve insights</h3>
            <SolveAnalysisPanel analysis={result.analysis} />
          </section>
        )}



        <div className="results-copy-area">
          <button
            aria-label="Copy emoji results"
            className="results-copy-button"
            type="button"
            onClick={onCopy}
          >
            <span className="results-copy-button__emoji">{emojiRows}</span>
          </button>
          <span
            aria-live="polite"
            aria-hidden={!result.copied}
            className="results-copy-feedback"
            data-visible={result.copied}
          >
            Copied!
          </span>
        </div>
      </section>
    </div>
  )
}

function DefinitionPanel({
  definition,
  fallbackWord,
}: {
  definition?: DefinitionSummary
  fallbackWord?: string
}) {
  const displayWord = definition?.word || fallbackWord || 'Wordle'
  const synonyms = definition?.synonyms ?? []

  return (
    <section className="definition-panel" aria-label="Answer definition">
      <div className="definition-panel__heading">
        <strong>{displayWord}</strong>
        {definition?.phonetic && <em>{definition.phonetic}</em>}
      </div>
      {definition?.partOfSpeech && (
        <span className="definition-panel__part">{definition.partOfSpeech}</span>
      )}
      <p>{definition?.definition || 'Short definition is still loading.'}</p>
      {synonyms.length > 0 && (
        <div className="definition-panel__synonyms">
          <span>Synonyms</span>
          <span>{synonyms.join(', ')}</span>
        </div>
      )}
    </section>
  )
}

function StatValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="results-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}
