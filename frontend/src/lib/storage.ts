import {
  ACCESS_STORAGE_KEY,
  ADDITIONAL_GAME_LABELS,
  CLIENT_SESSION_STORAGE_KEY,
  HINT_USAGE_STORAGE_KEY,
  LAST_GAME_RESUME_GRACE_MS,
  LAST_GAME_STORAGE_KEY,
  LEGACY_AVATAR_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  defaultSettings,
} from '../config/constants'
import { createDefaultAvatarConfig } from '../features/avatar/avatar-config'
import { decodeTokenPayload, formatFirstName, formatLastInitial, formatDisplayName } from './access'
import { getTodayDate } from './date'
import { createRandomId } from './ids'
import type {
  AccessState,
  FriendsFamilyAccess,
  GuestAccess,
  Settings,
  WordbeeGameKey,
} from '../types'

// Derived from the game labels so a newly added game is restorable on day one;
// a hardcoded list silently degraded every game missing from it back to Wordle.
const GAME_KEYS: WordbeeGameKey[] = [
  'wordle',
  ...(Object.keys(ADDITIONAL_GAME_LABELS) as WordbeeGameKey[]),
]

export type LastGameState = { activeGame: WordbeeGameKey; additionalGameDate: string }
// `dateWasToday` records whether the saved date was that game's *daily* at save
// time, as opposed to a date deliberately picked from the archive. Restoring a
// stale daily across a midnight rollover would quietly downgrade the player into
// a retro play of yesterday's puzzle, so only a genuine archive pick is kept.
type StoredLastGameState = LastGameState & { savedAt?: number; dateWasToday?: boolean }

function parseLastGameState(raw: string | null): StoredLastGameState | null {
  if (!raw) return null

  const parsed = JSON.parse(raw) as Partial<StoredLastGameState>
  if (!GAME_KEYS.includes(parsed.activeGame as WordbeeGameKey)) return null

  return {
    activeGame: parsed.activeGame as WordbeeGameKey,
    additionalGameDate:
      typeof parsed.additionalGameDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.additionalGameDate)
        ? parsed.additionalGameDate
        : '',
    savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : undefined,
    dateWasToday: parsed.dateWasToday === true,
  }
}

// Roll a restored *daily* forward if the calendar date moved on while the app
// was gone. The in-app midnight watcher only covers a document that stayed
// alive; a fresh document (iOS purge, deploy refresh) re-arms its timer for the
// next midnight and would otherwise sit on yesterday's puzzle.
function withCurrentDailyDate(state: StoredLastGameState): LastGameState {
  const today = getTodayDate()
  return {
    activeGame: state.activeGame,
    additionalGameDate:
      state.dateWasToday && state.additionalGameDate !== today ? today : state.additionalGameDate,
  }
}

export function loadLastGameState(): LastGameState | null {
  try {
    // Same document session (desktop tab reload, deploy refresh): always resume.
    const sessionState = parseLastGameState(window.sessionStorage.getItem(LAST_GAME_STORAGE_KEY))
    if (sessionState) return withCurrentDailyDate(sessionState)

    // sessionStorage is gone, so this is a fresh document — either the OS tore
    // down a backgrounded iOS PWA or the player genuinely relaunched. Resume
    // only if they were playing moments ago; otherwise fall through to Wordle.
    const persistedState = parseLastGameState(window.localStorage.getItem(LAST_GAME_STORAGE_KEY))
    if (
      persistedState?.savedAt !== undefined &&
      Date.now() - persistedState.savedAt <= LAST_GAME_RESUME_GRACE_MS
    ) {
      return withCurrentDailyDate(persistedState)
    }

    return null
  } catch {
    return null
  }
}

