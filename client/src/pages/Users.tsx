import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DEFAULT_USER_PAGES, PAGES } from '../auth/pages'
import { PageHeader } from '../components/Layout'
import { Badge, Button, Card, EmptyState, Input, SegmentedTabs, Select, Spinner, StatTile, cx } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import type { AuthUser, EnrollLink, ManagedUser, Role } from '../types'

/** Add-user / Save buttons share the accent green so primary actions read consistently. */
const GREEN = '#34eb92'
const greenBtn: CSSProperties = { backgroundImage: 'none', backgroundColor: GREEN, color: '#0f172a' }

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
    <div className="space-y-6">
      <PageHeader title="Users" subtitle="Create accounts and manage access">
        <AddUser
          open={addOpen}
          onToggle={() => setAddOpen((o) => !o)}
          onClose={() => setAddOpen(false)}
          onCreated={(email, enroll) => { setAddOpen(false); setLink({ email, enroll }); list.reload() }}
        />
      </PageHeader>

      {/* Scorecards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total users" value={stats.total}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>} />
        <StatTile label="Active" value={stats.active} hint="Authenticator set up"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>} />
        <StatTile label="Pending setup" value={stats.pending} hint="Awaiting enrolment"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>} />
        <StatTile label="Admins" value={stats.admins}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>} />
      </div>

      {/* Filter tabs */}
      <SegmentedTabs tabs={FILTERS} value={filter} onChange={setFilter} />

      <Card className="overflow-hidden">
        {list.loading ? (
          <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>
        ) : list.error ? (
          <p className="py-10 text-center text-sm text-red-600">{list.error}</p>
        ) : shown.length === 0 ? (
          <EmptyState message={users.length === 0 ? 'No users yet. Add your first user to get started.' : 'No users match this filter.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-white/50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Last sign-in</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id} className="border-b border-white/30 last:border-0 transition-colors hover:bg-white/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold text-blue-900">
                          {(u.name ?? u.email).charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{u.name ?? u.email}</div>
                          {u.name && <div className="truncate text-xs text-slate-400">{u.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge color={u.role === 'admin' ? 'blue' : 'slate'}>{u.role === 'admin' ? 'Admin' : 'User'}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      {!u.is_active ? <Badge color="red">Deactivated</Badge>
                        : u.totp_enabled ? <Badge color="green">Active</Badge>
                        : <Badge color="amber">Pending setup</Badge>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {u.is_active ? (
                          <>
                            <Button variant="secondary" size="sm" disabled={busyId === u.id}
                              onClick={() => resetTotp(u)}>
                              {u.totp_enabled ? 'Reset authenticator' : 'New link'}
                            </Button>
                            <Button variant="secondary" size="sm" disabled={busyId === u.id}
                              onClick={() => setActive(u, false)}>
                              Deactivate
                            </Button>
                          </>
                        ) : (
                          <Button variant="secondary" size="sm" disabled={busyId === u.id}
                            onClick={() => setActive(u, true)}>
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
    </div>
  )
}

// ─── Add-user button + dropdown (anchored under the button, no screen overlay) ──

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
      <Button onClick={onToggle} className="hover:brightness-95" style={greenBtn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Add user
      </Button>

      {open && (
        <div className="animate-fade-in-up absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/15">
          <form onSubmit={submit} className="space-y-2">
            <Input label="Email" type="email" placeholder="person@example.com" value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null) }} required autoFocus />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Name" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} />
              <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">User</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
            <Input label="Username" placeholder="Optional" value={username} onChange={(e) => setUsername(e.target.value)} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button type="submit" className="w-full justify-center hover:brightness-95" style={greenBtn} disabled={busy || !email.trim()}>
              {busy && <Spinner className="h-4 w-4 text-slate-800" />} Create &amp; get link
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}

// ─── Edit-user popover — anchored dropdown, no page overlay/blur ────────────────

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

  // Close on outside click / Escape only — NOT on scroll (scrolling inside the popover to
  // reach the checkboxes must not dismiss it).
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

  // Anchor to the button, but flip above and cap the height so the card never runs off-screen.
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
      className="animate-fade-in-up z-50 flex flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-900/20">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Edit user</h3>
        <button onClick={onClose} aria-label="Close" className="-mr-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <form onSubmit={submit} className="space-y-2">
        <Input label="Email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }} required autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Name" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Username" placeholder="Optional" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>

        {!isSelf && (
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-700">Role</span>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
              {(['member', 'admin'] as Role[]).map((r) => (
                <button key={r} type="button" onClick={() => setRole(r)}
                  className={cx('flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    role === r ? 'bg-white text-slate-900 shadow' : 'text-slate-500 hover:text-slate-700')}>
                  {r === 'admin' ? 'Admin' : 'User'}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isSelf && role !== 'admin' && (
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-700">Page access</span>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-lg border border-slate-200 p-2">
              {PAGES.map((p) => (
                <label key={p.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
                  <input type="checkbox" checked={perms.has(p.key)} onChange={() => toggle(p.key)}
                    className="h-3.5 w-3.5 rounded" style={{ accentColor: GREEN }} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {isSelf && <p className="text-[11px] text-slate-400">You can’t change your own role or access.</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2 pt-0.5">
          <Button type="button" variant="secondary" size="sm" className="flex-1 justify-center" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" className="flex-1 justify-center hover:brightness-95" style={greenBtn} disabled={busy || !email.trim()}>
            {busy && <Spinner className="h-4 w-4 text-slate-800" />} Save
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

// ─── Small square icon button (no fill / border by default) ─────────────────────

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
      className={
        'rounded-lg p-1.5 text-slate-400 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
        (danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-blue-900')
      }
    >
      {children}
    </button>
  )
}

// ─── Enrolment-link popup (compact, centred, no screen blur) ────────────────────

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4" onClick={onClose}>
      <div
        className="animate-fade-in-up w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/25"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Enrolment link ready</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">{info.email}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <QRCodeSVG value={url} size={150} />
          </div>
          <p className="text-center text-[11px] text-slate-400">Scan to open setup on a phone · valid until {expires}</p>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700"
          />
          <Button type="button" variant="secondary" onClick={copy}>{copied ? '✓' : 'Copy'}</Button>
        </div>
      </div>
    </div>
  )
}
