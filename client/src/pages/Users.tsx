import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DEFAULT_USER_PAGES, PAGES } from '../auth/pages'
import { PageHeader } from '../components/Layout'
import { Badge, Button, Card, EmptyState, Input, PageLoader, SegmentedTabs, Select, Spinner, StatTile, cx } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import type { AccessPreset, AuthUser, EnrollLink, ManagedUser, Role } from '../types'

/** Add-user / Save buttons share the accent green so primary actions read consistently. */
const GREEN = '#34eb92'
const greenBtn: CSSProperties = { backgroundImage: 'none', backgroundColor: GREEN, color: '#0f172a' }

type Filter = 'all' | 'admin' | 'user' | 'pending'

/** What the account logs in with — email when it has one, otherwise its username. */
function identifierOf(u: ManagedUser): string {
  return u.email ?? u.username ?? `user #${u.id}`
}

/** Best human name for the account, for headings and the avatar initial. */
function displayNameOf(u: ManagedUser): string {
  return u.name ?? identifierOf(u)
}

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
  const presets = useAsync(() => api.accessPresets(), [])
  const [addOpen, setAddOpen] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [link, setLink] = useState<{ label: string; enroll: EnrollLink } | null>(null)
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

  // How many accounts follow each preset — shown in the manager so an edit's reach is clear.
  const presetMemberCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const u of users) {
      if (u.preset_id != null) counts.set(u.preset_id, (counts.get(u.preset_id) ?? 0) + 1)
    }
    return counts
  }, [users])

  const shown = useMemo(() => users.filter((u) => {
    if (filter === 'admin') return u.role === 'admin'
    if (filter === 'user') return u.role !== 'admin'
    if (filter === 'pending') return u.is_active && !u.totp_enabled
    return true
  }), [users, filter])

  const resetTotp = async (u: ManagedUser) => {
    if (!confirm(`Reset ${identifierOf(u)}'s authenticator? Their current device stops working and they must re-enrol.`)) return
    setBusyId(u.id)
    try {
      const res = await api.resetUserTotp(u.id)
      setLink({ label: identifierOf(u), enroll: res.enroll })
      list.reload()
    } finally { setBusyId(null) }
  }

  const setActive = async (u: ManagedUser, is_active: boolean) => {
    if (!is_active && !confirm(`Deactivate ${identifierOf(u)}? They will be signed out and can no longer log in.`)) return
    setBusyId(u.id)
    try { await api.updateUser(u.id, { is_active }); list.reload() } finally { setBusyId(null) }
  }

  const remove = async (u: ManagedUser) => {
    if (!confirm(`Permanently delete ${identifierOf(u)}? This removes the account for good and cannot be undone.`)) return
    setBusyId(u.id)
    try { await api.deleteUser(u.id); list.reload() } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Users" subtitle="Create accounts and manage access">
        <Button variant="secondary" onClick={() => setPresetsOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M4 12h16M4 18h10" /><circle cx="19" cy="18" r="2" />
          </svg>
          Access presets
        </Button>
        <AddUser
          open={addOpen}
          onToggle={() => setAddOpen((o) => !o)}
          onClose={() => setAddOpen(false)}
          presets={presets.data ?? []}
          takenStaffIds={new Set(users.map((u) => u.staff_id).filter((id): id is number => id != null))}
          onCreated={(label, enroll) => { setAddOpen(false); setLink({ label, enroll }); list.reload() }}
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
          <PageLoader label="Loading users…" />
        ) : list.error ? (
          <p className="py-10 text-center text-sm text-red-600">{list.error}</p>
        ) : shown.length === 0 ? (
          <EmptyState message={users.length === 0 ? 'No users yet. Add your first user to get started.' : 'No users match this filter.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-white/50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Access</th>
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
                          {displayNameOf(u).charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{displayNameOf(u)}</div>
                          {u.name && (
                            <div className="truncate text-xs text-slate-400">
                              {identifierOf(u)}
                              {u.staff_id != null && <span className="ml-1 text-slate-300">· staff</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge color={u.role === 'admin' ? 'blue' : 'slate'}>{u.role === 'admin' ? 'Admin' : 'User'}</Badge>
                    </td>
                    <td className="px-5 py-3"><AccessCell user={u} /></td>
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
          presets={presets.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); list.reload() }}
        />
      )}
      {presetsOpen && (
        <AccessPresetsModal
          presets={presets.data ?? []}
          memberCounts={presetMemberCounts}
          loading={presets.loading}
          // Editing a preset changes its members' effective access, so the table reloads too.
          onChanged={() => { presets.reload(); list.reload() }}
          onClose={() => setPresetsOpen(false)}
        />
      )}
      {link && <EnrollLinkPopup info={link} onClose={() => setLink(null)} />}
    </div>
  )
}

// ─── Access summary ─────────────────────────────────────────────────────────────

/**
 * What this user can actually open. Admins always see everything; for a member it shows
 * the count and, in amber, any page a *default* member would have but they don't.
 *
 * That amber line is the one that matters after a page is added to the app: a member whose
 * access was customised earlier keeps the exact list they were saved with, so a new page
 * (Queues, Review, …) stays switched off for them until an admin ticks it here.
 */
function AccessCell({ user }: { user: ManagedUser }) {
  if (user.role === 'admin') return <Badge color="blue">All pages</Badge>

  const perms = user.permissions ?? DEFAULT_USER_PAGES
  const granted = PAGES.filter((p) => perms.includes(p.key))
  const missing = DEFAULT_USER_PAGES
    .filter((key) => !perms.includes(key))
    .map((key) => PAGES.find((p) => p.key === key)?.label ?? key)

  return (
    <div className="leading-tight">
      <span className="text-xs font-medium text-slate-600" title={granted.map((p) => p.label).join(', ') || 'No pages'}>
        {granted.length} of {PAGES.length} pages
      </span>
      {user.preset_name && (
        <div className="text-[11px] font-medium text-blue-700" title="Follows this preset — editing it changes their access">
          via {user.preset_name}
        </div>
      )}
      {missing.length > 0 && (
        <div className="text-[11px] font-medium text-amber-700" title={`Not granted: ${missing.join(', ')}`}>
          off: {missing.slice(0, 2).join(', ')}{missing.length > 2 ? ` +${missing.length - 2}` : ''}
        </div>
      )}
    </div>
  )
}

// ─── Add-user button + dropdown (anchored under the button, no screen overlay) ──

/** How the new account is identified. Each mode produces a different required field. */
type AddMode = 'email' | 'staff' | 'username'

const ADD_MODES: { id: AddMode; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'staff', label: 'Staff' },
  { id: 'username', label: 'Username' },
]

