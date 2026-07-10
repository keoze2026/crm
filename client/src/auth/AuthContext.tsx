import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { api, setUnauthorizedHandler } from '../api/client'
import { PAGES, userCanAccess } from './pages'
import type { AuthUser } from '../types'

interface AuthState {
  /** Whether the backend enforces auth. When false, the app runs ungated (legacy behaviour). */
  authEnabled: boolean
  user: AuthUser | null
  loading: boolean
  isAdmin: boolean
  /** Whether the current user may see a page (always true when auth is disabled). */
  canAccess: (key: string) => boolean
  /** Path of the first page the current user may see — a safe redirect target. */
  firstAllowedPath: () => string
  startLogin: (identifier: string) => Promise<{ mfa_required: boolean }>
  verifyTotp: (code: string) => Promise<void>
  enrollStart: (token: string) => ReturnType<typeof api.enrollStart>
  enrollConfirm: (token: string, code: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authEnabled, setAuthEnabled] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const bootstrapped = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me()
      setUser(user)
    } catch {
      setUser(null)
    }
  }, [])

  // Discover whether auth is enforced, then (if so) load the current user.
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    ;(async () => {
      try {
        const { auth_enabled } = await api.authStatus()
        setAuthEnabled(auth_enabled)
        if (auth_enabled) await refresh()
      } catch {
        // If status can't be reached, fail open to the legacy ungated behaviour.
        setAuthEnabled(false)
      } finally {
        setLoading(false)
      }
    })()
  }, [refresh])

  // Clear state on an unexpected 401 so the guards send the user back to /login.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    return () => setUnauthorizedHandler(null)
  }, [])

  const startLogin = useCallback((identifier: string) => api.login(identifier), [])

  const verifyTotp = useCallback(async (code: string) => {
    const { user } = await api.verifyTotp(code)
    setUser(user)
  }, [])

  const enrollStart = useCallback((token: string) => api.enrollStart(token), [])

  const enrollConfirm = useCallback(async (token: string, code: string) => {
    const { user } = await api.enrollConfirm(token, code)
    setUser(user)
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() } finally { setUser(null) }
  }, [])

  const canAccess = useCallback((key: string) => {
    if (!authEnabled) return true
    return userCanAccess(user, key)
  }, [authEnabled, user])

  const firstAllowedPath = useCallback(() => {
    if (!authEnabled) return '/'
    const page = PAGES.find((p) => userCanAccess(user, p.key))
    return page?.path ?? '/records' // Daily Sheet is always reachable
  }, [authEnabled, user])

  const value = useMemo<AuthState>(() => ({
    authEnabled,
    user,
    loading,
    isAdmin: authEnabled ? user?.role === 'admin' : true,
    canAccess,
    firstAllowedPath,
    startLogin,
    verifyTotp,
    enrollStart,
    enrollConfirm,
    logout,
    refresh,
  }), [authEnabled, user, loading, canAccess, firstAllowedPath, startLogin, verifyTotp, enrollStart, enrollConfirm, logout, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
