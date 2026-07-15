import { useEffect, useRef, useState, type FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { FullPageSpinner } from '../auth/RequireAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import type { EnrollInfo } from '../types'
import { Shell } from './Login'

/**
 * First-time TOTP setup, reached via the one-time enrolment link an admin hands out
 * (/enroll?token=...). Scan the QR into Google Authenticator, then confirm a live code.
 */
export default function Enroll() {
  const { authEnabled, loading, enrollStart, enrollConfirm } = useAuth()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()

  const [info, setInfo] = useState<EnrollInfo | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  // Kick off enrolment once we know auth is on and a token is present.
  useEffect(() => {
    if (started.current || !authEnabled || !token) return
    started.current = true
    enrollStart(token)
      .then(setInfo)
      .catch((err: Error) => setStartError(err.message))
  }, [authEnabled, token, enrollStart])

  if (loading) return <FullPageSpinner />
  if (!authEnabled) return <Navigate to="/" replace />
  if (!token) {
    return <Shell title="Enrolment" subtitle="Set up your authenticator">
      <p className="text-center text-sm text-destructive">Missing enrolment link. Ask your admin for a new one.</p>
    </Shell>
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await enrollConfirm(token, code.trim())
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title="Set up sign-in" subtitle="Scan this with Google Authenticator">
      {startError ? (
        <p className="text-center text-sm text-destructive">{startError}</p>
      ) : !info ? (
        <div className="flex justify-center py-8"><Spinner className="size-6" /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-2xl border border-border bg-white p-4">
              <QRCodeSVG value={info.otpauth_uri} size={196} />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Can’t scan? Enter this key manually:
              <br />
              <code className="mt-1 inline-block break-all rounded bg-accent px-2 py-1 font-mono text-[11px] text-foreground">
                {info.secret}
              </code>
            </p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="enroll-code">Enter the 6-digit code to confirm</Label>
              <Input
                id="enroll-code"
                placeholder="123456"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(null) }}
                autoComplete="one-time-code"
                className="text-center text-lg tracking-[0.4em] font-display"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full justify-center" disabled={busy || code.length < 6}>
              {busy && <Spinner className="size-4" />} Confirm &amp; finish
            </Button>
          </form>
        </div>
      )}
    </Shell>
  )
}