function AddUser({ open, onToggle, onClose, onCreated, takenStaffIds, presets }: {
  open: boolean; onToggle: () => void; onClose: () => void
  /** Staff who already have an account — offered but not selectable. */
  takenStaffIds: Set<number>
  /** Named page bundles the admin can apply instead of ticking boxes afterwards. */
  presets: AccessPreset[]
  onCreated: (label: string, enroll: EnrollLink) => void
}) {
  const [mode, setMode] = useState<AddMode>('email')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [staffId, setStaffId] = useState('')
  const [presetId, setPresetId] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // The roster is only needed once the picker is actually on screen.
  const staff = useAsync(() => (open ? api.staff() : Promise.resolve([])), [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  // Whatever identifies the account in this mode — also what the "created" popup is titled.
  const identifier = mode === 'email' ? email.trim()
    : mode === 'username' ? username.trim()
    : staffId

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await api.createUser({
        // Only send the field this mode collects; the server needs one of email/username/staff.
        email: mode === 'email' ? email.trim() : undefined,
        username: mode === 'username' ? username.trim() : undefined,
        staff_id: mode === 'staff' ? Number(staffId) : undefined,
        preset_id: presetId ? Number(presetId) : undefined,
        name: name.trim() || undefined,
        role,
      })
      onCreated(res.email ?? res.username ?? res.name ?? `user #${res.id}`, res.enroll)
      setEmail(''); setName(''); setUsername(''); setStaffId(''); setPresetId(''); setRole('member')
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
        <div className="animate-fade-in-up absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/15">
          <form onSubmit={submit} className="space-y-2">
            <SegmentedTabs
              tabs={ADD_MODES}
              value={mode}
              onChange={(m) => { setMode(m); setError(null) }}
              className="w-full"
            />

            {mode === 'email' && (
              <Input label="Email" type="email" placeholder="person@example.com" value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null) }} required autoFocus />
            )}

            {mode === 'staff' && (
              <Select label="Staff member" value={staffId} required
                onChange={(e) => { setStaffId(e.target.value); setError(null) }}>
                <option value="">
                  {staff.loading ? 'Loading roster…' : 'Select someone…'}
                </option>
                {(staff.data ?? []).map((s) => (
                  <option key={s.id} value={s.id} disabled={takenStaffIds.has(s.id)}>
                    {s.name}{takenStaffIds.has(s.id) ? ' — has an account' : ''}
                  </option>
                ))}
              </Select>
            )}

            {mode === 'username' && (
              <Input label="Username" placeholder="e.g. ada.lovelace" value={username}
                onChange={(e) => { setUsername(e.target.value); setError(null) }} required autoFocus />
            )}

            <div className="grid grid-cols-2 gap-2">
              <Input label="Name" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} />
              <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">User</option>
                <option value="admin">Admin</option>
              </Select>
            </div>

            {/* Admins see every page regardless, so the preset would be ignored for them. */}
            {role !== 'admin' && (
              <Select label="Access preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                <option value="">Default access ({DEFAULT_USER_PAGES.length} pages)</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.pages.length} pages)</option>
                ))}
              </Select>
            )}

            <p className="text-[11px] leading-snug text-slate-400">
              {mode === 'email' ? 'They sign in with this email and an authenticator code.'
                : mode === 'staff' ? 'Their name comes from the roster; a username is generated for signing in.'
                : 'They sign in with this username and an authenticator code — no email needed.'}
              {role !== 'admin' && presetId && ' They follow this preset — pages added to it later reach them too.'}
            </p>

            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button type="submit" className="w-full justify-center hover:brightness-95" style={greenBtn} disabled={busy || !identifier}>
              {busy && <Spinner className="h-4 w-4 text-slate-800" />} Create &amp; get link
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}

