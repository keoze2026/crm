import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AuthButton, AuthError, AuthField, AuthLoading, AuthShell } from '../components/AuthShell'

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

  if (loading) return <AuthLoading />
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
    <AuthShell subtitle={step === 'identifier' ? 'Sign in to your account' : 'Enter your authentication code'}>
      {step === 'identifier' ? (
        <form onSubmit={submitIdentifier} className="space-y-3">
          <AuthField
            label="Email or username"
            placeholder="you@example.com"
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setError(null) }}
            autoFocus
            autoComplete="username"
          />
          {error && <AuthError>{error}</AuthError>}
          <AuthButton type="submit" className="!mt-[23px]" busy={busy} disabled={!identifier.trim()}>
            Continue
          </AuthButton>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-3">
          <p className="text-center text-[12px] text-slate-400">
            Signing in as <span className="font-medium text-slate-200">{identifier.trim()}</span>. Enter the 6-digit code from your Google Authenticator app.
          </p>
          <AuthField
            label="Authentication code"
            placeholder="123456"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(null) }}
            autoFocus
            autoComplete="one-time-code"
            className="text-center font-figures text-lg tracking-[0.45em]"
          />
          {error && <AuthError>{error}</AuthError>}
          <AuthButton type="submit" className="!mt-6" busy={busy} disabled={code.length < 6}>
            Verify &amp; sign in
          </AuthButton>
          <button
            type="button"
            onClick={() => { setStep('identifier'); setCode(''); setError(null) }}
            className="w-full pt-1 text-center text-[11.5px] text-slate-400 transition-colors hover:text-blue-300"
          >
            ← Use a different account
          </button>
        </form>
      )}
    </AuthShell>
  )
}
