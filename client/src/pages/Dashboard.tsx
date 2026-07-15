import { useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis,
} from "recharts";
import { DollarSign, TrendingUp, PhoneCall } from "lucide-react";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { daysAgo, formatPeriod, money, num, pct, today } from "../lib/format";
import { DateRangeControl, type Range } from "../components/DateRange";
import DashboardPageLayout from "@/components/dashboard/page-layout";
import DashboardStat from "@/components/dashboard/stat";
import DashboardCard from "@/components/dashboard/card";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Bullet } from "@/components/ui/bullet";
import { cn } from "@/lib/utils";
import BracketsIcon from "@/components/icons/brackets";

type Granularity = "day" | "4day" | "week";

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "day", label: "DAILY" },
  { value: "4day", label: "4-DAY" },
  { value: "week", label: "WEEKLY" },
];

const trendConfig = {
  revenue: { label: "Revenue", color: "var(--chart-2)" },
  cost: { label: "Running Fee", color: "var(--chart-1)" },
  margin: { label: "Profit", color: "var(--chart-3)" },
} satisfies ChartConfig;

const buyerConfig = {
  revenue: { label: "Revenue", color: "var(--chart-2)" },
} satisfies ChartConfig;

const callsConfig = {
  answered: { label: "Answered", color: "var(--chart-2)" },
  missed: { label: "Missed", color: "var(--chart-5)" },
} satisfies ChartConfig;

const sourceConfig = {
  cost: { label: "Spend", color: "var(--chart-1)" },
} satisfies ChartConfig;

const fmtK = (v: number) => (v === 0 ? "" : `$${Math.round(v / 1000)}K`);

/** Small bullet-dot legend row shared by the chart panels. */
function Legend({ config }: { config: ChartConfig }) {
  return (
    <div className="flex items-center gap-4">
      {Object.entries(config).map(([key, cfg]) => (
        <div key={key} className="flex items-center gap-2 uppercase">
          <Bullet style={{ backgroundColor: cfg.color as string }} className="rotate-45" />
          <span className="text-xs font-medium text-muted-foreground">{cfg.label}</span>
        </div>
      ))}
    </div>
  );
}

function ChartMessage({ text }: { text: string }) {
  return <p className="py-16 text-center text-sm text-muted-foreground uppercase">{text}</p>;
}

