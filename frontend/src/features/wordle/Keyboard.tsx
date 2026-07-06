import { BackspaceIcon } from '../../components/InlineIcon'
import type { EvaluatedState } from '../../types'

export function Keyboard({
  keys,
  onKey,
  states,
}: {
  keys: string[][]
  onKey: (key: string) => void
  states: Record<string, EvaluatedState>
}) {
  return (
    <div className="wordbee-keyboard" aria-label="Keyboard">
      {keys.map((row, rowIndex) => (
        <div className="wordbee-keyboard__row" key={`keyboard-row-${rowIndex}`}>
          {rowIndex === 1 && <div className="wordbee-keyboard__spacer" />}
          {row.map((key) => {
            const isAction = key.length > 1
            const keyState = states[key.toLowerCase()]

            return (
              <button
                className={isAction ? 'wordbee-key wordbee-key--wide' : 'wordbee-key'}
                data-state={keyState ?? undefined}
                key={key}
                type="button"
                onClick={() => onKey(key)}
                aria-label={key === 'Backspace' ? 'Backspace' : key}
              >
                {key === 'Backspace' ? <BackspaceIcon /> : key}
              </button>
            )
          })}
          {rowIndex === 1 && <div className="wordbee-keyboard__spacer" />}
        </div>
      ))}
    </div>
  )
}
