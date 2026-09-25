<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Http;
use PHPUnit\Framework\TestCase;

/** Only Http::query — body() reads php://input and the response helpers exit(). */
final class HttpTest extends TestCase
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

    public function testQueryReturnsThePresentValue(): void
    {
        $_GET = ['from' => '2026-05-01'];
        $this->assertSame('2026-05-01', Http::query('from'));
        $this->assertSame('2026-05-01', Http::query('from', 'fallback'));
    }

    public function testQueryReturnsNullWhenMissingAndNoDefault(): void
    {
        $this->assertNull(Http::query('from'));
    }

    public function testQueryReturnsDefaultWhenMissing(): void
    {
        $this->assertSame('25', Http::query('limit', '25'));
    }

    public function testEmptyStringFallsBackToDefault(): void
    {
        $_GET = ['limit' => ''];
        $this->assertSame('25', Http::query('limit', '25'));
        $this->assertNull(Http::query('limit'));
    }

    public function testZeroAndWhitespaceAreReturnedAsIs(): void
    {
        $_GET = ['page' => '0', 'q' => ' '];
        $this->assertSame('0', Http::query('page', '1'));
        $this->assertSame(' ', Http::query('q', 'x'));
    }

    public function testKeyLookupIsCaseSensitive(): void
    {
        $_GET = ['From' => '2026-05-01'];
        $this->assertNull(Http::query('from'));
    }
}
