import { useMemo, useState } from 'react'
import { api } from '../api/client'
import { PageHeader } from '../components/Layout'
import QueueLists from '../components/QueueLists'
import QueuesSheet from '../components/QueuesSheet'
import { Badge, Button, Card, CardHeader, DownloadIcon, EmptyState, Input, PageLoader, cx } from '../components/ui'
import { formatDate, formatDmy, num, today } from '../lib/format'
import { buildQueuesPdf } from '../lib/sheetPdf'
import { entryDay, entryTime, matches } from '../lib/queues'
import { useAsync } from '../lib/useAsync'
import type { QueueAssignment } from '../types'

/** How many past sheets the History section keeps — the newest four days, no further. */
const HISTORY_LIMIT = 4

/** One day's worth of keyed-in records — the "sheet" the History pager steps through. */
interface HistoryDay {
  day: string
  rows: QueueAssignment[]
  queues: number
}

export default function Queues() {
  const records = useAsync(() => api.queues(), [])
  const people = useAsync(() => api.staff(), [])
  const codes = useAsync(() => api.queueCodes(), [])

  const [search, setSearch] = useState('')

  const rows = useMemo(() => records.data ?? [], [records.data])

  // A record touches all three lists: the sheet, a name's "on sheet" marker and a queue's
  // usage count. Reload together so nothing on the page can go stale against the rest.
  const reloadAll = () => { records.reload(); people.reload(); codes.reload() }

  // Search matches a name or a single queue code, so "Q04" finds everyone on that queue.
  const query = search.trim()
  const shown = useMemo(() => {
    const all = rows.map((row, i) => ({ index: i + 1, row }))
    if (query === '') return all
    return all.filter(({ row }) =>
      matches(row.name, query) || row.codes.some((c) => matches(c.code, query)),
    )
  }, [rows, query])

  // History: records grouped by the day they were keyed in, newest first, capped.
  const history = useMemo<HistoryDay[]>(() => {
    const byDay = new Map<string, QueueAssignment[]>()
    for (const row of rows) {
      const day = entryDay(row.created_at)
      const list = byDay.get(day)
      if (list) list.push(row)
      else byDay.set(day, [row])
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, HISTORY_LIMIT)
      .map(([day, dayRows]) => ({
        day,
        rows: dayRows,
        queues: dayRows.reduce((s, r) => s + r.codes.length, 0),
      }))
  }, [rows])

  const loading = records.loading || people.loading || codes.loading
  const error = records.error ?? people.error ?? codes.error

  return (
    <div className="min-w-0">
      <PageHeader title="Queues" subtitle="Who covers which queues">
        <div className="w-full sm:w-72">
          <Input
            value={search}
            placeholder="Search a name or queue code…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {/* Exports the saved sheet — the rows as filled in, without the entry row. */}
        <Button
          variant="secondary"
          disabled={rows.length === 0}
          onClick={() => buildQueuesPdf(rows).save(`Queues_${formatDmy(today())}.pdf`)}
        >
          <DownloadIcon />PDF
        </Button>
      </PageHeader>

      {loading ? (
        <PageLoader label="Loading queues…" />
      ) : (
        <>
          <QueueLists people={people.data ?? []} codes={codes.data ?? []} onChanged={reloadAll} />

          <Card className="mt-6">
            <CardHeader
              title="Queue Sheet"
              action={query !== '' && rows.length > 0 ? (
                <Badge color="blue">{`${num(shown.length)} of ${num(rows.length)}`}</Badge>
              ) : undefined}
            />
            <div className="p-4">
              {shown.length === 0 && query !== '' ? (
                <EmptyState message={`Nothing matches "${query}".`} />
              ) : (
                <QueuesSheet
                  rows={shown}
                  people={people.data ?? []}
                  codes={codes.data ?? []}
                  filtered={query !== ''}
                  onChanged={reloadAll}
                />
              )}
            </div>
          </Card>

          <History days={history} />
        </>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  )
}

// ─── History ──────────────────────────────────────────────────────────────────

/**
 * Past sheets, one day at a time: a collapsed section that opens onto a single day with
 * Back / Next stepping through the last four. Records carry no reporting date, so a "day"
 * here is the day its records were keyed in.
 */
function History({ days }: { days: HistoryDay[] }) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  // A new day can appear while the section is open; keep the cursor in range.
  const at = Math.min(index, Math.max(days.length - 1, 0))
  const day = days[at] ?? null

  return (
    <Card className="mt-6">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-white/60"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={cx('shrink-0 text-slate-600 transition-transform', open && 'rotate-90')}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <h3 className="font-semibold text-slate-900">History</h3>
          <Badge>{days.length === 0 ? 'empty' : `last ${days.length}`}</Badge>
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/50 p-4">
          {day === null ? (
            <EmptyState message="No history yet." />
          ) : (
            <>
              {/* Pager: Back steps further into the past, Next comes forward again. */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <PagerButton onClick={() => setIndex(at + 1)} disabled={at >= days.length - 1} side="back" />
                  <PagerButton onClick={() => setIndex(at - 1)} disabled={at <= 0} side="next" />
                  <select
                    value={day.day}
                    onChange={(e) => setIndex(days.findIndex((d) => d.day === e.target.value))}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900 focus:border-[#1a3654] focus:outline-none focus:ring-2 focus:ring-[#1a3654]/25"
                  >
                    {days.map((d) => (
                      <option key={d.day} value={d.day}>{formatDate(d.day)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {at + 1} of {days.length}
                  </span>
                  <Badge>{`${num(day.rows.length)} entr${day.rows.length === 1 ? 'y' : 'ies'}`}</Badge>
                  <Badge color="blue">{`${num(day.queues)} queues`}</Badge>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white shadow-sm">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600">
                      <th className="px-2 py-1.5">Name</th>
                      <th className="px-2 py-1.5">Queues</th>
                      <th className="px-2 py-1.5 text-center">Total</th>
                      <th className="px-2 py-1.5 text-right">Keyed in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.rows.map((row) => {
                      const edited = entryDay(row.updated_at) !== entryDay(row.created_at)
                      return (
                        <tr key={row.id} className="border-t border-slate-200 align-top">
                          <td className="px-2 py-1 font-semibold text-slate-900">{row.name}</td>
                          <td className="px-2 py-1">
                            {row.codes.length === 0 ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-0.5">
                                {row.codes.map((c) => (
                                  <span key={c.id} className="rounded border border-blue-300 bg-blue-50 px-1 text-[10px] font-bold leading-4 text-[#1d4ed8]">
                                    {c.code}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1 text-center font-bold tabular-nums text-slate-900">{row.codes.length}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right text-[11px] font-medium text-slate-600">
                            {entryTime(row.created_at)}
                            {edited && (
                              <span className="ml-1.5 text-amber-700">· edited {formatDate(entryDay(row.updated_at))}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

function PagerButton({ onClick, disabled, side }: { onClick: () => void; disabled: boolean; side: 'back' | 'next' }) {
  const back = side === 'back'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-800 transition-colors hover:border-[#1a3654] hover:bg-[#1a3654] hover:text-white disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50"
    >
      {back && <Chevron dir="left" />}
      {back ? 'Back' : 'Next'}
      {!back && <Chevron dir="right" />}
    </button>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  )
}
