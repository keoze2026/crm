// Renders a design-principles folder's index.html to a PDF beside it in docs/design (A4, page
// numbers, bookmarks). The file name and footer come from the page's <title>:
// "Attendance Design Principles" → docs/design/Attendance-Design-Principles.pdf.
//
// Usage: node build-pdf.mjs "<repo>/docs/design/principles"   (or …/docs/design/attendance)
// Needs puppeteer-core installed OUTSIDE the repo; see ../README.md.
import puppeteer from 'puppeteer-core'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// Pass the folder when running a copy from outside the repo; defaults to this one.
const src = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(here, '..')
const html = path.join(src, 'index.html')

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle0' })
await page.evaluate(() => document.fonts.ready)
const title = (await page.title()).trim() || 'Design Principles'
const out = path.resolve(src, '..', `${title.replace(/\s+/g, '-')}.pdf`)
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  outline: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:7.5pt;color:#64748b;padding:0 16mm;display:flex;justify-content:space-between">
    <span>Platform CRM · ${title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
})
await browser.close()
console.log('wrote', out)
