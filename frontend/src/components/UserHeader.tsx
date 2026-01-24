import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export function UserHeader() {
  const { user, logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await logout()
    } finally {
      setIsLoggingOut(false)
    }
  }

  if (!user) return null

  return (
    <div className="user-header">
      <span className="user-email">{user.email}</span>
      <button
        onClick={handleLogout}
        disabled={isLoggingOut}
        className="logout-button"
      >
        {isLoggingOut ? 'Signing out...' : 'Sign Out'}
      </button>
    </div>
  )
}
