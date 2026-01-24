import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { User, LoginRequest, RegisterRequest } from '../types/auth'
import * as authApi from '../api/auth'
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  isTokenExpired,
} from '../utils/tokenStorage'

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (request: LoginRequest) => Promise<void>
  register: (request: RegisterRequest) => Promise<void>
  logout: () => Promise<void>
  getAuthHeader: () => Record<string, string>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isAuthenticated = user !== null

  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    const refresh = getRefreshToken()
    if (!refresh) return false

    try {
      const response = await authApi.refreshToken(refresh)
      setTokens(response.access_token, refresh)
      return true
    } catch {
      clearTokens()
      setUser(null)
      return false
    }
  }, [])

  const initializeAuth = useCallback(async () => {
    const accessToken = getAccessToken()
    const refreshTokenValue = getRefreshToken()

    if (!accessToken || !refreshTokenValue) {
      setIsLoading(false)
      return
    }

    try {
      if (isTokenExpired(accessToken)) {
        const refreshed = await refreshAccessToken()
        if (!refreshed) {
          setIsLoading(false)
          return
        }
      }

      const currentAccessToken = getAccessToken()
      if (currentAccessToken) {
        const userData = await authApi.getCurrentUser(currentAccessToken)
        setUser(userData)
      }
    } catch {
      clearTokens()
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [refreshAccessToken])

  useEffect(() => {
    initializeAuth()
  }, [initializeAuth])

  useEffect(() => {
    if (!isAuthenticated) return

    const interval = setInterval(async () => {
      const accessToken = getAccessToken()
      if (accessToken && isTokenExpired(accessToken)) {
        await refreshAccessToken()
      }
    }, 60000)

    return () => clearInterval(interval)
  }, [isAuthenticated, refreshAccessToken])

  const login = useCallback(async (request: LoginRequest) => {
    const response = await authApi.login(request)
    setTokens(response.tokens.access_token, response.tokens.refresh_token)
    setUser(response.user)
  }, [])

  const register = useCallback(async (request: RegisterRequest) => {
    const response = await authApi.register(request)
    setTokens(response.tokens.access_token, response.tokens.refresh_token)
    setUser(response.user)
  }, [])

  const logout = useCallback(async () => {
    const accessToken = getAccessToken()
    const refreshTokenValue = getRefreshToken()

    if (accessToken && refreshTokenValue) {
      try {
        await authApi.logout(accessToken, refreshTokenValue)
      } catch {
        // Ignore logout errors, still clear local state
      }
    }

    clearTokens()
    setUser(null)
  }, [])

  const getAuthHeader = useCallback((): Record<string, string> => {
    const accessToken = getAccessToken()
    if (!accessToken) return {}
    return { Authorization: `Bearer ${accessToken}` }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        login,
        register,
        logout,
        getAuthHeader,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
