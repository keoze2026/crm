<?php

declare(strict_types=1);

namespace Tests\Api;

/**
 * Direct-DB arrangers for buyers, campaigns, destinations and call_records.
 * Used by the classes that extend Tests\ApiTestCase (which provides insert()/db()).
 */
trait SeedsCallData
{
    protected static function seedBuyer(string $code, float $rate = 0.0, ?string $name = null): int
    {
        return (int) self::insert('buyers', ['code' => $code, 'name' => $name, 'rate' => (string) $rate])['id'];
    }

    protected static function seedCampaign(string $code, array $extra = []): int
    {
        return (int) self::insert('campaigns', ['code' => $code] + $extra)['id'];
    }

    protected static function seedDestination(string $name, float $rate = 0.0, ?int $campaignId = null): int
    {
        return (int) self::insert('destinations', [
            'name'        => $name,
            'rate'        => (string) $rate,
            'campaign_id' => $campaignId,
        ])['id'];
    }

    protected static function seedBuyerRecord(
        int $buyerId,
        string $date,
        int $counted,
        float $rate,
        int $answered = 0,
        int $missed = 0,
        int $replacement = 0
    ): array {
        return self::insert('call_records', [
            'record_date' => $date,
            'record_type' => 'buyer',
            'buyer_id'    => $buyerId,
            'answered'    => $answered,
            'missed'      => $missed,
            'replacement' => $replacement,
            'counted'     => $counted,
            'rate'        => (string) $rate,
        ]);
    }

    protected static function seedCampaignRecord(
        int $campaignId,
        ?string $source,
        string $date,
        int $counted,
        float $rate,
        int $answered = 0,
        int $missed = 0,
        int $replacement = 0
    ): array {
        return self::insert('call_records', [
            'record_date' => $date,
            'record_type' => 'campaign',
            'campaign_id' => $campaignId,
            'source'      => $source,
            'answered'    => $answered,
            'missed'      => $missed,
            'replacement' => $replacement,
            'counted'     => $counted,
            'rate'        => (string) $rate,
        ]);
    }

    /** One column of one row, straight from the DB. */
    protected static function dbValue(string $sql, array $params = []): mixed
    {
        $stmt = self::db()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchColumn();
    }
}
