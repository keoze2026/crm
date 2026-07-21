# Dashboard — Content & Requirements Brief

**For the designer.** This document describes *what the Dashboard page must contain, what
every number means, and how the data actually behaves*. It deliberately does **not**
describe the current design — layout, colour, typography and component styling are yours
to decide. Where something is fixed, it is called out explicitly under **Constraints**.

**Scope: the Dashboard page only.** The application has nine pages; the other eight
(Daily Sheet, Buyers, Campaigns, Vendors, Portal Expenses, Complete Report, Attendance,
Users, System Logs) are out of scope.

---

## 1. What this page is for

Platform-CRM is an internal pay-per-call / call-forwarding operations system. The business
sits between two sides:

- **Buyer side — money in.** We deliver phone calls to buyers and bill them per call.
- **Campaign side — money out.** We buy those calls from traffic sources / campaigns.

The business is the spread between the two. The Dashboard is the single page that shows
whether that spread is healthy over a chosen period.

**Audience:** internal staff — operations people who work in the system all day, and
management who check in periodically. Not customers, not public.

**Nature of the page:** read-only. Nothing on it is edited, submitted, or approved. It is a
monitoring surface, opened many times a day, often left open, often scanned in a few
seconds rather than studied.

**Access:** the page is permission-gated; users without dashboard access never reach it.

### The questions the page must answer

In priority order — this is the hierarchy the design should express:

1. **Are we making money this period, and is that better or worse than before?**
2. **How much came in, how much went out?**
3. **Is the money trend stable or volatile across the period?**
4. **Is call quality holding** (are the calls we deliver actually being answered)?
5. **Which buyers account for the revenue?**
6. **Which traffic sources are absorbing the spend?**

> **Decision to confirm with us:** we currently treat Profit as the single most important
> figure on the page. If you want to propose a different emphasis, say so before you design
> to it.

---

## 2. Vocabulary you need to design correctly

These words appear on screen and mean specific things. They are **domain terms and must not
be renamed** without our sign-off — staff use them verbally every day.

| Term | Meaning |
|---|---|
| **Revenue (billed)** | What we bill buyers. Money in. |
| **Running Fee** | What we pay campaigns / traffic sources. Money out. It is a **cost**, despite the neutral-sounding name. |
| **Profit** | Revenue − Running Fee. |
| **Counted** | Calls that are **billable**. This is the commercial volume figure. |
| **Answered** | Calls the buyer actually picked up. |
| **Missed** | Calls that reached the buyer and were not picked up. |
| **Buyer** | A customer we sell calls to. Identified on screen by a short code (`L48`, `RTG 04`, `HOZ`). |
| **Campaign / Traffic source** | Where the calls come from. Sources are named (`Priority Y`, `XXD`, `PDSO`). |

Two traps worth designing around:

- **Counted ≠ Answered.** They are separate numbers with separate meanings, and a viewer
  who conflates them will misread the page. They currently appear in different blocks.
- **"Running Fee" reads like a neutral or even positive word but is a cost.** A rising
  Running Fee is bad news. Any good/bad signalling must be driven by the meaning of each
  metric, not by whether its number went up (see §4).

---

## 3. Required content

Everything below must appear on the page. Grouping, ordering, and form (tile, chart, table,
something else) are your decisions — except where noted. All of it is scoped by one global
date range (§5).

### 3.1 Headline financial metrics — 4 values, each with a period-over-period comparison

| Metric | Definition | Notes |
|---|---|---|
| Revenue (billed) | Total billed to buyers in the range | Up is good |
| Running Fee | Total paid to campaigns in the range | **Down is good** |
| Profit | Revenue − Running Fee | Up is good. **Frequently negative in real operation** |
| Counted Calls | Total billable calls in the range | Up is good. A count, not money |

Each carries a **comparison against the immediately preceding period of the same length**
(a 7-day range compares to the 7 days before it), expressed as a percentage change. The
comparison can be **absent** — it is not computed for open-ended ranges — and the design
must handle a metric with no comparison without looking broken.

### 3.2 Secondary metrics — 4 values, no comparison

| Metric | Definition | Notes |
|---|---|---|
| Answer Rate | Answered ÷ (Answered + Missed), as a percentage | Quality indicator. 0 when there are no calls |
| Profit Margin | Profit ÷ Revenue, as a percentage | **Can be negative.** 0 when there is no revenue |
| Active Buyers | Number of distinct buyers with activity in the range | A small integer |
| Active Campaigns | Number of distinct campaigns with activity in the range | A small integer |

These are supporting context, not headlines. They deliberately have no trend or comparison.

### 3.3 Money over time

