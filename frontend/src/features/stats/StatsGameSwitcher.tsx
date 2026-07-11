import type { WordbeeGameKey } from '../../types'

const GAMES: { key: WordbeeGameKey; label: string }[] = [
  { key: 'wordle', label: 'Wordle' },
  { key: 'connections', label: 'Connections' },
  { key: 'strands', label: 'Strands' },
  { key: 'sudoku', label: 'Sudoku' },
  { key: 'letterboxed', label: 'Letter Boxed' },
  { key: 'spellingbee', label: 'Spelling Bee' },
  { key: 'tiles', label: 'Tiles' },
  { key: 'pips', label: 'Pips' },
  { key: 'crossword', label: 'The Crossword' },
  { key: 'midi', label: 'The Midi' },
  { key: 'mini', label: 'The Mini' },
]

export function StatsGameSwitcher({
  activeGame,
  disabledGames = [],
  onSelect,
}: {
  activeGame: WordbeeGameKey
  disabledGames?: string[]
  onSelect: (gameKey: WordbeeGameKey) => void
}) {
  return (
    <label className="stats-game-switcher">
      <span className="wordbee-sr-only">Switch game stats</span>
      <select
        onChange={(event) => onSelect(event.target.value as WordbeeGameKey)}
        value={activeGame}
      >
        {GAMES.filter((game) => !disabledGames.includes(game.key)).map((game) => (
          <option key={game.key} value={game.key}>
            {game.label}
          </option>
        ))}
      </select>
    </label>
  )
}
