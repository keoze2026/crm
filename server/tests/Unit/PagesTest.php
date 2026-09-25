<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Auth\Pages;
use PHPUnit\Framework\TestCase;

final class PagesTest extends TestCase
{
    public function testSanitizeKeepsKnownKeysInCanonicalOrder(): void
    {
        $this->assertSame(
            ['dashboard', 'queues', 'logs'],
            Pages::sanitize(['logs', 'queues', 'dashboard'])
        );
    }

    public function testSanitizeDropsUnknownKeysAndDuplicates(): void
    {
        $this->assertSame(
            ['buyers', 'staff'],
            Pages::sanitize(['staff', 'nope', 'buyers', 'staff', 'Buyers', ' buyers', ''])
        );
    }

    public function testSanitizeOfEmptyOrAllUnknownIsEmpty(): void
    {
        $this->assertSame([], Pages::sanitize([]));
        $this->assertSame([], Pages::sanitize(['admin', 'settings', 0, null]));
    }

    public function testSanitizeIgnoresArrayKeysAndReindexes(): void
    {
        $this->assertSame(['dashboard', 'vendors'], Pages::sanitize(['x' => 'vendors', 5 => 'dashboard']));
    }

    public function testSanitizeOfEverythingIsAll(): void
    {
        $this->assertSame(Pages::ALL, Pages::sanitize(array_reverse(Pages::ALL)));
    }

    public function testAllHasNoDuplicates(): void
    {
        $this->assertSame(Pages::ALL, array_values(array_unique(Pages::ALL)));
    }

    public function testDefaultUserIsASubsetOfAllWithoutAdminPages(): void
    {
        $this->assertSame(Pages::DEFAULT_USER, Pages::sanitize(Pages::DEFAULT_USER));
        $this->assertNotContains('users', Pages::DEFAULT_USER);
        $this->assertNotContains('logs', Pages::DEFAULT_USER);
    }

    public function testListsMirrorTheClientCatalogue(): void
    {
        $file = __DIR__ . '/../../../client/src/auth/pages.ts';
        if (!is_file($file)) {
            $this->markTestSkipped('client/src/auth/pages.ts not present');
        }
        $src = (string) file_get_contents($file);

        preg_match('/export const PAGES[^=]*=\s*\[(.*?)\n\]/s', $src, $m);
        preg_match_all("/key:\s*'([^']+)'/", $m[1] ?? '', $keys);
        $this->assertEqualsCanonicalizing(Pages::ALL, $keys[1], 'Pages::ALL vs PAGES in pages.ts');

        preg_match('/export const DEFAULT_USER_PAGES\s*=\s*\[(.*?)\]/s', $src, $d);
        preg_match_all("/'([^']+)'/", $d[1] ?? '', $defaults);
        $this->assertEqualsCanonicalizing(Pages::DEFAULT_USER, $defaults[1], 'Pages::DEFAULT_USER vs DEFAULT_USER_PAGES');
    }
}
