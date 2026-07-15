import { useState, type FormEvent, type ReactNode, type CSSProperties } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { FullPageSpinner } from '../auth/RequireAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import TVNoise from '@/components/ui/tv-noise'
import MonkeyIcon from '@/components/icons/monkey'

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
        <form onSubmit={submitIdentifier} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">Email or username</Label>
            <Input
              id="identifier"
              placeholder="you@example.com"
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); setError(null) }}
              autoFocus
              autoComplete="username"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full justify-center" disabled={busy || !identifier.trim()}>
            {busy && <Spinner className="size-4" />} Continue
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            Enter the 6-digit code from your Google Authenticator app.
          </p>
          <div className="space-y-2">
            <Label htmlFor="code">Authentication code</Label>
            <Input
              id="code"
              placeholder="123456"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(null) }}
              autoFocus
              autoComplete="one-time-code"
              className="text-center text-lg tracking-[0.4em] font-display"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full justify-center" disabled={busy || code.length < 6}>
            {busy && <Spinner className="size-4" />} Verify &amp; sign in
          </Button>
          <button
            type="button"
            onClick={() => { setStep('identifier'); setCode(''); setError(null) }}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            ← Use a different account
          </button>
        </form>
      )}
    </Shell>
  )
}

const GRID_BG: CSSProperties = {
  backgroundImage:
    'linear-gradient(color-mix(in oklch, var(--primary) 8%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklch, var(--primary) 8%, transparent) 1px, transparent 1px)',
  backgroundSize: '44px 44px',
}

export function Shell({ children, title = 'Welcome back', subtitle = 'Sign in to your account' }: {
  children: ReactNode; title?: string; subtitle?: string
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-muted p-4" style={GRID_BG}>
      {/* Soft glow behind the card */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />

      <Card className="relative z-10 w-full max-w-sm overflow-hidden">
        <CardContent className="p-8">
          <TVNoise opacity={0.06} intensity={0.15} speed={30} />
          <div className="relative z-10 mb-6 flex flex-col items-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MonkeyIcon className="size-10" />
            </div>
            <div>
              <h2 className="text-2xl font-display tracking-tight text-foreground">{title}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground uppercase">{subtitle}</p>
            </div>
          </div>
          <div className="relative z-10">{children}</div>
        </CardContent>
      </Card>
    </div>
  )
}
