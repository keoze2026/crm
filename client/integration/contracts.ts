// The client's declared types (src/types.ts) as runtime checks, for the areas these
// integration tests cover. Each spec is keyed by every field of its type, so it stops
// compiling when the type grows a field nobody has described.
import type {
  Buyer,
  CallRecord,
  Campaign,
  CampaignSource,
  CompleteReport,
  CompleteReportBuyerRow,
  CompleteReportCampaignRow,
  Destination,
  Paginated,
  PortalExpense,
  QueueAssignment,
  QueueCode,
  Summary,
  TopBuyer,
  TopCampaign,
  TopSource,
  TrendPoint,
  Vendor,
  VendorLedger,
  VendorPayment,
} from '../src/types'
import {
  arrayOf, bool, int, isoDate, literal, nullable, num, object, optional, str, timestamp,
  type Check,
} from './shape'

export const buyerShape = object<Buyer>({
  id: int, code: str, name: nullable(str), status: str, notes: nullable(str), rate: num,
  created_at: timestamp, revenue: num, counted: num, answered: num, missed: num,
  record_days: num, records: num, last_activity: nullable(isoDate),
})

export const campaignShape = object<Campaign>({
  id: int, code: str, name: nullable(str), status: str, notes: nullable(str), created_at: timestamp,
  cost: num, counted: num, answered: num, missed: num, records: num, sources: num,
  last_activity: nullable(isoDate),
})

export const campaignSourceShape = object<CampaignSource>({
  destination_id: nullable(int), name: str, rate: num, counted: num, cost: num,
})

export const destinationShape = object<Destination>({
  id: int, name: str, status: str, rate: num, campaign_id: nullable(int), created_at: timestamp,
})

export const callRecordShape = object<CallRecord>({
  id: int, record_date: isoDate, record_type: literal('buyer', 'campaign'),
  buyer_id: nullable(int), buyer_code: nullable(str), campaign_id: nullable(int), campaign_code: nullable(str),
  source: nullable(str), answered: int, missed: int, replacement: int, counted: int, rate: num, total_bill: num,
})

export const paginated = (item: Check): Check => object<Paginated<unknown>>({
  data: arrayOf(item),
  meta: object<Paginated<unknown>['meta']>({ page: int, per_page: int, total: int, pages: int }),
})

const nullableNum = nullable(num)

export const summaryShape = object<Summary>({
  revenue: num, cost: num, portal_expenses: optional(num), margin: num, margin_pct: num,
  answered: num, missed: num, counted: num, answer_rate: num, buyer_records: num, campaign_records: num,
  active_buyers: num, active_campaigns: num,
  deltas: object<Summary['deltas']>({
    revenue: nullableNum, cost: nullableNum, margin: nullableNum, counted: nullableNum,
    answered: optional(nullableNum), active_buyers: optional(nullableNum), active_campaigns: optional(nullableNum),
  }),
  point_deltas: optional(object<NonNullable<Summary['point_deltas']>>({ margin_pct: nullableNum, answer_rate: nullableNum })),
})

export const trendShape = object<TrendPoint>({
  period: str, revenue: num, cost: num, portal_expenses: optional(num), margin: num, counted: num, answered: num, missed: num,
})

export const topBuyerShape = object<TopBuyer>({
  id: int, code: str, name: nullable(str), revenue: num, counted: num, answered: num, missed: num,
})

export const topCampaignShape = object<TopCampaign>({
  id: int, code: str, name: nullable(str), cost: num, counted: num, answered: num, missed: num,
})

export const topSourceShape = object<TopSource>({ source: str, cost: num, counted: num })

const reportBuyerRow = object<CompleteReportBuyerRow>({
  code: str, answered: num, missed: num, replacement: num, counted: num, rate: num, total_bill: num,
})
const reportCampaignRow = object<CompleteReportCampaignRow>({
  camp: str, destination: str, answered: num, missed: num, replacement: num, counted: num, rate: num, total_bill: num,
})

export const completeReportShape = object<CompleteReport>({
  from: nullable(isoDate), to: nullable(isoDate),
  buyers: arrayOf(reportBuyerRow), campaigns: arrayOf(reportCampaignRow),
  buyer_totals: object<CompleteReport['buyer_totals']>({
    destinations: num, answered: num, missed: num, replacement: num, counted: num, rate: num, total_bill: num,
  }),
  campaign_totals: object<CompleteReport['campaign_totals']>({
    camps: num, destinations: num, answered: num, missed: num, replacement: num, counted: num, rate: num, total_bill: num,
  }),
  revenue: num, cost: num, portal_expenses: optional(num), profit: num,
})

export const portalExpenseShape = object<PortalExpense>({
  id: int, month: isoDate, name: str, voice_minutes: num, rejected_calls: num, rent_values: num,
  call_recording: num, voip_shield: num, other_expenses: num, total_amount: num, sort_order: int,
  created_at: timestamp, updated_at: timestamp,
})

export const vendorShape = object<Vendor>({
  id: nullable(int), name: str, is_manual: bool, opening_advance: num, sort_order: int,
})

export const vendorPaymentShape = object<VendorPayment>({
  vendor: str, entry_date: isoDate, converted_calls: num, price: num, payments: num, amount_paid: num,
  payment_id: nullable(int),
})

export const vendorLedgerShape = object<VendorLedger>({
  rows: arrayOf(vendorPaymentShape), opening_advance: num, prior_net: num, initial_advance: num,
})

/** What createVendorPayment / updateVendorPayment declare they answer with. */
export const paymentWriteShape = object<{ id: number; vendor: string; entry_date: string; amount_paid: number }>({
  id: int, vendor: str, entry_date: isoDate, amount_paid: num,
})

export const queueCodeShape = object<QueueCode>({
  id: int, code: str, usage_count: int, created_at: timestamp, updated_at: timestamp,
})

export const queueAssignmentShape = object<QueueAssignment>({
  id: int, board: literal('forwarding', 'camp_flow'), person_id: int, name: str,
  codes: arrayOf(object<QueueAssignment['codes'][number]>({ id: int, code: str }, { strict: true })),
  sort_order: int, created_at: timestamp, updated_at: timestamp,
})

export const deletedShape = object<{ deleted: boolean }>({ deleted: bool })
