import { daysAgo, today } from '../lib/format'
import { Button, cx } from './ui'

export interface Range {
  from: string
  to: string
}

// Short-window presets only — the CRM keeps a rolling 40-day window and has no
// long-term data, so the date filter is limited to Daily / 4 Days / Weekly.
const PRESETS: { label: string; range: () => Range }[] = [
  { label: 'Daily', range: () => ({ from: today(), to: today() }) },
  { label: '4 Days', range: () => ({ from: daysAgo(3), to: today() }) },
  { label: 'Weekly', range: () => ({ from: daysAgo(6), to: today() }) },
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
    <div className="glass-input flex w-full flex-wrap rounded-xl border border-white/70 p-0.5 sm:w-auto">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange(p.range())}
          className={cx(
            'flex-1 whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium transition-colors sm:flex-none',
            matchesPreset(p) ? 'bg-linear-to-b from-blue-500 to-blue-600 text-white shadow' : 'text-slate-600 hover:bg-white/60',
          )}
        >
          {p.label}
        </button>
      ))}
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
