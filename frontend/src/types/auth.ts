export interface User {
  id: number
  email: string
  is_active: boolean
  created_at: string | null
}

export interface AuthTokens {
  access_token: string
  refresh_token: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
}

export interface AuthResponse {
  user: User
  tokens: AuthTokens
}

export interface RefreshResponse {
  access_token: string
}

export interface AuthValidationError {
  field: 'email' | 'password' | 'confirmPassword'
  message: string
}
