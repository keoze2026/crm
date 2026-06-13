<?php

declare(strict_types=1);

namespace App;

/**
 * Builds a WHERE clause + bound params from the standard record query filters:
 *   from, to, type, buyer_id, campaign_id, search
 */
final class RecordFilter
{
    /** @return array{0:string,1:array<string,mixed>} [whereSql, params] */
    public static function build(string $alias = 'r'): array
    {
        $where = [];
        $params = [];

        if ($from = Http::query('from')) {
            $where[] = "{$alias}.record_date >= :from";
            $params[':from'] = $from;
        }
        if ($to = Http::query('to')) {
            $where[] = "{$alias}.record_date <= :to";
            $params[':to'] = $to;
        }
        if (($type = Http::query('type')) && in_array($type, ['buyer', 'campaign'], true)) {
            $where[] = "{$alias}.record_type = :type";
            $params[':type'] = $type;
        }
        if ($buyerId = Http::query('buyer_id')) {
            $where[] = "{$alias}.buyer_id = :buyer_id";
            $params[':buyer_id'] = (int) $buyerId;
        }
        if ($campaignId = Http::query('campaign_id')) {
            $where[] = "{$alias}.campaign_id = :campaign_id";
            $params[':campaign_id'] = (int) $campaignId;
        }
        if ($search = Http::query('search')) {
            $where[] = "(b.code ILIKE :search OR c.code ILIKE :search OR {$alias}.source ILIKE :search)";
            $params[':search'] = "%{$search}%";
        }

        $sql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        return [$sql, $params];
    }
}
