import { useState } from 'react'
import connectionsLogoUrl from '../../assets/Connections_Logo.svg'
import strandsLogoUrl from '../../assets/Strands_Logo.svg'
import sudokuLogoUrl from '../../assets/Sudoku_Logo.svg'
import wordleLogoUrl from '../../assets/Wordle_Logo.svg'
import type { AdditionalGameKey, WordbeeGameKey } from '../../types'

export function WordbeeMenu({
  maxPastDate,
  minPastDate,
  onDaily,
  onPast,
  onPastDateChange,
  onRandom,
  onSelectGame,
  pastDate,
  selectedGame,
  showDaily,
}: {
  maxPastDate: string
  minPastDate: string
  onDaily: () => void
  onPast: () => void
  onPastDateChange: (dateValue: string) => void
  onRandom: () => void
  onSelectGame: (gameKey: WordbeeGameKey) => void
  pastDate: string
  selectedGame: WordbeeGameKey
  showDaily: boolean
}) {
  const [isWordleOpen, setIsWordleOpen] = useState(true)

  return (
    <div className="wordbee-menu-popover" role="menu">
      <button
        aria-expanded={isWordleOpen}
        className={[
          'wordbee-game-menu-button',
          selectedGame === 'wordle' ? 'wordbee-game-menu-button--active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => {
          onSelectGame('wordle')
          setIsWordleOpen((isOpen) => !isOpen)
        }}
        role="menuitem"
        type="button"
      >
        <img alt="" className="wordbee-game-menu-button__logo" src={wordleLogoUrl} />
        <span>Wordle</span>
        <span className="wordbee-game-menu-button__chevron" aria-hidden="true" />
      </button>

      {isWordleOpen && (
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

      <div className="wordbee-menu-other-games" aria-label="Games">
        {additionalGames.map((game) => (
          <button
            className={[
              'wordbee-game-menu-button',
              selectedGame === game.key ? 'wordbee-game-menu-button--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={game.key}
            onClick={() => onSelectGame(game.key)}
            role="menuitem"
            type="button"
          >
            <img alt="" className="wordbee-game-menu-button__logo" src={game.logoUrl} />
            <span>{game.label}</span>
          </button>
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
  { key: 'sudoku', label: 'Sudoku', logoUrl: sudokuLogoUrl },
  { key: 'connections', label: 'Connections', logoUrl: connectionsLogoUrl },
  { key: 'strands', label: 'Strands', logoUrl: strandsLogoUrl },
]
