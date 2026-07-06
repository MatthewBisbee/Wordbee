import {
  ACCESS_STORAGE_KEY,
  CLIENT_SESSION_STORAGE_KEY,
  LEGACY_AVATAR_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  defaultSettings,
} from '../config/constants'
import { createDefaultAvatarConfig } from '../features/avatar/avatar-config'
import { decodeTokenPayload } from './access'
import { createRandomId } from './ids'
import type { AccessState, FriendsFamilyAccess, GuestAccess, Settings } from '../types'

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
      const displayName = storedAccess.displayName.slice(0, 64)
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
        firstName: storedAccess.firstName.slice(0, 40),
        lastInitial: storedAccess.lastInitial.slice(0, 1),
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
