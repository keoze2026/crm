import { Fragment, useState } from 'react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Badge, Button, Card, EmptyState, Input, PageLoader, Select } from '../components/ui'
import { todayRange } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { AuditFilters, AuditLog } from '../types'

const PAGE = 50

/** Admin-only audit trail: who did what, when. Rows expand to show the full change detail. */
export default function SystemLogs() {
  const [range, setRange] = useState<Range>(todayRange)
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
    <div>
      <PageHeader title="System Logs">
        <DateRangeControl value={range} onChange={resetAndSet(setRange)} />
        <Select value={action} onChange={(e) => resetAndSet(setAction)(e.target.value)} className="w-40">
          <option value="">All actions</option>
          {(actions.data ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <div className="w-full sm:w-52">
          <Input placeholder="Search user, action, path…" value={q}
            onChange={(e) => resetAndSet(setQ)(e.target.value)} />
        </div>
        <a href={api.auditExportUrl(filters)}>
          <Button variant="secondary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Download
          </Button>
        </a>
        <Button variant="danger" onClick={clearAll} disabled={busy || rows.length === 0}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
          Clear
        </Button>
      </PageHeader>

      <Card className="overflow-hidden">
        {logs.loading ? (
          <PageLoader label="Loading logs…" />
        ) : logs.error ? (
          <p className="py-10 text-center text-sm text-red-600">{logs.error}</p>
        ) : rows.length === 0 ? (
          <EmptyState message="No audit events match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-white/50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
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
          <div className="flex items-center justify-between border-t border-white/50 px-4 py-3 text-sm text-slate-500">
            <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={offset === 0}
                onClick={() => { setOffset((o) => Math.max(0, o - PAGE)); setExpanded(null) }}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={offset + PAGE >= total}
                onClick={() => { setOffset((o) => o + PAGE); setExpanded(null) }}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
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
        className={cxRow(open)}
      >
        <td className="px-4 py-2.5 text-slate-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={open ? 'rotate-90 transition-transform' : 'transition-transform'}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{fmtTime(row.created_at)}</td>
        <td className="px-4 py-2.5 font-medium text-slate-700">{row.user_email ?? '—'}</td>
        <td className="px-4 py-2.5"><span className="font-mono text-xs text-slate-700">{row.action}</span></td>
        <td className="px-4 py-2.5 text-slate-600">
          {row.entity_type ? `${row.entity_type}${row.entity_id != null ? ` #${row.entity_id}` : ''}` : '—'}
        </td>
        <td className="px-4 py-2.5">{status ? <Badge color={color}>{status}</Badge> : '—'}</td>
        <td className="px-4 py-2.5 text-right">
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            disabled={busy}
            title="Delete this entry"
            aria-label="Delete this entry"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-slate-50/60 px-6 py-4">
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
      <p className="text-sm text-slate-700">{summary}</p>

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
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Values</div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {entries.map(([k, v]) => (
                  <tr key={k} className="border-b border-slate-100 last:border-0">
                    <td className="w-40 px-3 py-1.5 font-medium text-slate-500">{k}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-700 break-all">{renderValue(v)}</td>
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
      <span className="shrink-0 text-slate-400">{label}:</span>
      <span className={mono ? 'font-mono text-xs text-slate-700 break-all' : 'text-slate-700'}>{value}</span>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const cxRow = (open: boolean) =>
  'cursor-pointer border-b border-white/30 last:border-0 transition-colors ' +
  (open ? 'bg-white/50' : 'hover:bg-white/40')

/** Entity slugs that read better with a space than a hyphen in the summary sentence. */
const ENTITY_NOUN: Record<string, string> = {
  'vendor-payment': 'vendor payment',
  'portal-expense': 'portal expense',
}

/** A human sentence describing what happened. */
function summarize(row: AuditLog): string {
  const who = row.user_email ?? 'Someone'
  const [entityRaw, verbRaw] = row.action.split('.')
  const entity = ENTITY_NOUN[entityRaw] ?? entityRaw
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
