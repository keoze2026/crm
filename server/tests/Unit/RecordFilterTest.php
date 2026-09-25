<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\RecordFilter;
use PHPUnit\Framework\TestCase;

final class RecordFilterTest extends TestCase
{
    private array $savedGet;

    protected function setUp(): void
    {
        $this->savedGet = $_GET;
        $_GET = [];
    }

    protected function tearDown(): void
    {
        $_GET = $this->savedGet;
    }

    public function testNoFiltersGivesEmptyClauseAndNoParams(): void
    {
        $this->assertSame(['', []], RecordFilter::build());
    }

    public function testEmptyStringFiltersAreIgnored(): void
    {
        $_GET = ['from' => '', 'to' => '', 'type' => '', 'buyer_id' => '', 'campaign_id' => '', 'search' => ''];
        $this->assertSame(['', []], RecordFilter::build());
    }

    public function testDateRange(): void
    {
        $_GET = ['from' => '2026-05-01', 'to' => '2026-05-31'];
        $this->assertSame(
            ['WHERE r.record_date >= :from AND r.record_date <= :to', [':from' => '2026-05-01', ':to' => '2026-05-31']],
            RecordFilter::build()
        );
    }

    public function testAliasIsApplied(): void
    {
        $_GET = ['from' => '2026-05-01', 'search' => 'x'];
        [$sql] = RecordFilter::build('rec');
        $this->assertSame(
            'WHERE rec.record_date >= :from AND (b.code ILIKE :search OR c.code ILIKE :search OR rec.source ILIKE :search)',
            $sql
        );
    }

    public function testKnownTypesAreAccepted(): void
    {
        foreach (['buyer', 'campaign'] as $type) {
            $_GET = ['type' => $type];
            $this->assertSame(['WHERE r.record_type = :type', [':type' => $type]], RecordFilter::build());
        }
    }

    public function testUnknownTypeIsIgnored(): void
    {
        foreach (['Buyer', 'vendor', "buyer' OR 1=1"] as $type) {
            $_GET = ['type' => $type];
            $this->assertSame(['', []], RecordFilter::build());
        }
    }

    public function testIdsAreCastToInt(): void
    {
        $_GET = ['buyer_id' => '12', 'campaign_id' => '7abc'];
        $this->assertSame(
            ['WHERE r.buyer_id = :buyer_id AND r.campaign_id = :campaign_id', [':buyer_id' => 12, ':campaign_id' => 7]],
            RecordFilter::build()
        );
    }

    public function testSearchIsWrappedInWildcards(): void
    {
        $_GET = ['search' => 'C-03'];
        [$sql, $params] = RecordFilter::build();
        $this->assertSame('WHERE (b.code ILIKE :search OR c.code ILIKE :search OR r.source ILIKE :search)', $sql);
        $this->assertSame([':search' => '%C-03%'], $params);
    }

    public function testSearchForZeroIsApplied(): void
    {
        $_GET = ['search' => '0'];
        [$sql, $params] = RecordFilter::build();
        $this->assertStringContainsString(':search', $sql);
        $this->assertSame([':search' => '%0%'], $params);
    }

    public function testAllFiltersCombineInFixedOrder(): void
    {
        $_GET = [
            'search' => 'g', 'campaign_id' => '2', 'buyer_id' => '1',
            'type' => 'campaign', 'to' => '2026-05-31', 'from' => '2026-05-01',
            'unrelated' => 'ignored',
        ];
        [$sql, $params] = RecordFilter::build();
        $this->assertSame(
            'WHERE r.record_date >= :from AND r.record_date <= :to AND r.record_type = :type'
            . ' AND r.buyer_id = :buyer_id AND r.campaign_id = :campaign_id'
            . ' AND (b.code ILIKE :search OR c.code ILIKE :search OR r.source ILIKE :search)',
            $sql
        );
        $this->assertSame([':from', ':to', ':type', ':buyer_id', ':campaign_id', ':search'], array_keys($params));
    }
}