A time series across the selected range showing **Revenue, Running Fee and Profit
together**, so the viewer can see the spread and its volatility.

- Three series, same time axis, all in currency.
- Profit is the derived one (Revenue − Running Fee) and **crosses zero**, so the series
  goes negative. A zero baseline is meaningful here.
- The viewer can change the time bucket: **Daily, 4-day, or Weekly**. This control affects
  only this data (and 3.5, which shares the same series). Buckets are calendar-aligned —
  weekly buckets start Monday.

### 3.4 Buyer ranking

**Up to 8 buyers, ranked by revenue** in the range.

- Each has: short code (the identifier shown), full name, revenue, and counted / answered /
  missed volumes.
- Only revenue is currently surfaced; the other fields are available if you want them in a
  detail-on-demand treatment.
- Purely informational — there is no click-through to a buyer page from this screen today.

### 3.5 Call quality over time

A time series over the same range and the same bucket control as 3.3, showing **Answered
and Missed call counts**.

- Two series, counts not currency.
- In healthy operation these two are **wildly different in magnitude** — answered runs in
  the thousands per day while missed runs near zero. A shared linear axis flattens the
  Missed series against the baseline. This is the central design problem of this block: the
  small number is the one that matters, and it is the one that disappears.

### 3.6 Traffic source spend

**Up to 6 traffic sources, ranked by spend** in the range.

- Each has: source name, total spend, and counted calls.
- Spend is extremely **top-heavy** — the leading source can be several times the second and
  orders of magnitude above the tail, so a linear comparison renders the smallest sources as
  invisible slivers.
- Cost-per-call (spend ÷ counted) is derivable and was considered useful; include it if your
  design has room.
- A source with no name recorded appears as the literal string `(none)`.

---

## 4. How the data actually behaves

Design against these facts, not against tidy sample numbers. Every one of them has produced
an awkward result in the current build.

| Characteristic | Reality |
|---|---|
| **Money magnitude** | Seven figures over a 90-day range (e.g. `$9,257,923`); low four figures over a single quiet day. The design must hold both without re-layout. |
| **Negative values** | Profit and Profit Margin are genuinely negative in normal operation (`-$172,064`, `-1.9%`). This is a headline metric that is regularly negative — it needs a deliberate treatment, not just a minus sign. |
| **Comparison magnitude** | Period-over-period changes are not gentle. `+154.3%`, `+228.6%` are real observed values. Assume three digits plus a sign. |
| **Missing comparison** | Can be absent entirely for a metric (§3.1). |
| **Zero / empty range** | A range with no activity yields zeros across every metric and empty series. Currently there is **no empty state at all** — the page renders zeros and blank charts. One is required. |
| **Time series length** | 1 to ~90 points on Daily; ~23 on 4-day; ~13 on Weekly. Label crowding at the long end is a real problem. |
| **Series scale disparity** | Answered vs Missed differ by 2–3 orders of magnitude (§3.5). |
| **Ranking skew** | Traffic source spend is heavily top-weighted (§3.6). |
| **Label lengths** | Buyer codes 2–8 characters; source names 2–15 characters. Short, but not uniform. |
| **Currency** | USD only. No multi-currency, no localisation. |
| **Freshness** | Data is fetched when the page opens and when the range or bucket changes. It does **not** auto-refresh or stream. There is no "last updated" indicator today; consider whether the viewer needs one. |
| **Load behaviour** | The six blocks arrive as four independent requests that resolve at different times, so the page fills in progressively. Any one of them can fail on its own. |

### Good/bad signalling

Colour or iconography indicating "good" and "bad" must follow the **meaning** of each
metric, not the direction of its change:

- Revenue up = good. Profit up = good. Counted Calls up = good.
- **Running Fee up = bad, Running Fee down = good.**
- Profit and Profit Margin below zero = bad regardless of direction of change.

The current build gets this partly wrong and produces contradictory signals (a red-flagged
cost increase paired with a downward arrow). Please define one coherent convention and
apply it consistently.

---

## 5. Required interactions

Only two controls exist on this page, and we are not adding more in this round:

1. **Date range — global.** Scopes every number on the page. Must offer both quick presets
   and an arbitrary custom range, including a single day. The presets in use are: Today,
   Yesterday, Last 7 days, Last 30 days, Last 90 days, This month. **Default on open: the
   last 7 days.** The selected range must be readable at a glance without opening the
   control.
2. **Time bucket — local to the time-series content.** Daily / 4-day / Weekly, affecting
   §3.3 and §3.5 only.

Everything else is static. There is **no** drill-down, no click-through to other pages, no
zoom, no series toggling, no annotation, no export, no saved views, no alerting. Detail on
hover is welcome; anything that navigates or changes data is out of scope.

