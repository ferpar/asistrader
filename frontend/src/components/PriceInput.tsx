import { ChangeEvent, FocusEvent, InputHTMLAttributes, useEffect, useState } from 'react'
import styles from './PriceInput.module.css'

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'onBlur' | 'step' | 'inputMode'
>

interface PriceInputProps extends NativeInputProps {
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  priceHint: number | null | undefined
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void
}

function resolveDigits(priceHint: number | null | undefined): number {
  return priceHint ?? 2
}

function countDecimals(value: string): number {
  const dotIdx = value.indexOf('.')
  if (dotIdx === -1) return 0
  return value.length - dotIdx - 1
}

// Normalize user input to canonical dot-decimal form. Accepts comma or dot as
// the decimal separator; the last occurrence wins so "1.234,56" and "1,234.56"
// both become "1234.56". This is the locale-safe parse the browser refuses to
// do for us: <input type="number"> in a comma-decimal locale interprets a
// pasted "1.154" as 1154, which is how trade 72 LDA.MC got a 1000× exit price.
function normalize(raw: string): string {
  const cleaned = raw.replace(/[^0-9.,]/g, '')
  const lastSep = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','))
  if (lastSep === -1) return cleaned
  const head = cleaned.slice(0, lastSep).replace(/[.,]/g, '')
  const tail = cleaned.slice(lastSep + 1).replace(/[.,]/g, '')
  return head + '.' + tail
}

export function PriceInput({
  value,
  onChange,
  onBlur,
  priceHint,
  name,
  ...rest
}: PriceInputProps) {
  const [focused, setFocused] = useState(false)
  // Local display string echoes what the user typed (including in-progress
  // states like "1." or "1,") while we emit canonical dot-decimal upstream.
  const [display, setDisplay] = useState(value)

  // Re-sync display when value changes from outside (prefill, reset). Skip
  // while focused so we don't clobber a partial entry mid-typing.
  useEffect(() => {
    if (!focused) setDisplay(value)
  }, [value, focused])

  const digits = resolveDigits(priceHint)
  const canonical = normalize(display)
  const hasExcessDecimals = canonical !== '' && countDecimals(canonical) > digits

  const emit = (e: ChangeEvent<HTMLInputElement> | FocusEvent<HTMLInputElement>, normalized: string) => {
    const synthetic = {
      ...e,
      target: { ...e.target, name: name ?? '', value: normalized },
      currentTarget: { ...e.currentTarget, name: name ?? '', value: normalized },
    } as unknown as ChangeEvent<HTMLInputElement>
    onChange(synthetic)
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const typed = e.target.value
    setDisplay(typed)
    emit(e, normalize(typed))
  }

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    setFocused(false)
    if (canonical !== '' && hasExcessDecimals) {
      const parsed = parseFloat(canonical)
      if (!Number.isNaN(parsed)) {
        const rounded = parsed.toFixed(digits)
        setDisplay(rounded)
        emit(e, rounded)
      }
    } else if (display !== canonical) {
      // Snap visible value back to canonical form so a Spanish-typed "1,154"
      // doesn't keep displaying with a comma after blur.
      setDisplay(canonical)
    }
    onBlur?.(e)
  }

  const showHint = focused && hasExcessDecimals

  return (
    <div className={styles.wrapper}>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        name={name}
        value={display}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
      />
      {showHint && (
        <span className={styles.precisionHint}>
          Will round to {digits} decimal{digits === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}
