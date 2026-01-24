import { useMemo } from 'react'
import { AuthValidationError } from '../types/auth'

interface AuthFormValues {
  email: string
  password: string
  confirmPassword?: string
}

interface AuthValidationResult {
  isValid: boolean
  errors: AuthValidationError[]
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

export function useAuthValidation(
  values: AuthFormValues,
  isRegister: boolean
): AuthValidationResult {
  return useMemo(() => {
    const errors: AuthValidationError[] = []
    const { email, password, confirmPassword } = values

    if (!email) {
      errors.push({ field: 'email', message: 'Email is required' })
    } else if (!EMAIL_REGEX.test(email)) {
      errors.push({ field: 'email', message: 'Invalid email format' })
    }

    if (!password) {
      errors.push({ field: 'password', message: 'Password is required' })
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.push({ field: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
    }

    if (isRegister) {
      if (!confirmPassword) {
        errors.push({ field: 'confirmPassword', message: 'Please confirm your password' })
      } else if (password !== confirmPassword) {
        errors.push({ field: 'confirmPassword', message: 'Passwords do not match' })
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }, [values.email, values.password, values.confirmPassword, isRegister])
}
