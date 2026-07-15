import { Fragment, useState } from 'react'
import { ScrollText, Download, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import DashboardPageLayout from '@/components/dashboard/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useAsync } from '../lib/useAsync'
import type { AuditFilters, AuditLog } from '../types'

const PAGE = 50

const selectCls =
  'rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

type BadgeVariant = 'secondary' | 'outline-success' | 'outline-warning' | 'outline-destructive'
const STATUS_VARIANT: Record<'red' | 'amber' | 'green' | 'slate', BadgeVariant> = {
  red: 'outline-destructive', amber: 'outline-warning', green: 'outline-success', slate: 'secondary',
}

/** Admin-only audit trail: who did what, when. Rows expand to show the full change detail. */
export default function SystemLogs() {
  const [range, setRange] = useState<Range>({ from: '', to: '' })
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const filters: AuditFilters = {
    from: range.from || undefined,
    to: range.to || undefined,
    action: action || undefined,
    q: q || undefined,
  }

  const actions = useAsync(() => api.auditActions(), [])
  const logs = useAsync(
    () => api.auditLogs({ ...filters, limit: PAGE, offset }),
    [range.from, range.to, action, q, offset],
  )

  const data = logs.data
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const resetAndSet = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setOffset(0); setExpanded(null) }

  const deleteOne = async (id: number) => {
    if (!confirm('Delete this log entry? This cannot be undone.')) return
    setBusy(true)
    try { await api.deleteAuditLog(id); logs.reload() } finally { setBusy(false) }
  }

  const clearAll = async () => {
    const scoped = !!(filters.from || filters.to || filters.action || filters.q)
    const msg = scoped
      ? 'Delete all logs matching the current filters? This cannot be undone.'
      : 'Delete ALL system logs? This cannot be undone.'
    if (!confirm(msg)) return
    setBusy(true)
    try { await api.clearAuditLogs(filters); setOffset(0); logs.reload() } finally { setBusy(false) }
  }

  return (
    <DashboardPageLayout header={{ title: 'System Logs', icon: ScrollText }}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-2">
        <DateRangeControl value={range} onChange={resetAndSet(setRange)} />
        <select value={action} onChange={(e) => resetAndSet(setAction)(e.target.value)} className={selectCls}>
          <option value="">All actions</option>
          {(actions.data ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <Input placeholder="Search user, action, path…" value={q}
          onChange={(e) => resetAndSet(setQ)(e.target.value)} className="w-full sm:w-52" />
        <div className="ml-auto flex gap-2">
          <a href={api.auditExportUrl(filters)}>
            <Button variant="secondary"><Download className="size-4" /> Download</Button>
          </a>
          <Button variant="destructive" onClick={clearAll} disabled={busy || rows.length === 0}>
            <Trash2 className="size-4" /> Clear
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-hidden p-0">
          {logs.loading ? (
            <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
          ) : logs.error ? (
            <p className="py-10 text-center text-sm text-destructive">{logs.error}</p>
          ) : rows.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground uppercase">No audit events match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 w-8"></th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Entity</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <LogRow
                      key={r.id}
                      row={r}
                      open={expanded === r.id}
                      onToggle={() => setExpanded((id) => (id === r.id ? null : r.id))}
                      onDelete={() => deleteOne(r.id)}
                      busy={busy}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
              <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={offset === 0}
                  onClick={() => { setOffset((o) => Math.max(0, o - PAGE)); setExpanded(null) }}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={offset + PAGE >= total}
                  onClick={() => { setOffset((o) => o + PAGE); setExpanded(null) }}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardPageLayout>
  )
}

function LogRow({ row, open, onToggle, onDelete, busy }: {
  row: AuditLog; open: boolean; onToggle: () => void; onDelete: () => void; busy: boolean
}) {
  const status = row.status_code ?? 0
  const color = status >= 500 ? 'red' : status >= 400 ? 'amber' : status >= 200 ? 'green' : 'slate'

  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className={'cursor-pointer border-b border-border last:border-0 transition-colors ' + (open ? 'bg-accent/60' : 'hover:bg-accent/50')}
      >
        <td className="px-4 py-2.5 text-muted-foreground">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={open ? 'rotate-90 transition-transform' : 'transition-transform'}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{fmtTime(row.created_at)}</td>
        <td className="px-4 py-2.5 font-medium text-foreground">{row.user_email ?? '—'}</td>
        <td className="px-4 py-2.5"><span className="font-mono text-xs text-foreground">{row.action}</span></td>
        <td className="px-4 py-2.5 text-muted-foreground">
          {row.entity_type ? `${row.entity_type}${row.entity_id != null ? ` #${row.entity_id}` : ''}` : '—'}
        </td>
        <td className="px-4 py-2.5">{status ? <Badge variant={STATUS_VARIANT[color]}>{status}</Badge> : '—'}</td>
        <td className="px-4 py-2.5 text-right">
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            disabled={busy}
            title="Delete this entry"
            aria-label="Delete this entry"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          >
            <Trash2 className="size-4" />
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-accent/40 px-6 py-4">
            <div className="animate-expand">
              <Detail row={row} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

/** Expanded panel: the change summary + every value that was submitted. */
function Detail({ row }: { row: AuditLog }) {
  const details = row.details ?? {}
  const entries = Object.entries(details)
  const summary = summarize(row)

  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground">{summary}</p>

      <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
        <Meta label="When" value={new Date(row.created_at).toLocaleString()} />
        <Meta label="User" value={row.user_email ?? '—'} />
        <Meta label="Request" value={`${row.method ?? ''} ${row.path ?? ''}`.trim() || '—'} mono />
        <Meta label="Status" value={row.status_code != null ? String(row.status_code) : '—'} />
        <Meta label="IP address" value={row.ip ?? '—'} mono />
        <Meta label="Entity" value={row.entity_type ? `${row.entity_type}${row.entity_id != null ? ` #${row.entity_id}` : ''}` : '—'} />
      </div>

      {entries.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Values</div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <tbody>
                {entries.map(([k, v]) => (
                  <tr key={k} className="border-b border-border last:border-0">
                    <td className="w-40 px-3 py-1.5 font-medium text-muted-foreground">{k}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-foreground break-all">{renderValue(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {row.user_agent && <Meta label="Device" value={row.user_agent} />}
    </div>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className={mono ? 'font-mono text-xs text-foreground break-all' : 'text-foreground'}>{value}</span>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A human sentence describing what happened. */
function summarize(row: AuditLog): string {
  const who = row.user_email ?? 'Someone'
  const [entity, verbRaw] = row.action.split('.')
  const verb = verbRaw ?? ''
  const target = row.entity_id != null ? `${entity} #${row.entity_id}` : entity
  const past: Record<string, string> = {
    create: 'created', update: 'updated', delete: 'deleted', deactivate: 'deactivated',
    login: 'signed in', logout: 'signed out', enrolled: 'set up their authenticator',
    login_failed: 'failed a sign-in', reset_totp: 'reset authenticator for',
  }
  const action = past[verb] ?? verb
  if (verb === 'login' || verb === 'logout' || verb === 'enrolled') return `${who} ${action}.`
  return `${who} ${action} ${target}.`
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  })
}
