import type { PuzzleMetadata } from '../types'

export function getDevicePrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function getIsStandaloneApp() {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean }
  return (
    navigatorWithStandalone.standalone === true ||
    (window.matchMedia?.('(display-mode: standalone)').matches ?? false)
  )
}

export function getDefaultPastDate() {
  const dateValue = new Date()
  dateValue.setDate(dateValue.getDate() - 1)
  return formatDateInput(dateValue)
}

export function getTodayDate() {
  return formatDateInput(new Date())
}

export function formatDateInput(dateValue: Date) {
  const year = dateValue.getFullYear()
  const month = String(dateValue.getMonth() + 1).padStart(2, '0')
  const day = String(dateValue.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getPuzzleHeaderLabel(puzzle: PuzzleMetadata | null) {
  if (!puzzle) return ''
  if (puzzle.mode === 'random') return 'Random'
  if (puzzle.mode === 'past') return formatPuzzleHeaderDate(puzzle.date)
  return ''
}

export function formatPuzzleHeaderDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number)
  if (!year || !month || !day) return dateValue

  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function getOrdinalSuffix(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th'

  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}
