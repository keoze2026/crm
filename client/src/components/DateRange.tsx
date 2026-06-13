import { daysAgo, today } from '../lib/format'
import { Button, cx } from './ui'

export interface Range {
  from: string
  to: string
}

const PRESETS: { label: string; range: () => Range }[] = [
  { label: '7D', range: () => ({ from: daysAgo(6), to: today() }) },
  { label: '30D', range: () => ({ from: daysAgo(29), to: today() }) },
  { label: '90D', range: () => ({ from: daysAgo(89), to: today() }) },
  { label: 'YTD', range: () => ({ from: `${today().slice(0, 4)}-01-01`, to: today() }) },
]

export function DateRangeControl({
  value,
  onChange,
}: {
  value: Range
  onChange: (r: Range) => void
}) {
  const matchesPreset = (p: { range: () => Range }) => {
    const r = p.range()
    return r.from === value.from && r.to === value.to
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <div className="glass-input flex rounded-xl border border-white/70 p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.range())}
            className={cx(
              'flex-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none',
              matchesPreset(p) ? 'bg-linear-to-b from-blue-500 to-blue-600 text-white shadow' : 'text-slate-600 hover:bg-white/60',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-1 items-center gap-2 sm:flex-none">
        <input
          type="date"
          value={value.from}
          max={value.to}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="glass-input min-w-0 flex-1 rounded-xl border border-white/70 px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:flex-none"
        />
        <span className="text-slate-400">→</span>
        <input
          type="date"
          value={value.to}
          min={value.from}
          max={today()}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="glass-input min-w-0 flex-1 rounded-xl border border-white/70 px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:flex-none"
        />
      </div>
    </div>
  )
}

export function DownloadButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} download>
      <Button variant="secondary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        {children}
      </Button>
    </a>
  )
}
