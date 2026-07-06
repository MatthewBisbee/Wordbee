import { useCallback, useEffect, useRef, useState } from 'react'
import closeIconMarkup from '../../assets/icons/icon-close.svg?raw'
import { InlineIcon } from '../../components/InlineIcon'
import {
  AVATAR_FEATURES,
  AVATAR_GRAPHIC_UNAVAILABLE_OPTIONS,
  avatarClothesSupportsGraphic,
  createAvatarUrl,
  createRandomAvatarConfig,
  updateAvatarFeature,
} from './avatar-config'
import type { AvatarConfig, AvatarFeatureKey, AvatarOption } from '../../types'

const DICE_FRAME_INTERVAL_MS = 22
const DICE_FIRST_ROLL_FRAME = 6
const DICE_REST_FRAME = 90
const DICE_FRAME_MODULES = import.meta.glob<string>('../../assets/dice/*.gif', {
  eager: true,
  query: '?url',
  import: 'default',
})
const DICE_ROLL_FRAMES = Object.entries(DICE_FRAME_MODULES)
  .map(([path, src]) => ({
    frame: Number(path.match(/frame_(\d+)_/)?.[1] ?? 0),
    src,
  }))
  .filter(({ frame }) => frame >= DICE_FIRST_ROLL_FRAME && frame <= DICE_REST_FRAME)
  .sort((a, b) => a.frame - b.frame)
const DICE_REST_SRC =
  DICE_ROLL_FRAMES.find(({ frame }) => frame === DICE_REST_FRAME)?.src ??
  DICE_ROLL_FRAMES[DICE_ROLL_FRAMES.length - 1]?.src ??
  ''

export function AvatarDialog({
  ariaLabel,
  displayName,
  initialAvatar,
  onCancel,
  onClose,
  onSave,
  saveLabel,
}: {
  ariaLabel: string
  displayName: string
  initialAvatar: AvatarConfig
  onCancel?: () => void
  onClose?: () => void
  onSave: (avatar: AvatarConfig) => void
  saveLabel: string
}) {
  return (
    <div className="avatar-backdrop" onClick={onClose}>
      <section
        aria-label={ariaLabel}
        aria-modal="true"
        className="avatar-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        {onClose && (
          <button
            aria-label="Close avatar builder"
            className="avatar-close"
            onClick={onClose}
            type="button"
          >
            <InlineIcon markup={closeIconMarkup} />
          </button>
        )}
        <AvatarBuilder
          displayName={displayName}
          initialAvatar={initialAvatar}
          onCancel={onCancel}
          onSave={onSave}
          saveLabel={saveLabel}
        />
      </section>
    </div>
  )
}

export function AvatarBuilder({
  displayName,
  initialAvatar,
  onCancel,
  onSave,
  saveLabel,
}: {
  displayName: string
  initialAvatar: AvatarConfig
  onCancel?: () => void
  onSave: (avatar: AvatarConfig) => void
  saveLabel: string
}) {
  const [draftAvatar, setDraftAvatar] = useState(initialAvatar)

  useEffect(() => {
    setDraftAvatar(initialAvatar)
  }, [initialAvatar])

  const updateDraftAvatar = (key: AvatarFeatureKey, value: string) => {
    setDraftAvatar((previousAvatar) => updateAvatarFeature(previousAvatar, key, value))
  }
  const selectedClothesSupportsGraphic = avatarClothesSupportsGraphic(draftAvatar.clothesVariant)

  return (
    <div className="avatar-builder">
      <div className="avatar-builder__preview-row">
        <div className="avatar-preview avatar-preview--large">
          <AvatarImage avatar={draftAvatar} displayName={displayName} size={384} />
        </div>
        <div className="avatar-builder__heading">
          <h3>Choose your avatar</h3>
          <DiceRandomButton
            onRandomize={() =>
              setDraftAvatar((previousAvatar) => createRandomAvatarConfig(previousAvatar))
            }
          />
        </div>
      </div>

      <div className="avatar-builder__controls">
        {AVATAR_FEATURES.map((feature) => {
          const isUnavailableGraphic =
            feature.key === 'clothesGraphicVariant' && !selectedClothesSupportsGraphic
          const options = isUnavailableGraphic
            ? AVATAR_GRAPHIC_UNAVAILABLE_OPTIONS
            : feature.options

          return (
            <AvatarFeatureSelector
              disabled={isUnavailableGraphic}
              key={feature.key}
              label={feature.label}
              onChange={(value) => updateDraftAvatar(feature.key, value)}
              options={options}
              value={isUnavailableGraphic ? 'none' : draftAvatar[feature.key]}
            />
          )
        })}
      </div>

      <div className="avatar-builder__actions">
        {onCancel && (
          <button className="avatar-secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
        )}
        <button
          className="avatar-primary-button"
          onClick={() => onSave(draftAvatar)}
          type="button"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  )
}

