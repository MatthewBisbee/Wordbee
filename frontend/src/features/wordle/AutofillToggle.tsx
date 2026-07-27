import autofillIconMarkup from '../../assets/Autofill.svg?raw'
import { InlineIcon } from '../../components/InlineIcon'

// Header toggle (left of the hint button) that carries confirmed green letters
// into the next row. Rendered as a pressable icon; the parent owns the state.
export function AutofillToggle({
  enabled,
  disabled = false,
  onToggle,
}: {
  enabled: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      aria-label={enabled ? 'Autofill known letters (on)' : 'Autofill known letters'}
      aria-pressed={enabled}
      className={[
        'wordbee-icon-button',
        'wordbee-icon-button--autofill',
        enabled ? 'wordbee-icon-button--autofill-on' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      <InlineIcon markup={autofillIconMarkup} />
    </button>
  )
}
