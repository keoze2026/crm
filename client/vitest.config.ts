import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit tests. Kept apart from vite.config.ts so the Tailwind plugin and dev proxy stay out of
// the test run. jsdom gives the hooks and the fetch-based api client a browser-like global.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
