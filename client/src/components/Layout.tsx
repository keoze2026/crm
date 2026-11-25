import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './ui'
import { KeozeLogo } from './Brand'
import ThemeToggle from './ThemeToggle'
import { useAuth } from '../auth/AuthContext'
import { PerformerBadge } from '../lib/performers'
import { AUTH_ONLY_PAGES } from '../auth/pages'

// App shell, to the Keoze design: a dark top bar with the KEOZE logo on the left, every page
// in a centred two-row pill (the day-to-day pages, then reports and admin), and the signed-in
// account on the right. Below the xl breakpoint the pill folds into a menu button.

interface NavItem {
  to: string
  label: string
  /** Permission key that gates this item; omitted items are always visible. */
  perm?: string
  /** Which line of the pill it sits on. */
  row: 1 | 2
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', perm: 'dashboard', row: 1 },
  // The Daily Sheet and the Campaigns sheet, on one page since 25 Nov 2026. Always
  // reachable, as the Daily Sheet was; the page gates its cost side on 'campaigns'.
  { to: '/daily-billing', label: 'AHT Daily Billing', row: 1 },
  { to: '/buyers', label: 'Buyers', perm: 'buyers', row: 1 },
  { to: '/vendors', label: 'Traffic Source', perm: 'vendors', row: 1 },
  { to: '/portal-expenses', label: 'Portal Expenses', perm: 'portal-expenses', row: 1 },
  { to: '/queues', label: 'Queues', perm: 'queues', row: 1 },
  { to: '/review', label: 'Review', perm: 'reviews', row: 1 },
  { to: '/staff', label: 'Staff Management', perm: 'staff', row: 1 },
  // Reports (download hub) disabled — Complete Report is the only report page now.
  { to: '/complete-report', label: 'Complete Report', perm: 'complete-report', row: 2 },
  { to: '/attendance', label: 'Attendance', perm: 'attendance', row: 2 },
  { to: '/incentives', label: 'Monthly Incentives', perm: 'incentives', row: 2 },
  // Admin/permission pages, filtered by the viewer's access.
  { to: '/users', label: 'Users', perm: 'users', row: 2 },
  { to: '/system-logs', label: 'System Logs', perm: 'logs', row: 2 },
]

function useNavItems(): NavItem[] {
  const { authEnabled, canAccess } = useAuth()
  return NAV.filter((i) => {
    // Users / System Logs only exist while auth is on.
    if (i.perm && !authEnabled && AUTH_ONLY_PAGES.includes(i.perm)) return false
    return !i.perm || canAccess(i.perm)
  })
}

function NavPill({ item, onNavigate, block }: { item: NavItem; onNavigate?: () => void; block?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          'whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors wide:px-[15px]',
          block && 'block py-2 text-[13px]',
          isActive
            ? 'bg-blue-500/[0.16] text-white shadow-[inset_0_0_0_1px_rgba(96,140,255,0.45),0_0_14px_rgba(59,130,246,0.22)]'
            : 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
        )
      }
    >
      {item.label}
    </NavLink>
  )
}

