// Dashboard — performance overview of calls, revenue and margin.
//
// Light theme (flat white panels on the app's soft gradient), matching the rest of the app.
// Layout mirrors the client's reference mock: a full-width Total Profit hero with a large
// area chart, a row of four KPI cards with sparklines, a row of four volume cards each with
// an isometric 3D-style icon + bar sparkline, then the trend/donut and ranked-list rows.
// Report downloads (CSV/PDF) were removed; a lightweight KPI CSV export lives on this page.
import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { cx } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import {
  daysAgo,
  daysBeforeIso,
  formatDmy,
  formatPeriod,
  money,
  moneyCompact,
  num,
  previousPeriod,
  rangeDays,
  today,
} from '../lib/format'
import { useAsync } from '../lib/useAsync'

type Granularity = 'day' | '4day' | 'week'

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: '4day', label: '4 Days' },
  { value: 'week', label: 'Weekly' },
]

/** One colour = one meaning, across every block. */
const C = {
  revenue: '#2563eb',
  cost: '#f97316',
  profit: '#16a34a',
  hero: '#8b5cf6',
  marginPct: '#8b5cf6',
  answerRate: '#0d9488',
  answered: '#16a34a',
  missed: '#f43f5e',
  grid: '#eef2f6',
  axis: '#94a3b8',
}

/**
 * Whether a rising number is good news for this metric. Running Fee is a cost, so it
 * is the one metric where falling is good — the arrow follows the raw sign, the colour
 * follows the meaning.
 */
type Tone = 'up-good' | 'down-good'

// ─── Formatting helpers ───────────────────────────────────────────────────────

const signed = (v: number, suffix: string) => `${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix}`

/** % change with the same "no baseline → null" rule the API uses. */
function changePct(prev: number | undefined, curr: number): number | null {
  if (prev === undefined) return null
  if (prev === 0) return curr === 0 ? 0 : null
  return Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(1))
}

/** "vs prev. 7 days" — the comparison window is always the same length as the range. */
function comparisonLabel(range: Range): string {
  const days = rangeDays(range.from, range.to)
  if (days <= 1) return 'vs prev. day'
  return `vs prev. ${days} days`
}

// ─── Line icons (KPI badges, controls) ─────────────────────────────────────────

const svg = (children: ReactNode, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    {children}
  </svg>
)

const IconRefresh = () => svg(<><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></>, 14)
// Icons for the redesigned Top Traffic Sources card.
const IconBars = () => svg(<><line x1="6" y1="20" x2="6" y2="14" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="10" /></>, 22)
const IconGrid = () => svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>, 18)
const IconPie = () => svg(<><path d="M21.2 15.9A10 10 0 1 1 8 2.8" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></>, 20)
const IconArrowUR = () => svg(<><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></>, 16)
const IconCal = () => svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>, 15)
const IconChevD = () => svg(<><polyline points="6 9 12 15 18 9" /></>, 15)
const IconTrendUp = () => svg(<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>, 18)
const IconTrendDown = () => svg(<><polyline points="22 17 13.5 8.5 8.5 13.5 2 7" /><polyline points="16 17 22 17 22 11" /></>, 18)
const IconMinus = () => svg(<><line x1="5" y1="12" x2="19" y2="12" /></>, 18)
const IconCrown = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
    <path d="M3 8l4.4 3L12 5l4.6 6L21 8l-1.5 9.2a1 1 0 0 1-1 .8H5.5a1 1 0 0 1-1-.8L3 8z" />
  </svg>
)
const IconPhoneCall = () => svg(<><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></>, 24)
const IconPhoneFwd = () => svg(<><polyline points="16 3 21 3 21 8" /><line x1="14" y1="10" x2="21" y2="3" /><path d="M20.5 16.9v2.6a2 2 0 0 1-2.2 2A18 18 0 0 1 3.5 6.2 2 2 0 0 1 5.5 4h2.4a2 2 0 0 1 2 1.7c.1.8.3 1.6.6 2.4a2 2 0 0 1-.5 2.1L8.3 11.6a14 14 0 0 0 5.3 5.3l1.4-1.2a2 2 0 0 1 2.1-.5c.8.3 1.6.5 2.4.6a2 2 0 0 1 1.7 2z" /></>, 18)

// ─── Isometric 3D-style icons for the volume cards ─────────────────────────────
//
// Hand-built SVGs — an object on a glossy pedestal with gradient shading and a soft ground
// shadow — standing in for the reference mock's rendered-3D illustrations (true 3D renders
// can't be produced as code). One factory keeps the pedestal/lighting consistent; each card
// supplies its subject and a colour ramp.

interface Ramp { light: string; base: string; dark: string; pad: string; padDark: string }

const RAMPS: Record<string, Ramp> = {
  green: { light: '#bbf7d0', base: '#22c55e', dark: '#15803d', pad: '#86efac', padDark: '#16a34a' },
  blue: { light: '#bfdbfe', base: '#3b82f6', dark: '#1d4ed8', pad: '#93c5fd', padDark: '#2563eb' },
  purple: { light: '#ddd6fe', base: '#8b5cf6', dark: '#6d28d9', pad: '#c4b5fd', padDark: '#7c3aed' },
  orange: { light: '#fed7aa', base: '#f97316', dark: '#c2410c', pad: '#fdba74', padDark: '#ea580c' },
}

