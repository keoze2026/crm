<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Changes;
use PHPUnit\Framework\TestCase;

final class ChangesTest extends TestCase
{
    public function testAWriteIsFiledUnderItsArea(): void
    {
        $this->assertSame('calls', Changes::areaFor('/records/12'));
        $this->assertSame('calls', Changes::areaFor('/vendor-payments'));
        $this->assertSame('staff', Changes::areaFor('/staff-salary-holds/3'));
        $this->assertSame('attendance', Changes::areaFor('/staff-attendance/9'));
        $this->assertSame('queues', Changes::areaFor('/queue-codes'));
        $this->assertSame('reviews', Changes::areaFor('/annual-reviews/reset'));
        $this->assertSame('users', Changes::areaFor('/admin/users/4'));
    }

    public function testAnUnlistedSurfaceStillCountsAsAChange(): void
    {
        $this->assertSame(Changes::OTHER, Changes::areaFor('/something-new/1'));
    }

    public function testSigningInAndOutChangesNothingShown(): void
    {
        $this->assertNull(Changes::areaFor('/auth/login'));
        $this->assertNull(Changes::areaFor('/changes'));
        $this->assertNull(Changes::areaFor('/'));
    }
}
