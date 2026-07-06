import type {
  AccessState,
  AdditionalGameKey,
  MultigameDashboard,
  MultigameResultResponse,
} from '../../types'

export type SessionRequest = <ResponseBody>(
  url: string,
  initFactory: () => RequestInit,
) => Promise<ResponseBody>

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
  elapsedSeconds: number
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
