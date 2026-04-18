import { ChangeEvent, FocusEvent, InputHTMLAttributes, useState } from 'react'
import styles from './PriceInput.module.css'

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'onBlur' | 'step'
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

function stepFor(digits: number): string {
  if (digits <= 0) return '1'
  return (1 / 10 ** digits).toFixed(digits)
}

function countDecimals(value: string): number {
  const dotIdx = value.indexOf('.')
  if (dotIdx === -1) return 0
  return value.length - dotIdx - 1
}

export function PriceInput({
  value,
  onChange,
  onBlur,
  priceHint,
  min = '0',
  name,
  ...rest
}: PriceInputProps) {
  const [focused, setFocused] = useState(false)
  const digits = resolveDigits(priceHint)
  const step = stepFor(digits)
  const hasExcessDecimals = value !== '' && countDecimals(value) > digits

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    setFocused(false)
    if (value !== '' && hasExcessDecimals) {
      const parsed = parseFloat(value)
      if (!Number.isNaN(parsed)) {
        const rounded = parsed.toFixed(digits)
        const synthetic = {
          ...e,
          target: { ...e.target, name: name ?? '', value: rounded },
          currentTarget: { ...e.currentTarget, name: name ?? '', value: rounded },
        } as unknown as ChangeEvent<HTMLInputElement>
        onChange(synthetic)
      }
    }
    onBlur?.(e)
  }

  const showHint = focused && hasExcessDecimals

  return (
    <div className={styles.wrapper}>
      <input
        {...rest}
        type="number"
        name={name}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        step={step}
        min={min}
      />
      {showHint && (
        <span className={styles.precisionHint}>
          Will round to {digits} decimal{digits === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}
