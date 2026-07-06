import { useState } from 'react'
import wordleLogoUrl from '../../assets/Wordle_Logo.svg'

export function WordbeeMenu({
  maxPastDate,
  minPastDate,
  onDaily,
  onPast,
  onPastDateChange,
  onRandom,
  pastDate,
  showDaily,
}: {
  maxPastDate: string
  minPastDate: string
  onDaily: () => void
  onPast: () => void
  onPastDateChange: (dateValue: string) => void
  onRandom: () => void
  pastDate: string
  showDaily: boolean
}) {
  const [isWordleOpen, setIsWordleOpen] = useState(true)

  return (
    <div className="wordbee-menu-popover" role="menu">
      <button
        aria-expanded={isWordleOpen}
        className="wordbee-game-menu-button"
        onClick={() => setIsWordleOpen((isOpen) => !isOpen)}
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
    </div>
  )
}
