import { useState, FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAuthValidation } from '../hooks/useAuthValidation'
import { AuthValidationError } from '../types/auth'

export function AuthForm() {
  const { login, register } = useAuth()
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const { isValid, errors } = useAuthValidation(
    { email, password, confirmPassword },
    isRegister
  )

  const getFieldError = (field: AuthValidationError['field']): string | null => {
    if (!touched[field]) return null
    const error = errors.find((e) => e.field === field)
    return error?.message ?? null
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched({ email: true, password: true, confirmPassword: true })

    if (!isValid) return

    setIsSubmitting(true)
    setServerError(null)

    try {
      if (isRegister) {
        await register({ email, password })
      } else {
        await login({ email, password })
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleMode = () => {
    setIsRegister(!isRegister)
    setServerError(null)
    setTouched({})
  }

  const emailError = getFieldError('email')
  const passwordError = getFieldError('password')
  const confirmPasswordError = getFieldError('confirmPassword')

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">AsisTrader</h1>
        <p className="auth-subtitle">Trading Operations Management</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <h2>{isRegister ? 'Create Account' : 'Sign In'}</h2>

          {serverError && <div className="auth-error">{serverError}</div>}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              className={emailError ? 'input-error' : ''}
              disabled={isSubmitting}
              autoComplete="email"
            />
            {emailError && <span className="field-error">{emailError}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              className={passwordError ? 'input-error' : ''}
              disabled={isSubmitting}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
            {passwordError && <span className="field-error">{passwordError}</span>}
          </div>

          {isRegister && (
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, confirmPassword: true }))}
                className={confirmPasswordError ? 'input-error' : ''}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
              {confirmPasswordError && (
                <span className="field-error">{confirmPasswordError}</span>
              )}
            </div>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={isSubmitting || (Object.keys(touched).length > 0 && !isValid)}
          >
            {isSubmitting
              ? 'Please wait...'
              : isRegister
              ? 'Create Account'
              : 'Sign In'}
          </button>
        </form>

        <div className="auth-toggle">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button type="button" onClick={toggleMode} disabled={isSubmitting}>
            {isRegister ? 'Sign In' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  )
}
