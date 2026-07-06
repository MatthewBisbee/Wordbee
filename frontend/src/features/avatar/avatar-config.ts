import type { AvatarConfig, AvatarFeatureKey, AvatarOption } from '../../types'

const AVATAR_API_URL = 'https://api.dicebear.com/10.x/notionists/svg'
const AVATAR_CONFIG_VERSION = 1
const AVATAR_HAIR_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Hat', value: 'hat' },
  ...createVariantOptions(63),
] as const
const AVATAR_CLOTHES_OPTIONS = createVariantOptions(25)
const AVATAR_GESTURE_OPTIONS = [
  { label: 'Hand', value: 'hand' },
  { label: 'Phone', value: 'handPhone' },
  { label: 'OK', value: 'ok' },
  { label: 'Long OK', value: 'okLongArm' },
  { label: 'Point', value: 'point' },
  { label: 'Long point', value: 'pointLongArm' },
  { label: 'Wave', value: 'waveLongArm' },
  { label: 'Two-arm wave', value: 'waveLongArms' },
  { label: 'Wave OK', value: 'waveOkLongArms' },
  { label: 'Wave point', value: 'wavePointLongArms' },
] as const
const AVATAR_GLASSES_OPTIONS = [
  { label: 'None', value: 'none' },
  ...createVariantOptions(11),
] as const
const AVATAR_BEARD_OPTIONS = [{ label: 'None', value: 'none' }, ...createVariantOptions(12)]
const AVATAR_CLOTHES_GRAPHIC_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Electric', value: 'electric' },
  { label: 'Galaxy', value: 'galaxy' },
  { label: 'Saturn', value: 'saturn' },
] as const
const AVATAR_EYEBROWS_OPTIONS = createVariantOptions(13)
const AVATAR_EYES_OPTIONS = createVariantOptions(5)
const AVATAR_MOUTH_OPTIONS = createVariantOptions(30)
const AVATAR_NOSE_OPTIONS = createVariantOptions(20)
export const AVATAR_FEATURES = [
  { key: 'hairVariant', label: 'Hair', options: AVATAR_HAIR_OPTIONS },
  { key: 'clothesVariant', label: 'Clothes', options: AVATAR_CLOTHES_OPTIONS },
  { key: 'gestureVariant', label: 'Pose', options: AVATAR_GESTURE_OPTIONS },
  { key: 'glassesVariant', label: 'Glasses', options: AVATAR_GLASSES_OPTIONS },
  { key: 'beardVariant', label: 'Facial hair', options: AVATAR_BEARD_OPTIONS },
  {
    key: 'clothesGraphicVariant',
    label: 'Shirt graphic',
    options: AVATAR_CLOTHES_GRAPHIC_OPTIONS,
  },
  { key: 'eyebrowsVariant', label: 'Eyebrows', options: AVATAR_EYEBROWS_OPTIONS },
  { key: 'eyesVariant', label: 'Eyes', options: AVATAR_EYES_OPTIONS },
  { key: 'noseVariant', label: 'Nose', options: AVATAR_NOSE_OPTIONS },
  { key: 'mouthVariant', label: 'Mouth', options: AVATAR_MOUTH_OPTIONS },
] as const
const AVATAR_GRAPHIC_COMPATIBLE_CLOTHES = new Set(
  createVariantOptions(10).map((option) => option.value),
)
export const AVATAR_GRAPHIC_UNAVAILABLE_OPTIONS = [
  { label: 'Not on this shirt', value: 'none' },
] as const

function createVariantOptions(count: number): AvatarOption[] {
  return Array.from({ length: count }, (_, index) => {
    const displayNumber = index + 1
    return {
      label: `Style ${displayNumber}`,
      value: `variant${String(displayNumber).padStart(2, '0')}`,
    }
  })
}

