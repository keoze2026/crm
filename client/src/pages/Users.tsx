import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Users as UsersIcon, Plus } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DEFAULT_USER_PAGES, PAGES } from '../auth/pages'
import DashboardPageLayout from '@/components/dashboard/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useAsync } from '../lib/useAsync'
import type { AuthUser, EnrollLink, ManagedUser, Role } from '../types'

const selectCls =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

type Filter = 'all' | 'admin' | 'user' | 'pending'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'admin', label: 'Admins' },
  { id: 'user', label: 'Users' },
  { id: 'pending', label: 'Pending' },
]

/**
 * Admin user management: create accounts (→ one-time enrolment link + QR), edit details,
 * promote/demote, control which pages a non-admin can see, and reset/deactivate/delete.
 */
export default function Users() {
  const { user: me } = useAuth()
  const list = useAsync(() => api.users(), [])
  const [addOpen, setAddOpen] = useState(false)
  const [link, setLink] = useState<{ email: string; enroll: EnrollLink } | null>(null)
  const [editing, setEditing] = useState<{ user: ManagedUser; rect: DOMRect } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const users = useMemo(() => list.data ?? [], [list.data])

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.is_active && u.totp_enabled).length,
    pending: users.filter((u) => u.is_active && !u.totp_enabled).length,
    admins: users.filter((u) => u.role === 'admin' && u.is_active).length,
  }), [users])

  const shown = useMemo(() => users.filter((u) => {
    if (filter === 'admin') return u.role === 'admin'
    if (filter === 'user') return u.role !== 'admin'
    if (filter === 'pending') return u.is_active && !u.totp_enabled
    return true
  }), [users, filter])

  const resetTotp = async (u: ManagedUser) => {
    if (!confirm(`Reset ${u.email}'s authenticator? Their current device stops working and they must re-enrol.`)) return
    setBusyId(u.id)
    try {
      const res = await api.resetUserTotp(u.id)
      setLink({ email: u.email, enroll: res.enroll })
      list.reload()
    } finally { setBusyId(null) }
  }

  const setActive = async (u: ManagedUser, is_active: boolean) => {
    if (!is_active && !confirm(`Deactivate ${u.email}? They will be signed out and can no longer log in.`)) return
    setBusyId(u.id)
    try { await api.updateUser(u.id, { is_active }); list.reload() } finally { setBusyId(null) }
  }

  const remove = async (u: ManagedUser) => {
    if (!confirm(`Permanently delete ${u.email}? This removes the account for good and cannot be undone.`)) return
    setBusyId(u.id)
    try { await api.deleteUser(u.id); list.reload() } finally { setBusyId(null) }
  }

  return (
    <DashboardPageLayout
      header={{
        title: 'Users',
        icon: UsersIcon,
        description: (
          <AddUser
            open={addOpen}
            onToggle={() => setAddOpen((o) => !o)}
            onClose={() => setAddOpen(false)}
            onCreated={(email, enroll) => { setAddOpen(false); setLink({ email, enroll }); list.reload() }}
          />
        ),
      }}
    >
      {/* Scorecards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Total users" value={stats.total} />
        <Tile label="Active" value={stats.active} hint="Authenticator set up" />
        <Tile label="Pending setup" value={stats.pending} hint="Awaiting enrolment" />
        <Tile label="Admins" value={stats.admins} />
      </div>

      {/* Filter tabs */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          {FILTERS.map((f) => <TabsTrigger key={f.id} value={f.id}>{f.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="overflow-hidden p-0">
          {list.loading ? (
            <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
          ) : list.error ? (
            <p className="py-10 text-center text-sm text-destructive">{list.error}</p>
          ) : shown.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground uppercase">
              {users.length === 0 ? 'No users yet. Add your first user to get started.' : 'No users match this filter.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Last sign-in</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u.id} className="border-b border-border last:border-0 transition-colors hover:bg-accent/50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/15 text-sm font-bold text-primary">
                            {(u.name ?? u.email).charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{u.name ?? u.email}</div>
                            {u.name && <div className="truncate text-xs text-muted-foreground">{u.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role === 'admin' ? 'Admin' : 'User'}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        {!u.is_active ? <Badge variant="outline-destructive">Deactivated</Badge>
                          : u.totp_enabled ? <Badge variant="outline-success">Active</Badge>
                          : <Badge variant="outline-warning">Pending setup</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {u.is_active ? (
                            <>
                              <Button variant="secondary" size="sm" disabled={busyId === u.id} onClick={() => resetTotp(u)}>
                                {u.totp_enabled ? 'Reset authenticator' : 'New link'}
                              </Button>
                              <Button variant="secondary" size="sm" disabled={busyId === u.id} onClick={() => setActive(u, false)}>
                                Deactivate
                              </Button>
                            </>
                          ) : (
                            <Button variant="secondary" size="sm" disabled={busyId === u.id} onClick={() => setActive(u, true)}>
                              Activate
                            </Button>
                          )}
                          <IconButton title="Edit user" disabled={busyId === u.id}
                            onClick={(e) => setEditing({ user: u, rect: e.currentTarget.getBoundingClientRect() })}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                          </IconButton>
                          <IconButton title={me?.id === u.id ? "You can't delete your own account" : 'Delete user'}
                            danger disabled={busyId === u.id || me?.id === u.id} onClick={() => remove(u)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditUserPopover
          user={editing.user}
          rect={editing.rect}
          me={me}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); list.reload() }}
        />
      )}
      {link && <EnrollLinkPopup info={link} onClose={() => setLink(null)} />}
    </DashboardPageLayout>
  )
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold font-display text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

// ─── Add-user button + dropdown (anchored under the button) ─────────────────────

function AddUser({ open, onToggle, onClose, onCreated }: {
  open: boolean; onToggle: () => void; onClose: () => void
  onCreated: (email: string, enroll: EnrollLink) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await api.createUser({
        email: email.trim(),
        name: name.trim() || undefined,
        username: username.trim() || undefined,
        role,
      })
      onCreated(res.email, res.enroll)
      setEmail(''); setName(''); setUsername(''); setRole('member')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={wrap} className="relative">
      <Button onClick={onToggle}><Plus className="size-4" /> Add user</Button>

      {open && (
        <div className="animate-fade-in-up absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl">
          <form onSubmit={submit} className="space-y-2 text-left">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">Email</span>
              <Input type="email" placeholder="person@example.com" value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null) }} required autoFocus />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">Name</span>
                <Input placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">Role</span>
                <select className={selectCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="member">User</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">Username</span>
              <Input placeholder="Optional" value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full justify-center" disabled={busy || !email.trim()}>
              {busy && <Spinner className="size-4" />} Create &amp; get link
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}

// ─── Edit-user popover — anchored dropdown ──────────────────────────────────────

function EditUserPopover({ user, rect, me, onClose, onSaved }: {
  user: ManagedUser; rect: DOMRect; me: AuthUser | null; onClose: () => void; onSaved: () => void
}) {
  const [email, setEmail] = useState(user.email)
  const [name, setName] = useState(user.name ?? '')
  const [username, setUsername] = useState(user.username ?? '')
  const [role, setRole] = useState<Role>(user.role)
  const [perms, setPerms] = useState<Set<string>>(() => new Set(user.permissions ?? DEFAULT_USER_PAGES))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const isSelf = me?.id === user.id

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!card.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const toggle = (key: string) => setPerms((p) => {
    const next = new Set(p)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const data: Parameters<typeof api.updateUser>[1] = {
        email: email.trim(), name: name.trim(), username: username.trim(),
      }
      if (!isSelf) {
        data.role = role
        if (role !== 'admin') data.permissions = Array.from(perms)
      }
      await api.updateUser(user.id, data)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const margin = 10
  const spaceBelow = window.innerHeight - rect.bottom - margin
  const spaceAbove = rect.top - margin
  const openBelow = spaceBelow >= 280 || spaceBelow >= spaceAbove
  const style: CSSProperties = {
    position: 'fixed',
    right: Math.max(8, window.innerWidth - rect.right),
    width: '16.5rem',
    maxHeight: Math.max(200, openBelow ? spaceBelow : spaceAbove),
    ...(openBelow ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
  }

  return createPortal(
    <div ref={card} style={style}
      className="animate-fade-in-up z-50 flex flex-col overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Edit user</h3>
        <button onClick={onClose} aria-label="Close" className="-mr-1 rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <form onSubmit={submit} className="space-y-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">Email</span>
          <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }} required autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Name</span>
            <Input placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Username</span>
            <Input placeholder="Optional" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
        </div>

        {!isSelf && (
          <div>
            <span className="mb-1 block text-xs font-medium text-foreground">Role</span>
            <div className="flex gap-1 rounded-lg bg-muted p-0.5">
              {(['member', 'admin'] as Role[]).map((r) => (
                <button key={r} type="button" onClick={() => setRole(r)}
                  className={cn('flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    role === r ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground')}>
                  {r === 'admin' ? 'Admin' : 'User'}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isSelf && role !== 'admin' && (
          <div>
            <span className="mb-1 block text-xs font-medium text-foreground">Page access</span>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-lg border border-border p-2">
              {PAGES.map((p) => (
                <label key={p.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
                  <input type="checkbox" checked={perms.has(p.key)} onChange={() => toggle(p.key)}
                    className="size-3.5 rounded accent-primary" />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {isSelf && <p className="text-[11px] text-muted-foreground">You can’t change your own role or access.</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2 pt-0.5">
          <Button type="button" variant="secondary" size="sm" className="flex-1 justify-center" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" className="flex-1 justify-center" disabled={busy || !email.trim()}>
            {busy && <Spinner className="size-4" />} Save
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

// ─── Small square icon button ───────────────────────────────────────────────────

function IconButton({ title, onClick, disabled, danger, children }: {
  title: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean; danger?: boolean; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-lg p-1.5 text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        danger ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-accent hover:text-primary',
      )}
    >
      {children}
    </button>
  )
}

// ─── Enrolment-link popup ───────────────────────────────────────────────────────

function EnrollLinkPopup({ info, onClose }: { info: { email: string; enroll: EnrollLink }; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  const url = `${window.location.origin}${info.enroll.path}`
  const expires = new Date(info.enroll.expires_at).toLocaleString()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked — the field is selectable as a fallback */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="animate-fade-in-up w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">User added — send them this link</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{info.email}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <ol className="mb-3 list-decimal space-y-1 pl-4 text-xs text-muted-foreground marker:text-muted-foreground">
          <li>Send this link to the user (it's one-time, valid until {expires}).</li>
          <li>They open it — the <span className="font-medium text-foreground">Set up sign-in</span> page appears.</li>
          <li>On that page they scan the QR with any authenticator app (Google Authenticator,
            Authy, Microsoft…) or type the key, then enter the 6-digit code.</li>
        </ol>

        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-border bg-accent px-3 py-2 font-mono text-[11px] text-foreground"
          />
          <Button type="button" variant="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          Tip: the QR to scan with an authenticator app is on the setup page the link opens — not here.
        </p>
      </div>
    </div>
  )
}