// ─── Access presets — named page bundles reused across new accounts ─────────────

/**
 * Manage the named presets accounts can be attached to. Editing one here is a LIVE change:
 * every user on that preset gains or loses those pages the next time they load the app, so
 * the member count is shown next to each preset before you change it.
 */
function AccessPresetsModal({ presets, memberCounts, loading, onChanged, onClose }: {
  presets: AccessPreset[]
  /** How many accounts follow each preset, so an edit's blast radius is visible. */
  memberCounts: Map<number, number>
  loading: boolean; onChanged: () => void; onClose: () => void
}) {
  // Which row is open in the editor: a preset id, 'new', or nothing.
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = async (p: AccessPreset) => {
    const n = memberCounts.get(p.id) ?? 0
    const who = n === 0 ? 'No accounts use it.'
      : `${n} account${n === 1 ? '' : 's'} follow${n === 1 ? 's' : ''} it — ${n === 1 ? 'it keeps' : 'they keep'} these pages as their own.`
    if (!confirm(`Delete the "${p.name}" preset? ${who}`)) return
    setBusyId(p.id); setError(null)
    try { await api.deleteAccessPreset(p.id); onChanged() }
    catch (err) { setError((err as Error).message) }
    finally { setBusyId(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4" onClick={onClose}>
      <div
        className="animate-fade-in-up flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/25"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Access presets</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Shared page bundles. Editing one changes access for everyone on it — they see it
              after a refresh.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {error && <p className="text-xs text-red-600">{error}</p>}

          {editing === 'new' ? (
            <PresetEditor
              onCancel={() => setEditing(null)}
              onSave={async (name, pages) => { await api.createAccessPreset({ name, pages }); setEditing(null); onChanged() }}
            />
          ) : (
            <Button variant="secondary" size="sm" className="w-full justify-center" onClick={() => setEditing('new')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              New preset
            </Button>
          )}

          {loading ? (
            <PageLoader label="Loading presets…" />
          ) : presets.length === 0 && editing !== 'new' ? (
            <EmptyState message="No presets yet. Create one to reuse a set of pages." />
          ) : (
            presets.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 p-2.5">
                {editing === p.id ? (
                  <PresetEditor
                    preset={p}
                    onCancel={() => setEditing(null)}
                    onSave={async (name, pages) => { await api.updateAccessPreset(p.id, { name, pages }); setEditing(null); onChanged() }}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{p.name}</div>
                      <div className="truncate text-xs text-slate-400"
                        title={p.pages.map((k) => PAGES.find((x) => x.key === k)?.label ?? k).join(', ')}>
                        {p.pages.length === 0 ? 'No pages' : `${p.pages.length} of ${PAGES.length} pages`}
                        {(() => {
                          const n = memberCounts.get(p.id) ?? 0
                          return n > 0 ? ` · ${n} user${n === 1 ? '' : 's'}` : ' · unused'
                        })()}
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(p.id)}>Edit</Button>
                    <IconButton title="Delete preset" danger disabled={busyId === p.id} onClick={() => remove(p)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    </IconButton>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/** Name + page tick boxes, shared by the "new preset" and "edit preset" rows. */
function PresetEditor({ preset, onSave, onCancel }: {
  preset?: AccessPreset
  onSave: (name: string, pages: string[]) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(preset?.name ?? '')
  const [pages, setPages] = useState<Set<string>>(() => new Set(preset?.pages ?? DEFAULT_USER_PAGES))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (key: string) => setPages((p) => {
    const next = new Set(p)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await onSave(name.trim(), Array.from(pages)) }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Input label="Preset name" placeholder="e.g. Agent" value={name}
        onChange={(e) => { setName(e.target.value); setError(null) }} required autoFocus />

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-700">
            Pages <span className="text-slate-400">({pages.size}/{PAGES.length})</span>
          </span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPages(new Set(PAGES.map((p) => p.key)))}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">All</button>
            <button type="button" onClick={() => setPages(new Set(DEFAULT_USER_PAGES))} title="The pages a new user gets"
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">Default</button>
            <button type="button" onClick={() => setPages(new Set())}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">None</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-lg border border-slate-200 p-2">
          {PAGES.map((p) => (
            <label key={p.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" checked={pages.has(p.key)} onChange={() => toggle(p.key)}
                className="h-3.5 w-3.5 rounded" style={{ accentColor: GREEN }} />
              {p.label}
            </label>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" className="flex-1 justify-center" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" className="flex-1 justify-center hover:brightness-95" style={greenBtn} disabled={busy || !name.trim()}>
          {busy && <Spinner className="h-4 w-4 text-slate-800" />} {preset ? 'Save' : 'Create'}
        </Button>
      </div>
    </form>
  )
}

// ─── Edit-user popover — anchored dropdown, no page overlay/blur ────────────────

function EditUserPopover({ user, rect, me, presets, onClose, onSaved }: {
  user: ManagedUser; rect: DOMRect; me: AuthUser | null; presets: AccessPreset[]
  onClose: () => void; onSaved: () => void
}) {
  const [email, setEmail] = useState(user.email ?? '')
  const [name, setName] = useState(user.name ?? '')
  const [username, setUsername] = useState(user.username ?? '')
  const [role, setRole] = useState<Role>(user.role)
  const [presetId, setPresetId] = useState(user.preset_id ? String(user.preset_id) : '')
  // Their own list — what the boxes fall back to when detached from a preset.
  const [perms, setPerms] = useState<Set<string>>(() => new Set(user.own_permissions ?? user.permissions ?? DEFAULT_USER_PAGES))
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
        if (role !== 'admin') {
          // Attached to a preset => send only that; the preset supplies the pages. Otherwise
          // send the tick boxes, which also detaches them from any preset they were on.
          if (presetId) data.preset_id = Number(presetId)
          else { data.preset_id = null; data.permissions = Array.from(perms) }
        }
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
        {/* Not `required`: an account may be identified by username alone. The submit button
            enforces that at least one of the two survives the edit. */}
        <Input label="Email" type="email" placeholder="Optional if a username is set" value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null) }} autoFocus />
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
          <Select label="Access preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            <option value="">Custom — set below</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.pages.length} pages)</option>
            ))}
          </Select>
        )}

        {!isSelf && role !== 'admin' && presetId && (
          <p className="rounded-lg bg-blue-50 px-2 py-1.5 text-[11px] leading-snug text-blue-800">
            Access follows this preset. Change the preset and it changes here too — switch to
            <span className="font-medium"> Custom</span> to give this account its own pages.
          </p>
        )}

        {!isSelf && role !== 'admin' && !presetId && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-700">
                Page access <span className="text-slate-400">({perms.size}/{PAGES.length})</span>
              </span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPerms(new Set(PAGES.map((p) => p.key)))}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">
                  All
                </button>
                <button type="button" onClick={() => setPerms(new Set(DEFAULT_USER_PAGES))}
                  title="The pages a new user gets"
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">
                  Default
                </button>
                <button type="button" onClick={() => setPerms(new Set())}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">
                  None
                </button>
              </div>
            </div>
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
          <Button type="submit" size="sm" className="flex-1 justify-center hover:brightness-95" style={greenBtn}
            disabled={busy || (!email.trim() && !username.trim())}>
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

function EnrollLinkPopup({ info, onClose }: { info: { label: string; enroll: EnrollLink }; onClose: () => void }) {
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
        className="animate-fade-in-up w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/25"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">User added — send them this link</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">{info.label}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <ol className="mb-3 list-decimal space-y-1 pl-4 text-xs text-slate-600 marker:text-slate-400">
          <li>Send this link to the user (it's one-time, valid until {expires}).</li>
          <li>They open it — the <span className="font-medium">Set up sign-in</span> page appears.</li>
          <li>On that page they scan the QR with any authenticator app (Google Authenticator,
            Authy, Microsoft…) or type the key, then enter the 6-digit code.</li>
        </ol>

        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700"
          />
          <Button type="button" variant="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>

        <p className="mt-2 text-[11px] text-slate-400">
          Tip: the QR to scan with an authenticator app is on the setup page the link opens — not here.
        </p>
      </div>
    </div>
  )
}
