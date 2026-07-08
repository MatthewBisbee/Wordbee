import { type FormEvent, useState } from 'react'

import closeIconMarkup from '../../assets/icons/icon-close.svg?raw'
import { InlineIcon } from '../../components/InlineIcon'
import { AvatarImage } from '../avatar/avatar'
import { FriendsFamilyAccessForm } from '../access/AccessDialog'
import { ApiError, requestJson } from '../../lib/api'
import type { AccessState, AvatarConfig, FriendsFamilyAccess, Settings } from '../../types'

export function SettingsDialog({
  accessState,
  clientSessionId,
  effectiveDarkTheme,
  onAccessLogin,
  onAvatarChange,
  onClose,
  onSignOut,
  onSettingChange,
  settings,
}: {
  accessState: AccessState | null
  clientSessionId: string
  effectiveDarkTheme: boolean
  onAccessLogin: (accessState: FriendsFamilyAccess) => void
  onAvatarChange: () => void
  onClose: () => void
  onSignOut: () => void
  onSettingChange: <Key extends keyof Settings>(key: Key, value: Settings[Key]) => void
  settings: Settings
}) {
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="settings-modal__header">
          <h2 id="settings-title">SETTINGS</h2>
          <button className="settings-close" type="button" aria-label="Close" onClick={onClose}>
            <InlineIcon markup={closeIconMarkup} />
          </button>
        </div>

        <div className="settings-list">
          <SettingsRow
            checked={effectiveDarkTheme}
            label="Dark Theme"
            onChange={(checked) => onSettingChange('darkThemeOverride', checked)}
          />
          <SettingsRow
            checked={settings.highContrast}
            description="Contrast and colorblindness improvements"
            label="High Contrast Mode"
            onChange={(checked) => onSettingChange('highContrast', checked)}
          />
          <SettingsRow
            checked={settings.onscreenKeyboardOnly}
            description="Ignore key input except from the onscreen keyboard. Most helpful for users using speech recognition or other assistive devices."
            label="Onscreen Keyboard Input Only"
            onChange={(checked) => onSettingChange('onscreenKeyboardOnly', checked)}
          />
          {accessState?.kind === 'friends-family' && (
            <SettingsIdentityRow
              avatar={accessState.avatar}
              label="Signed in as"
              onAvatarChange={onAvatarChange}
              onSignOut={onSignOut}
              value={accessState.displayName}
            />
          )}
          {accessState?.kind === 'guest' && (
            <SettingsAccessSection
              clientSessionId={clientSessionId}
              onAvatarDialogClose={onClose}
              onLogin={onAccessLogin}
            />
          )}
          <SettingsContactForm accessState={accessState} clientSessionId={clientSessionId} />
          <div className="settings-links" aria-label="Project links">
            <a
              href="https://github.com/MatthewBisbee/Wordbee"
              rel="noreferrer"
              target="_blank"
            >
              GitHub
            </a>
            <span className="settings-links__separator" aria-hidden="true">
              |
            </span>
            <a href="https://matthewbisbee.com" rel="noreferrer" target="_blank">
              matthewbisbee.com
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}

type ContactFormStatus = 'idle' | 'sending' | 'sent' | 'error'

function SettingsContactForm({
  accessState,
  clientSessionId,
}: {
  accessState: AccessState | null
  clientSessionId: string
}) {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<ContactFormStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const trimmedMessage = message.trim()
  const isSending = status === 'sending'
  const statusText =
    status === 'sent'
      ? 'Suggestion sent'
      : status === 'error'
        ? errorMessage || 'Could not send suggestion'
        : ''

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!trimmedMessage || isSending) {
      return
    }

    setStatus('sending')
    setErrorMessage('')

    try {
      const payload =
        accessState?.kind === 'friends-family'
          ? {
              clientSessionId,
              friendsFamilyToken: accessState.token,
              message: trimmedMessage,
            }
          : { message: trimmedMessage }

      await requestJson<{ ok: boolean }>('/api/contact', {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })

      setMessage('')
      setStatus('sent')
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Could not send suggestion')
      setStatus('error')
    }
  }

  return (
    <form className="settings-contact-form" onSubmit={handleSubmit}>
      <label className="settings-row__label" htmlFor="settings-contact-message">
        Suggestions
      </label>
      <textarea
        className="settings-contact-input"
        disabled={isSending}
        id="settings-contact-message"
        maxLength={2000}
        onChange={(event) => {
          setMessage(event.target.value)
          if (status !== 'idle') {
            setStatus('idle')
            setErrorMessage('')
          }
        }}
        placeholder="Recommend bug fixes or new features"
        rows={4}
        value={message}
      />
      <div className="settings-contact-footer">
        <span
          className={`settings-contact-status settings-contact-status--${status}`}
          role={status === 'error' ? 'alert' : undefined}
        >
          {statusText}
        </span>
        <button
          className="settings-avatar-button"
          disabled={!trimmedMessage || isSending}
          type="submit"
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  )
}

function SettingsAccessSection({
  clientSessionId,
  onAvatarDialogClose,
  onLogin,
}: {
  clientSessionId: string
  onAvatarDialogClose: () => void
  onLogin: (accessState: FriendsFamilyAccess) => void
}) {
  return (
    <div className="settings-access-section">
      <span className="settings-row__label">Enter friends and family code</span>
      <FriendsFamilyAccessForm
        clientSessionId={clientSessionId}
        className="access-form--settings"
        hideCodeLabel
        onAvatarDialogClose={onAvatarDialogClose}
        onLogin={onLogin}
        useAvatarDialog
      />
    </div>
  )
}

function SettingsIdentityRow({
  avatar,
  label,
  onAvatarChange,
  onSignOut,
  value,
}: {
  avatar: AvatarConfig
  label: string
  onAvatarChange: () => void
  onSignOut: () => void
  value: string
}) {
  return (
    <div className="settings-row settings-profile-row">
      <span className="settings-row__text">
        <span className="settings-row__label">{label}</span>
      </span>
      <span className="settings-profile">
        <span className="settings-profile-identity">
          <span className="settings-avatar-preview">
            <AvatarImage avatar={avatar} displayName={value} size={96} />
          </span>
          <span className="settings-identity-value">{value}</span>
        </span>
        <span className="settings-profile-actions">
          <button className="settings-avatar-button" onClick={onAvatarChange} type="button">
            Change avatar
          </button>
          <button className="settings-avatar-button" onClick={onSignOut} type="button">
            Sign out
          </button>
        </span>
      </span>
    </div>
  )
}

function SettingsRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean
  description?: string
  label: string
  onChange: (checked: boolean) => void
}) {
  const inputId = `setting-${label.toLowerCase().replaceAll(' ', '-')}`
  const labelId = `${inputId}-label`

  return (
    <div className="settings-row">
      <div className="settings-row__text" id={labelId}>
        <span className="settings-row__label">{label}</span>
        {description && <span className="settings-row__description">{description}</span>}
      </div>
      <button
        aria-checked={checked}
        aria-labelledby={labelId}
        className="settings-switch"
        id={inputId}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span className="settings-switch__thumb" />
      </button>
    </div>
  )
}
