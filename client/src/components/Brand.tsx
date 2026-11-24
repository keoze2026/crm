// Keoze brand marks shared by the navbar and the sign-in pages: the hexagon "K" logo with
// its letter-spaced wordmark, and the glowing blue orb with the AI sparkle.
import { cx } from './ui'

/** The hexagon with a K inside — the logo mark on its own. */
export function KeozeMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden focusable="false">
      <path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z" />
      <path d="M9.6 7.6v8.8M14.6 7.6 9.7 12l4.9 4.4" />
    </svg>
  )
}

/** Mark + "KEOZE" wordmark. `size` scales both. */
export function KeozeLogo({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  return (
    <span className={cx('inline-flex items-center text-white', size === 'lg' ? 'gap-3' : 'gap-2.5', className)}>
      <KeozeMark size={size === 'lg' ? 26 : 22} />
      <span className={cx('font-medium leading-none tracking-[0.2em]', size === 'lg' ? 'text-[19px]' : 'text-[15px]')}>KEOZE</span>
    </span>
  )
}

/** The four-point AI sparkle with its small companion star. */
export function Sparkle({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M11 3c.45 4.3 2.3 6.15 6.6 6.6-4.3.45-6.15 2.3-6.6 6.6-.45-4.3-2.3-6.15-6.6-6.6C8.7 9.15 10.55 7.3 11 3z" />
      <path d="M17.6 14.6c.2 1.75.95 2.5 2.7 2.7-1.75.2-2.5.95-2.7 2.7-.2-1.75-.95-2.5-2.7-2.7 1.75-.2 2.5-.95 2.7-2.7z" />
    </svg>
  )
}

/** The glowing blue orb at the top of the sign-in card. */
export function SparkleOrb({ size = 52 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-full text-white"
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle at 34% 28%, #8db4ff 0%, #4a80f5 42%, #2a5bd6 78%, #2149b8 100%)',
        boxShadow: '0 0 0 1px rgba(147,187,255,0.35), 0 0 28px 4px rgba(59,130,246,0.45), 0 0 70px 10px rgba(37,99,235,0.22), inset 0 1px 2px rgba(255,255,255,0.45)',
      }}
      aria-hidden
    >
      <Sparkle size={Math.round(size * 0.42)} />
    </span>
  )
}
