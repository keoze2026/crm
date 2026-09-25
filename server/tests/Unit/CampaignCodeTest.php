<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\CampaignCode;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class CampaignCodeTest extends TestCase
{
    /** @return array<string, array{0:?string,1:string}> */
    public static function codes(): array
    {
        return [
            'already canonical'           => ['C-03', 'C-03'],
            'lowercase run-together'      => ['c03', 'C-03'],
            'single digit with dash'      => ['c-3', 'C-03'],
            'uppercase single digit'      => ['C-3', 'C-03'],
            'letter O typed for zero'     => ['Co3', 'C-03'],
            'O inside number after dash'  => ['C-O3', 'C-03'],
            'space before dash'           => ['c -03', 'C-03'],
            'space after dash'            => ['C- 03', 'C-03'],
            'spaces everywhere'           => ['C 0 3', 'C-03'],
            'tab and newline'             => ["C\t0\n3", 'C-03'],
            'outer whitespace'            => ['  c-3  ', 'C-03'],
            'multi-letter prefix kept'    => ['CO-05', 'CO-05'],
            'long prefix run-together'    => ['abc12', 'ABC-12'],
            'underscore separator'        => ['c_7', 'C-07'],
            'dot separator'               => ['c.7', 'C-07'],
            'repeated separators'         => ['C--_03', 'C-03'],
            'three digits kept'           => ['C-100', 'C-100'],
            'extra leading zeros dropped' => ['C-003', 'C-03'],
            'zero'                        => ['C-0', 'C-00'],
            'all-letter code unchanged'   => ['GOOGLE', 'GOOGLE'],
            'all-letter code keeps case'  => ['  google ', 'google'],
            'no digit in number'          => ['C-OO', 'C-OO'],
            'trailing letter'             => ['C-3A', 'C-3A'],
            'digits only'                 => ['03', '03'],
            'dangling dash'               => ['c-', 'c-'],
            'empty'                       => ['', ''],
            'whitespace only'             => ["  \t ", ''],
            'null'                        => [null, ''],
        ];
    }

    #[DataProvider('codes')]
    public function testStandardize(?string $input, string $expected): void
    {
        $this->assertSame($expected, CampaignCode::standardize($input));
    }

    #[DataProvider('codes')]
    public function testStandardizeIsIdempotent(?string $input, string $expected): void
    {
        $this->assertSame($expected, CampaignCode::standardize($expected));
    }
}
