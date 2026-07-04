import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { cx } from './ui'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

const icon = (path: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
)

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: icon(<><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>) },
  { to: '/records', label: 'Daily Sheet', icon: icon(<><path d="M3 5h18M3 12h18M3 19h18" /></>) },
  { to: '/buyers', label: 'Buyers', icon: icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>) },
  { to: '/campaigns', label: 'Campaigns', icon: icon(<><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>) },
  // Reports (download hub) disabled — Complete Report is the only report page now.
  // { to: '/reports', label: 'Reports', icon: icon(<><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-5" /></>) },
  { to: '/complete-report', label: 'Complete Report', icon: icon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8M10 9H8" /></>) },
  { to: '/attendance', label: 'Attendance', icon: icon(<><circle cx="12" cy="7" r="4" /><path d="M5.5 21a8.38 8.38 0 0 1 13 0" /><path d="M16 11l1.5 4.5L20 14l1 5" /></>) },
]

function BrandMark() {
  return (
    <div className="font-semibold text-slate-900">Platform-CRM</div>
  )
}

/** Shared content for both the desktop sidebar and the mobile drawer. */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="px-6 py-5">
        <BrandMark />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all',
                isActive
                  ? 'bg-linear-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-600 hover:bg-white/60',
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/50 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-600/30 ring-1 ring-white/40">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v16a2 2 0 0 0 2 2h16" />
              <path d="m7 14 3.5-4 3.5 2.5L21 6" />
              <circle cx="21" cy="6" r="1.4" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-700">Platform</div>
            <div className="text-xs text-slate-400">Operations</div>
          </div>
        </div>
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
      <aside className="glass-strong fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-white/50 lg:flex">
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
            'glass-strong absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col border-r border-white/50 shadow-2xl transition-transform duration-300',
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
          <Outlet />
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