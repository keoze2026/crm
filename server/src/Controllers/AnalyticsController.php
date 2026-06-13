<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;
use PDO;

final class AnalyticsController
{
    /** Headline KPIs with previous-period comparison. */
    public function summary(): void
    {
        $from = Http::query('from');
        $to   = Http::query('to');
        $pdo  = Database::connection();

        $current = $this->aggregate($pdo, $from, $to);

        // Compute deltas vs the immediately preceding period of the same length.
        $deltas = ['revenue' => null, 'cost' => null, 'margin' => null, 'counted' => null];
        if ($from && $to) {
            $start = new \DateTimeImmutable($from);
            $end   = new \DateTimeImmutable($to);
            $days  = $start->diff($end)->days + 1;
            $prevEnd   = $start->modify('-1 day');
            $prevStart = $prevEnd->modify('-' . ($days - 1) . ' day');
            $previous  = $this->aggregate($pdo, $prevStart->format('Y-m-d'), $prevEnd->format('Y-m-d'));
            foreach (['revenue', 'cost', 'margin', 'counted'] as $k) {
                $deltas[$k] = $this->pctChange((float) $previous[$k], (float) $current[$k]);
            }
        }

        $current['deltas'] = $deltas;
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

    // --- helpers ----------------------------------------------------------------

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
