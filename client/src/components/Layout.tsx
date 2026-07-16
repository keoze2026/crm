import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { cx } from './ui'
import { useAuth } from '../auth/AuthContext'
import { AUTH_ONLY_PAGES } from '../auth/pages'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  /** Permission key that gates this item; omitted items are always visible. */
  perm?: string
}

const icon = (path: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
)

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', perm: 'dashboard', icon: icon(<><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>) },
  { to: '/records', label: 'Daily Sheet', icon: icon(<><path d="M3 5h18M3 12h18M3 19h18" /></>) },
  { to: '/buyers', label: 'Buyers', perm: 'buyers', icon: icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>) },
  { to: '/campaigns', label: 'Campaigns', perm: 'campaigns', icon: icon(<><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>) },
  { to: '/portal-expenses', label: 'Portal Expenses', icon: icon(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></>) },
  // Reports (download hub) disabled — Complete Report is the only report page now.
  // { to: '/reports', label: 'Reports', icon: icon(<><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-5" /></>) },
  { to: '/complete-report', label: 'Complete Report', perm: 'complete-report', icon: icon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8M10 9H8" /></>) },
  { to: '/attendance', label: 'Attendance', perm: 'attendance', icon: icon(<><circle cx="12" cy="7" r="4" /><path d="M5.5 21a8.38 8.38 0 0 1 13 0" /><path d="M16 11l1.5 4.5L20 14l1 5" /></>) },
]

// Admin/permission pages, appended to NAV and filtered by the viewer's access.
const ADMIN_NAV: NavItem[] = [
  {
    to: '/users', label: 'Users', perm: 'users',
    icon: icon(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>),
  },
  {
    to: '/system-logs', label: 'System Logs', perm: 'logs',
    icon: icon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h2" /></>),
  },
]

function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={light ? 'text-white' : 'text-blue-900'}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19V6l8 6 8-6v13" />
        </svg>
      </span>
      <span className={cx('font-semibold tracking-tight', light ? 'text-white' : 'text-slate-900')}>Platform-CRM</span>
      <Link
        to="/manual"
        title="User manual"
        aria-label="Open user manual"
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold leading-none transition-colors',
          light
            ? 'border-white/40 text-white/90 hover:bg-white/15 hover:text-white'
            : 'border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700',
        )}
      >
        ?
      </Link>
    </div>
  )
}

/** Shared content for both the desktop sidebar and the mobile drawer. */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { authEnabled, user, logout, canAccess } = useAuth()
  const navigate = useNavigate()
  const items = [...NAV, ...ADMIN_NAV].filter((i) => {
    // Users / System Logs only exist while auth is on.
    if (i.perm && !authEnabled && AUTH_ONLY_PAGES.includes(i.perm)) return false
    return !i.perm || canAccess(i.perm)
  })

  const handleLogout = async () => {
    onNavigate?.()
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <div className="px-6 py-5">
        <BrandMark light />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {items.map((item, i) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            style={{ animationDelay: `${i * 35}ms` }}
            className={({ isActive }) =>
              cx(
                'nav-item animate-fade-in-up flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium backdrop-blur-sm',
                isActive
                  ? 'bg-white/5 text-white ring-1 ring-white/25'
                  : 'text-slate-300 hover:translate-x-0.5 hover:bg-white/10 hover:text-white',
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        {authEnabled && user ? (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center text-sm font-bold text-white">
              {(user.name ?? user.email).charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold text-white">{user.name ?? user.email}</div>
              <div className="truncate text-xs capitalize text-slate-400">{user.role}</div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Sign out"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-white">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v16a2 2 0 0 0 2 2h16" />
                <path d="m7 14 3.5-4 3.5 2.5L21 6" />
              </svg>
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-white">Platform</div>
              <div className="text-xs text-slate-400">Operations</div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default function Layout() {
  const [navOpen, setNavOpen] = useState(false)

  // Prevent body scroll while the mobile drawer is open.
  useEffect(() => {
    if (navOpen) {
      const { overflow } = document.body.style
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = overflow }
    }
  }, [navOpen])

  return (
    <div className="flex min-h-screen text-slate-900">
      {/* Desktop sidebar */}
      <aside className="sidebar-dark fixed inset-y-0 left-0 z-20 hidden w-60 flex-col lg:flex">
        <SidebarContent />
      </aside>

      {/* Mobile drawer + backdrop */}
      <div className={cx('fixed inset-0 z-40 lg:hidden', !navOpen && 'pointer-events-none')}>
        <div
          className={cx('absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300', navOpen ? 'opacity-100' : 'opacity-0')}
          onClick={() => setNavOpen(false)}
        />
        <aside
          className={cx(
            'sidebar-dark absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col shadow-2xl transition-transform duration-300',
            navOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <SidebarContent onNavigate={() => setNavOpen(false)} />
        </aside>
      </div>

      {/* Main */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-60">
        {/* Mobile top bar */}
        <header className="glass-strong sticky top-0 z-20 flex items-center gap-3 border-b border-white/50 px-4 py-3 lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            className="-ml-1 rounded-lg p-1.5 text-slate-600 hover:bg-white/60"
            aria-label="Open navigation"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <BrandMark />
        </header>

        <main className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="animate-fade-in-up">
            <Outlet />
          </div>
        </main>
      </div>
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
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}