function Iso3D({ id, ramp, size = 64, children }: { id: string; ramp: Ramp; size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${id}-obj`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={ramp.light} />
          <stop offset="55%" stopColor={ramp.base} />
          <stop offset="100%" stopColor={ramp.dark} />
        </linearGradient>
        <linearGradient id={`${id}-objSoft`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={ramp.light} />
          <stop offset="100%" stopColor={ramp.base} />
        </linearGradient>
        <linearGradient id={`${id}-padTop`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="100%" stopColor={ramp.pad} />
        </linearGradient>
      </defs>
      {/* Ground shadow */}
      <ellipse cx="32" cy="55" rx="19" ry="4.5" fill="rgba(15,23,42,0.12)" />
      {/* Pedestal — isometric slab */}
      <path d="M32 39 L51 46.5 L32 54 L13 46.5 Z" fill={`url(#${id}-padTop)`} />
      <path d="M13 46.5 L32 54 L32 58 L13 50.5 Z" fill={ramp.padDark} />
      <path d="M51 46.5 L32 54 L32 58 L51 50.5 Z" fill={ramp.pad} />
      {/* Subject */}
      {children}
    </svg>
  )
}

const Phone3D = ({ size }: { size?: number }) => (
  <Iso3D id="i3-phone" ramp={RAMPS.green} size={size}>
    {/* Handset — filled receiver, tilted, with a couple of sound arcs. */}
    <g transform="translate(15 8) scale(1.35)">
      <path
        d="M4.8 2.2c-.9-.4-1.9 0-2.3.9L1.4 5.4c-.4.9-.2 2 .5 2.7 3 3 6 6 9 9 .7.7 1.8.9 2.7.5l2.3-1.1c.9-.4 1.3-1.4.9-2.3l-1.1-2.5c-.3-.8-1.2-1.2-2-1L13 11.4c-.5.1-1.1 0-1.5-.4L8.9 8.4c-.4-.4-.5-1-.4-1.5l.8-2.4c.2-.8-.2-1.7-1-2z"
        fill={`url(#i3-phone-obj)`}
        stroke="#0f5132"
        strokeWidth="0.4"
      />
      <path d="M14 2.6a5 5 0 0 1 3.4 3.4" stroke={RAMPS.green.dark} strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.85" />
      <path d="M12.6 5a2.6 2.6 0 0 1 1.8 1.8" stroke={RAMPS.green.dark} strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.85" />
    </g>
  </Iso3D>
)

const People3D = ({ size }: { size?: number }) => (
  <Iso3D id="i3-people" ramp={RAMPS.blue} size={size}>
    {/* Three figures — two lighter behind, one darker in front. */}
    <g>
      <circle cx="19" cy="24" r="5" fill={`url(#i3-people-objSoft)`} />
      <path d="M11 43c0-5 3.6-8 8-8s8 3 8 8z" fill={`url(#i3-people-objSoft)`} />
      <circle cx="45" cy="24" r="5" fill={`url(#i3-people-objSoft)`} />
      <path d="M37 43c0-5 3.6-8 8-8s8 3 8 8z" fill={`url(#i3-people-objSoft)`} />
      <circle cx="32" cy="20" r="6.5" fill={`url(#i3-people-obj)`} stroke="#1e3a8a" strokeWidth="0.4" />
      <path d="M21 44c0-6.5 4.6-11 11-11s11 4.5 11 11z" fill={`url(#i3-people-obj)`} stroke="#1e3a8a" strokeWidth="0.4" />
    </g>
  </Iso3D>
)

const Megaphone3D = ({ size }: { size?: number }) => (
  <Iso3D id="i3-mega" ramp={RAMPS.purple} size={size}>
    {/* Bullhorn pointing up-right, with a handle and sound arcs. */}
    <g transform="rotate(-18 32 28)">
      <path d="M14 24 L34 18 L34 38 L14 32 Z" fill={`url(#i3-mega-obj)`} stroke="#4c1d95" strokeWidth="0.4" />
      <ellipse cx="34" cy="28" rx="3.4" ry="10" fill={RAMPS.purple.light} />
      <rect x="9" y="24" width="6" height="8" rx="2" fill={`url(#i3-mega-obj)`} />
      <rect x="20" y="38" width="5" height="9" rx="2.2" fill={RAMPS.purple.dark} />
      <path d="M40 20a10 10 0 0 1 0 16" stroke={RAMPS.purple.base} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M44 15a16 16 0 0 1 0 26" stroke={RAMPS.purple.light} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.8" />
    </g>
  </Iso3D>
)

const Headphones3D = ({ size }: { size?: number }) => (
  <Iso3D id="i3-head" ramp={RAMPS.orange} size={size}>
    {/* Over-ear headphones — filled band + two ear cups. */}
    <g>
      <path d="M16 38 V30 a16 16 0 0 1 32 0 V38 h-4 V30 a12 12 0 0 0-24 0 V38 Z" fill={`url(#i3-head-obj)`} stroke="#7c2d12" strokeWidth="0.4" />
      <rect x="12.5" y="34" width="9" height="14" rx="4" fill={`url(#i3-head-obj)`} stroke="#7c2d12" strokeWidth="0.4" />
      <rect x="42.5" y="34" width="9" height="14" rx="4" fill={`url(#i3-head-obj)`} stroke="#7c2d12" strokeWidth="0.4" />
      <rect x="14.5" y="36.5" width="4.5" height="9" rx="2.2" fill={RAMPS.orange.light} opacity="0.7" />
    </g>
  </Iso3D>
)

// ─── KPI card illustrations ────────────────────────────────────────────────────
//
// Themed SVG graphics for the four colour widgets, floating on a soft white glow so they
// read on any card colour — the code-drawn equivalent of the reference mock's 3D artwork
// (rendered-3D images can't be produced as code). Money-in, money-out, growth, and a rate
// gauge, one per metric.

const AnswerArt = ({ size = 82 }: { size?: number }) => (
  <svg viewBox="0 0 88 88" width={size} height={size} fill="none" aria-hidden focusable="false">
    <defs>
      <radialGradient id="ans-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
        <stop offset="70%" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="44" cy="46" r="40" fill="url(#ans-glow)" />
    {/* Gauge — track, filled arc, needle. */}
    <path d="M22 62 a24 24 0 0 1 44 0" stroke="#fff" strokeOpacity="0.35" strokeWidth="6" strokeLinecap="round" fill="none" />
    <path d="M22 62 a24 24 0 0 1 8-17.6" stroke="#fff" strokeWidth="6" strokeLinecap="round" fill="none" />
    <path d="M55 45 a24 24 0 0 1 11 17" stroke="#fff" strokeWidth="6" strokeLinecap="round" fill="none" />
    <circle cx="44" cy="62" r="6" fill="#fff" />
    <path d="M44 62 L57 47" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
    <circle cx="44" cy="62" r="2.5" fill="#0d9488" />
  </svg>
)

const RevenueArt = ({ size = 82 }: { size?: number }) => (
  <svg viewBox="0 0 88 88" width={size} height={size} fill="none" aria-hidden focusable="false">
    <defs>
      <radialGradient id="rev-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
        <stop offset="70%" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="rev-note" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#6ee7b7" /><stop offset="100%" stopColor="#10b981" />
      </linearGradient>
      <linearGradient id="rev-coin" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fde68a" /><stop offset="100%" stopColor="#f59e0b" />
      </linearGradient>
    </defs>
    <circle cx="44" cy="46" r="40" fill="url(#rev-glow)" />
    {/* Banknotes */}
    <g transform="rotate(-10 44 52)">
      <rect x="20" y="46" width="46" height="17" rx="3" fill="#34d399" />
      <rect x="17" y="42" width="46" height="17" rx="3" fill="url(#rev-note)" stroke="#059669" strokeWidth="1" />
      <circle cx="40" cy="50.5" r="5.5" fill="#d1fae5" />
    </g>
    {/* Coin stack */}
    <ellipse cx="30" cy="70" rx="11" ry="4.2" fill="#d97706" />
    <ellipse cx="30" cy="66.6" rx="11" ry="4.2" fill="url(#rev-coin)" stroke="#d97706" strokeWidth="0.8" />
    {/* Floating coin with $ */}
    <circle cx="64" cy="34" r="10" fill="url(#rev-coin)" stroke="#d97706" strokeWidth="1" />
    <path d="M64 29v10M61.6 31h4a1.6 1.6 0 0 1 0 3.2h-2.6a1.6 1.6 0 0 0 0 3.2h4" stroke="#b45309" strokeWidth="1.1" strokeLinecap="round" fill="none" />
  </svg>
)

const CostArt = ({ size = 82 }: { size?: number }) => (
  <svg viewBox="0 0 88 88" width={size} height={size} fill="none" aria-hidden focusable="false">
    <defs>
      <radialGradient id="cost-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
        <stop offset="70%" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="cost-coin" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fff7ed" /><stop offset="100%" stopColor="#fdba74" />
      </linearGradient>
    </defs>
    <circle cx="44" cy="46" r="40" fill="url(#cost-glow)" />
    {/* Bank card */}
    <g transform="rotate(-12 42 44)">
      <rect x="18" y="32" width="40" height="26" rx="4" fill="#fff" />
      <rect x="18" y="38" width="40" height="6" fill="#fb923c" />
      <rect x="24" y="50" width="16" height="3" rx="1.5" fill="#fdba74" />
    </g>
    {/* Coin stack (fees paid out) */}
    <ellipse cx="62" cy="66" rx="11" ry="4.2" fill="#c2410c" />
    <ellipse cx="62" cy="62.6" rx="11" ry="4.2" fill="url(#cost-coin)" stroke="#c2410c" strokeWidth="0.8" />
    <ellipse cx="62" cy="59.2" rx="11" ry="4.2" fill="url(#cost-coin)" stroke="#c2410c" strokeWidth="0.8" />
  </svg>
)

const ProfitArt = ({ size = 82 }: { size?: number }) => (
  <svg viewBox="0 0 88 88" width={size} height={size} fill="none" aria-hidden focusable="false">
    <defs>
      <radialGradient id="pro-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
        <stop offset="70%" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="44" cy="46" r="40" fill="url(#pro-glow)" />
    {/* Rising bars */}
    <rect x="22" y="52" width="11" height="16" rx="2" fill="#fff" fillOpacity="0.85" />
    <rect x="37" y="44" width="11" height="24" rx="2" fill="#fff" fillOpacity="0.92" />
    <rect x="52" y="34" width="11" height="34" rx="2" fill="#fff" />
    {/* Growth arrow */}
    <path d="M22 46 L38 36 L48 42 L66 26" stroke="#a3e635" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M58 26 h8 v8" stroke="#a3e635" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
)

// ─── Small building blocks ────────────────────────────────────────────────────

/** Flat white card on the app's soft gradient backdrop. */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5', className)}>
      {children}
    </section>
  )
}

