<?php

declare(strict_types=1);

namespace App;

/**
 * Three-way merge of JSON-shaped documents — for the sheets that save a whole document at
 * once (the Top Performer month, an Annual Reviews period).
 *
 * Such a save used to replace the stored document with the browser's copy, so two managers
 * editing the same month each overwrote the other's ticks with the copy they had loaded.
 * Now the browser also sends `base` — the document as it last read it — and the server
 * applies only what THIS browser changed since then to what is stored NOW:
 *
 *   - a value this browser didn't touch keeps whatever is stored (someone else's edit);
 *   - a value this browser changed takes the browser's (the latest edit wins a clash);
 *   - maps merge key by key, so two people editing different cells both land;
 *   - lists are sets: this browser's additions are added, its removals removed, and
 *     everybody else's additions stay.
 *
 * The client runs the same merge (client/src/lib/merge.ts) to fold a fresh server copy into
 * an open sheet without dropping what is being typed.
 */
final class Merge
{
    public static function threeWay(mixed $base, mixed $mine, mixed $theirs): mixed
    {
        if (self::same($mine, $base)) {
            return $theirs;
        }
        if (self::same($theirs, $base) || self::same($theirs, $mine)) {
            return $mine;
        }
        if (is_array($mine) && is_array($theirs) && ($base === null || is_array($base))) {
            $base ??= [];
            return self::isList($mine) || self::isList($theirs) || self::isList($base)
                ? self::mergeList($base, $mine, $theirs)
                : self::mergeMap($base, $mine, $theirs);
        }
        return $mine;
    }

    /** Equal as JSON, ignoring the order of a map's keys. */
    public static function same(mixed $a, mixed $b): bool
    {
        return json_encode(self::canonical($a)) === json_encode(self::canonical($b));
    }

    private static function canonical(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        $value = array_map([self::class, 'canonical'], $value);
        if (!array_is_list($value)) {
            ksort($value);
        }
        return $value;
    }

    /** A non-empty list. An empty array could be either, so it defers to the other sides. */
    private static function isList(array $value): bool
    {
        return $value !== [] && array_is_list($value);
    }

    private static function mergeMap(array $base, array $mine, array $theirs): array
    {
        $out = [];
        // Stored keys keep their order; keys this browser added follow.
        foreach (array_keys($theirs + $mine) as $key) {
            $b = $base[$key] ?? null;
            $m = $mine[$key] ?? null;
            $t = $theirs[$key] ?? null;
            // A collection missing on one side is an empty one, so removing someone's last
            // tick on one side and adding one on the other still merges as sets.
            if (is_array($b) || is_array($m) || is_array($t)) {
                $b ??= [];
                $m ??= [];
                $t ??= [];
            }
            $merged = self::threeWay($b, $m, $t);
            if ($merged !== null) {
                $out[$key] = $merged;
            }
        }
        return $out;
    }

    private static function mergeList(array $base, array $mine, array $theirs): array
    {
        $key    = static fn (mixed $v): string => (string) json_encode(self::canonical($v));
        $inBase = array_flip(array_map($key, $base));
        $inMine = array_flip(array_map($key, $mine));

        $out  = [];
        $seen = [];
        foreach ($theirs as $item) {
            $k = $key($item);
            if ((isset($inBase[$k]) && !isset($inMine[$k])) || isset($seen[$k])) {
                continue; // removed here, or a duplicate
            }
            $seen[$k] = true;
            $out[] = $item;
        }
        foreach ($mine as $item) {
            $k = $key($item);
            if (isset($inBase[$k]) || isset($seen[$k])) {
                continue; // not new here, or already kept
            }
            $seen[$k] = true;
            $out[] = $item;
        }
        return $out;
    }
}
