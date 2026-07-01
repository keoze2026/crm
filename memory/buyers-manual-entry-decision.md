---
name: buyers-manual-entry-decision
description: Why the Buyers record grids got manual Counted entry but the Monthly Sheet did not
metadata:
  type: project
---

Stakeholder feedback (2026-07-01) asked to enable manual data entry on the Buyers "revenue sheet" + "leads records section" and retire the "Add record" flow. Scope was confirmed as **just the record grids** (`RecordsSection` → `RecordsGrid`, used by both "Revenue billing" on the Buyers page and "Leads Record" on the Records page), NOT the per-buyer "Monthly Sheet" (`BuyersSheet`).

**Why:** In `RecordsGrid`, `counted` is a real, independently-stored column on `call_records`, so making it a free input (decoupled from answered+missed) was frontend-only and directly supports the two buyer categories — "Yes": counted = answered+missed; "No/Non-Missed": missed excluded. In `BuyersSheet`, answered/missed/counted/revenue are SQL SUM aggregates over call_records (see `BuyerController::index`) with no backing column, so manual entry there would need a backend + schema change — deferred.

**How to apply:** If asked to make the Monthly Sheet's answered/missed/counted keyable, that requires new stored columns on `buyers` (or writing a synthetic call_record) and touches dashboard/reports that aggregate call_records. Also: Average Rate (Total ÷ Counted) was added to the totals rows; the top "Add record" button in `RecordsSection` is commented out (records are keyed inline).

Follow-up (same day): buyer **rate** is now typeable per record in the grids (removed the `disabled={isBuyer}` lock in `RecordsGrid` existing + draft rows, and in `RecordForm`); the draft row gained a "+ New…" option that lets you **type a new buyer/campaign code** (find-or-create via `buyer_code`/`campaign_code` on the store endpoint, seeding the entity rate). Existing-row entity code stays read-only on purpose — it's the buyer identity, and renaming lives on the Monthly Sheet (`BuyerController::update` also has a notes-wipe footgun when notes aren't sent). Editing a buyer record's rate only changes that record; editing the master rate on the Monthly Sheet still propagates to all its records.

Follow-up 2 (same day): in the **buyer** draft row the "Destination" column dropdown is now commented out and replaced with a plain typing `Input` (find-or-create by code; auto-fills rate from a matching destination until the rate is keyed in manually).

Follow-up 3 (same day): applied full parity to the **Campaigns > Cost billing** section (same shared `RecordsGrid`). The `DraftRow` was refactored so BOTH the "Campaign" entity column and the "Source" (destinations) column are now typing `Input`s — all dropdowns/Selects commented out, `Select` import removed. `entityId`/`newSource`/`destOptions`/`onEntity`/`onSourceSel` and the client-side `createDestination` pre-create were dropped; the server (`RecordController::store` → `resolveId` + `sourceRate`) now handles find-or-create + linking the source with its rate. `onEntityType` (rate auto-fill only for buyers) and `onSourceType` (rate auto-fill from matching destination) drive the two fields. Existing campaign rows were already editable (source Input + rate); their entity code stays read-only like buyers.
