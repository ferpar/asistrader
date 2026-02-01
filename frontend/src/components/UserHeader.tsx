import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './UserHeader.module.css'

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
    <div className={styles.userHeader}>
      <span className={styles.userEmail}>{user.email}</span>
      <button
        onClick={handleLogout}
        disabled={isLoggingOut}
        className={styles.logoutButton}
      >
        {isLoggingOut ? 'Signing out...' : 'Sign Out'}
      </button>
    </div>
  )
}
