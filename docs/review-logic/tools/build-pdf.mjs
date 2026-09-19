import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.goto('file:///' + dir.split(path.sep).join('/') + '/index.html', { waitUntil: 'networkidle0' })
await page.pdf({
  path: path.join(dir, 'Review-and-Top-Performer-Logic.pdf'),
  format: 'A4',
  printBackground: true,
  outline: true,
  tagged: true,
  margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-family:'Segoe UI',sans-serif;font-size:8px;color:#94a3b8;padding:0 15mm;display:flex;justify-content:space-between">
    <span>Review and top performer logic · Platform-CRM · HR guide</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
})
await browser.close()
console.log('built')
