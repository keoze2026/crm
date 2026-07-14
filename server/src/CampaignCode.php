<?php

declare(strict_types=1);

namespace App;

/** Canonicalizes campaign codes to the "C-03" house format. */
final class CampaignCode
{
    /**
     * Standardize a campaign code: uppercase, a single dash between the letter prefix
     * and a two-digit zero-padded number, with the letter O read as a zero inside the
     * number (a common typo) and the prefix matched non-greedily so a run-together code
     * splits correctly. All whitespace is stripped first, so spaces anywhere — "c -03",
     * "C- 03", "C 0 3" — are absorbed, while dashes are kept so a genuine multi-letter
     * prefix ("CO-05") still splits right. "c03", "c-3", "C-3" and "Co3" all become
     * "C-03". Codes that are not a letters-then-number pattern (e.g. "GOOGLE", "BING")
     * are returned trimmed but otherwise unchanged. Mirrors standardizeCampaignCode() in
     * client/src/lib/bundle.ts.
     */
    public static function standardize(?string $input): string
    {
        $s = trim((string) $input);
        if ($s === '') {
            return '';
        }
        $compact = preg_replace('/\s+/', '', strtoupper($s));
        if (!preg_match('/^([A-Z]+?)[._-]*([0-9O]*[0-9][0-9O]*)$/', (string) $compact, $m)) {
            return $s;
        }
        $n = (int) str_replace('O', '0', $m[2]);
        return $m[1] . '-' . str_pad((string) $n, 2, '0', STR_PAD_LEFT);
    }
}
