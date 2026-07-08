import { useState } from 'react'
import { requestJson } from '../../lib/api'
import { isCompleteAccessLoginResponse, isPendingAccessLoginResponse } from '../../lib/access'
import { AvatarBuilder, AvatarDialog } from '../avatar/avatar'
import { createDefaultAvatarConfig, sanitizeAvatarConfig } from '../avatar/avatar-config'
import type {
  AccessLoginResponse,
  AccessValidateResponse,
  AvatarConfig,
  FriendsFamilyAccess,
  PendingFriendsFamilyAccess,
} from '../../types'

export function AccessDialog({
  clientSessionId,
  onGuest,
  onLogin,
}: {
  clientSessionId: string
  onGuest: () => void
  onLogin: (accessState: FriendsFamilyAccess) => void
}) {
  return (
    <div className="access-backdrop">
      <section
        aria-labelledby="access-title"
        aria-modal="true"
        className="access-modal"
        role="dialog"
      >
        <h2 id="access-title">Who's playing?</h2>
        <FriendsFamilyAccessForm
          autoFocusCode
          clientSessionId={clientSessionId}
          guestButtonLabel="I don't have a friends and family code"
          onGuest={onGuest}
          onLogin={onLogin}
          useAvatarDialog
        />
      </section>
    </div>
  )
}

