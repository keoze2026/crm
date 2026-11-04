# Attendance design principles — source

`index.html` is the source of `docs/design/Attendance-Design-Principles.pdf`: the rules the
Attendance day sheet follows (taken from the designer's mock, Attendance.pdf), its colour and
status meanings, the component specs, and where the build departs from the mock. It shares
its styles with `../principles/` (the Dashboard document).

## Rebuild the PDF

puppeteer is **not** a project dependency. Install it in a scratch folder outside the repo;
it drives the installed Chrome:

```sh
cd <scratch> && npm init -y && npm i puppeteer-core@24
cp "<repo>/docs/design/attendance/tools/screenshots.mjs" "<repo>/docs/design/principles/tools/build-pdf.mjs" .
```

1. **Screenshots** (only when the Day sheet changed). Start the API (:8000) and Vite (:5173),
   then `node screenshots.mjs "<repo>/docs/design/attendance/images"`.
   The sample data has nobody at work "today", so the script serves 10 Sep 2026 as today
   **inside the headless browser only** (request interception, GETs only), with a few rows
   altered to show each state. Nothing reaches the database. No code change is needed.
   `mobile.png` is the real, unstubbed empty "today" at 390px; it is captured separately.
2. **PDF:** `node build-pdf.mjs "<repo>/docs/design/attendance"`. The output name and footer
   come from the page `<title>`.

Headings use `padding-top`, not `margin-top`: Chromium doubles a PDF bookmark title when a
heading's top margin is cut at a page break.