function AvatarFeatureSelector({
  label,
  onChange,
  options,
  value,
  disabled = false,
}: {
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  options: readonly AvatarOption[]
  value: string
}) {
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const currentOption = options[currentIndex] ?? options[0]

  const selectOffset = (offset: number) => {
    const nextIndex = (currentIndex + offset + options.length) % options.length
    const nextValue = options[nextIndex]?.value

    if (nextValue) {
      onChange(nextValue)
    }
  }

  return (
    <div className="avatar-feature">
      <span className="avatar-feature__label">{label}</span>
      <div className="avatar-feature__selector" data-disabled={disabled}>
        <button
          aria-label={`Previous ${label}`}
          className="avatar-feature__button"
          disabled={disabled || options.length <= 1}
          onClick={() => selectOffset(-1)}
          type="button"
        >
          <span aria-hidden="true">&lt;</span>
        </button>
        <span className="avatar-feature__value">{currentOption?.label}</span>
        <button
          aria-label={`Next ${label}`}
          className="avatar-feature__button"
          disabled={disabled || options.length <= 1}
          onClick={() => selectOffset(1)}
          type="button"
        >
          <span aria-hidden="true">&gt;</span>
        </button>
      </div>
    </div>
  )
}

export function AvatarImage({
  avatar,
  className = '',
  displayName,
  size = 256,
}: {
  avatar: AvatarConfig
  className?: string
  displayName: string
  size?: number
}) {
  return (
    <img
      alt={`${displayName} avatar`}
      className={['avatar-image', className].filter(Boolean).join(' ')}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      src={createAvatarUrl(avatar, size)}
    />
  )
}

function DiceRandomButton({ onRandomize }: { onRandomize: () => void }) {
  const [isDiceRolling, setIsDiceRolling] = useState(false)
  const [diceFrameIndex, setDiceFrameIndex] = useState(Math.max(DICE_ROLL_FRAMES.length - 1, 0))
  const diceRollTimerRef = useRef<number | null>(null)
  const diceRollRunIdRef = useRef(0)
  const dicePreloadRef = useRef<HTMLImageElement[]>([])

  const stopDiceRoll = useCallback(() => {
    diceRollRunIdRef.current += 1

    if (diceRollTimerRef.current !== null) {
      window.clearTimeout(diceRollTimerRef.current)
      diceRollTimerRef.current = null
    }

    setIsDiceRolling(false)
    setDiceFrameIndex(Math.max(DICE_ROLL_FRAMES.length - 1, 0))
  }, [])

  const startDiceRoll = useCallback(() => {
    if (DICE_ROLL_FRAMES.length <= 1) return

    const rollId = diceRollRunIdRef.current + 1
    diceRollRunIdRef.current = rollId

    if (diceRollTimerRef.current !== null) {
      window.clearTimeout(diceRollTimerRef.current)
    }

    setIsDiceRolling(true)
    setDiceFrameIndex(0)

    const advanceFrame = (frameIndex: number) => {
      if (diceRollRunIdRef.current !== rollId) return

      if (document.visibilityState === 'hidden') {
        stopDiceRoll()
        return
      }

      if (frameIndex >= DICE_ROLL_FRAMES.length - 1) {
        setDiceFrameIndex(DICE_ROLL_FRAMES.length - 1)
        diceRollTimerRef.current = null
        setIsDiceRolling(false)
        return
      }

      setDiceFrameIndex(frameIndex)
      diceRollTimerRef.current = window.setTimeout(
        () => advanceFrame(frameIndex + 1),
        DICE_FRAME_INTERVAL_MS,
      )
    }

    diceRollTimerRef.current = window.setTimeout(
      () => advanceFrame(1),
      DICE_FRAME_INTERVAL_MS,
    )
  }, [stopDiceRoll])

  useEffect(() => {
    dicePreloadRef.current = DICE_ROLL_FRAMES.map(({ src }) => {
      const image = new Image()
      image.decoding = 'sync'
      image.src = src
      return image
    })

    return () => {
      dicePreloadRef.current = []
      diceRollRunIdRef.current += 1

      if (diceRollTimerRef.current !== null) {
        window.clearTimeout(diceRollTimerRef.current)
        diceRollTimerRef.current = null
      }
    }
  }, [])

  const diceImageSrc = isDiceRolling
    ? DICE_ROLL_FRAMES[diceFrameIndex]?.src ?? DICE_REST_SRC
    : DICE_REST_SRC

  return (
    <button
      aria-label="Randomize avatar"
      className="avatar-random-button"
      data-rolling={isDiceRolling}
      disabled={isDiceRolling}
      onClick={() => {
        startDiceRoll()
        onRandomize()
      }}
      type="button"
    >
      {diceImageSrc ? (
        <img alt="" decoding="sync" draggable={false} src={diceImageSrc} />
      ) : (
        <span aria-hidden="true" className="avatar-random-button__fallback">
          D6
        </span>
      )}
    </button>
  )
}
