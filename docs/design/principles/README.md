# Dashboard design principles — source

`index.html` is the source of `docs/design/Dashboard-Design-Principles.pdf`: the rules the
Dashboard design follows (taken from the designer's mock, Dashboard.pdf), the tokens,
the component specs, and where the build departs from the mock.

## Rebuild the PDF

puppeteer is **not** a project dependency. Install it in a scratch folder outside the repo;
it drives the installed Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`):

```sh
cd <scratch> && npm init -y && npm i puppeteer-core@24
cp "<repo>/docs/design/principles/tools/"*.mjs .
```

1. **Screenshots** (only when the Dashboard changed). Start the API (:8000) and Vite (:5173).
   The page opens on today, which is empty in the sample data, so temporarily set the
   default range in `client/src/pages/Dashboard.tsx` to a dense month (March 2026 for the
   profitable shots; 4 May – 13 Jun 2026 for the loss shots `loss-kpi.png` / `loss-flow.png`
   and `mobile.png`), run, then **revert the default**:
   `node screenshots.mjs "<repo>/docs/design/principles/images"`
2. **PDF:** `node build-pdf.mjs "<repo>/docs/design/principles"` from the scratch folder.
   It reads `index.html` there and writes `docs/design/Dashboard-Design-Principles.pdf`. The
   script is shared with `../attendance/`: the output name and footer come from the page
   `<title>`.

Headings use `padding-top`, not `margin-top`: Chromium doubles a PDF bookmark title when a
heading's top margin is cut at a page break.