export default function Dashboard() {
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() });
  const [granularity, setGranularity] = useState<Granularity>("day");

  const summary = useAsync(() => api.summary(range), [range.from, range.to]);
  const trends = useAsync(() => api.trends({ ...range, granularity }), [range.from, range.to, granularity]);
  const topBuyers = useAsync(() => api.topBuyers({ ...range, limit: 6 }), [range.from, range.to]);
  const topSources = useAsync(() => api.topSources({ ...range, limit: 6 }), [range.from, range.to]);

  const s = summary.data;
  const dir = (d?: number | null): "up" | "down" | undefined =>
    d == null ? undefined : d >= 0 ? "up" : "down";
  const intent = (d?: number | null, higherIsGood = true): "positive" | "negative" | "neutral" => {
    if (d == null) return "neutral";
    return (higherIsGood ? d >= 0 : d <= 0) ? "positive" : "negative";
  };

  return (
    <DashboardPageLayout
      header={{
        title: "Overview",
        icon: BracketsIcon,
        description: <DateRangeControl value={range} onChange={setRange} />,
      }}
    >
      {/* KPI stat row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <DashboardStat label="REVENUE" value={s ? money(s.revenue) : "—"} description={`${pct(s?.deltas.revenue)} vs previous`} icon={DollarSign} intent={intent(s?.deltas.revenue)} direction={dir(s?.deltas.revenue)} />
        <DashboardStat label="PROFIT" value={s ? money(s.margin) : "—"} description={`${pct(s?.deltas.margin)} vs previous`} icon={TrendingUp} intent={intent(s?.deltas.margin)} direction={dir(s?.deltas.margin)} />
        <DashboardStat label="COUNTED CALLS" value={s ? num(s.counted) : "—"} description={`${pct(s?.deltas.counted)} vs previous`} icon={PhoneCall} intent={intent(s?.deltas.counted)} direction={dir(s?.deltas.counted)} />
      </div>

      {/* Trend area chart */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <Tabs value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
            <TabsList>
              {GRANULARITIES.map((g) => (
                <TabsTrigger key={g.value} value={g.value}>{g.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Legend config={trendConfig} />
        </div>
        <div className="bg-accent rounded-lg p-3">
          {trends.error ? (
            <ChartMessage text={`${trends.error} — is the PHP API on :8000?`} />
          ) : (
            <ChartContainer className="md:aspect-[3/1] w-full" config={trendConfig}>
              <AreaChart data={trends.data ?? []} margin={{ left: -12, right: 12, top: 12, bottom: 12 }}>
                <defs>
                  {Object.keys(trendConfig).map((key) => (
                    <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.1} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid horizontal={false} strokeDasharray="8 8" strokeWidth={2} stroke="var(--muted-foreground)" opacity={0.3} />
                <XAxis dataKey="period" tickLine={false} tickMargin={12} strokeWidth={1.5} tickFormatter={formatPeriod} className="uppercase text-sm fill-muted-foreground" minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} tickMargin={0} tickCount={6} className="text-sm fill-muted-foreground" tickFormatter={fmtK} domain={[0, "dataMax"]} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" className="min-w-[200px] px-4 py-3" />} />
                <Area dataKey="revenue" type="linear" fill="url(#fill-revenue)" fillOpacity={0.4} stroke="var(--color-revenue)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Area dataKey="cost" type="linear" fill="url(#fill-cost)" fillOpacity={0.4} stroke="var(--color-cost)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Area dataKey="margin" type="linear" fill="url(#fill-margin)" fillOpacity={0.4} stroke="var(--color-margin)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ChartContainer>
          )}
        </div>
      </div>

      {/* Row: buyers bar chart + answered/missed line chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DashboardCard title="MOST ACTIVE BUYERS" intent="default" addon={<Legend config={buyerConfig} />}>
          <div className="bg-accent rounded-lg p-3">
            {topBuyers.error ? (
              <ChartMessage text="No buyer data" />
            ) : (topBuyers.data ?? []).length === 0 ? (
              <ChartMessage text={topBuyers.loading ? "Loading…" : "No buyer activity"} />
            ) : (
              <ChartContainer className="h-[280px] w-full" config={buyerConfig}>
                <BarChart data={topBuyers.data ?? []} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="8 8" strokeWidth={2} stroke="var(--muted-foreground)" opacity={0.3} />
                  <XAxis type="number" tickFormatter={fmtK} tickLine={false} axisLine={false} className="text-sm fill-muted-foreground" />
                  <YAxis type="category" dataKey="code" tickLine={false} axisLine={false} width={64} className="uppercase text-sm fill-muted-foreground" />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" className="min-w-[180px]" />} />
                  <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="ANSWERED VS MISSED" intent="default" addon={<Legend config={callsConfig} />}>
          <div className="bg-accent rounded-lg p-3">
            {trends.error ? (
              <ChartMessage text="No call data" />
            ) : (
              <ChartContainer className="h-[280px] w-full" config={callsConfig}>
                <LineChart data={trends.data ?? []} margin={{ left: -12, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="8 8" strokeWidth={2} stroke="var(--muted-foreground)" opacity={0.3} />
                  <XAxis dataKey="period" tickLine={false} tickMargin={12} strokeWidth={1.5} tickFormatter={formatPeriod} className="uppercase text-sm fill-muted-foreground" minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} tickCount={6} className="text-sm fill-muted-foreground" />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" className="min-w-[180px]" />} />
                  <Line dataKey="answered" type="monotone" stroke="var(--color-answered)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line dataKey="missed" type="monotone" stroke="var(--color-missed)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ChartContainer>
            )}
          </div>
        </DashboardCard>
      </div>

      {/* Row: traffic sources bar chart + key metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DashboardCard title="TOP TRAFFIC SOURCES" intent="default" addon={<Legend config={sourceConfig} />}>
          <div className="bg-accent rounded-lg p-3">
            {topSources.error ? (
              <ChartMessage text="No source data" />
            ) : (topSources.data ?? []).length === 0 ? (
              <ChartMessage text={topSources.loading ? "Loading…" : "No source activity"} />
            ) : (
              <ChartContainer className="h-[280px] w-full" config={sourceConfig}>
                <BarChart data={topSources.data ?? []} margin={{ left: -12, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="8 8" strokeWidth={2} stroke="var(--muted-foreground)" opacity={0.3} />
                  <XAxis dataKey="source" tickLine={false} axisLine={false} className="uppercase text-sm fill-muted-foreground" />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={fmtK} className="text-sm fill-muted-foreground" />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" className="min-w-[180px]" />} />
                  <Bar dataKey="cost" radius={[4, 4, 0, 0]} barSize={40}>
                    {(topSources.data ?? []).map((_, i) => (
                      <Cell key={i} fill={i === 0 ? "var(--chart-2)" : "var(--color-cost)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="KEY METRICS" intent="success" addon={<Badge variant="outline-success">LIVE</Badge>}>
          <div className="grid grid-cols-2 gap-3 py-2">
            <MetricTile label="ANSWER RATE" value={s ? `${s.answer_rate}%` : "—"} variant="success" />
            <MetricTile label="PROFIT MARGIN" value={s ? `${s.margin_pct}%` : "—"} variant={s && s.margin_pct < 0 ? "destructive" : "success"} />
            <MetricTile label="ACTIVE BUYERS" value={s ? num(s.active_buyers) : "—"} variant="warning" />
            <MetricTile label="ACTIVE CAMPAIGNS" value={s ? num(s.active_campaigns) : "—"} variant="warning" />
          </div>
        </DashboardCard>
      </div>

      {summary.error && (
        <p className="text-sm text-destructive">{summary.error}. Is the PHP API running on port 8000?</p>
      )}
    </DashboardPageLayout>
  );
}

function MetricTile({
  label, value, variant,
}: {
  label: string;
  value: string;
  variant: "success" | "warning" | "destructive";
}) {
  const cls = {
    success: "border-success bg-success/5 text-success ring-success/3",
    warning: "border-warning bg-warning/5 text-warning ring-warning/3",
    destructive: "border-destructive bg-destructive/5 text-destructive ring-destructive/3",
  }[variant];
  return (
    <div className={cn("border rounded-md ring-4", cls)}>
      <div className="flex items-center gap-2 py-1 px-2 border-b border-current">
        <Bullet size="sm" variant={variant === "success" ? "success" : "default"} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="py-2 px-2.5">
        <div className="text-2xl font-bold font-display">{value}</div>
      </div>
    </div>
  );
}
