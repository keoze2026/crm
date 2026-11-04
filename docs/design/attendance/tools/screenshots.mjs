// Captures the Attendance day sheet for the design-principles PDF.
//
// The local sample data has no attendance for "today", nobody online and no day that needs
// review, so the states this document has to show cannot be reached from it. This script
// serves today's view from a real sample day (10 Sep 2026) INSIDE THE HEADLESS BROWSER ONLY,
// with a few rows altered to show each state: someone still in, a logout after midnight, a
// break with no login, and someone online with no login. Nothing is written to the API or
// the database; every request outside these GETs passes through untouched.
//
// Usage (puppeteer-core installed outside the repo, see ../README.md):
//   node screenshots.mjs "<repo>/docs/design/attendance/images"
import puppeteer from 'puppeteer-core'
import path from 'node:path'

const out = path.resolve(process.argv[2] ?? 'images')
const APP = process.argv[3] ?? 'http://localhost:5173/attendance'
const API = 'http://localhost:8000/api'
const SAMPLE = '2026-09-10'

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const month = today.slice(0, 7)
const getJson = async (p) => (await fetch(`${API}${p}`)).json()

// The sample day, moved to today and altered to show every state the table has.
async function sheetToday() {
  const page = await getJson(`/staff-attendance?from=${SAMPLE}&to=${SAMPLE}`)
  const rows = page.rows.map((r) => ({ ...r, work_date: today }))
  const by = (name) => rows.find((r) => r.staff_name.startsWith(name))
  Object.assign(by('Amara'), { logout_at: null, status: 'still in' })                // still at their desk
  Object.assign(by('Dafna'), { logout_at: null, status: 'still in' })
  Object.assign(by('Corin'), { login_at: '07:47', logout_at: '00:06' })              // logout after midnight
  rows.push({ id: null, source: 'fetched', edited: false, staff_id: 74, staff_name: 'Dalia Fenn', work_date: today,
    login_at: null, logout_at: null, break_min: 30, status: '', note: '', on_leave: false }) // break, no login
  return { ...page, from: today, to: today, rows }
}

async function monthSheet() {
  const page = await getJson(`/staff-attendance?from=2026-09-01&to=2026-09-30`)
  return { ...page, from: `${month}-01`, to: `${month}-30`, rows: page.rows.map((r) => ({ ...r, work_date: `${month}${r.work_date.slice(7)}` })) }
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
await page.setRequestInterception(true)

page.on('request', async (req) => {
  const u = new URL(req.url())
  if (req.method() !== 'GET' || !u.pathname.startsWith('/api/')) return req.continue()
  const p = u.pathname.replace(/^\/api/, '')
  const q = u.searchParams
  const reply = (body) => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  try {
    if (p === '/staff') {
      const staff = await getJson('/staff')
      // Emeka gets a check-in account so the bot can see him online with nothing logged.
      return reply(staff.map((s) => (s.name === 'Emeka Nwosu' ? { ...s, attendance_user_id: '999' } : s)))
    }
    if (p === '/staff-attendance' && q.get('from') === today && q.get('to') === today) return reply(await sheetToday())
    if (p === '/staff-attendance' && q.get('from') === `${month}-01`) return reply(await monthSheet())
    if (p === '/attendance/roster' && q.get('date') === today) {
      const r = await getJson(`/attendance/roster?date=${SAMPLE}`)
      return reply({ ...r, date: today })
    }
    if (p === '/attendance/exceptions' && q.get('from') === today) {
      return reply(await getJson(`/attendance/exceptions?type=${q.get('type')}&from=${SAMPLE}&to=${SAMPLE}`))
    }
    if (p === '/attendance/live') {
      return reply([
        { user_id: '900', staff_name: 'Amara Oduya', username: 'amara' },
        { user_id: '903', staff_name: 'Dafna Klein', username: 'dafna' },
        { user_id: '999', staff_name: 'Emeka Nwosu', username: 'emeka' },
      ])
    }
    if (p === '/attendance/on-break') {
      return reply([{ user_id: '903', staff_name: 'Dafna Klein', username: 'dafna', taken_at: new Date(Date.now() - 20 * 60000).toISOString(), duration_min: 30, out_for_min: 20, late_min: 0 }])
    }
  } catch (e) {
    console.error('stub failed for', p, e.message)
  }
  return req.continue()
})

await page.goto(APP, { waitUntil: 'networkidle0', timeout: 60000 })
await new Promise((r) => setTimeout(r, 2500))

const shot = async (name, selectorFn) => {
  const h = await page.evaluateHandle(selectorFn)
  const el = h.asElement()
  if (!el) { console.log('missing', name); return }
  await el.scrollIntoView()
  await new Promise((r) => setTimeout(r, 400))
  await el.screenshot({ path: `${out}/${name}.png` })
  console.log('saved', name)
}

// Whole page (content area), then the parts.
await shot('page', () => document.querySelector('h1').parentElement.parentElement.parentElement)
await shot('kpis', () => [...document.querySelectorAll('p')].find((p) => p.textContent === 'At work').closest('.grid'))
await shot('status', () => [...document.querySelectorAll('span')].find((s) => s.textContent.startsWith('Online now')).closest('.rounded-xl'))
await shot('table', () => document.querySelector('table.table-dash').closest('.rounded-xl'))
await shot('header', () => document.querySelector('h1').parentElement.parentElement)

// The review tab.
await page.evaluate(() => [...document.querySelectorAll('button[role=tab]')].find((b) => b.textContent.startsWith('Needs review')).click())
await new Promise((r) => setTimeout(r, 500))
await shot('review', () => document.querySelector('table.table-dash').closest('.rounded-xl'))
await page.evaluate(() => [...document.querySelectorAll('button[role=tab]')].find((b) => b.textContent.startsWith('All')).click())

// The correction popover: opened from Corin's row it slides down; from a row near the bottom
// of the window it opens upward. Each shot is clipped to the row plus the popover, with the
// table around them, so it shows where the popover sits.
const popoverShot = async (name, who, scrollRowTo) => {
  await page.evaluate((who, to) => {
    const btn = document.querySelector(`button[aria-label^="Correct ${who}"]`)
    const row = btn.closest('tr')
    window.scrollBy(0, row.getBoundingClientRect().top - (to === 'bottom' ? innerHeight - 90 : 260))
    btn.click()
  }, who, scrollRowTo)
  await new Promise((r) => setTimeout(r, 600))
  const clip = await page.evaluate((who) => {
    const row = document.querySelector(`button[aria-label^="Correct ${who}"]`).closest('tr').getBoundingClientRect()
    const pop = document.querySelector('[role=dialog]').getBoundingClientRect()
    const table = document.querySelector('table.table-dash').getBoundingClientRect()
    // Viewport rects → page coordinates, which is what a clip is measured in.
    const top = Math.max(0, Math.min(row.top, pop.top) - 70)
    const bottom = Math.min(innerHeight, Math.max(row.bottom, pop.bottom) + 70)
    return { x: table.left - 8 + scrollX, y: top + scrollY, width: table.width + 16, height: bottom - top }
  }, who)
  await page.screenshot({ path: `${out}/${name}.png`, clip })
  console.log('saved', name)
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 300))
}
await popoverShot('edit', 'Corin', 'top')
await popoverShot('edit-up', 'Tomas', 'bottom')
await browser.close()
