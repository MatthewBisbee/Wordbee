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

export function formatFirstName(firstName: string): string {
  const trimmed = firstName.trim()
  if (!trimmed) return ''
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
}

export function formatLastInitial(lastInitial: string): string {
  return lastInitial.trim().toUpperCase()
}

export function formatDisplayName(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed) return ''
  const lastSpaceIndex = trimmed.lastIndexOf(' ')
  if (lastSpaceIndex === -1) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  }
  const firstPart = trimmed.slice(0, lastSpaceIndex).trim()
  const lastPart = trimmed.slice(lastSpaceIndex + 1).trim()

  const formattedFirst = firstPart.charAt(0).toUpperCase() + firstPart.slice(1).toLowerCase()
  const formattedLast = lastPart.charAt(0).toUpperCase() + lastPart.slice(1).toLowerCase()
  return `${formattedFirst} ${formattedLast}`
}