export function saveLastGameState(state: LastGameState) {
  const payload = JSON.stringify({
    ...state,
    savedAt: Date.now(),
    dateWasToday: state.additionalGameDate === getTodayDate(),
  })

  try {
    window.sessionStorage.setItem(LAST_GAME_STORAGE_KEY, payload)
  } catch {
    // Session persistence is best-effort.
  }

  try {
    window.localStorage.setItem(LAST_GAME_STORAGE_KEY, payload)
  } catch {
    // Persistence across a relaunch is best-effort too.
  }
}

export function loadSettings(): Settings {
  try {
    const rawSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!rawSettings) return defaultSettings

    const storedSettings = JSON.parse(rawSettings) as Partial<Settings>
    return {
      ...defaultSettings,
      ...storedSettings,
      darkThemeOverride:
        typeof storedSettings.darkThemeOverride === 'boolean'
          ? storedSettings.darkThemeOverride
          : null,
    }
  } catch {
    return defaultSettings
  }
}

export function loadAccessState(): AccessState | null {
  try {
    window.localStorage.removeItem(LEGACY_AVATAR_STORAGE_KEY)
    const rawAccess = window.localStorage.getItem(ACCESS_STORAGE_KEY)
    if (!rawAccess) return null

    const storedAccess = JSON.parse(rawAccess) as Partial<FriendsFamilyAccess | GuestAccess>
    if (storedAccess.kind === 'guest') {
      return { kind: 'guest' }
    }

    if (
      storedAccess.kind === 'friends-family' &&
      typeof storedAccess.displayName === 'string' &&
      typeof storedAccess.firstName === 'string' &&
      typeof storedAccess.lastInitial === 'string' &&
      typeof storedAccess.token === 'string'
    ) {
      const rawDisplayName = storedAccess.displayName.slice(0, 64)
      const displayName = formatDisplayName(rawDisplayName)
      const tokenPayload = decodeTokenPayload(storedAccess.token)
      const userId =
        typeof storedAccess.userId === 'string'
          ? storedAccess.userId.slice(0, 80)
          : typeof tokenPayload?.userId === 'string'
            ? tokenPayload.userId.slice(0, 80)
            : ''

      return {
        avatar: createDefaultAvatarConfig(displayName),
        kind: 'friends-family',
        userId,
        displayName,
        firstName: formatFirstName(storedAccess.firstName.slice(0, 40)),
        lastInitial: formatLastInitial(storedAccess.lastInitial.slice(0, 1)),
        token: storedAccess.token,
      }
    }
  } catch {
    window.localStorage.removeItem(ACCESS_STORAGE_KEY)
  }

  return null
}

export function getClientSessionId() {
  try {
    const storedSessionId = window.sessionStorage.getItem(CLIENT_SESSION_STORAGE_KEY)
    if (storedSessionId) return storedSessionId

    const legacySessionId = window.localStorage.getItem(CLIENT_SESSION_STORAGE_KEY)
    if (legacySessionId) {
      window.sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, legacySessionId)
      window.localStorage.removeItem(CLIENT_SESSION_STORAGE_KEY)
      return legacySessionId
    }

    const sessionId = createRandomId()
    window.sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, sessionId)
    return sessionId
  } catch {
    return createRandomId()
  }
}

function loadHintUsedDates(): Record<string, true> {
  try {
    const raw = window.localStorage.getItem(HINT_USAGE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as Record<string, unknown>
    const dates: Record<string, true> = {}
    for (const [date, used] of Object.entries(parsed)) {
      if (used && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        dates[date] = true
      }
    }
    return dates
  } catch {
    return {}
  }
}

export function hasUsedHintForDate(date: string): boolean {
  if (!date) return false
  return loadHintUsedDates()[date] === true
}

export function markHintUsedForDate(date: string) {
  if (!date) return

  try {
    const dates = loadHintUsedDates()
    if (dates[date]) return

    dates[date] = true
    window.localStorage.setItem(HINT_USAGE_STORAGE_KEY, JSON.stringify(dates))
  } catch {
    // Hint-usage persistence is best-effort.
  }
}
