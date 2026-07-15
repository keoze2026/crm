import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { num } from '../lib/format'
import type { Campaign, CampaignSource } from '../types'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/**
 * Compact "Edit source rates" control: a $ button that drops a small popover
 * anchored right below it (no full-screen modal). Lists each source with its live
 * rate, lets you retune rates or add a source, and saves in place.
 */
export function CampaignRatesPopover({ campaign, onSaved }: { campaign: Campaign; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 288 })

  // Anchor the dropdown just under the button, right-aligned, clamped to the viewport.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const margin = 8
    const width = Math.min(300, window.innerWidth - margin * 2)
    let left = r.right - width
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
    if (left < margin) left = margin
    setPos({ top: r.bottom + 6 + window.scrollY, left: left + window.scrollX, width })
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (document.querySelector('[data-rates-popover]')?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={wrapRef} className="inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Edit source rates"
        className={cn('rounded p-1', open ? 'bg-primary text-primary-foreground' : 'text-warning hover:bg-warning/10')}
      >
        <RatesIcon />
      </button>
      {open && createPortal(
        <RatesDropdown campaign={campaign} pos={pos} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved() }} />,
        document.body,
      )}
    </div>
  )
}

function RatesDropdown({ campaign, pos, onClose, onSaved }: {
  campaign: Campaign; pos: { top: number; left: number; width: number }; onClose: () => void; onSaved: () => void
}) {
  const [sources, setSources] = useState<CampaignSource[] | null>(null)
  const [rates, setRates] = useState<Record<number, string>>({})
  const [newRows, setNewRows] = useState<{ name: string; rate: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.campaignSources(campaign.id)
      .then((d) => { if (alive) setSources(d) })
      .catch((e) => { if (alive) setError((e as Error).message) })
    return () => { alive = false }
  }, [campaign.id])

  const list = sources ?? []
  const rateValue = (s: CampaignSource) =>
    s.destination_id != null && rates[s.destination_id] !== undefined ? rates[s.destination_id] : String(s.rate)
  const addRow = () => setNewRows((r) => [...r, { name: '', rate: '' }])
  const patchRow = (i: number, patch: Partial<{ name: string; rate: string }>) =>
    setNewRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  const removeRow = (i: number) => setNewRows((r) => r.filter((_, j) => j !== i))

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const changed = list.filter(
        (s) => s.destination_id != null && rates[s.destination_id] !== undefined && Number(rates[s.destination_id]) !== s.rate,
      )
      for (const s of changed) await api.updateDestination(s.destination_id!, { rate: Number(rates[s.destination_id!]) || 0 })
      for (const r of newRows.filter((r) => r.name.trim() !== '')) {
        await api.createDestination({ name: r.name.trim(), rate: Number(r.rate) || 0, campaign_id: campaign.id })
      }
      onSaved()
    } catch (err) { setError((err as Error).message) } finally { setSaving(false) }
  }

  const rateCls = 'w-16 rounded border border-input bg-transparent px-1.5 py-0.5 text-right text-xs tabular-nums text-foreground focus:border-ring focus:outline-none'

  return (
    <div
      data-rates-popover
      style={{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
      className="overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="flex items-center justify-between bg-primary px-2.5 py-1.5 text-primary-foreground">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide">Rates — {campaign.code}</span>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-primary-foreground/80 hover:bg-white/20 hover:text-primary-foreground">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto px-2 py-1.5">
        {sources === null ? (
          <div className="flex justify-center py-4"><Spinner className="size-4" /></div>
        ) : list.length === 0 && newRows.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-muted-foreground">No sources yet — add one below.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {list.map((s) => (
              <div key={s.name} className="flex items-center gap-2 border-b border-border py-0.5 last:border-0">
                <span className="flex-1 truncate text-xs font-medium text-foreground" title={s.name}>{s.name}</span>
                <span className="tabular-nums text-[10px] text-muted-foreground" title="Calls">{num(s.counted)}</span>
                <input
                  type="number" min="0" step="0.01" value={rateValue(s)} disabled={s.destination_id == null}
                  onChange={(e) => s.destination_id != null && setRates((r) => ({ ...r, [s.destination_id!]: e.target.value }))}
                  className={rateCls}
                />
              </div>
            ))}
            {newRows.map((row, i) => (
              <div key={`new-${i}`} className="flex items-center gap-2 py-0.5">
                <input
                  placeholder="New source" value={row.name} onChange={(e) => patchRow(i, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-input bg-transparent px-1.5 py-0.5 text-xs text-foreground focus:border-ring focus:outline-none"
                />
                <input
                  type="number" min="0" step="0.01" placeholder="0.00" value={row.rate} onChange={(e) => patchRow(i, { rate: e.target.value })}
                  className={rateCls}
                />
                <button type="button" onClick={() => removeRow(i)} title="Remove" className="rounded p-0.5 text-muted-foreground hover:text-destructive">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
        <button type="button" onClick={addRow} className="text-[11px] font-medium text-primary hover:underline">+ Source</button>
        <button
          type="button" onClick={save} disabled={saving}
          className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving && <Spinner className="size-3" />}Save
        </button>
      </div>
    </div>
  )
}

const RatesIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
