import { useState } from 'react'
import connectionsLogoUrl from '../../assets/Connections_Logo.svg'
import crosswordLogoUrl from '../../assets/TheCrossword_Logo.svg'
import miniLogoUrl from '../../assets/TheMini_Logo.svg'
import midiLogoUrl from '../../assets/TheMidi_Logo.svg'
import letterboxedLogoUrl from '../../assets/LetterBoxed_Logo.svg'
import pipsLogoUrl from '../../assets/Pips_Logo.svg'
import spellingbeeLogoUrl from '../../assets/SpellingBee_Logo.svg'
import strandsLogoUrl from '../../assets/Strands_Logo.svg'
import sudokuLogoUrl from '../../assets/Sudoku_Logo.svg'
import tilesLogoUrl from '../../assets/Tiles_Logo.svg'
import wordleLogoUrl from '../../assets/Wordle_Logo.svg'
import { ADDITIONAL_GAME_FIRST_DATES } from '../../config/constants'
import type { AdditionalGameKey, WordbeeGameKey } from '../../types'

export function WordbeeMenu({
  additionalMaxPastDate,
  additionalPastDate,
  disabledGames = [],
  maxPastDate,
  minPastDate,
  onAdditionalDaily,
  onAdditionalPast,
  onAdditionalPastDateChange,
  onDaily,
  onPast,
  onPastDateChange,
  onRandom,
  onSelectGame,
  onTilesRandom,
  pastDate,
  selectedGame,
  showAdditionalDaily,
  showDaily,
}: {
  additionalMaxPastDate: string
  additionalPastDate: string
  maxPastDate: string
  minPastDate: string
  onAdditionalDaily: () => void
  onAdditionalPast: () => void
  onAdditionalPastDateChange: (dateValue: string) => void
  onDaily: () => void
  onPast: () => void
  onPastDateChange: (dateValue: string) => void
  onRandom: () => void
  onSelectGame: (gameKey: WordbeeGameKey) => void
  onTilesRandom?: () => void
  pastDate: string
  selectedGame: WordbeeGameKey
  showAdditionalDaily: boolean
  showDaily: boolean
  disabledGames?: string[]
}) {
  // Which game's submenu is expanded. Clicking a game expands it (and switches to
  // it); clicking the already-open game collapses it. Uniform for every game.
  const [expandedGame, setExpandedGame] = useState<WordbeeGameKey | ''>(selectedGame)

  const toggleGame = (gameKey: WordbeeGameKey) => {
    if (expandedGame === gameKey) {
      setExpandedGame('')
      return
    }
    setExpandedGame(gameKey)
    if (gameKey !== selectedGame) {
      onSelectGame(gameKey)
    }
  }

  return (
    <div className="wordbee-menu-drawer" role="menu">
      <div className="wordbee-menu-game-group">
        <button
          aria-expanded={expandedGame === 'wordle'}
          className={[
            'wordbee-game-menu-button',
            selectedGame === 'wordle' ? 'wordbee-game-menu-button--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={disabledGames.includes('wordle')}
          onClick={() => toggleGame('wordle')}
          role="menuitem"
          type="button"
        >
          <img alt="" className="wordbee-game-menu-button__logo" src={wordleLogoUrl} />
          <span>Wordle</span>
          <span className="wordbee-game-menu-button__chevron" aria-hidden="true" />
        </button>

        {expandedGame === 'wordle' && (
          <div className="wordbee-menu-game-options">
            {showDaily && (
              <button onClick={onDaily} role="menuitem" type="button">
                Daily Wordle
              </button>
            )}
            <button onClick={onRandom} role="menuitem" type="button">
              Endless random
            </button>
            <div className="wordbee-menu-past">
              <label htmlFor="wordbee-past-date">Past date</label>
              <div>
                <input
                  id="wordbee-past-date"
                  max={maxPastDate}
                  min={minPastDate}
                  onChange={(event) => onPastDateChange(event.target.value)}
                  type="date"
                  value={pastDate}
                />
                <button onClick={onPast} type="button">
                  Play
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="wordbee-menu-other-games" aria-label="Games">
        {additionalGames.map((game) => (
          <div className="wordbee-menu-game-group" key={game.key}>
            <button
              aria-expanded={expandedGame === game.key}
              className={[
                'wordbee-game-menu-button',
                selectedGame === game.key ? 'wordbee-game-menu-button--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={disabledGames.includes(game.key)}
              onClick={() => toggleGame(game.key)}
              role="menuitem"
              type="button"
            >
              <img alt="" className="wordbee-game-menu-button__logo" src={game.logoUrl} />
              <span>{game.label}</span>
              <span className="wordbee-game-menu-button__chevron" aria-hidden="true" />
            </button>

            {expandedGame === game.key && (
              <div className="wordbee-menu-game-options">
                {game.key === 'tiles' && onTilesRandom && (
                  <button onClick={onTilesRandom} role="menuitem" type="button">
                    Endless random
                  </button>
                )}
                {showAdditionalDaily && (
                  <button onClick={onAdditionalDaily} role="menuitem" type="button">
                    Today&apos;s {game.label}
                  </button>
                )}
                <div className="wordbee-menu-past">
                  <label htmlFor={`wordbee-past-${game.key}`}>Past date</label>
                  <div>
                    <input
                      id={`wordbee-past-${game.key}`}
                      max={additionalMaxPastDate}
                      min={ADDITIONAL_GAME_FIRST_DATES[game.key]}
                      onChange={(event) => onAdditionalPastDateChange(event.target.value)}
                      type="date"
                      value={additionalPastDate}
                    />
                    <button onClick={onAdditionalPast} type="button">
                      Play
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const additionalGames: Array<{
  key: AdditionalGameKey
  label: string
  logoUrl: string
}> = [
  { key: 'connections', label: 'Connections', logoUrl: connectionsLogoUrl },
  { key: 'strands', label: 'Strands', logoUrl: strandsLogoUrl },
  { key: 'sudoku', label: 'Sudoku', logoUrl: sudokuLogoUrl },
  { key: 'letterboxed', label: 'Letter Boxed', logoUrl: letterboxedLogoUrl },
  { key: 'spellingbee', label: 'Spelling Bee', logoUrl: spellingbeeLogoUrl },
  { key: 'tiles', label: 'Tiles', logoUrl: tilesLogoUrl },
  { key: 'pips', label: 'Pips', logoUrl: pipsLogoUrl },
  { key: 'crossword', label: 'The Crossword', logoUrl: crosswordLogoUrl },
  { key: 'midi', label: 'The Midi', logoUrl: midiLogoUrl },
  { key: 'mini', label: 'The Mini', logoUrl: miniLogoUrl },
]
