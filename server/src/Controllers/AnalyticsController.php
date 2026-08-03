<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;
use PDO;

final class AnalyticsController
{
    /**
     * Traffic sources whose cost-side Replacement is entered by hand instead of being
     * auto-filled as (Answered − Counted). Edit this list to change the exclusions
     * (matching ignores case and surrounding whitespace). Keep it in sync with the
     * client copy — REPLACEMENT_AUTOFILL_EXCLUDED_SOURCES in client/src/lib/bundle.ts.
     */
    private const REPLACEMENT_AUTOFILL_EXCLUDED_SOURCES = ['PDSO'];

    /** Headline KPIs with previous-period comparison. */
    public function summary(): void
    {
        $from = Http::query('from');
        $to   = Http::query('to');
        $pdo  = Database::connection();

        $current = $this->aggregate($pdo, $from, $to);

        // Metrics compared as a % change vs the previous period.
        $ratioKeys = ['revenue', 'cost', 'margin', 'counted', 'answered', 'active_buyers', 'active_campaigns'];
        // Metrics that are already percentages — comparing them as a "% change of a %" is
        // misleading, so these carry a percentage-POINT difference instead.
        $pointKeys = ['margin_pct', 'answer_rate'];

        $deltas      = array_fill_keys($ratioKeys, null);
        $pointDeltas = array_fill_keys($pointKeys, null);

        // Compute deltas vs the immediately preceding period of the same length.
        if ($from && $to) {
            $start = new \DateTimeImmutable($from);
            $end   = new \DateTimeImmutable($to);
            $days  = $start->diff($end)->days + 1;
            $prevEnd   = $start->modify('-1 day');
            $prevStart = $prevEnd->modify('-' . ($days - 1) . ' day');
            $previous  = $this->aggregate($pdo, $prevStart->format('Y-m-d'), $prevEnd->format('Y-m-d'));
            foreach ($ratioKeys as $k) {
                $deltas[$k] = $this->pctChange((float) $previous[$k], (float) $current[$k]);
            }
            foreach ($pointKeys as $k) {
                $pointDeltas[$k] = round((float) $current[$k] - (float) $previous[$k], 1);
            }
        }

        $current['deltas']       = $deltas;
        $current['point_deltas'] = $pointDeltas;
        Http::json($current);
    }

    /** Revenue / cost / margin time series grouped by day, month, or year. */
    public function trends(): void
    {
        $granularity = Http::query('granularity', 'day');
        $period = match ($granularity) {
            'year'  => "to_char(record_date, 'YYYY')",
            'month' => "to_char(record_date, 'YYYY-MM')",
            // Week bucket → the Monday that starts the ISO week.
            'week'  => "to_char(date_trunc('week', record_date), 'YYYY-MM-DD')",
            // 4-day bucket → start date of each fixed 4-day window (anchored at 2000-01-01).
            '4day'  => "to_char(DATE '2000-01-01' + ((record_date - DATE '2000-01-01') / 4) * 4, 'YYYY-MM-DD')",
            default => "to_char(record_date, 'YYYY-MM-DD')",
        };

        [$where, $params] = $this->dateWhere();
        $sql = "
            SELECT {$period} AS period,
                   COALESCE(SUM(total_bill) FILTER (WHERE record_type = 'buyer'), 0)    AS revenue,
                   COALESCE(SUM(total_bill) FILTER (WHERE record_type = 'campaign'), 0) AS cost,
                   COALESCE(SUM(counted)    FILTER (WHERE record_type = 'buyer'), 0)    AS counted,
                   COALESCE(SUM(answered)   FILTER (WHERE record_type = 'buyer'), 0)    AS answered,
                   COALESCE(SUM(missed)     FILTER (WHERE record_type = 'buyer'), 0)    AS missed
            FROM call_records
            {$where}
            GROUP BY period
            ORDER BY period
        ";
        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);

        $rows = array_map(function ($r) {
            $revenue = (float) $r['revenue'];
            $cost = (float) $r['cost'];
            return [
                'period'   => $r['period'],
                'revenue'  => $revenue,
                'cost'     => $cost,
                'margin'   => $revenue - $cost,
                'counted'  => (int) $r['counted'],
                'answered' => (int) $r['answered'],
                'missed'   => (int) $r['missed'],
            ];
        }, $stmt->fetchAll());

