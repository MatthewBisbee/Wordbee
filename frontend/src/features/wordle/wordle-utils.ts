import { MAX_GUESSES, WORD_LENGTH, statePriority } from '../../config/constants'
import type {
  EvaluatedState,
  GameResult,
  StatsSummary,
  Tile,
  TileAnimation,
  TileState,
} from '../../types'

export function createBoard() {
  return Array.from({ length: MAX_GUESSES }, () =>
    Array.from({ length: WORD_LENGTH }, () => ({
      letter: '',
      state: 'empty' as TileState,
      animation: 'idle' as TileAnimation,
    })),
  )
}

export function getCompletedBoard(board: Tile[][], activeRow: number, scores: EvaluatedState[]) {
  return board
    .slice(0, activeRow)
    .map((row) => row.map((tile) => tile.state as EvaluatedState))
    .concat([scores])
}

export function getCompletedGuesses(board: Tile[][], activeRow: number) {
  return board
    .slice(0, activeRow + 1)
    .map((row) => row.map((tile) => tile.letter).join(''))
}

export function hydrateBoardFromResult(result: { guesses: string[]; board: EvaluatedState[][] }) {
  const nextBoard = createBoard()

  result.guesses.forEach((guess, rowIndex) => {
    const rowStates = result.board[rowIndex] ?? []

    guess.split('').forEach((letter, tileIndex) => {
      nextBoard[rowIndex][tileIndex] = {
        animation: 'idle',
        letter,
        state: rowStates[tileIndex] ?? 'absent',
      }
    })
  })

  return nextBoard
}

export function getKeyboardStateFromResult(result: { guesses: string[]; board: EvaluatedState[][] }) {
  return result.guesses.reduce<Record<string, EvaluatedState>>((nextState, guess, rowIndex) => {
    guess.split('').forEach((letter, tileIndex) => {
      const state = result.board[rowIndex]?.[tileIndex]
      if (!state) return

      const normalizedLetter = letter.toLowerCase()
      const previousState = nextState[normalizedLetter]
      if (previousState && statePriority[previousState] >= statePriority[state]) return

      nextState[normalizedLetter] = state
    })

    return nextState
  }, {})
}

export function createShareText(result: GameResult) {
  return result.board.map((row) =>
    row
      .map((state) => {
        if (state === 'correct') return '🟩'
        if (state === 'present') return '🟨'
        return '⬜'
      })
      .join(''),
  ).join('\n')
}

export function getDistributionMax(stats: StatsSummary) {
  return Math.max(1, ...Object.values(stats.guessDistribution))
}

export function tileAriaLabel(tile: Tile, index: number) {
  const position = ['1st', '2nd', '3rd', '4th', '5th'][index]

  if (!tile.letter) return `${position} letter, empty`
  if (tile.state === 'tbd') return `${position} letter, ${tile.letter}`
  if (tile.state === 'correct') return `${position} letter, ${tile.letter}, correct`
  if (tile.state === 'present') {
    return `${position} letter, ${tile.letter}, present in another position`
  }

  return `${position} letter, ${tile.letter}, absent`
}