function hashNumber(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function getRandomIndex(length: number) {
  if (length <= 0) return 0

  try {
    if (!window.crypto?.getRandomValues) throw new Error('Crypto unavailable')
    const randomValues = new Uint32Array(1)
    window.crypto.getRandomValues(randomValues)
    return randomValues[0] % length
  } catch {
    return Math.floor(Math.random() * length)
  }
}

function getRandomItem<Item>(items: readonly Item[]) {
  return items[getRandomIndex(items.length)]
}

function getDefaultAvatarFeatureValue(
  options: readonly AvatarOption[],
  seedHash: number,
  offset: number,
) {
  return options[(seedHash + offset) % options.length]?.value ?? ''
}

function isAvatarOptionValue(
  options: readonly AvatarOption[],
  value: unknown,
): value is string {
  return typeof value === 'string' && options.some((option) => option.value === value)
}

export function avatarClothesSupportsGraphic(clothesVariant: string) {
  return AVATAR_GRAPHIC_COMPATIBLE_CLOTHES.has(clothesVariant)
}

function normalizeAvatarGraphic(avatar: AvatarConfig) {
  if (avatarClothesSupportsGraphic(avatar.clothesVariant)) {
    return avatar
  }

  return {
    ...avatar,
    clothesGraphicVariant: 'none',
  }
}

export function createDefaultAvatarConfig(displayName = ''): AvatarConfig {
  const seedHash = hashNumber(displayName.trim().toLowerCase() || 'wordbee')
  const avatar = {
    seed: `wb-${seedHash.toString(36)}`,
    version: AVATAR_CONFIG_VERSION,
  } as AvatarConfig

  AVATAR_FEATURES.forEach((feature, index) => {
    avatar[feature.key] = getDefaultAvatarFeatureValue(feature.options, seedHash, index * 7)
  })

  return normalizeAvatarGraphic(avatar)
}

export function createRandomAvatarConfig(previousAvatar: AvatarConfig): AvatarConfig {
  const nextAvatar = { ...previousAvatar }

  AVATAR_FEATURES.forEach((feature) => {
    nextAvatar[feature.key] = getRandomItem(feature.options).value
  })

  return normalizeAvatarGraphic(nextAvatar)
}

export function sanitizeAvatarConfig(rawAvatar: unknown, displayName = ''): AvatarConfig {
  const defaultAvatar = createDefaultAvatarConfig(displayName)

  if (!rawAvatar || typeof rawAvatar !== 'object') {
    return defaultAvatar
  }

  const storedAvatar = rawAvatar as Partial<AvatarConfig>
  const avatar: AvatarConfig = {
    ...defaultAvatar,
    seed:
      typeof storedAvatar.seed === 'string' && storedAvatar.seed.trim()
        ? storedAvatar.seed.slice(0, 80)
        : defaultAvatar.seed,
    version: AVATAR_CONFIG_VERSION,
  }

  AVATAR_FEATURES.forEach((feature) => {
    const storedValue = storedAvatar[feature.key]

    if (isAvatarOptionValue(feature.options, storedValue)) {
      avatar[feature.key] = storedValue
    }
  })

  return normalizeAvatarGraphic(avatar)
}

export function updateAvatarFeature(
  avatar: AvatarConfig,
  key: AvatarFeatureKey,
  value: string,
): AvatarConfig {
  const nextAvatar = {
    ...avatar,
    [key]: value,
  }

  if (
    key === 'clothesGraphicVariant' &&
    value !== 'none' &&
    !avatarClothesSupportsGraphic(nextAvatar.clothesVariant)
  ) {
    nextAvatar.clothesVariant = AVATAR_CLOTHES_OPTIONS[0].value
  }

  return normalizeAvatarGraphic(nextAvatar)
}

function setOptionalAvatarVariant(
  params: URLSearchParams,
  variantParameter: string,
  probabilityParameter: string,
  value: string,
) {
  if (value === 'none') {
    params.set(probabilityParameter, '0')
    return
  }

  params.set(probabilityParameter, '100')
  params.set(variantParameter, value)
}

export function createAvatarUrl(avatar: AvatarConfig, size = 256) {
  const params = new URLSearchParams({
    clothesVariant: avatar.clothesVariant,
    eyebrowsVariant: avatar.eyebrowsVariant,
    eyesVariant: avatar.eyesVariant,
    gestureProbability: '100',
    gestureVariant: avatar.gestureVariant,
    mouthVariant: avatar.mouthVariant,
    noseVariant: avatar.noseVariant,
    seed: avatar.seed,
    size: String(size),
  })

  setOptionalAvatarVariant(params, 'hairVariant', 'hairProbability', avatar.hairVariant)
  setOptionalAvatarVariant(params, 'beardVariant', 'beardProbability', avatar.beardVariant)
  setOptionalAvatarVariant(
    params,
    'glassesVariant',
    'glassesProbability',
    avatar.glassesVariant,
  )
  setOptionalAvatarVariant(
    params,
    'clothesGraphicVariant',
    'clothesGraphicProbability',
    avatar.clothesGraphicVariant,
  )

  return `${AVATAR_API_URL}?${params.toString()}`
}