        Http::json($rows);
    }

    /** Ranked buyers (revenue side). */
    public function topBuyers(): void
    {
        $metric = in_array(Http::query('metric'), ['revenue', 'counted', 'answered'], true)
            ? Http::query('metric') : 'revenue';
        $limit = min(50, max(1, (int) Http::query('limit', '10')));
        $orderCol = $metric === 'revenue' ? 'revenue' : $metric;

        [$where, $params] = $this->dateWhere('AND');
        $sql = "
            SELECT b.id, b.code, b.name,
                   COALESCE(SUM(r.total_bill), 0) AS revenue,
                   COALESCE(SUM(r.counted), 0)    AS counted,
                   COALESCE(SUM(r.answered), 0)   AS answered,
                   COALESCE(SUM(r.missed), 0)     AS missed
            FROM call_records r
            JOIN buyers b ON b.id = r.buyer_id
            WHERE r.record_type = 'buyer' {$where}
            GROUP BY b.id
            ORDER BY {$orderCol} DESC
            LIMIT {$limit}
        ";
        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($this->numerify($stmt->fetchAll(), ['revenue', 'counted', 'answered', 'missed']));
    }

    /** Ranked campaigns (cost side). */
    public function topCampaigns(): void
    {
        $limit = min(50, max(1, (int) Http::query('limit', '10')));
        [$where, $params] = $this->dateWhere('AND');
        $sql = "
            SELECT c.id, c.code, c.name,
                   COALESCE(SUM(r.total_bill), 0) AS cost,
                   COALESCE(SUM(r.counted), 0)    AS counted,
                   COALESCE(SUM(r.answered), 0)   AS answered,
                   COALESCE(SUM(r.missed), 0)     AS missed
            FROM call_records r
            JOIN campaigns c ON c.id = r.campaign_id
            WHERE r.record_type = 'campaign' {$where}
            GROUP BY c.id
            ORDER BY cost DESC
            LIMIT {$limit}
        ";
        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($this->numerify($stmt->fetchAll(), ['cost', 'counted', 'answered', 'missed']));
    }

    /** Ranked traffic sources within campaigns. */
    public function topSources(): void
    {
        $limit = min(50, max(1, (int) Http::query('limit', '10')));
        [$where, $params] = $this->dateWhere('AND');
        $sql = "
            SELECT COALESCE(source, '(none)') AS source,
                   COALESCE(SUM(total_bill), 0) AS cost,
                   COALESCE(SUM(counted), 0)    AS counted
            FROM call_records
            WHERE record_type = 'campaign' {$where}
            GROUP BY source
            ORDER BY cost DESC
            LIMIT {$limit}
        ";
        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($this->numerify($stmt->fetchAll(), ['cost', 'counted']));
    }

    /** Downloadable per-buyer performance report (CSV). */
    public function report(): void
    {
        [$where, $params] = $this->dateWhere('AND');
        $sql = "
            SELECT b.code,
                   COALESCE(SUM(r.answered), 0)   AS answered,
                   COALESCE(SUM(r.missed), 0)     AS missed,
                   COALESCE(SUM(r.counted), 0)    AS counted,
                   COALESCE(SUM(r.total_bill), 0) AS revenue
            FROM call_records r
            JOIN buyers b ON b.id = r.buyer_id
            WHERE r.record_type = 'buyer' {$where}
            GROUP BY b.id
            ORDER BY revenue DESC
        ";
        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);

        $rows = (function () use ($stmt) {
            while ($r = $stmt->fetch()) {
                yield [
                    $r['code'], $r['answered'], $r['missed'], $r['counted'],
                    number_format((float) $r['revenue'], 2, '.', ''),
                ];
            }
        })();

        Http::csv(
            'buyer-performance.csv',
            ['Buyer', 'Answered', 'Missed', 'Counted', 'Revenue'],
            $rows
        );
    }

    /**
     * Complete system report (JSON): the full revenue side (per buyer) and the
     * full cost side (per campaign + destination), with grand totals and profit.
     * Unlike the ranked endpoints this is unlimited — it returns *every* row so
     * the frontend can render the formatted "Complete Report" download.
     *
     * Rows with zero counted Leads are dropped (`HAVING SUM(counted) > 0`): a buyer
     * or campaign that billed nothing in the period is noise on a billing report.
     * Both totals footers are computed from these filtered rows, so the TOTAL band,
     * the destination / camp counts and the profit figure all stay in step — and
     * because revenue and cost only come from `total_bill`, which is zero whenever
     * counted is zero, dropping the rows can never move the profit number.
     */
    public function completeReport(): void
    {
        $pdo = Database::connection();
        [$where, $params] = $this->dateWhere('AND');

        // Revenue side — one row per buyer (the "DESTINATION" in the revenue table).
        $buyerSql = "
            SELECT b.code,
                   COALESCE(SUM(r.answered), 0)     AS answered,
                   COALESCE(SUM(r.missed), 0)       AS missed,
                   COALESCE(SUM(r.replacement), 0)  AS replacement,
                   COALESCE(SUM(r.counted), 0)      AS counted,
                   COALESCE(SUM(r.total_bill), 0)   AS total_bill,
                   CASE WHEN COALESCE(SUM(r.counted), 0) > 0
                        THEN COALESCE(SUM(r.total_bill), 0) / SUM(r.counted)
                        ELSE 0 END                  AS rate
            FROM call_records r
            JOIN buyers b ON b.id = r.buyer_id
            WHERE r.record_type = 'buyer' {$where}
            GROUP BY b.id, b.code
            HAVING COALESCE(SUM(r.counted), 0) > 0
            ORDER BY rate DESC, total_bill DESC, b.code
        ";
        $stmt = $pdo->prepare($buyerSql);
        $stmt->execute($params);
        $buyers = $this->numerify($stmt->fetchAll(), ['answered', 'missed', 'replacement', 'counted', 'total_bill', 'rate']);

        // Cost side — one row per campaign + traffic source (the "DESTINATION").
        // Similar campaign codes / sources are bundled together regardless of case,
        // spaces or punctuation ("C 03" = "C-03" = "C03"), summing their metrics. The
        // displayed label is the most-used raw variant within each bundle.
        //
        // Replacement mirrors the campaigns sheet: auto-filled per record as
        // GREATEST(0, answered − counted), except for excluded traffic sources, which
        // keep their hand-entered value. The excluded list is a hardcoded constant, so
        // it is safe to inline (values are quote-escaped regardless).
        $excludedList = implode(', ', array_map(
            static fn ($s) => "'" . str_replace("'", "''", strtoupper((string) $s)) . "'",
            self::REPLACEMENT_AUTOFILL_EXCLUDED_SOURCES
        ));
        $isExcludedSource = $excludedList !== ''
            ? "upper(btrim(COALESCE(r.source, ''))) IN ({$excludedList})"
            : 'FALSE';
        $replacementSum = "SUM(CASE WHEN {$isExcludedSource} "
            . "THEN r.replacement ELSE GREATEST(0, r.answered - r.counted) END)";

        $campSql = "
            SELECT mode() WITHIN GROUP (ORDER BY c.code)                       AS camp,
                   COALESCE(mode() WITHIN GROUP (ORDER BY NULLIF(r.source, '')), '(none)') AS destination,
                   COALESCE(SUM(r.answered), 0)     AS answered,
                   COALESCE(SUM(r.missed), 0)       AS missed,
                   COALESCE({$replacementSum}, 0)   AS replacement,
                   COALESCE(SUM(r.counted), 0)      AS counted,
                   COALESCE(SUM(r.total_bill), 0)   AS total_bill,
                   CASE WHEN COALESCE(SUM(r.counted), 0) > 0
                        THEN COALESCE(SUM(r.total_bill), 0) / SUM(r.counted)
                        ELSE 0 END                  AS rate
            FROM call_records r
            JOIN campaigns c ON c.id = r.campaign_id
            WHERE r.record_type = 'campaign' {$where}
            GROUP BY upper(regexp_replace(c.code, '[^A-Za-z0-9]', '', 'g')),
                     upper(regexp_replace(COALESCE(r.source, ''), '[^A-Za-z0-9]', '', 'g'))
            HAVING COALESCE(SUM(r.counted), 0) > 0
            ORDER BY rate DESC, total_bill DESC, camp
        ";
        $stmt = $pdo->prepare($campSql);
        $stmt->execute($params);
        $campaigns = $this->numerify($stmt->fetchAll(), ['answered', 'missed', 'replacement', 'counted', 'total_bill', 'rate']);

        // Actual date span covered by the returned data.
        [$spanWhere, $spanParams] = $this->dateWhere('WHERE');
        $spanStmt = $pdo->prepare(
            "SELECT to_char(MIN(record_date), 'YYYY-MM-DD') AS \"from\",
                    to_char(MAX(record_date), 'YYYY-MM-DD') AS \"to\"
             FROM call_records {$spanWhere}"
        );
        $spanStmt->execute($spanParams);
        $span = $spanStmt->fetch() ?: ['from' => null, 'to' => null];

        Http::json([
            'from'            => $span['from'] ?? null,
            'to'              => $span['to'] ?? null,
            'buyers'          => $buyers,
            'campaigns'       => $campaigns,
            'buyer_totals'    => $this->buyerTotals($buyers),
            'campaign_totals' => $this->campaignTotals($campaigns),
            'revenue'         => array_sum(array_column($buyers, 'total_bill')),
            'cost'            => array_sum(array_column($campaigns, 'total_bill')),
            'profit'          => array_sum(array_column($buyers, 'total_bill'))
                                 - array_sum(array_column($campaigns, 'total_bill')),
        ]);
    }

    // --- helpers ----------------------------------------------------------------

    /** Grand-total footer for the revenue table (one buyer per row). */
    private function buyerTotals(array $rows): array
    {
        $counted = array_sum(array_column($rows, 'counted'));
        $bill    = array_sum(array_column($rows, 'total_bill'));
        return [
            'destinations' => count($rows),
            'answered'     => array_sum(array_column($rows, 'answered')),
            'missed'       => array_sum(array_column($rows, 'missed')),
            'replacement'  => array_sum(array_column($rows, 'replacement')),
            'counted'      => $counted,
            'total_bill'   => $bill,
            'rate'         => $counted > 0 ? $bill / $counted : 0.0,
        ];
    }

    /** Grand-total footer for the cost table (camp count + distinct destinations). */
    private function campaignTotals(array $rows): array
    {
        $counted = array_sum(array_column($rows, 'counted'));
        $bill    = array_sum(array_column($rows, 'total_bill'));
        // Rows are already bundled by normalized code/source, but the displayed
        // labels are raw variants — re-normalize before counting distinct so the
        // camp / destination counts match the bundling exactly.
        $camps = array_unique(array_map([self::class, 'normKey'], array_column($rows, 'camp')));
        $dests = array_unique(array_map([self::class, 'normKey'], array_column($rows, 'destination')));
        return [
            'camps'        => count($camps),
            'destinations' => count($dests),
            'answered'     => array_sum(array_column($rows, 'answered')),
            'missed'       => array_sum(array_column($rows, 'missed')),
            'replacement'  => array_sum(array_column($rows, 'replacement')),
            'counted'      => $counted,
            'total_bill'   => $bill,
            'rate'         => $counted > 0 ? $bill / $counted : 0.0,
        ];
    }

    /** Canonical key for matching campaign codes / sources: upper-case, alnum only. */
    private static function normKey(?string $s): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $s) ?? '');
    }

    private function aggregate(PDO $pdo, ?string $from, ?string $to): array
    {
        [$where, $params] = $this->dateWhere('WHERE', $from, $to);
        $sql = "
            SELECT
                COALESCE(SUM(total_bill) FILTER (WHERE record_type = 'buyer'), 0)    AS revenue,
                COALESCE(SUM(total_bill) FILTER (WHERE record_type = 'campaign'), 0) AS cost,
                COALESCE(SUM(answered) FILTER (WHERE record_type = 'buyer'), 0)      AS answered,
                COALESCE(SUM(missed)   FILTER (WHERE record_type = 'buyer'), 0)      AS missed,
                COALESCE(SUM(counted)  FILTER (WHERE record_type = 'buyer'), 0)      AS counted,
                COUNT(*) FILTER (WHERE record_type = 'buyer')                        AS buyer_records,
                COUNT(*) FILTER (WHERE record_type = 'campaign')                     AS campaign_records,
                COUNT(DISTINCT buyer_id)                                             AS active_buyers,
                COUNT(DISTINCT campaign_id)                                          AS active_campaigns
            FROM call_records
            {$where}
        ";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $r = $stmt->fetch();

        $revenue = (float) $r['revenue'];
        $cost = (float) $r['cost'];
        $answered = (int) $r['answered'];
        $missed = (int) $r['missed'];

        return [
            'revenue'          => $revenue,
            'cost'             => $cost,
            'margin'           => $revenue - $cost,
            'margin_pct'       => $revenue > 0 ? round(($revenue - $cost) / $revenue * 100, 1) : 0.0,
            'answered'         => $answered,
            'missed'           => $missed,
            'counted'          => (int) $r['counted'],
            'answer_rate'      => ($answered + $missed) > 0 ? round($answered / ($answered + $missed) * 100, 1) : 0.0,
            'buyer_records'    => (int) $r['buyer_records'],
            'campaign_records' => (int) $r['campaign_records'],
            'active_buyers'    => (int) $r['active_buyers'],
            'active_campaigns' => (int) $r['active_campaigns'],
        ];
    }

    /** Build a date WHERE/AND clause from from/to query params (or explicit values). */
    private function dateWhere(string $keyword = 'WHERE', ?string $from = null, ?string $to = null): array
    {
        $from ??= Http::query('from');
        $to   ??= Http::query('to');
        $clauses = [];
        $params = [];
        if ($from) {
            $clauses[] = 'record_date >= :from';
            $params[':from'] = $from;
        }
        if ($to) {
            $clauses[] = 'record_date <= :to';
            $params[':to'] = $to;
        }
        if (!$clauses) {
            return ['', []];
        }
        $glue = implode(' AND ', $clauses);
        return [($keyword === 'WHERE' ? "WHERE {$glue}" : "AND {$glue}"), $params];
    }

    private function pctChange(float $prev, float $curr): ?float
    {
        if ($prev == 0.0) {
            return $curr == 0.0 ? 0.0 : null; // null = "new" (no baseline)
        }
        return round(($curr - $prev) / abs($prev) * 100, 1);
    }

    private function numerify(array $rows, array $keys): array
    {
        foreach ($rows as &$r) {
            foreach ($keys as $k) {
                $r[$k] = (float) $r[$k];
            }
        }
        return $rows;
    }
}
