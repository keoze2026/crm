// The sign-in backdrop and card shared by Login and Enroll, to the Keoze design: a starfield
// over black, a planet whose blue-lit rim rises behind the card, the KEOZE logo above, the
// glowing sparkle orb, title and subtitle, the Keoze AI line, then the page's own form.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { KeozeLogo, Sparkle, SparkleOrb } from './Brand'
import { Spinner, cx } from './ui'

/** Deterministic stars — the same sky on every visit, no hydration jitter. */
const STARS = (() => {
  let seed = 20260
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  return Array.from({ length: 120 }, () => {
    const big = rand() > 0.88
    return {
      x: rand() * 100,
      y: rand() * 92,
      r: big ? 1.1 + rand() * 0.7 : 0.45 + rand() * 0.6,
      o: big ? 0.75 + rand() * 0.25 : 0.25 + rand() * 0.55,
    }
  })
})()

function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* A faint navy wash along the top edge. */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 75% 38% at 50% 0%, rgba(30, 58, 138, 0.38), transparent 72%)' }} />
      <svg className="absolute inset-0 h-full w-full">
        {STARS.map((s, i) => <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#fff" opacity={s.o} />)}
      </svg>
      {/* The planet: a huge disc whose top edge is the lit horizon, its apex at 77.5% of the page. */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full"
        style={{
          top: '77.5%',
          width: 'max(305vw, 1100px)',
          aspectRatio: '1',
          background: 'radial-gradient(ellipse 50% 6% at 50% 0%, rgba(37, 99, 235, 0.32), transparent 100%), linear-gradient(180deg, #050a18 0%, #020308 6%, #000 18%)',
          boxShadow: [
            '0 -1px 0 0 rgba(165, 200, 255, 0.95)', // the bright rim line
            '0 -6px 22px 0 rgba(77, 132, 255, 0.55)', // its glow just above
            '0 -24px 90px 12px rgba(37, 99, 235, 0.35)', // atmosphere
            'inset 0 1px 0 0 rgba(191, 219, 254, 0.55)',
            'inset 0 14px 40px -12px rgba(59, 130, 246, 0.5)',
          ].join(', '),
        }}
      />
    </div>
  )
}

export function AuthShell({ children, title = 'Welcome back', subtitle = 'Sign in to your account' }: {
  children: ReactNode
  title?: string
  subtitle?: string
}) {
  return (
    <div className="force-dark relative flex min-h-screen flex-col items-center overflow-hidden bg-black px-4 font-sans text-slate-200">
      <Backdrop />

      <header className="relative z-10 pt-7">
        <KeozeLogo size="lg" />
      </header>

      <main className="relative z-10 flex w-full flex-1 items-center justify-center py-14">
        <div
          className="animate-fade-in-up w-full max-w-[390px] rounded-2xl border border-blue-200/[0.12] bg-[#070a12]/[0.92] px-8 pb-7 pt-8 backdrop-blur-xl"
          style={{ boxShadow: '0 0 0 1px rgba(59,130,246,0.05), 0 24px 80px -24px rgba(37,99,235,0.45), inset 0 1px 0 rgba(255,255,255,0.04)' }}
        >
          <div className="flex flex-col items-center text-center">
            <SparkleOrb />
            <h1 className="mt-4 text-[22px] font-bold tracking-tight text-white">{title}</h1>
            <p className="mt-1.5 text-[13px] text-slate-300">{subtitle}</p>
            <p className="mt-3 max-w-[350px] text-[11px] leading-[1.65] text-[#b6c4e2]">
              <Sparkle size={11} className="mr-2 inline-block -translate-y-px text-blue-400" />
              Keoze AI is preparing your briefing on revenue, buyers and margin.
            </p>
          </div>
          <div className="mt-6">{children}</div>
          <p className="mt-4 text-center text-[10.5px] text-slate-500">Protected sign-in · Keoze CRM</p>
        </div>
      </main>

      <footer className="relative z-10 pb-6 text-[10.5px] text-slate-500">© {new Date().getFullYear()} Keoze · Platform CRM</footer>
    </div>
  )
}

/** Label above a dark field with the blue focus ring. */
export function AuthField({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11.5px] font-semibold text-slate-100">{label}</span>
      <input
        {...props}
        className={cx(
          'block h-11 w-full rounded-[10px] border border-white/10 bg-[#05080f] px-3.5 text-[13px] text-white placeholder:text-slate-500 transition-[border-color,box-shadow] focus:border-[#4a7cf0] focus:shadow-[0_0_0_3px_rgba(59,111,224,0.22)] focus:outline-none',
          className,
        )}
      />
    </label>
  )
}

/** The full-width Continue button: dim navy until the form can go, then lit blue. */
export function AuthButton({ busy, children, className, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      className={cx(
        'inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border text-[13px] font-medium transition-colors',
        disabled && !busy
          ? 'cursor-not-allowed border-blue-400/20 bg-[#0b1428] text-slate-400'
          : 'border-blue-400/50 bg-linear-to-b from-[#3d74f2] to-[#2a58d0] text-white shadow-[0_10px_28px_-10px_rgba(59,130,246,0.7)] hover:from-[#4a7ff5] hover:to-[#2f60da]',
        className,
      )}
    >
      {busy && <Spinner className="h-4 w-4 text-white" />}
      {children}
    </button>
  )
}

export function AuthError({ children }: { children: ReactNode }) {
  return <p role="alert" className="text-[12px] leading-snug text-red-400">{children}</p>
}

/** The shell with a spinner in place of a form — while the session is being looked up. */
export function AuthLoading() {
  return (
    <AuthShell>
      <div className="flex justify-center py-6"><Spinner className="h-6 w-6 text-blue-400" /></div>
    </AuthShell>
  )
}
