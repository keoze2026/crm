// Captures the Dashboard and its components for the design-principles PDF.
// Run against the local app (Vite :5173 + PHP API :8000) with puppeteer-core installed
// OUTSIDE the repo (see ../README.md). The page opens on today, which is empty in the sample
// data, so point its default range at a dense month first and revert afterwards.
import puppeteer from 'puppeteer-core'
import path from 'node:path'

const out = path.resolve(process.argv[2] ?? 'images')
const url = process.argv[3] ?? 'http://localhost:5173/'
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
await new Promise((r) => setTimeout(r, 2500))

// The whole page (main area only — the sidebar is app chrome, not part of this design).
const main = await page.evaluateHandle(() => document.querySelector('h1').closest('.animate-page-in-left'))
await main.asElement().screenshot({ path: `${out}/page.png` })

const byText = (t) => page.evaluateHandle((t) => [...document.querySelectorAll('section')].find((s) => s.textContent.includes(t)), t)
const shots = {
  'kpi-revenue': 'Revenue per counted lead',
  chart: 'Revenue by day',
  ranking: 'Revenue by buyer',
  flow: 'Where the revenue went',
  'lead-mix': 'Lead mix',
  rail: 'Time bucket',
  team: 'Team today',
}
for (const [name, text] of Object.entries(shots)) {
  let h = await byText(text)
  if (!h.asElement()) {
    // KPI cards: the first card holding the label.
    h = await page.evaluateHandle((t) => [...document.querySelectorAll('section')].find((s) => s.querySelector('span')?.textContent?.startsWith(t.split(' ')[0])), text)
  }
  await h.asElement().scrollIntoView()
  await new Promise((r) => setTimeout(r, 600))
  await h.asElement().screenshot({ path: `${out}/${name}.png` })
  console.log('saved', name)
}
// The KPI row as a group.
const kpis = await page.evaluateHandle(() => [...document.querySelectorAll('section')].find((s) => s.textContent.includes('Counted leads')).parentElement)
await kpis.asElement().scrollIntoView()
await kpis.asElement().screenshot({ path: `${out}/kpis.png` })
await browser.close()