/** The account chip: avatar, name, role — and a small menu with the manual and sign-out. */
function AccountMenu() {
  const { authEnabled, user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const signedIn = authEnabled && user
  // An account may have a username instead of an email, so neither is guaranteed.
  const name = signedIn ? (user.name ?? user.email ?? user.username ?? '?') : 'Platform'
  const role = signedIn ? user.role : 'Operations'

  const handleLogout = async () => {
    setOpen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#0b1222]/80 py-1.5 pl-1.5 pr-3 text-left transition-colors hover:border-white/20"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-400/50 bg-blue-500/15 text-[11px] font-semibold text-white">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="hidden min-w-0 leading-tight sm:block">
          <span className="flex items-center gap-1.5">
            <span className="max-w-[9rem] truncate text-[12px] font-semibold text-white">{name}</span>
            {/* An account carries no staff id, so the badge resolves on the name. */}
            {signedIn && <PerformerBadge name={user.name} compact />}
          </span>
          <span className="block text-[10px] capitalize text-slate-400">{role}</span>
        </span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#0a0e17] p-1 shadow-2xl shadow-black/60">
          <Link
            to="/manual"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-slate-200 hover:bg-white/[0.06] hover:text-white"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px] font-bold">?</span>
            User manual
          </Link>
          {signedIn && (
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-slate-200 hover:bg-white/[0.06] hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Sign out, always in view at the right of the bar (the account menu has it too). Only
 * renders while there is a session to end — with auth off there is nothing to sign out of.
 */
function LogoutButton() {
  const { authEnabled, user, logout } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  if (!authEnabled || !user) return null

  const handle = async () => {
    setBusy(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      title="Sign out"
      aria-label="Sign out"
      className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/10 bg-[#0b1222]/80 px-2.5 text-[12px] font-medium text-slate-300 transition-colors hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50 sm:px-3"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      {/* The label fits beside the nav pill from the `wide` breakpoint; below it the icon stands alone. */}
      <span className="hidden wide:inline">Sign out</span>
    </button>
  )
}

export default function Layout() {
  const items = useNavItems()
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const rows = [items.filter((i) => i.row === 1), items.filter((i) => i.row === 2)].filter((r) => r.length > 0)

  // Publish the bar's height so a page sized to the viewport (the Dashboard's staff view)
  // can take it off: `calc(100vh - var(--app-header-h))`.
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--app-header-h', `${el.offsetHeight}px`)
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="flex min-h-screen flex-col text-slate-100">
      {/* Near-black with a soft blue glow along the top edge (`.app-header` in index.css,
          which also carries its light-theme look); the glow fades out well before the bar's
          bottom edge, so it meets a dark page (the Dashboard) without a seam. */}
      <header ref={headerRef} className="app-header relative z-30 text-slate-200">
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 sm:px-6 lg:px-8 xl:grid-cols-[1fr_auto_1fr] xl:py-4">
          <Link to="/" className="justify-self-start rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50" aria-label="Keoze — home">
            <KeozeLogo />
          </Link>

          {/* Desktop: the two-row pill, centred on the page. */}
          <nav
            aria-label="Main"
            className="hidden flex-col items-center gap-1 rounded-2xl border border-white/10 bg-[#0a1122]/75 px-3 py-2 wide:px-8 shadow-[0_0_0_1px_rgba(59,130,246,0.07),0_12px_40px_-14px_rgba(37,99,235,0.45)] backdrop-blur xl:flex"
          >
            {rows.map((row, i) => (
              <div key={i} className="flex flex-wrap justify-center gap-0.5">
                {row.map((item) => <NavPill key={item.to} item={item} />)}
              </div>
            ))}
          </nav>

          <div className="flex items-center gap-2 justify-self-end">
            <ThemeToggle />
            <AccountMenu />
            <LogoutButton />
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              className="rounded-lg border border-white/10 p-2 text-slate-200 transition-colors hover:border-white/20 hover:text-white xl:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
              </svg>
            </button>
          </div>
        </div>

        {/* Below xl: the same pages as a panel under the bar. */}
        {menuOpen && (
          <nav aria-label="Main" className="animate-fade-in border-t border-white/[0.07] px-4 pb-4 pt-3 sm:px-6 lg:px-8 xl:hidden">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5">
              {items.map((item) => <NavPill key={item.to} item={item} block onNavigate={() => setMenuOpen(false)} />)}
            </div>
          </nav>
        )}
      </header>

      {/*
        Full-bleed: no max-width cap, so the content always fills the width. Zooming the
        browser out widens the viewport in CSS pixels — with a cap the page would stay narrow
        and centred instead.

        The height chain is min-h-screen (column) → grow (main) → grow (wrapper) → grow on the
        page root, so a short page still reaches the bottom of the viewport instead of ending
        under its last card. `*:` targets whatever the route renders, since page roots are
        plain divs with no height of their own.

        `grow`, not `flex-1`: flex-1 sets flex-basis to 0, which would make a page taller than
        the viewport overflow rather than stretch the container. grow keeps basis auto —
        content sets the height, and any leftover space is absorbed.
      */}
      <main className="flex w-full min-w-0 grow flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="animate-fade-in-up flex grow flex-col *:grow">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

/** Shared page header used across pages. */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
