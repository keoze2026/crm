# Review and top performer logic — HR guide

`Review-and-Top-Performer-Logic.pdf` is rendered from `index.html` with puppeteer; the
screenshots in `images/` are taken from the running app (API on :8000, Vite on :5173,
August 2026 sample data) by `tools/screenshots.mjs`.

To rebuild after a change to the logic or the page:

```sh
mkdir tmp && cd tmp && npm init -y && npm i puppeteer sharp
node ../tools/screenshots.mjs          # → shots/*.png (never writes to the DB: the tab's autosave PUT is answered locally)
node ../tools/convert.mjs              # → img/*.jpg, then copy the ones index.html references into ../images/
node ../tools/build-pdf.mjs            # → ../Review-and-Top-Performer-Logic.pdf (A4, bookmarks, clickable contents)
```

Headings in `index.html` use `padding-top` rather than `margin-top` on purpose: Chromium
doubles the PDF bookmark title of a heading whose top margin is truncated at a page top.
