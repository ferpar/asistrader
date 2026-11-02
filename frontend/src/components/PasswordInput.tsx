import { useState, InputHTMLAttributes } from 'react'
import styles from './AuthForm.module.css'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export function PasswordInput(props: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <div className={styles.passwordInput}>
      <input {...props} type={isVisible ? 'text' : 'password'} />
      <button
        type="button"
        className={styles.passwordToggle}
        onClick={() => setIsVisible((visible) => !visible)}
        disabled={props.disabled}
        aria-label={isVisible ? 'Hide password' : 'Show password'}
      >
        {isVisible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
