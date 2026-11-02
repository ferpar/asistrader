import { useEffect, useState, FormEvent } from 'react'
import { resetPassword } from '../api/auth'
import { useAuthStore, useRouterStore } from '../container/ContainerContext'
import { LOGIN_ROUTE } from '../domain/router/RouterStore'
import { MIN_PASSWORD_LENGTH } from '../hooks/useAuthValidation'
import { PasswordInput } from './PasswordInput'
import formStyles from '../styles/forms.module.css'
import styles from './AuthForm.module.css'

// bcrypt's limit; the API rejects anything longer.
const MAX_PASSWORD_LENGTH = 72

function tokenFromHash(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get('token')
}

function passwordError(password: string, confirmPassword: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`
  }
  if (password !== confirmPassword) {
    return 'Passwords do not match'
  }
  return null
}

export function ResetPasswordForm() {
  const authStore = useAuthStore()
  const routerStore = useRouterStore()
  const [token] = useState(tokenFromHash)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDone, setIsDone] = useState(false)

  // Keep the token out of the address bar and browser history.
  useEffect(() => {
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token) return

    const validationError = passwordError(password, confirmPassword)
    if (validationError) {
      setError(validationError)
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await resetPassword(token, password)
      // The reset revoked every session, including any in this browser.
      await authStore.logout()
      setIsDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const goToSignIn = () => routerStore.navigate(LOGIN_ROUTE)

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <h1 className={styles.authTitle}>AsisTrader</h1>
        <p className={styles.authSubtitle}>Trading Operations Management</p>

        {isDone || !token ? (
          <div className={styles.authForm}>
            <h2>{isDone ? 'Password Updated' : 'Invalid Reset Link'}</h2>
            {!isDone && (
              <div className={styles.authError}>
                This reset link is incomplete. Open the full link you were sent, or ask for a new one.
              </div>
            )}
            <button type="button" className={styles.authSubmit} onClick={goToSignIn}>
              Go to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.authForm}>
            <h2>Set a New Password</h2>

            {error && <div className={styles.authError}>{error}</div>}

            <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
              <label htmlFor="newPassword">New Password</label>
              <PasswordInput
                id="newPassword"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            </div>

            <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
              <label htmlFor="confirmPassword">Confirm Password</label>
              <PasswordInput
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            </div>

            <button type="submit" className={styles.authSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Please wait...' : 'Set Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
