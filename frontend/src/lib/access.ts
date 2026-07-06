import { ApiError } from './api'
import type { AccessLoginResponse } from '../types'

export function decodeTokenPayload(rawToken: unknown) {
  if (typeof rawToken !== 'string' || !rawToken.includes('.')) return null

  try {
    const [encodedPayload] = rawToken.split('.', 1)
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(window.atob(`${base64}${padding}`)) as Record<string, unknown>
  } catch {
    return null
  }
}

export function isSessionConflict(error: unknown) {
  return error instanceof ApiError && error.status === 409 && error.message === 'Session is active elsewhere'
}

export function isCompleteAccessLoginResponse(
  responseBody: AccessLoginResponse,
): responseBody is AccessLoginResponse & {
  identity: NonNullable<AccessLoginResponse['identity']>
  token: string
} {
  return (
    typeof responseBody.token === 'string' &&
    responseBody.identity?.kind === 'friends-family' &&
    typeof responseBody.identity.userId === 'string'
  )
}

export function isPendingAccessLoginResponse(
  responseBody: AccessLoginResponse,
): responseBody is AccessLoginResponse & {
  pendingIdentity: NonNullable<AccessLoginResponse['pendingIdentity']>
} {
  return Boolean(responseBody.requiresAvatar && responseBody.pendingIdentity)
}
