import { ADDITIONAL_GAME_LABELS } from '../../config/constants'
import { formatPuzzleHeaderDate } from '../../lib/date'
import type {
  AccessState,
  AdditionalGameKey,
  DateClampInfo,
  FriendsFamilyAccess,
  GameCalendar,
  MultigameDashboard,
  MultigameStatsSummary,
  MultigameStatusResponse,
  MultigameResultResponse,
  WordbeeGameKey,
} from '../../types'

export type SessionRequest = <ResponseBody>(
  url: string,
  initFactory: () => RequestInit,
) => Promise<ResponseBody>

// Surfaces the same "oldest/newest playable" nudge Wordle shows when a requested
// date is snapped back into a game's playable window.
export function notifyDateClamp(
  clampInfo: DateClampInfo,
  gameKey: AdditionalGameKey,
  showToast: (message: string, durationMs?: number) => void,
) {
  const label = ADDITIONAL_GAME_LABELS[gameKey]
  if (clampInfo.clampedToOldest && clampInfo.oldestDate) {
    showToast(`${formatPuzzleHeaderDate(clampInfo.oldestDate)} is the oldest ${label} playable.`, 2400)
  } else if (clampInfo.clampedToNewest && clampInfo.newestDate) {
    showToast(`${formatPuzzleHeaderDate(clampInfo.newestDate)} is the newest ${label} playable.`, 2400)
  }
}

export function formatElapsedTime(totalSeconds: number | null | undefined) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds <= 0) {
    return '--'
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function getElapsedSeconds(startedAt: number) {
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000))
}

export function getAdditionalGameStorageKey({
  date,
  gameKey,
  kind,
  variant,
}: {
  date: string
  gameKey: AdditionalGameKey
  kind: 'attempt' | 'result'
  variant: string
}) {
  return `wordbee.${gameKey}.${kind}.v1:${date}:${variant || 'daily'}`
}

export function loadStoredAdditionalGameValue<Value>(key: string): Value | null {
  try {
    const rawValue = window.localStorage.getItem(key)
    if (!rawValue) return null
    return JSON.parse(rawValue) as Value
  } catch {
    window.localStorage.removeItem(key)
    return null
  }
}

export function saveStoredAdditionalGameValue(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Local persistence is best-effort for guest mode.
  }
}

export function clearStoredAdditionalGameValue(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Local persistence is best-effort for guest mode.
  }
}

export async function loadAdditionalGameStatus({
  accessState,
  clientSessionId,
  date,
  gameKey,
  requestWithSessionRecovery,
  variant,
}: {
  accessState: AccessState | null
  clientSessionId: string
  date: string
  gameKey: AdditionalGameKey
  requestWithSessionRecovery: SessionRequest
  variant: string
}): Promise<MultigameStatusResponse> {
  if (accessState?.kind !== 'friends-family') {
    return { attempt: null, completed: false, result: null }
  }

  return requestWithSessionRecovery<MultigameStatusResponse>('/api/games/status', () => ({
    body: JSON.stringify({
      clientSessionId,
      date,
      friendsFamilyToken: accessState.token,
      gameKey,
      variant,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }))
}

export async function saveAdditionalGameAttempt({
  accessState,
  clientSessionId,
  date,
  gameKey,
  requestWithSessionRecovery,
  state,
  variant,
}: {
  accessState: AccessState | null
  clientSessionId: string
  date: string
  gameKey: AdditionalGameKey
  requestWithSessionRecovery: SessionRequest
  state: Record<string, unknown>
  variant: string
}) {
  if (accessState?.kind !== 'friends-family') {
    return null
  }

  return requestWithSessionRecovery<{ ok: boolean }>('/api/games/attempt', () => ({
    body: JSON.stringify({
      clientSessionId,
      date,
      friendsFamilyToken: accessState.token,
      gameKey,
      state,
      variant,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }))
}

export async function saveAdditionalGameResult({
  accessState,
  clientSessionId,
  date,
  elapsedSeconds,
  gameKey,
  outcome,
  requestWithSessionRecovery,
  score,
  variant,
}: {
  accessState: AccessState | null
  clientSessionId: string
  date: string
  elapsedSeconds: number | null
  gameKey: AdditionalGameKey
  outcome: 'won' | 'lost'
  requestWithSessionRecovery: SessionRequest
  score: Record<string, unknown>
  variant: string
}) {
  return requestWithSessionRecovery<MultigameResultResponse>('/api/games/result', () => ({
    body: JSON.stringify({
      clientSessionId,
      date,
      elapsedSeconds,
      friendsFamilyToken:
        accessState?.kind === 'friends-family' ? accessState.token : '',
      gameKey,
      outcome,
      score,
      variant,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }))
}

export async function loadAdditionalGameStats({
  accessState,
  clientSessionId,
  requestWithSessionRecovery,
}: {
  accessState: AccessState | null
  clientSessionId: string
  requestWithSessionRecovery: SessionRequest
}) {
  if (accessState?.kind !== 'friends-family') {
    return null
  }

  return requestWithSessionRecovery<MultigameDashboard>('/api/friends-family/game-stats', () => ({
    body: JSON.stringify({
      clientSessionId,
      token: accessState.token,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }))
}

export function getUserGameStats(
  dashboard: MultigameDashboard | null,
  gameKey: AdditionalGameKey,
  userId: string,
): MultigameStatsSummary | null {
  return dashboard?.games[gameKey].users.find((user) => user.id === userId)?.stats ?? null
}

export async function loadGameCalendar({
  accessState,
  clientSessionId,
  gameKey,
  requestWithSessionRecovery,
  userId,
}: {
  accessState: FriendsFamilyAccess
  clientSessionId: string
  gameKey: WordbeeGameKey
  requestWithSessionRecovery: SessionRequest
  userId: string
}) {
  return requestWithSessionRecovery<GameCalendar>('/api/friends-family/calendar', () => ({
    body: JSON.stringify({
      clientSessionId,
      gameKey,
      token: accessState.token,
      userId,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }))
}

export async function loadStatsForGameUser({
  accessState,
  clientSessionId,
  gameKey,
  requestWithSessionRecovery,
}: {
  accessState: AccessState | null
  clientSessionId: string
  gameKey: AdditionalGameKey
  requestWithSessionRecovery: SessionRequest
}) {
  if (accessState?.kind !== 'friends-family') {
    return null
  }

  const dashboard = await loadAdditionalGameStats({
    accessState,
    clientSessionId,
    requestWithSessionRecovery,
  })
  return getUserGameStats(dashboard, gameKey, accessState.userId)
}
