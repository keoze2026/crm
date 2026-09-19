// Screenshots for the HR guide. Every write the Top Performer tab tries (its autosave PUT)
// is answered locally, so flipping a switch or ticking a chip for a picture never touches
// the database.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const OUT = 'shots'
fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })

await page.setRequestInterception(true)
page.on('request', (req) => {
  if (req.method() === 'PUT' && req.url().includes('/api/top-performer')) {
    const body = JSON.parse(req.postData() || '{}')
    req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ month: '2026-08-01', ...body }) })
  } else req.continue()
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const go = async (path) => { await page.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 60000 }); await sleep(1500) }
const shot = async (name, el) => {
  if (el) { await el.evaluate((e) => e.scrollIntoView({ block: "start" })); await sleep(250); await el.screenshot({ path: `${OUT}/${name}.png` }) }
  else await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log("shot", name)
}
const byText = async (sel, text) => {
  // The smallest element that holds the text — an ancestor holds it too.
  let best = null, bestLen = Infinity
  for (const h of await page.$$(sel)) {
    const t = await h.evaluate((e) => e.textContent.trim())
    if (t.includes(text) && t.length < bestLen) { best = h; bestLen = t.length }
  }
  return best
}
const main = () => page.$('main')

// ── Review page: header, month picker, tabs ───────────────────────────────────
await go('/review')
await shot('review-full')
const header = await page.$('main')
{
  const box = await header.boundingBox()
  await page.screenshot({ path: `${OUT}/review-header.png`, clip: { x: box.x, y: 0, width: box.width, height: 200 } })
}
// Open the month picker.
const monthBtn = await byText('button', 'August 2026')
await monthBtn.click(); await sleep(400)
{
  const box = await header.boundingBox()
  await page.screenshot({ path: `${OUT}/month-picker.png`, clip: { x: box.x + box.width - 640, y: 0, width: 640, height: 420 } })
}
await page.keyboard.press('Escape'); await page.mouse.click(5, 500); await sleep(300)

// Performance sheet
{
  const card = await page.$('main section, main .rounded-2xl, main [class*="Card"]')
  const cards = await page.$$('main > div > div')
  await shot('performance-sheet', null)
}
await go('/review?tab=behaviour')
await shot('behaviour-sheet', null)

// ── Top Performer tab ─────────────────────────────────────────────────────────
await go('/review?tab=top')
// Hide the guide so panels sit closer; it is remembered in localStorage only.
const hide = await byText('button', 'Hide guide'); if (hide) { await hide.click(); await sleep(300) }
await shot('top-overview', null)

const cardOf = async (text) => {
  const h = await byText('div', text)
  return h
}
// Headline cards: the grid that holds both.
{
  const tp = await byText('div[aria-label]', 'Top performer')
  const grid = (await tp.evaluateHandle((e) => e.parentElement)).asElement()
  await shot('top-headlines', grid, 2)
}
// Tiles
{
  const tile = await byText('div', 'Eligible for incentive')
  const grid = (await tile.evaluateHandle((e) => e.closest('.grid'))).asElement()
  await shot('top-tiles', grid, 2)
}
// Criteria panels
{
  const core = await byText('section', 'Criteria to become Top Performer')
  const grid = (await core.evaluateHandle((e) => e.parentElement)).asElement()
  await shot('top-criteria', grid, 2)
}
// Ranking (the whole leaderboard card)
{
  const rank = await byText('h4', 'Ranking —')
  const card = (await rank.evaluateHandle((e) => e.closest('.rounded-xl.border'))).asElement()
  await card.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await sleep(300)
  await shot('top-ranking', card, 2)
  const head = (await rank.evaluateHandle((e) => e.closest('.border-b'))).asElement()
  await shot('top-ranking-header', head, 2)
  // Column header with tick-all chips
  const colHead = await byText('div.grid', 'Checked for you')
  await shot('top-ranking-columns', colHead, 2)
  // First row
  const first = await page.$('main ol.divide-y > li.grid')
  await shot('top-ranking-row', first, 2)
}
// Switch an additional criterion on (answered locally — not saved).
{
  const sw = await page.$('button[aria-label="Include Continuous Learning"]')
  await sw.click(); await sleep(900)
  const core = await byText('section', 'Additional criteria')
  await core.evaluate((e) => e.scrollIntoView({ block: 'start' })); await sleep(200)
  await shot('top-additional-on', core, 2)
  const rank = await byText('h4', 'Ranking —')
  const card = (await rank.evaluateHandle((e) => e.closest('.rounded-xl.border'))).asElement()
  await card.evaluate((e) => e.scrollIntoView({ block: 'start' })); await sleep(200)
  const first = await page.$('main ol.divide-y > li.grid')
  await shot('top-row-nine-criteria', first, 2)
  // Tick a chip for the second person → Re-rank appears.
  const rows = await page.$$('main ol.divide-y > li.grid')
  // Tick the 6th person three times: they climb past the people above, so the held order goes stale.
  const chips = await rows[5].$$('button[role="checkbox"]')
  for (const c of chips.slice(0, 3)) { await c.click(); await sleep(300) }
  await sleep(900)
  const head = (await rank.evaluateHandle((e) => e.closest('.border-b'))).asElement()
  await shot('top-rerank', head, 2)
  await shot('top-row-ticked', rows[5], 2)
  // Search + filter
  const search = await page.$('input[placeholder="Search name or department…"]')
  await search.type('Amara'); await sleep(500)
  await shot('top-search', card, 2)
  await search.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await sleep(300)
  const only = await byText('label', 'Only people who pass')
  await only.click(); await sleep(500)
  await shot('top-only-eligible', card, 2)
}

// ── Where the badges appear ───────────────────────────────────────────────────
await go('/staff')
await shot('staff-page', null)
{
  const tp = await byText('h4', 'Top Performer')
  const panel = (await tp.evaluateHandle((e) => e.closest('section, .rounded-xl'))).asElement()
  await shot('staff-top-preview', panel, 2)
}
// Staff month picker → the Leaves tab wears the month's badge.
{
  const leaves = await byText('button', 'Leaves')
  await leaves.click(); await sleep(1500)
  await shot('staff-leaves', null)
}
// Attendance day sheet on an August day.
await go('/attendance')
{
  await page.$eval('input[type="date"]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, '2026-08-31')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await sleep(2500)
  await shot('attendance-day', null)
}
// Dashboard → Staff view (review month one behind the picker).
await go('/')
{
  await sleep(4000)
  const btns = await page.$$('main button')
  let btn = null
  for (const b of btns) { const t = await b.evaluate((e) => e.textContent.trim()); if (t === 'Staff') { btn = b; break } }
  console.log('dashboard staff button', !!btn)
  if (btn) { await btn.click(); await sleep(4000); await shot('dashboard-staff', null) }
}
// Sidebar / Queues (no month of their own).
await go('/queues')
await shot('queues', null)

await browser.close()
