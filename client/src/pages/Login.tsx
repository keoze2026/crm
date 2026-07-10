import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { FullPageSpinner } from '../auth/RequireAuth'
import { Button, Card, Input, Spinner } from '../components/ui'

/**
 * Passwordless login: enter your email/username, then the 6-digit code from Google
 * Authenticator. First-time setup happens through the enrolment link (see /enroll).
 */
export default function Login() {
  const { authEnabled, user, loading, startLogin, verifyTotp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [step, setStep] = useState<'identifier' | 'code'>('identifier')
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <FullPageSpinner />
  if (!authEnabled) return <Navigate to="/" replace />       // auth off → nothing to log into
  if (user) return <Navigate to={from} replace />            // already signed in

  const submitIdentifier = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await startLogin(identifier.trim())
      setStep('code')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await verifyTotp(code.trim())
      navigate(from, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      {step === 'identifier' ? (
        <form onSubmit={submitIdentifier} className="space-y-3">
          <Input
            label="Email or username"
            placeholder="you@example.com"
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setError(null) }}
            autoFocus
            autoComplete="username"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full justify-center" disabled={busy || !identifier.trim()}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Continue
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-3">
          <p className="text-center text-sm text-slate-500">
            Enter the 6-digit code from your Google Authenticator app.
          </p>
          <Input
            label="Authentication code"
            placeholder="123456"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(null) }}
            autoFocus
            autoComplete="one-time-code"
            className="text-center text-lg tracking-[0.4em]"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full justify-center" disabled={busy || code.length < 6}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Verify &amp; sign in
          </Button>
          <button
            type="button"
            onClick={() => { setStep('identifier'); setCode(''); setError(null) }}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            ← Use a different account
          </button>
        </form>
      )}
    </Shell>
  )
}

const GRID_BG: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(rgba(37,99,235,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.06) 1px, transparent 1px)',
  backgroundSize: '44px 44px',
}

export function Shell({ children, title = 'Welcome back', subtitle = 'Sign in to your account' }: {
  children: React.ReactNode; title?: string; subtitle?: string
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-4" style={GRID_BG}>
      {/* Soft glow behind the card */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/10 blur-3xl" />

      <Card className="animate-fade-in-up relative z-10 w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="text-blue-900">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          </div>
        </div>
        {children}
      </Card>
    </div>
  )
}