/** Metric definitions surface as a hover/focus hint rather than eating layout space. */
function InfoDot({ text }: { text: string }) {
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      className="inline-flex shrink-0 cursor-help text-slate-400 transition-colors hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
      </svg>
    </button>
  )
}

function PanelHeader({ title, subtitle, info, action }: {
  title: string
  subtitle?: string
  info?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 px-5 pb-2 pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {/* Titles wrap rather than truncate — the trend title is long. */}
        <div className="flex items-start gap-1.5">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          {info && <span className="mt-1"><InfoDot text={info} /></span>}
        </div>
        {subtitle && <p className="mt-0.5 text-base text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-100', className)} />
}

/**
 * Change vs the previous period. The glyph follows the raw sign; the colour follows
 * whether that movement is good for this particular metric.
 */
function DeltaChip({ value, tone, suffix = '%', caption, className, hideWhenNull }: {
  value?: number | null
  tone: Tone
  suffix?: string
  caption?: string
  className?: string
  /** In dense rows, say nothing rather than spending a line on "no prior period". */
  hideWhenNull?: boolean
}) {
  if (value === undefined || value === null) {
    if (hideWhenNull) return null
    return <span className={cx('text-sm text-slate-400', className)}>No comparable prior period</span>
  }
  const good = value === 0 ? null : tone === 'up-good' ? value > 0 : value < 0
  return (
    <span className={cx('flex items-baseline gap-x-1 whitespace-nowrap', className)}>
      <span
        className={cx(
          'shrink-0 text-[11px] font-semibold',
          good === null ? 'text-slate-500' : good ? 'text-emerald-600' : 'text-red-500',
        )}
      >
        {value === 0 ? '±' : value > 0 ? '▲' : '▼'} {signed(value, suffix)}
      </span>
      {caption && <span className="truncate text-[11px] text-slate-400">{caption}</span>}
    </span>
  )
}

/** Axis-less area sparkline for the KPI tiles, drawn from the same series as the main chart. */
function Sparkline({ id, data, color, height = 40, dots = false, fillOpacity = 0.28 }: {
  id: string
  data: number[]
  color: string
  height?: number
  /** Show a marker at each point (the colour-widget cards use these). */
  dots?: boolean
  fillOpacity?: number
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <span className="text-[11px] text-slate-300">No trend data in this range</span>
      </div>
    )
  }
  // A single bucket still deserves a mark: duplicate it so there is a segment to stroke.
  const values = data.length === 1 ? [data[0], data[0]] : data
  const points = values.map((v, i) => ({ i, v }))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = min === max ? Math.abs(max) * 0.5 || 1 : 0

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[min - pad, max + pad]} />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#${id})`} dot={dots ? { r: 2.5, fill: color, stroke: 'none' } : false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Tiny activity bars for the volume cards, echoing the reference's mini bar charts. */
function BarSpark({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  if (data.length === 0) return <div style={{ height }} aria-hidden />
  const points = data.map((v, i) => ({ i, v }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
        <YAxis hide domain={[0, 'dataMax']} />
        <Bar dataKey="v" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

interface PieSlice { name: string; value: number; color: string; light: string; dark: string; pull?: number }

/**
 * A tilted, extruded 3D pie — hand-drawn SVG, since Recharts only renders flat charts.
 * A slice with `pull` is exploded outward along its bisector and gets its radial side walls
 * too, so it pops out in 3D (like a highlighted wedge). Non-pulled slices draw first; the
 * pulled one draws last so it sits proud of the rest.
 */
function Pie3D({ slices, size = 184, depth = 26, tilt = 0.5 }: {
  slices: PieSlice[]
  size?: number
  depth?: number
  tilt?: number
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1
  const maxPull = slices.reduce((m, s) => Math.max(m, s.pull ?? 0), 0)
  const rx = size / 2 - 10 - maxPull
  const ry = rx * tilt
  const cx = size / 2
  const cy = ry + 12 + maxPull * tilt
  const h = Math.round(cy + ry + depth + 16)

  // Slices start at the top (−90°) and sweep clockwise (increasing angle = clockwise on
  // screen, since y grows downward). Cumulative starts + explode offset computed functionally.
  const sweeps = slices.map((s) => (s.value / total) * Math.PI * 2)
  const segs = slices.map((s, i) => {
    const a0 = -Math.PI / 2 + sweeps.slice(0, i).reduce((x, y) => x + y, 0)
    const a1 = a0 + sweeps[i]
    const mid = (a0 + a1) / 2
    const pull = s.pull ?? 0
    return {
      ...s,
      idx: i,
      a0,
      a1,
      large: sweeps[i] > Math.PI ? 1 : 0,
      // Offset the slice outward along its bisector, projected onto the tilted ellipse.
      ox: pull * Math.cos(mid),
      oy: pull * Math.sin(mid) * tilt,
    }
  })
  type Seg = (typeof segs)[number]

  const pt = (a: number, seg: Seg, dy = 0): [number, number] =>
    [cx + seg.ox + rx * Math.cos(a), cy + seg.oy + ry * Math.sin(a) + dy]

  const topPath = (seg: Seg) => {
    const [x0, y0] = pt(seg.a0, seg)
    const [x1, y1] = pt(seg.a1, seg)
    return `M ${cx + seg.ox} ${cy + seg.oy} L ${x0} ${y0} A ${rx} ${ry} 0 ${seg.large} 1 ${x1} ${y1} Z`
  }
  const arcWall = (seg: Seg) => {
    const [x0, y0] = pt(seg.a0, seg)
    const [x1, y1] = pt(seg.a1, seg)
    return `M ${x0} ${y0} A ${rx} ${ry} 0 ${seg.large} 1 ${x1} ${y1} L ${x1} ${y1 + depth} A ${rx} ${ry} 0 ${seg.large} 0 ${x0} ${y0 + depth} Z`
  }
  // Straight (radial) wall from the slice centre to one arc endpoint — only exposed on a
  // pulled-out slice, where the seam between neighbours opens up.
  const radialWall = (seg: Seg, a: number) => {
    const [xe, ye] = pt(a, seg)
    const cxp = cx + seg.ox
    const cyp = cy + seg.oy
    return `M ${cxp} ${cyp} L ${xe} ${ye} L ${xe} ${ye + depth} L ${cxp} ${cyp + depth} Z`
  }

  const base = segs.filter((s) => !s.pull)
  const pulled = segs.filter((s) => s.pull)

  return (
    <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} aria-hidden focusable="false" style={{ filter: 'drop-shadow(0 6px 8px rgba(15,23,42,0.15))' }}>
      <defs>
        {segs.map((s, i) => (
          <linearGradient key={i} id={`p3d-${i}`} x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stopColor={s.light} />
            <stop offset="100%" stopColor={s.color} />
          </linearGradient>
        ))}
      </defs>
      {/* Non-pulled slices: side walls first, then gradient tops. */}
      {base.map((s) => (
        <path key={`bw${s.name}`} d={arcWall(s)} fill={s.dark} />
      ))}
      {base.map((s) => (
        <path key={`bt${s.name}`} d={topPath(s)} fill={`url(#p3d-${s.idx})`} stroke="#fff" strokeWidth="1.5" strokeOpacity="0.75" strokeLinejoin="round" />
      ))}
      {/* Pulled slices on top: full extrusion (radial + arc walls) then the gradient top. */}
      {pulled.map((s) => (
        <g key={`pg${s.name}`}>
          <path d={radialWall(s, s.a0)} fill={s.dark} />
          <path d={radialWall(s, s.a1)} fill={s.dark} />
          <path d={arcWall(s)} fill={s.dark} />
          <path d={topPath(s)} fill={`url(#p3d-${s.idx})`} stroke="#fff" strokeWidth="1.5" strokeOpacity="0.85" strokeLinejoin="round" />
        </g>
      ))}
    </svg>
  )
}

/** The full-width Total Profit hero: big figure on the left, large area chart on the right. */
function HeroBanner({ value, delta, caption, series, loading }: {
  value: number | undefined
  delta: number | null | undefined
  caption: string
  series: { period: string; margin: number }[]
  loading: boolean
}) {
  const negative = value !== undefined && value < 0
  const plottable = series.length >= 2
  return (
    <Panel className="bg-linear-to-br from-violet-50/70 to-white">
      <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[minmax(0,20rem)_1fr] lg:items-center lg:gap-8">
        {/* Left — the headline figure */}
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-base font-medium text-slate-500">Total Profit</span>
            <InfoDot text="Revenue (billed) minus Running Fee for the selected period. Negative means the calls cost more than they billed." />
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-11 w-52" />
          ) : (
            <div className={cx('mt-1 text-5xl font-bold tracking-tight', negative ? 'text-red-600' : 'text-slate-900')}>
              {value !== undefined ? money(value) : '—'}
            </div>
          )}
          {!loading && <DeltaChip className="mt-2" value={delta} tone="up-good" caption={caption} />}
        </div>

        {/* Right — the large area chart */}
        <div className="relative h-44">
          <div className="absolute right-0 top-0 z-10 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm font-medium text-slate-500">
            Area Chart
          </div>
          {loading ? (
            <div className="flex h-full items-center justify-center"><Skeleton className="h-32 w-full" /></div>
          ) : !plottable ? (
            <div className="flex h-full items-center justify-center">
              <span className="text-sm text-slate-400">Not enough data to plot a trend for this range.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 24, right: 8, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.hero} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.hero} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="period" tickFormatter={formatPeriod} tick={{ fontSize: 12, fill: C.axis }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tickFormatter={moneyCompact} tick={{ fontSize: 12, fill: C.axis }} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<SeriesTooltip format={money} />} />
                <Area type="monotone" dataKey="margin" name="Profit" stroke={C.hero} strokeWidth={2.5} fill="url(#hero-area)" dot={false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </Panel>
  )
}

function EmptyHint({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-slate-300">
        <path d="M3 3v18h18" /><path d="m7 15 3.5-3.5 3 3L21 7" />
      </svg>
      <p className="max-w-[26ch] text-base text-slate-400">{message}</p>
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="flex h-full items-end gap-2 px-2 pb-6 pt-4">
      {[38, 62, 45, 78, 55, 88, 66, 72, 50, 80].map((h, i) => (
        <div key={i} className="flex-1 animate-pulse rounded-t bg-slate-100" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

// ─── KPI + volume cards ────────────────────────────────────────────────────────

/**
 * A solid colour-filled KPI widget (CoreUI-style): white value + directional delta + label,
 * a "⋮" menu that surfaces the metric definition, and an edge-to-edge chart at the bottom.
 * The delta is white and follows the raw sign only — on a solid colour tile the good/bad
 * green/red coding can't read, so it's intentionally dropped here (the arrow shows direction).
 */
function StatWidget({ gradient, label, info, value, delta, deltaSuffix = '%', chart, art, loading }: {
  gradient: string
  label: string
  info: string
  value: string
  delta: number | null | undefined
  deltaSuffix?: string
  chart: ReactNode
  /** Themed illustration, floated on the right (see the KPI card illustrations above). */
  art: ReactNode
  loading: boolean
}) {
  const arrow = delta == null ? '' : delta > 0 ? '↑' : delta < 0 ? '↓' : ''
  return (
    // title carries the metric definition on hover (the ⋮ menu was dropped to make room for
    // the illustration, mirroring the reference cards which have no menu).
    <div title={info} className={cx('relative flex flex-col overflow-hidden rounded-2xl p-4 text-white shadow-lg shadow-slate-900/10', gradient)}>
      {/* Illustration — right side, vertically centred, above the chart. */}
      <div className="pointer-events-none absolute right-1 top-[22px] z-0">{art}</div>
      {/* Text — reserve space on the right so the value never runs under the art. */}
      <div className="relative z-10 min-w-0 pr-20">
        {loading ? (
          <div className="h-7 w-24 animate-pulse rounded bg-white/25" />
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-2xl font-bold tracking-tight">{value}</span>
            {delta != null && (
              <span className="text-sm font-medium text-white/85">({signed(delta, deltaSuffix)} {arrow})</span>
            )}
          </div>
        )}
        <div className="mt-0.5 truncate text-base text-white/85">{label}</div>
      </div>
      {/* Chart bleeds to the card edges; the negative margins cancel the p-4. */}
      <div className="relative z-10 -mx-4 -mb-4 mt-3 h-16">{!loading && chart}</div>
    </div>
  )
}

/** A volume card: label + value + delta on the left, a 3D icon on the right, bars below. */
function VolumeCard({ icon, label, info, value, delta, tone, caption, bars, barColor, loading }: {
  icon: ReactNode
  label: string
  info: string
  value: string
  delta: number | null | undefined
  tone: Tone
  caption: string
  bars: number[]
  barColor: string
  loading: boolean
}) {
  return (
    <Panel className="flex flex-col justify-between p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-base font-medium text-slate-600">{label}</span>
            <InfoDot text={info} />
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-20" />
          ) : (
            <div className="mt-1.5 text-3xl font-bold tracking-tight text-slate-900">{value}</div>
          )}
          {!loading && <DeltaChip className="mt-1" value={delta} tone={tone} caption={caption} />}
        </div>
        <span className="-mt-1 -mr-1 shrink-0">{icon}</span>
      </div>
      <div className="-mx-1 mt-3 h-9">
        {!loading && <BarSpark data={bars} color={barColor} />}
      </div>
    </Panel>
  )
}

// ─── Ranked lists ─────────────────────────────────────────────────────────────

/**
 * Buyers and campaigns have no logo in the schema — only a short code and an optional
 * name — so identity is carried by initials on a tint derived from the code.
 */
const TINTS = [
  'bg-blue-50 text-blue-700',
  'bg-emerald-50 text-emerald-700',
  'bg-amber-50 text-amber-700',
  'bg-violet-50 text-violet-700',
  'bg-rose-50 text-rose-700',
  'bg-cyan-50 text-cyan-700',
  'bg-indigo-50 text-indigo-700',
  'bg-teal-50 text-teal-700',
]

function tintFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

/** Codes are short and mostly alphanumeric — first three chars, separators stripped. */
function initialsFor(code: string): string {
  return code.replace(/[\s\-_]+/g, '').slice(0, 3).toUpperCase()
}

interface RankRow {
  key: string
  code: string
  name: string | null
  value: number
  delta: number | null
}

/** Trend chip for the Change column: green up / red down / grey flat, matching the mock. */
function TrendChip({ delta }: { delta: number | null }) {
  const dir = delta == null ? 0 : delta > 0 ? 1 : delta < 0 ? -1 : 0
  const cls = dir > 0 ? 'bg-emerald-50 text-emerald-500' : dir < 0 ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-400'
  const title = delta == null ? 'No comparable prior period' : `${signed(delta, '%')} vs previous period`
  return (
    <span title={title} className={cx('inline-flex h-9 w-9 items-center justify-center rounded-xl', cls)}>
      {dir > 0 ? <IconTrendUp /> : dir < 0 ? <IconTrendDown /> : <IconMinus />}
    </span>
  )
}

/**
 * A ranked list where each row is its own card: a gradient rank badge (crown on #1) on the
 * left, then avatar, name, value and a trend chip. Rows flex to fill the card height so a
 * short list (e.g. 4 campaigns) leaves no empty space at the bottom.
 */
function RankPanel({ title, info, rows, loading, emptyMessage, valueHead, to, perm, linkLabel, caption, rankGradients }: {
  title: string
  info: string
  rows: RankRow[]
  loading: boolean
  emptyMessage: string
  valueHead: string
  to: string
  /** Permission key for the linked page — the link is hidden from viewers who lack it. */
  perm: string
  linkLabel: string
  caption: string
  /** Per-rank badge gradients (index 0 = #1). The last entry repeats for lower ranks. */
  rankGradients: string[]
}) {
  const { canAccess } = useAuth()
  return (
    <Panel className="flex flex-col">
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <InfoDot text={info} />
        </div>
        {canAccess(perm) && (
          <Link to={to} className="text-sm font-medium text-blue-600 hover:text-blue-700">
            {linkLabel}
          </Link>
        )}
      </div>
      {/* Column headers. */}
      <div className="flex items-center gap-3 px-5 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        <span className="w-6">#</span>
        <span className="flex-1 pl-11">Name</span>
        <span className="w-24 text-right">{valueHead}</span>
        <span className="w-12 text-right">Change</span>
      </div>
      {loading ? (
        <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 flex-1 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex-1 px-4 pb-4">
          <EmptyHint message={emptyMessage} />
        </div>
      ) : (
        <ol className="flex flex-1 flex-col gap-3 px-4 pb-4">
          {rows.map((r, i) => (
            <li
              key={r.key}
              className={cx(
                'flex min-h-[3.5rem] flex-1 items-stretch overflow-hidden rounded-2xl shadow-sm ring-1',
                i === 0 ? 'ring-violet-200' : 'ring-slate-100',
              )}
            >
              {/* Rank badge with crown on #1. */}
              <div className={cx('flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 bg-linear-to-b text-white', rankGradients[Math.min(i, rankGradients.length - 1)])}>
                <span className="text-lg font-bold leading-none">{i + 1}</span>
                {i === 0 && <span className="text-amber-300"><IconCrown /></span>}
              </div>
              {/* Content. */}
              <div className="flex flex-1 items-center gap-3 bg-white px-3">
                <span
                  className={cx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tracking-tight', tintFor(r.code))}
                  aria-hidden
                >
                  {initialsFor(r.code)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-slate-800">{r.code}</span>
                  {r.name && <span className="block truncate text-sm text-slate-400">{r.name}</span>}
                </span>
                <span className="w-24 shrink-0 text-right text-base font-bold tabular-nums text-slate-900">{money(r.value)}</span>
                <TrendChip delta={r.delta} />
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="sr-only">{caption}</p>
    </Panel>
  )
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean
  payload?: { name: string; value: number; color: string; dataKey: string }[]
  label?: string
}

function SeriesTooltip({ active, payload, label, format }: TooltipProps & { format: (v: number) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg">
      {label && <div className="mb-1 font-semibold text-slate-700">{formatPeriod(label)}</div>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-semibold tabular-nums text-slate-800">{format(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  return <DashboardPage />
}

function DashboardPage() {
  const { canAccess } = useAuth()
  // Default to the last 90 days rather than 7: a dashboard wants a meaningful trend window,
  // and a 7-day default shows nothing whenever the most recent activity is older than a
  // week (e.g. the seeded sample data, which ends before "today").
  const [range, setRange] = useState<Range>({ from: daysAgo(89), to: today() })
  const [granularity, setGranularity] = useState<Granularity>('day')

  // Anchor the initial window to the most recent record, so the dashboard always lands on
  // real data even when the newest activity trails the current clock (e.g. fixed sample
  // data). Adjust-state-during-render (guarded by `anchored`, runs once); the user's own
  // range changes then take over. If the lookup fails, the 90-day default above stands.
  const latestRecord = useAsync(() => api.records({ sort: 'record_date', dir: 'desc', per_page: 1 }), [])
  const [anchored, setAnchored] = useState(false)
  if (!anchored && latestRecord.data) {
    setAnchored(true)
    const last = latestRecord.data.data?.[0]?.record_date
    if (last && last < range.to) setRange({ from: daysBeforeIso(last, 89), to: last })
  }

  const prev = useMemo(() => previousPeriod(range.from, range.to), [range.from, range.to])
  const caption = comparisonLabel(range)

  const summary = useAsync(() => api.summary(range), [range.from, range.to])
  const trends = useAsync(() => api.trends({ ...range, granularity }), [range.from, range.to, granularity])
  // Buyers capped at 5 so the ranked cards don't grow taller than the donut card they share
  // a row with (keeps the row visually even).
  const topBuyers = useAsync(() => api.topBuyers({ ...range, limit: 5 }), [range.from, range.to])
  const topCampaigns = useAsync(() => api.topCampaigns({ ...range, limit: 5 }), [range.from, range.to])
  const topSources = useAsync(() => api.topSources({ ...range, limit: 50 }), [range.from, range.to])
  // Ranked lists show a per-row change, which the ranking endpoints don't provide — so the
  // same ranking is pulled for the previous window and matched by id. A wider limit is used
  // because today's top 5 may have sat well down the table last period.
  const prevBuyers = useAsync(() => api.topBuyers({ ...prev, limit: 50 }), [prev.from, prev.to])
  const prevCampaigns = useAsync(() => api.topCampaigns({ ...prev, limit: 50 }), [prev.from, prev.to])

  const s = summary.data
  const series = useMemo(() => trends.data ?? [], [trends.data])
  /** One bucket cannot form a line — the chart renders markers plus an explanation. */
  const single = series.length === 1

  // KPI sparklines are derived from the trend series — the two rate metrics aren't
  // returned per bucket, so they're recomputed here from their components. The volume
  // cards' bars reuse the closest available per-bucket series (Active Buyers / Campaigns
  // have no per-bucket count, so counted / spend stand in as a volume proxy).
  const sparks = useMemo(
    () => ({
      revenue: series.map((p) => p.revenue),
      cost: series.map((p) => p.cost),
      profit: series.map((p) => p.margin),
      counted: series.map((p) => p.counted),
      answered: series.map((p) => p.answered),
      marginPct: series.map((p) => (p.revenue > 0 ? (p.margin / p.revenue) * 100 : 0)),
      answerRate: series.map((p) => (p.answered + p.missed > 0 ? (p.answered / (p.answered + p.missed)) * 100 : 0)),
    }),
    [series],
  )

  const buyerRows: RankRow[] = useMemo(() => {
    const before = new Map((prevBuyers.data ?? []).map((b) => [b.id, b.revenue]))
    return (topBuyers.data ?? []).map((b) => ({
      key: String(b.id),
      code: b.code,
      name: b.name,
      value: b.revenue,
      delta: changePct(before.get(b.id), b.revenue),
    }))
  }, [topBuyers.data, prevBuyers.data])

  const campaignRows: RankRow[] = useMemo(() => {
    const before = new Map((prevCampaigns.data ?? []).map((c) => [c.id, c.cost]))
    return (topCampaigns.data ?? []).map((c) => ({
      key: String(c.id),
      code: c.code,
      name: c.name,
      value: c.cost,
      delta: changePct(before.get(c.id), c.cost),
    }))
  }, [topCampaigns.data, prevCampaigns.data])

  // Spend is heavily top-weighted, so the tail is folded into a single "Others" row.
  const sources = useMemo(() => {
    const all = topSources.data ?? []
    const total = all.reduce((sum, r) => sum + r.cost, 0)
    const head = all.slice(0, 5)
    const tail = all.slice(5)
    const rows = head.map((r) => ({ name: r.source, cost: r.cost, counted: r.counted }))
    if (tail.length) {
      rows.push({
        name: `Others (${tail.length})`,
        cost: tail.reduce((sum, r) => sum + r.cost, 0),
        counted: tail.reduce((sum, r) => sum + r.counted, 0),
      })
    }
    const totalCounted = rows.reduce((sum, r) => sum + r.counted, 0)
    const maxCost = rows.reduce((m, r) => Math.max(m, r.cost), 0)
    const avgCpc = totalCounted > 0 ? total / totalCounted : 0
    return { rows, total, totalCounted, maxCost, avgCpc }
  }, [topSources.data])

  const answered = s?.answered ?? 0
  const missed = s?.missed ?? 0
  // light/dark shades drive the 3D pie's top-face gradient and side walls; `pull` explodes
  // the Missed slice outward so the small red wedge stands proud of the green, per the mock.
  const callMix: PieSlice[] = [
    { name: 'Answered', value: answered, color: C.answered, light: '#4ade80', dark: '#15803d' },
    { name: 'Missed', value: missed, color: C.missed, light: '#fb7185', dark: '#be123c', pull: 18 },
  ]
  const callTotal = answered + missed

  const blocks = [summary, trends, topBuyers, topCampaigns, topSources]
  const failed = blocks.filter((b) => b.error)
  const retryAll = () => failed.forEach((b) => b.reload())

  const heroSeries = useMemo(() => series.map((p) => ({ period: p.period, margin: p.margin })), [series])

  return (
    // Plus Jakarta Sans, scoped to this page (inherited by children, incl. the shared
    // PageHeader and the Recharts SVG text). Other pages keep the app-wide Poppins.
    <div style={{ fontFamily: "'Plus Jakarta Sans', 'Poppins', ui-sans-serif, system-ui, sans-serif" }}>
      {/* Light sky-blue backdrop for this page only, so the white panels stand out. Portalled
          to <body> so it covers the whole viewport (incl. wide-screen gutters) and escapes the
          layout's transformed animation wrapper; z-index:-1 keeps it behind the content. It
          unmounts on navigation, so the other pages keep the app-wide gradient. */}
      {createPortal(
        <div
          aria-hidden
          className="fixed inset-0"
          style={{
            zIndex: -1,
            background:
              'radial-gradient(60rem 40rem at 50% -8%, #cfe8fb, transparent 60%), linear-gradient(180deg, #e2f2fd 0%, #eef7fe 100%)',
          }}
        />,
        document.body,
      )}

      {/* Custom header (not the shared PageHeader) so the dashboard can carry its own
          larger title, roomier title↔subtitle spacing, and a wider gap to the panel below. */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Dashboard</h1>
          <p className="mt-2.5 text-base text-slate-500">Performance overview of calls, revenue and margin</p>
        </div>
        {/* Dark date box on the light header, per the client's request. */}
        <DateRangeControl value={range} onChange={setRange} tone="dark" />
      </div>

      {/* Total Profit hero — full-width banner with a large area chart. */}
      <HeroBanner
        value={s?.margin}
        delta={s?.deltas.margin}
        caption={caption}
        series={heroSeries}
        loading={summary.loading}
      />

      {/* KPI widgets — solid colour tiles with an embedded chart (CoreUI style). White
          charts read on the colour; Answer Rate uses bars, the rest lines-with-markers /
          an area, echoing the reference's mix. 2×2 until wide, four across at 1440+. */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 wide:grid-cols-4">
        <StatWidget
          gradient="bg-linear-to-br from-blue-500 to-blue-600"
          label="Revenue (billed)"
          info="Total billed to buyers for calls delivered in the selected period."
          value={s ? money(s.revenue) : '—'}
          delta={s?.deltas.revenue}
          chart={<Sparkline id="w-revenue" data={sparks.revenue} color="#fff" height={64} dots fillOpacity={0.22} />}
          art={<RevenueArt />}
          loading={summary.loading}
        />
        <StatWidget
          gradient="bg-linear-to-br from-orange-400 to-orange-500"
          label="Running Fee"
          info="Total paid to campaigns and traffic sources in the selected period. This is a cost — a falling Running Fee is good news."
          value={s ? money(s.cost) : '—'}
          delta={s?.deltas.cost}
          chart={<Sparkline id="w-cost" data={sparks.cost} color="#fff" height={64} dots fillOpacity={0.22} />}
          art={<CostArt />}
          loading={summary.loading}
        />
        <StatWidget
          gradient="bg-linear-to-br from-violet-500 to-purple-600"
          label="Profit Margin"
          info="Profit as a share of revenue. Shown as a percentage-point change against the previous period."
          value={s ? `${s.margin_pct}%` : '—'}
          delta={s?.point_deltas?.margin_pct} deltaSuffix="pp"
          chart={<Sparkline id="w-margin" data={sparks.marginPct} color="#fff" height={64} fillOpacity={0.3} />}
          art={<ProfitArt />}
          loading={summary.loading}
        />
        <StatWidget
          gradient="bg-linear-to-br from-teal-500 to-teal-600"
          label="Answer Rate"
          info="Answered calls as a share of answered + missed, buyer side. Shown as a percentage-point change against the previous period."
          value={s ? `${s.answer_rate}%` : '—'}
          delta={s?.point_deltas?.answer_rate} deltaSuffix="pp"
          chart={<BarSpark data={sparks.answerRate} color="rgba(255,255,255,0.85)" height={64} />}
          art={<AnswerArt />}
          loading={summary.loading}
        />
      </div>

      {/* Volume cards — isometric 3D-style icon + bar sparkline. */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 wide:grid-cols-4">
        <VolumeCard
          icon={<Phone3D />}
          label="Counted Calls"
          info="Billable calls in the selected period. Not the same as answered calls."
          value={s ? num(s.counted) : '—'}
          delta={s?.deltas.counted} tone="up-good" caption={caption}
          bars={sparks.counted} barColor={C.answered} loading={summary.loading}
        />
        <VolumeCard
          icon={<People3D />}
          label="Active Buyers"
          info="Distinct buyers with recorded activity in the selected period."
          value={s ? num(s.active_buyers) : '—'}
          delta={s?.deltas.active_buyers} tone="up-good" caption={caption}
          bars={sparks.counted} barColor={C.revenue} loading={summary.loading}
        />
        <VolumeCard
          icon={<Megaphone3D />}
          label="Active Campaigns"
          info="Distinct campaigns with recorded activity in the selected period."
          value={s ? num(s.active_campaigns) : '—'}
          delta={s?.deltas.active_campaigns} tone="up-good" caption={caption}
          bars={sparks.cost} barColor={C.marginPct} loading={summary.loading}
        />
        <VolumeCard
          icon={<Headphones3D />}
          label="Answered Calls"
          info="Calls the buyer actually picked up, in the selected period."
          value={s ? num(s.answered) : '—'}
          delta={s?.deltas.answered} tone="up-good" caption={caption}
          bars={sparks.answered} barColor={C.cost} loading={summary.loading}
        />
      </div>

      {/* Below xl the trend chart takes a full row rather than squeezing the ranked lists. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {/* Money over time — full-width row of its own. */}
        <Panel className="lg:col-span-2 xl:col-span-3">
          <PanelHeader
            title="Revenue, Running Fee & Profit Over Time"
            subtitle="Income trend across the selected period"
            info="Profit is Revenue minus Running Fee and crosses zero, so this chart can run below the baseline."
            action={
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Time bucket">
                {GRANULARITIES.map((g) => (
                  <button
                    key={g.value}
                    onClick={() => setGranularity(g.value)}
                    aria-pressed={granularity === g.value}
                    className={cx(
                      'rounded-lg px-2.5 py-1 text-sm font-medium transition-colors',
                      granularity === g.value
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900',
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            }
          />
          <div className="relative h-80 px-2 pb-4 pt-2">
            {trends.loading ? (
              <ChartSkeleton />
            ) : series.length === 0 ? (
              <EmptyHint message="No calls were recorded in this period. Try a wider date range." />
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="area-rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.revenue} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={C.revenue} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="area-cost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.cost} stopOpacity={0.38} />
                        <stop offset="100%" stopColor={C.cost} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="area-profit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.profit} stopOpacity={0.36} />
                        <stop offset="100%" stopColor={C.profit} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatPeriod} tick={{ fontSize: 13, fill: C.axis }} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickFormatter={moneyCompact} tick={{ fontSize: 13, fill: C.axis }} tickLine={false} axisLine={false} width={60} />
                    {/* Zero baseline matters: profit legitimately runs negative. */}
                    <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
                    <Tooltip content={<SeriesTooltip format={money} />} />
                    <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} iconType="plainline" />
                    {/* Smooth gradient areas. A single bucket shows a marker so it stays visible. */}
                    <Area type="monotone" dataKey="revenue" name="Revenue (billed)" stroke={C.revenue} strokeWidth={2.5} fill="url(#area-rev)" dot={single ? { r: 4, strokeWidth: 2, fill: '#fff' } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
                    <Area type="monotone" dataKey="cost" name="Running Fee" stroke={C.cost} strokeWidth={2.5} fill="url(#area-cost)" dot={single ? { r: 4, strokeWidth: 2, fill: '#fff' } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
                    <Area type="monotone" dataKey="margin" name="Profit" stroke={C.profit} strokeWidth={2.5} fill="url(#area-profit)" dot={single ? { r: 4, strokeWidth: 2, fill: '#fff' } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>

                {single && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
                    <p className="max-w-xs rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-center text-sm leading-relaxed text-slate-500 shadow-sm backdrop-blur-sm">
                      Only one {granularity === 'day' ? 'day' : granularity === '4day' ? '4-day block' : 'week'} in
                      this range has records, so there is no trend to plot yet. Widen the date range to compare periods.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>

        {/* Ranked buyers */}
        <RankPanel
          title="Top Buyers"
          info="Top 5 buyers by revenue. The change compares each buyer against the same buyer in the previous period."
          rows={buyerRows}
          loading={topBuyers.loading}
          emptyMessage="No buyer activity in this period."
          valueHead="Revenue"
          to="/buyers"
          perm="buyers"
          linkLabel="View all"
          caption={`Change shown ${caption}`}
          rankGradients={['from-violet-500 to-purple-600', 'from-blue-500 to-blue-600', 'from-blue-400 to-blue-500', 'from-sky-400 to-blue-400', 'from-sky-300 to-sky-400']}
        />

        {/* Ranked campaigns */}
        <RankPanel
          title="Top Campaigns"
          info="Top 5 campaigns by Running Fee. The change compares each campaign against the same campaign in the previous period."
          rows={campaignRows}
          loading={topCampaigns.loading}
          emptyMessage="No campaign activity in this period."
          valueHead="Spend"
          to="/campaigns"
          perm="campaigns"
          linkLabel="View all"
          caption={`Change shown ${caption}`}
          rankGradients={['from-amber-400 to-amber-500', 'from-slate-400 to-slate-500', 'from-orange-400 to-orange-500', 'from-slate-300 to-slate-400']}
        />

        {/* Call quality mix — Answered vs Missed, beside Top Campaigns. Its content sets the
            height the three cards in this row share. */}
        <Panel className="flex flex-col">
          <PanelHeader
            title="Answered vs Missed Calls"
            subtitle="Share of delivered calls, buyer side"
            info="Share of calls delivered to buyers that were picked up versus not picked up, across the whole period."
          />
          {/* flex-1 + flex-col so the Total-delivered box is pinned to the bottom and the
              card has no empty space beneath it. */}
          <div className="flex flex-1 flex-col px-5 pb-5 pt-2">
            {summary.loading ? (
              <div className="flex w-full items-center gap-5 py-6">
                <Skeleton className="h-32 w-32 rounded-full" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            ) : callTotal === 0 ? (
              <div className="w-full">
                <EmptyHint message="No answered or missed calls were recorded in this period." />
              </div>
            ) : (
              <>
                <div className="flex flex-1 items-center gap-3">
                  {/* 3D pie made to read as a donut: a raised white call-button in the middle,
                      with a faint dashed orbit and two accent dots. */}
                  <div className="relative shrink-0">
                    <span className="pointer-events-none absolute left-1/2 top-[42%] -z-0 h-[132px] w-[132px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-slate-200" />
                    <span className="absolute right-[8px] top-[16px] h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                    <span className="absolute bottom-[24px] left-[6px] h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
                    <Pie3D slices={callMix} size={150} />
                    <span className="absolute left-1/2 top-[40%] flex h-[54px] w-[54px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-emerald-500 shadow-[0_6px_16px_rgba(15,23,42,0.18)]">
                      <IconPhoneCall />
                    </span>
                  </div>
                  <dl className="min-w-0 flex-1 space-y-2.5">
                    {callMix.map((slice, i) => (
                      <div key={slice.name} className={cx(i > 0 && 'border-t border-slate-100 pt-2.5')}>
                        <dt className="flex items-center gap-2 text-base text-slate-500">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: slice.color }} />
                          {slice.name}
                        </dt>
                        <dd className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{num(slice.value)}</dd>
                        <dd className="text-sm font-medium" style={{ color: slice.color }}>
                          {((slice.value / callTotal) * 100).toFixed(1)}% of calls
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                {/* Total delivered — its own rounded box at the bottom of the card. */}
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-violet-50 px-4 py-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm">
                    <IconPhoneFwd />
                  </span>
                  <span className="text-base font-medium leading-tight text-slate-500">Total<br />delivered</span>
                  <span className="ml-auto text-2xl font-bold tabular-nums text-slate-900">{num(callTotal)}</span>
                </div>
              </>
            )}
          </div>
        </Panel>

        {/* Traffic sources — full-width row of its own, below the ranked/donut row. */}
        <Panel className="overflow-hidden lg:col-span-2 xl:col-span-3">
          {/* Header: icon + title, and a read-only period pill reflecting the global range. */}
          <div className="flex flex-col gap-4 px-6 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
                <IconBars />
              </span>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-lg font-semibold text-slate-900">Top Traffic Sources</h3>
                  <InfoDot text="Share of Running Fee by traffic source. Sources beyond the top five are grouped into Others. The period follows the date range at the top of the page." />
                </div>
                <p className="text-sm text-slate-500">Campaign spend by source</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 shadow-sm">
              <span className="text-slate-400"><IconCal /></span>
              {formatDmy(range.from)} – {formatDmy(range.to)}
              <span className="text-slate-400"><IconChevD /></span>
            </span>
          </div>

          {topSources.loading ? (
            <div className="grid gap-5 px-6 pb-6 pt-5 lg:grid-cols-2">
              {[0, 1].map((c) => (
                <div key={c} className="space-y-5 rounded-2xl border border-slate-200/80 p-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-11 w-11 rounded-xl" />
                      <Skeleton className="h-4 flex-1" />
                      <Skeleton className="h-8 w-20" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : sources.rows.length === 0 ? (
            <div className="px-6 pb-6 pt-2">
              <EmptyHint message="No campaign spend was recorded in this period." />
            </div>
          ) : (
            <>
              {/* Two bordered columns of source rows. */}
              <div className="grid gap-5 px-6 pt-5 lg:grid-cols-2">
                {[
                  sources.rows.slice(0, Math.ceil(sources.rows.length / 2)),
                  sources.rows.slice(Math.ceil(sources.rows.length / 2)),
                ].map((col, ci) =>
                  col.length === 0 ? null : (
                    <div key={ci} className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80">
                      {col.map((row) => {
                        const share = sources.total > 0 ? (row.cost / sources.total) * 100 : 0
                        const barW = sources.maxCost > 0 ? (row.cost / sources.maxCost) * 100 : 0
                        const isOthers = row.name.startsWith('Others')
                        const badge = row.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
                        return (
                          <div key={row.name} className="flex items-center gap-4 px-4 py-4">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-sm font-bold text-violet-600 ring-1 ring-inset ring-violet-100">
                              {isOthers ? <IconGrid /> : badge}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-bold uppercase tracking-wide text-slate-800">{row.name}</div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-linear-to-r from-violet-500 to-fuchsia-500"
                                  style={{ width: `${Math.max(barW, barW > 0 ? 4 : 0)}%` }}
                                />
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-xs text-slate-400">
                                {row.counted > 0 ? `${money(row.cost / row.counted)} / call` : '—'}
                              </div>
                              <div className="text-lg font-bold tabular-nums text-slate-900">{money(row.cost)}</div>
                              <div className="mt-1 inline-flex rounded-lg bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                                {share.toFixed(1)}%
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ),
                )}
              </div>

              {/* Summary footer bar. */}
              <div className="mt-6 flex flex-col items-stretch gap-4 border-t border-slate-200/70 bg-violet-50/50 px-6 py-4 lg:flex-row lg:items-center">
                <div className="flex flex-1 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm">
                    <IconPie />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-700">Total Spend</div>
                    <div className="text-xs text-slate-400">Across all sources</div>
                  </div>
                  <div className="ml-auto text-2xl font-bold tabular-nums text-slate-900 lg:ml-6">{money(sources.total)}</div>
                </div>
                <div className="hidden w-px self-stretch bg-slate-200 lg:block" />
                <div className="flex flex-col px-1">
                  <div className="text-lg font-bold tabular-nums text-slate-900">${sources.avgCpc.toFixed(1)} <span className="text-sm font-medium text-slate-400">/ call</span></div>
                  <div className="text-xs text-slate-400">Average CPC</div>
                </div>
                <div className="hidden w-px self-stretch bg-slate-200 lg:block" />
                <div className="flex flex-col px-1">
                  <div className="text-lg font-bold text-violet-600">100%</div>
                  <div className="text-xs text-slate-400">Total Share</div>
                </div>
                {canAccess('campaigns') && (
                  <Link
                    to="/campaigns"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-semibold text-violet-700 shadow-sm transition-colors hover:bg-violet-50 lg:ml-2"
                  >
                    <IconArrowUR />
                    View Full Report
                  </Link>
                )}
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* One banner for any block that failed — the rest of the page stays usable. */}
      {failed.length > 0 && (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 text-red-500">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" />
              </svg>
            </span>
            <p className="text-base text-red-700">
              {failed[0].error}
              {failed.length > 1 && ` (and ${failed.length - 1} other section${failed.length > 2 ? 's' : ''})`}
              . Is the PHP API running on port 8000?
            </p>
          </div>
          <button
            onClick={retryAll}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-red-200 bg-white px-3 py-1.5 text-base font-medium text-red-600 transition-colors hover:bg-red-50 sm:self-auto"
          >
            <IconRefresh />
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
