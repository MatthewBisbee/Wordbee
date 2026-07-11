import type { AdditionalGameKey, EvaluatedState, Settings, StatsSummary } from '../types'

export const WORD_LENGTH = 5
export const MAX_GUESSES = 6
export const GUESS_DISTRIBUTION_ROWS = [
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3' },
  { key: '4', label: '4' },
  { key: '5', label: '5' },
  { key: '6', label: '6' },
  { key: 'fail', label: 'X' },
] as const

export const FLIP_HALF_MS = 250
export const REVEAL_STEP_MS = 250
export const DANCE_STEP_MS = 100
export const REVEAL_DONE_MS = (WORD_LENGTH - 1) * REVEAL_STEP_MS + FLIP_HALF_MS * 2 + 100
export const COMPLETION_TOAST_MS = 2600
export const RESULTS_REVEAL_DELAY_MS = 950
export const COPY_FEEDBACK_MS = 1300

export const SETTINGS_STORAGE_KEY = 'wordbee.settings.v1'
export const ACCESS_STORAGE_KEY = 'wordbee.access.v1'
export const LEGACY_AVATAR_STORAGE_KEY = 'wordbee.avatars.v1'
export const CLIENT_SESSION_STORAGE_KEY = 'wordbee.client-session.v1'
// Dates on which the player used the Wordle repeated-letter hint. Persists the
// "hint used" button state across reloads, independent of the daily result.
export const HINT_USAGE_STORAGE_KEY = 'wordbee.wordle-hint-usage.v1'
// Session-scoped so a cold app launch defaults to the daily Wordle, while an
// in-session reload (e.g. an iOS PWA refocus) restores the active game/date.
export const LAST_GAME_STORAGE_KEY = 'wordbee.last-game.v1'
export const FIRST_OFFICIAL_PUZZLE_DATE = '2021-06-19'

// Mirrors backend GAME_FIRST_DATES so the past-date picker can gray out
// unavailable days without waiting on a network round-trip.
export const ADDITIONAL_GAME_FIRST_DATES: Record<AdditionalGameKey, string> = {
  connections: '2023-06-12',
  strands: '2024-03-04',
  sudoku: '2021-06-19',
  letterboxed: '2019-02-01',
  spellingbee: '2018-05-09',
  tiles: '2023-04-24',
  pips: '2025-08-18',
  crossword: '1942-02-15',
  mini: '2014-08-21',
  midi: '2026-02-25',
}

export const ADDITIONAL_GAME_LABELS: Record<AdditionalGameKey, string> = {
  connections: 'Connections',
  strands: 'Strands',
  sudoku: 'Sudoku',
  letterboxed: 'Letter Boxed',
  spellingbee: 'Spelling Bee',
  tiles: 'Tiles',
  pips: 'Pips',
  crossword: 'The Crossword',
  mini: 'The Mini',
  midi: 'The Midi',
}

export const SKILL_HELP_TEXT =
  'Skill scores how efficiently your guesses split the remaining possible answers. If only one answer is left, only playing that answer scores well.'
export const LUCK_HELP_TEXT =
  "Luck compares the clue you actually received with that guess's average clue spread. Higher means the answer gave more help than expected."

export const EMPTY_STATS: StatsSummary = {
  played: 0,
  wins: 0,
  winPercentage: 0,
  averageGuesses: 0,
  currentStreak: 0,
  maxStreak: 0,
  currentWinStreak: 0,
  bestWinStreak: 0,
  currentPlayStreak: 0,
  bestPlayStreak: 0,
  guessDistribution: {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    fail: 0,
  },
  topStarters: [],
}

export const keyboardRows = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['Enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'Backspace'],
]

export const statePriority: Record<EvaluatedState, number> = {
  absent: 1,
  present: 2,
  correct: 3,
}

export const defaultSettings: Settings = {
  darkThemeOverride: null,
  highContrast: false,
  onscreenKeyboardOnly: false,
}
