import closeIconMarkup from '../../assets/icons/icon-close.svg?raw'
import { InlineIcon } from '../../components/InlineIcon'
import { AvatarImage } from '../avatar/avatar'
import { FriendsFamilyAccessForm } from '../access/AccessDialog'
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
