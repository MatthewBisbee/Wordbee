import { useCallback, useEffect, useRef, useState } from 'react'
import hintIconMarkup from '../../assets/icons/icon-forum.svg?raw'
import { InlineIcon } from '../../components/InlineIcon'

const REPEAT_NAMES: Record<number, string> = {
  2: 'double',
  3: 'triple',
  4: 'quadruple',
  5: 'quintuple',
}
const COUNT_WORDS: Record<number, string> = {
  1: 'a',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
}

// Turn the anonymized repeat structure (e.g. [3, 2]) into a plain-English line
// like "This word has a triple and a double." without naming any letters.
function summarizeRepeats(repeats: number[]): string {
  if (repeats.length === 0) {
    return 'No letter repeats in this word.'
  }

  const groups = new Map<number, number>()
  repeats.forEach((count) => groups.set(count, (groups.get(count) ?? 0) + 1))

  const phrases = [...groups.entries()]
    .sort((first, second) => second[0] - first[0])
    .map(([multiplicity, occurrences]) => {
      const name = REPEAT_NAMES[multiplicity] ?? `${multiplicity}×`
      if (occurrences === 1) {
        return `${COUNT_WORDS[1]} ${name}`
      }
      return `${COUNT_WORDS[occurrences] ?? occurrences} ${name}s`
    })

  const joined =
    phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`

  return `This word has ${joined}.`
}

export function HintButton({
  used,
  disabled = false,
  onReveal,
}: {
  used: boolean
  disabled?: boolean
  onReveal: () => Promise<number[] | null>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [repeats, setRepeats] = useState<number[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const fetchRepeats = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const result = await onReveal()
      if (result) {
        setRepeats(result)
      } else {
        setError('Hint is unavailable right now.')
      }
    } catch {
      setError('Hint is unavailable right now.')
    } finally {
      setIsLoading(false)
    }
  }, [onReveal])

  const toggleOpen = useCallback(() => setIsOpen((open) => !open), [])

  // Fetch the repeats the first time the popover opens; reuse the cached result
  // on later opens. The `error` guard stops the effect from retrying in a loop;
  // closing clears it so a reopen retries after a failure.
  useEffect(() => {
    if (!isOpen || repeats !== null || isLoading || error) return
    void fetchRepeats()
  }, [error, fetchRepeats, isLoading, isOpen, repeats])

  useEffect(() => {
    if (!isOpen) setError('')
  }, [isOpen])

  // Close when clicking/tapping outside the popover.
  useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const wrapper = wrapperRef.current
      if (!wrapper || !(event.target instanceof Node)) return
      if (wrapper.contains(event.target)) return
      setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  return (
    <div className="wordbee-hint" ref={wrapperRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={used ? 'Repeated-letter hint (used)' : 'Repeated-letter hint'}
        aria-pressed={used}
        className={[
          'wordbee-icon-button',
          'wordbee-icon-button--hint',
          used ? 'wordbee-icon-button--hint-used' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled}
        onClick={toggleOpen}
        type="button"
      >
        <InlineIcon markup={hintIconMarkup} />
      </button>

      {isOpen && (
        <div className="wordbee-hint-popover" role="dialog" aria-label="Repeated-letter hint">
          <span className="wordbee-hint-popover__title">Repeated letters</span>

          {isLoading && <p className="wordbee-hint-popover__status">Checking…</p>}

          {!isLoading && error && (
            <p className="wordbee-hint-popover__status wordbee-hint-popover__status--error">
              {error}
            </p>
          )}

          {!isLoading && !error && repeats !== null && (
            <>
              {repeats.length > 0 && (
                <div className="wordbee-hint-badges" aria-hidden="true">
                  {repeats.map((count, index) => (
                    <span className="wordbee-hint-badge" key={`repeat-${index}`}>
                      ×{count}
                    </span>
                  ))}
                </div>
              )}
              <p className="wordbee-hint-popover__summary">{summarizeRepeats(repeats)}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