export function FriendsFamilyAccessForm({
  autoFocusCode = false,
  className = '',
  clientSessionId,
  guestButtonLabel,
  hideCodeLabel = false,
  onGuest,
  onLogin,
  onAvatarDialogClose,
  useAvatarDialog = false,
}: {
  autoFocusCode?: boolean
  className?: string
  clientSessionId: string
  guestButtonLabel?: string
  hideCodeLabel?: boolean
  onGuest?: () => void
  onLogin: (accessState: FriendsFamilyAccess) => void
  onAvatarDialogClose?: () => void
  useAvatarDialog?: boolean
}) {
  const [code, setCode] = useState(() => {
    try {
      return window.localStorage.getItem('wordbee.authorized_family_code') || ''
    } catch {
      return ''
    }
  })
  const [firstName, setFirstName] = useState('')
  const [lastInitial, setLastInitial] = useState('')
  const [step, setStep] = useState<'code' | 'profile' | 'avatar'>(() => {
    try {
      return window.localStorage.getItem('wordbee.authorized_family_code') ? 'profile' : 'code'
    } catch {
      return 'code'
    }
  })
  const [pendingAccess, setPendingAccess] = useState<PendingFriendsFamilyAccess | null>(null)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validateCode = async () => {
    setError('')
    setIsSubmitting(true)

    try {
      const responseBody = await requestJson<AccessValidateResponse>(
        '/api/friends-family/validate-code',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        },
      )

      if (!responseBody.ok) {
        throw new Error('Code not recognized')
      }

      try {
        window.localStorage.setItem('wordbee.authorized_family_code', code)
      } catch (storageError) {
        console.warn('Could not save authorized code to localStorage', storageError)
      }

      setStep('profile')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Code not recognized')
    } finally {
      setIsSubmitting(false)
    }
  }

  const requestLogin = (createUser = false, avatar?: AvatarConfig) =>
    requestJson<AccessLoginResponse>('/api/friends-family/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientSessionId,
        code,
        createUser,
        ...(avatar ? { avatar } : {}),
        firstName,
        lastInitial,
      }),
    })

  const completeSignedInLogin = (responseBody: AccessLoginResponse, avatar?: AvatarConfig) => {
    if (!isCompleteAccessLoginResponse(responseBody)) {
      throw new Error('Could not sign in')
    }

    try {
      window.localStorage.setItem('wordbee.authorized_family_code', code)
    } catch (storageError) {
      console.warn('Could not save authorized code to localStorage', storageError)
    }

    const serverAvatar = responseBody.identity.avatar
      ? sanitizeAvatarConfig(responseBody.identity.avatar, responseBody.identity.displayName)
      : null
    onLogin({
      ...responseBody.identity,
      avatar:
        serverAvatar ??
        avatar ??
        createDefaultAvatarConfig(responseBody.identity.displayName),
      token: responseBody.token,
    })
  }

  const login = async () => {
    setError('')
    setIsSubmitting(true)

    try {
      const responseBody = await requestLogin(false)

      if (isCompleteAccessLoginResponse(responseBody)) {
        completeSignedInLogin(responseBody)
        return
      }

      if (isPendingAccessLoginResponse(responseBody)) {
        setPendingAccess({
          avatar: createDefaultAvatarConfig(responseBody.pendingIdentity.displayName),
          ...responseBody.pendingIdentity,
        })
        setStep('avatar')
        return
      }

      throw new Error('Could not sign in')
    } catch (submitError) {
      const errorMsg = submitError instanceof Error ? submitError.message : 'Could not sign in'
      setError(errorMsg)
      if (errorMsg.toLowerCase().includes('code')) {
        try {
          window.localStorage.removeItem('wordbee.authorized_family_code')
        } catch {}
        setStep('code')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const savePendingAvatar = async (avatar: AvatarConfig) => {
    if (!pendingAccess || isSubmitting) return

    setError('')
    setIsSubmitting(true)

    try {
      const responseBody = await requestLogin(true, avatar)
      completeSignedInLogin(responseBody, avatar)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save avatar')
    } finally {
      setIsSubmitting(false)
    }
  }

  const cancelPendingAvatar = () => {
    setPendingAccess(null)
    setStep('profile')
    onAvatarDialogClose?.()
  }

  return (
    <div className={['access-form', className].filter(Boolean).join(' ')}>
      {step === 'code' ? (
        <>
          {guestButtonLabel && onGuest && (
            <button className="access-guest-button" type="button" onClick={onGuest}>
              {guestButtonLabel}
            </button>
          )}
          <label className="access-field">
            <span className={hideCodeLabel ? 'wordbee-sr-only' : ''}>
              Friends and family code
            </span>
            <input
              autoComplete="one-time-code"
              autoFocus={autoFocusCode}
              inputMode="numeric"
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && code.trim()) {
                  void validateCode()
                }
              }}
              type="password"
              value={code}
            />
          </label>
          <button
            className="access-primary-button"
            disabled={!code.trim() || isSubmitting}
            onClick={() => void validateCode()}
            type="button"
          >
            Continue
          </button>
        </>
      ) : step === 'profile' ? (
        <>
          <p className="access-confirmed">
            Code accepted.
            <button
              className="access-change-code-button"
              type="button"
              onClick={() => {
                try {
                  window.localStorage.removeItem('wordbee.authorized_family_code')
                } catch {}
                setCode('')
                setStep('code')
              }}
            >
              Change code
            </button>
          </p>
          <p className="access-profile-note">Use this same name to sign in on another device.</p>
          <label className="access-field">
            <span>First name</span>
            <input
              autoComplete="given-name"
              autoFocus
              maxLength={40}
              onChange={(event) => setFirstName(event.target.value)}
              type="text"
              value={firstName}
            />
          </label>
          <label className="access-field access-field--short">
            <span>Last initial</span>
            <input
              autoComplete="off"
              maxLength={1}
              onChange={(event) => setLastInitial(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && firstName.trim() && lastInitial.trim()) {
                  void login()
                }
              }}
              type="text"
              value={lastInitial}
            />
          </label>
          <button
            className="access-primary-button"
            disabled={!firstName.trim() || !lastInitial.trim() || isSubmitting}
            onClick={() => void login()}
            type="button"
          >
            Save
          </button>
        </>
      ) : pendingAccess ? (
        useAvatarDialog ? (
          <>
            <p className="access-confirmed">Code accepted.</p>
            <AvatarDialog
              ariaLabel="Choose your avatar"
              displayName={pendingAccess.displayName}
              initialAvatar={pendingAccess.avatar}
              onCancel={cancelPendingAvatar}
              onClose={cancelPendingAvatar}
              onSave={(avatar) => void savePendingAvatar(avatar)}
              saveLabel="Save avatar"
            />
          </>
        ) : (
          <AvatarBuilder
            displayName={pendingAccess.displayName}
            initialAvatar={pendingAccess.avatar}
            onCancel={cancelPendingAvatar}
            onSave={(avatar) => void savePendingAvatar(avatar)}
            saveLabel="Save avatar"
          />
        )
      ) : null}

      {error && <p className="access-error">{error}</p>}
    </div>
  )
}
