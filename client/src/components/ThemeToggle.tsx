import { useTheme } from '../lib/useTheme'

/**
 * The dark / light switch in the top bar: one icon that turns from a sun into a moon.
 * The sun's disc swells and a masking circle slides across to carve the crescent while
 * the rays spin in and shrink away; the whole glyph rolls a little as it goes. The motion
 * is CSS transitions on the SVG parts (index.css, ".theme-toggle"), driven by data-theme.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  const light = theme === 'light'
  const label = light ? 'Switch to dark mode' : 'Switch to light mode'
  return (
    <button
      type="button"
      onClick={() => setTheme(light ? 'dark' : 'light')}
      data-theme={theme}
      aria-label={label}
      title={label}
      className="theme-toggle flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#0b1222]/80 text-slate-200 transition-colors hover:border-white/20 hover:text-white"
    >
      <svg className="theme-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <mask id="theme-moon-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <circle className="theme-moon" cx="26" cy="7" r="7" fill="black" />
        </mask>
        <circle className="theme-sun" cx="12" cy="12" r="5.5" fill="currentColor" mask="url(#theme-moon-mask)" />
        <g className="theme-rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="1.5" x2="12" y2="3.5" />
          <line x1="12" y1="20.5" x2="12" y2="22.5" />
          <line x1="1.5" y1="12" x2="3.5" y2="12" />
          <line x1="20.5" y1="12" x2="22.5" y2="12" />
          <line x1="4.6" y1="4.6" x2="6" y2="6" />
          <line x1="18" y1="18" x2="19.4" y2="19.4" />
          <line x1="4.6" y1="19.4" x2="6" y2="18" />
          <line x1="18" y1="6" x2="19.4" y2="4.6" />
        </g>
      </svg>
    </button>
  )
}
