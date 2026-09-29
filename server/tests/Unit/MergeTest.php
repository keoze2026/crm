<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Merge;
use PHPUnit\Framework\TestCase;

/** Mirrors client/src/lib/merge.test.ts — the two merges must agree. */
final class MergeTest extends TestCase
{
    private const BASE = [
        'settings' => ['additional' => ['goals'], 'min_performance' => 80],
        'ticks'    => [1 => ['written'], 2 => ['behaviour']],
    ];

    public function testTakesTheStoredCopyWhenThisBrowserChangedNothing(): void
    {
        $theirs = self::BASE;
        $theirs['ticks'][3] = ['login'];
        $this->assertSame($theirs, Merge::threeWay(self::BASE, self::BASE, $theirs));
    }

    public function testKeepsThisBrowsersCopyWhenNothingElseMoved(): void
    {
        $mine = self::BASE;
        $mine['ticks'][1] = ['written', 'login'];
        $this->assertSame($mine, Merge::threeWay(self::BASE, $mine, self::BASE));
    }

    public function testTwoManagersTickingDifferentPeopleBothLand(): void
    {
        $mine = self::BASE;
        $mine['ticks'][1] = ['written', 'login'];
        $theirs = self::BASE;
        $theirs['ticks'][2] = ['behaviour', 'feedback'];

        $merged = Merge::threeWay(self::BASE, $mine, $theirs);
        $this->assertSame([1 => ['written', 'login'], 2 => ['behaviour', 'feedback']], $merged['ticks']);
    }

    public function testListsMergeAsSets(): void
    {
        $merged = Merge::threeWay(['a', 'b', 'c'], ['a', 'c', 'd'], ['a', 'b', 'e']);
        sort($merged);
        $this->assertSame(['a', 'd', 'e'], $merged);
    }

    public function testAPersonMissingOnOneSideHasNoTicks(): void
    {
        $merged = Merge::threeWay(['ticks' => [1 => ['a']]], ['ticks' => []], ['ticks' => [1 => ['a', 'b']]]);
        $this->assertSame([1 => ['b']], $merged['ticks']);
    }

    public function testThisBrowserWinsAClashOnOneValue(): void
    {
        $mine = self::BASE;
        $mine['settings']['min_performance'] = 70;
        $theirs = self::BASE;
        $theirs['settings']['min_performance'] = 90;
        $this->assertSame(70, Merge::threeWay(self::BASE, $mine, $theirs)['settings']['min_performance']);
    }

    public function testTypedOverCellsMergeCellByCellAndAClearedCellGoes(): void
    {
        $base   = ['s:1' => ['score' => '80', 'note' => 'x']];
        $mine   = ['s:1' => ['score' => '85']];
        $theirs = ['s:1' => ['score' => '80', 'note' => 'x'], 's:2' => ['score' => '60']];
        $this->assertSame(
            ['s:1' => ['score' => '85'], 's:2' => ['score' => '60']],
            Merge::threeWay($base, $mine, $theirs),
        );
    }

    public function testAddedRowsFromBothSidesAreKept(): void
    {
        $base   = [['key' => 'm:1', 'name' => 'A']];
        $mine   = [...$base, ['key' => 'm:2', 'name' => 'B']];
        $theirs = [...$base, ['key' => 'm:3', 'name' => 'C']];
        $this->assertSame(['m:1', 'm:3', 'm:2'], array_column(Merge::threeWay($base, $mine, $theirs), 'key'));
    }

    public function testMapKeyOrderIsNotAChange(): void
    {
        $this->assertTrue(Merge::same(['a' => 1, 'b' => 2], ['b' => 2, 'a' => 1]));
        $this->assertFalse(Merge::same([1, 2], [2, 1]));
    }
}
