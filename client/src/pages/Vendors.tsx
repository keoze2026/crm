import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import VendorSheet from '../components/VendorSheet'
import { Button, Card, CardHeader, EmptyState, PageLoader, Spinner, cx } from '../components/ui'
import { today } from '../lib/format'
import { useAsync } from '../lib/useAsync'

/** Default range: 1st of the current month → today. */
function defaultRange(): Range {
  return { from: `${today().slice(0, 7)}-01`, to: today() }
}

export default function Vendors() {
  // One top-level filter for every vendor tab — changing it re-queries the active tab live.
  const [range, setRange] = useState<Range>(defaultRange)
  const vendors = useAsync(() => api.vendors(), [])
  const list = vendors.data ?? []

  // The selected tab is the user's explicit pick; `active` derives from it with a fallback
  // to the first vendor, so it stays valid as the list loads/changes without a sync effect.
  const [selected, setSelected] = useState<string | null>(null)
  const active = list.find((v) => v.name === selected) ?? list[0] ?? null
  // Anchor rect for the compact add-vendor dropdown (null = closed).
  const [addRect, setAddRect] = useState<DOMRect | null>(null)

  const removeVendor = async () => {
    if (!active?.id || !active.is_manual) return
    if (!confirm(`Remove vendor "${active.name}" and all its entries?`)) return
    try {
      await api.deleteVendor(active.id)
      setSelected(null)
      vendors.reload()
    } catch (err) { alert((err as Error).message) }
  }

  return (
    <div>
      <PageHeader title="Vendors" subtitle="Per traffic-source payment sheets — converted calls, payments and dues">
        <DateRangeControl value={range} onChange={setRange} />
      </PageHeader>

      {vendors.loading ? (
        <PageLoader label="Loading vendors…" />
      ) : (
        <>
          {/* Tab strip — one tab per traffic source, plus the "+" to add a manual vendor. */}
          <div className="mb-5 flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl bg-linear-to-b from-[#131b31] to-[#0d1424] p-1 shadow-lg shadow-slate-900/25 ring-1 ring-white/10">
            {list.map((v) => (
              <button
                key={v.name}
                onClick={() => setSelected(v.name)}
                className={cx(
                  'flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-1.5 text-sm font-medium transition-all',
                  v.name === active?.name ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white',
                )}
              >
                {v.name}
                {v.is_manual && (
                  <span className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    v.name === active?.name ? 'bg-blue-100 text-blue-700' : 'bg-white/10 text-slate-300')}>
                    manual
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={(e) => setAddRect(e.currentTarget.getBoundingClientRect())}
              title="Add a vendor not in Campaigns"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          {active ? (
            <Card>
              <CardHeader
                title={active.name}
                subtitle={active.is_manual ? 'Manually-added vendor' : 'Traffic source from Campaigns'}
                action={active.is_manual && active.id ? (
                  <Button variant="danger" size="sm" onClick={removeVendor}>Remove vendor</Button>
                ) : undefined}
              />
              <div className="p-4">
                {/* Remount the whole sheet on tab change so its edit state starts clean. */}
                <VendorSheet key={active.name} vendor={active} range={range} onVendorChanged={() => vendors.reload()} />
              </div>
            </Card>
          ) : (
            <Card>
              <div className="p-4">
                <EmptyState message="No traffic sources yet — press the + on the tab bar to add a vendor." />
              </div>
            </Card>
          )}
        </>
      )}

      {vendors.error && <p className="mt-4 text-sm text-red-600">{vendors.error}</p>}

      {/* Compact dropdown anchored under the + button; mounted only while open. */}
      {addRect && (
        <AddVendorPopover
          rect={addRect}
          existing={list.map((v) => v.name)}
          onClose={() => setAddRect(null)}
          onAdded={(name) => { setAddRect(null); setSelected(name); vendors.reload() }}
        />
      )}
    </div>
  )
}

// ── Add-vendor dropdown — compact, anchored under the + (mirrors the Users page) ──
function AddVendorPopover({
  rect, existing, onClose, onAdded,
}: { rect: DOMRect; existing: string[]; onClose: () => void; onAdded: (name: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!card.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') return
    if (existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      setError('A vendor with that name already exists.')
      return
    }
    setBusy(true); setError(null)
    try {
      await api.createVendor(trimmed)
      onAdded(trimmed)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Anchor under the button, clamped to stay within the viewport.
  const width = 216
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  const style: React.CSSProperties = { position: 'fixed', top: rect.bottom + 6, left, width }

  return createPortal(
    <div ref={card} style={style}
      className="glass-strong animate-fade-in-up z-50 rounded-xs border border-white/50 p-2.5 shadow-2xl shadow-slate-900/20">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1a3654]">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3h18v4H3z" /><path d="M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7" /><path d="M9 11h6" />
        </svg>
        Add vendor
      </div>
      <form onSubmit={submit} className="space-y-1.5">
        <input
          value={name} placeholder="Vendor name" autoFocus
          onChange={(e) => { setName(e.target.value); setError(null) }}
          className="glass-input w-full rounded-xs border border-white/70 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1a3654] focus:outline-none focus:ring-2 focus:ring-[#1a3654]/25"
        />
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <button
          type="submit" disabled={busy || name.trim() === ''}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xs bg-[#1a3654] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#24466b] focus:outline-none focus:ring-2 focus:ring-[#1a3654]/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <Spinner className="h-4 w-4 text-white" />}Add vendor
        </button>
      </form>
    </div>,
    document.body,
  )
}
