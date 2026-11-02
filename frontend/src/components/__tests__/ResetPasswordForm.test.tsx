import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ResetPasswordForm } from '../ResetPasswordForm'
import { resetPassword } from '../../api/auth'
import { ApiError } from '../../api/http'

const authStore = vi.hoisted(() => ({ logout: vi.fn() }))
const routerStore = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('../../api/auth', () => ({ resetPassword: vi.fn() }))
vi.mock('../../container/ContainerContext', () => ({
  useAuthStore: () => authStore,
  useRouterStore: () => routerStore,
}))

const api = vi.mocked(resetPassword)

function fillAndSubmit(password: string, confirmPassword = password) {
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: confirmPassword } })
  fireEvent.click(screen.getByRole('button', { name: 'Set Password' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/reset-password#token=abc123')
})

describe('ResetPasswordForm', () => {
  it('removes the token from the address bar', () => {
    render(<ResetPasswordForm />)
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/reset-password')
  })

  it('submits the token, clears the local session and offers sign in', async () => {
    api.mockResolvedValue(undefined)
    render(<ResetPasswordForm />)

    fillAndSubmit('brand-new-password')

    await screen.findByText('Password Updated')
    expect(api).toHaveBeenCalledWith('abc123', 'brand-new-password')
    expect(authStore.logout).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Go to Sign In' }))
    expect(routerStore.navigate).toHaveBeenCalledWith('login')
  })

  it('shows the server error for an invalid or expired link', async () => {
    api.mockRejectedValue(new ApiError('This reset link is invalid or has expired', 400))
    render(<ResetPasswordForm />)

    fillAndSubmit('brand-new-password')

    await screen.findByText('This reset link is invalid or has expired')
    expect(authStore.logout).not.toHaveBeenCalled()
  })

  it.each([
    ['short', 'short', 'Password must be at least 8 characters'],
    ['x'.repeat(73), 'x'.repeat(73), 'Password must be at most 72 characters'],
    ['brand-new-password', 'different-password', 'Passwords do not match'],
  ])('rejects invalid input before calling the API', async (password, confirm, message) => {
    render(<ResetPasswordForm />)

    fillAndSubmit(password, confirm)

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument())
    expect(api).not.toHaveBeenCalled()
  })

  it('explains the problem when the link has no token', () => {
    window.history.replaceState({}, '', '/reset-password')
    render(<ResetPasswordForm />)

    expect(screen.getByText('Invalid Reset Link')).toBeInTheDocument()
    expect(screen.queryByLabelText('New Password')).not.toBeInTheDocument()
  })
})