---

## 6. States you must design

For the page and, where they differ, per block:

- **Loading** — first load, with blocks arriving independently at different times.
- **Loaded** — the normal case.
- **Refreshing** — the range or bucket changed and new data is in flight while previous
  numbers are still on screen. The current build shows stale numbers with no indication at
  all; this needs solving.
- **Empty** — valid range, no activity. Currently undesigned.
- **Error** — one or more blocks failed while others succeeded. Must not imply the whole
  page is broken.
- **Metric without a comparison** — see §3.1.
- **Negative headline value** — see §4.

---

## 7. Constraints

These are fixed. Everything not listed here is open.

**Platform**
- Web application, internal, desktop-first. Modern browsers only.
- Usable content width is approximately **1150px on a 1440px screen** — a fixed 240px
  navigation sidebar sits to the left of the content area, and the content column is capped
  at 1280px. Please design the page against that usable width, not the full viewport.
- Must work down to **375px**. Mobile use is real but secondary; below roughly 1024px the
  sidebar collapses and the full width becomes available.

**Implementation**
- Built in React with **Recharts** as the charting library. Area, line, bar, scatter,
  composed and radial charts, custom tooltips, gradients, per-item colouring and custom SVG
  marks are all achievable. Canvas/WebGL visuals, physics-based motion, and sophisticated
  automatic label placement are not, without a library change we are not planning. If a
  concept depends on something unusual, flag it early and we will confirm feasibility.
- Styled with Tailwind CSS. Designs land most cleanly on a 4px spacing rhythm and a small
  set of radii and shadows. This shapes implementation cost, not your visual direction.

**Design system**
- The app has a shared visual language across all nine pages and shared components,
  including the date-range control, which is reused elsewhere. **The Dashboard may lead a
  visual refresh, but it cannot diverge from the rest of the app in isolation.** If your
  direction implies changes to shared elements, call them out separately.

**Accessibility**
- **WCAG AA contrast for all text and meaningful UI boundaries**, verified against the
  actual page background rather than plain white.
- Data series must remain distinguishable **without relying on hue alone** — verify in
  greyscale and for common colour-vision deficiencies.
- Motion must respect `prefers-reduced-motion`.

**Not in scope unless we agree separately**
- Dark mode. There is none today, and adding one is an app-wide commitment.
- Any new metric, filter, comparison, drill-down or export.

---

## 8. What the data cannot currently do

So you don't design around something that doesn't exist. None of the following is available
today; each would require backend work:

- **Targets, budgets or goals** — there is nothing to show progress against.
- **Forecasts or projections.**
- **Per-metric history for the headline figures** — there is no sparkline-ready series
  behind Revenue, Running Fee, Profit or Counted Calls individually. The only time series
  available are the two described in §3.3 and §3.5.
- **Trend history per buyer or per traffic source** — rankings are a single total per entity
  for the range, with no time dimension.
- **Comparison against arbitrary periods** — only the immediately preceding period of equal
  length.
- **Any segmentation** beyond buyer and traffic source: no geography, no time-of-day, no
  call duration, no agent or team breakdown.
- **Alerts, thresholds, anomaly flags or annotations.**
- **Real-time or streaming updates.**

If your concept needs any of it, propose it in writing with the metric precisely defined
and we will scope it. Do not assume it into a mockup.

---

## 9. Deliverables

1. Full page at **1440px** (checked at 1280px), **768px**, and **375px**.
2. All states from §6, including the ones that don't exist today (empty, refreshing,
   partial error, missing comparison, negative headline value).
3. Both controls from §5 in closed and open/active states.
4. Chart specifications: for each visualisation, the mark, axes, scale, labelling, legend
   and hover-detail treatment — plus your explicit answers to the two hard cases: the
   **zero crossing / negative range** in §3.3 and the **scale disparity** in §3.5.
5. Your good/bad signalling convention (§4), stated as a rule and shown applied.
6. A token sheet: colour with the semantic meaning of each value, type scale, spacing,
   radius, elevation — and a note on anything that would be new to the app's shared system.
7. Accessibility verification against §7.
8. A structured design file with real components, not flattened images. **Populate it with
   the realistic values from §4** — seven-figure money, a negative Profit, a three-digit
   percentage change, a 90-point Daily series, near-zero Missed against thousands of
   Answered, and a top-heavy source ranking.

---

## 10. Reference

A screenshot of the current implementation is available at
`docs/user-manual/images/raw/dashboard-full.png`. It is provided **only** as evidence of
the content and the data's real shape. It is not a design to preserve, extend, or reference
— treat the visual direction as open.
