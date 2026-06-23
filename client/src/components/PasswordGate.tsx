/* Per-page password gate. NOTE: this is a CLIENT-SIDE gate — it controls what the
 * UI shows, but the passwords ship in the bundle and the API is still reachable
 * directly. It is access control for the UI, not real security. For true
 * protection, move the check to the backend/auth layer. */
import { useState, type FormEvent, type ReactNode } from 'react'
import { PageHeader } from './Layout'
import { Button, Card, Input } from './ui'

export function Protected({ pageTitle, subtitle, password, storageKey, children }: {
  pageTitle: string
  subtitle?: string
  password: string
  storageKey: string
  children: ReactNode
}) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(storageKey) === '1')

  if (unlocked) return <>{children}</>

  return (
    <div>
      <PageHeader title={pageTitle} subtitle={subtitle ?? 'Protected — enter the password to continue'} />
      <PasswordForm
        password={password}
        onUnlock={() => { sessionStorage.setItem(storageKey, '1'); setUnlocked(true) }}
      />
    </div>
  )
}

function PasswordForm({ password, onUnlock }: { password: string; onUnlock: () => void }) {
  const [pwd, setPwd] = useState('')
  const [error, setError] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pwd === password) onUnlock()
    else setError(true)
  }

  return (
    <Card className="mx-auto max-w-sm p-8">
      <div className="mb-4 flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a3654] text-white">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800">Password required</h2>
          <p className="mt-0.5 text-sm text-slate-500">Enter the password to access this page.</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <Input
          type="password"
          placeholder="Password"
          value={pwd}
          onChange={(e) => { setPwd(e.target.value); setError(false) }}
          autoFocus
        />
        {error && <p className="text-sm text-red-600">Incorrect password.</p>}
        <Button type="submit" className="w-full justify-center">Unlock</Button>
      </form>
    </Card>
  )
}
