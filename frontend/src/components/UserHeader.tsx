import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useAuthStore } from '../container/ContainerContext'
import styles from './UserHeader.module.css'

export const UserHeader = observer(function UserHeader() {
  const authStore = useAuthStore()
  const user = authStore.user$.get()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await authStore.logout()
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
})
