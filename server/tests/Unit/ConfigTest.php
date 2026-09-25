<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Auth\Config;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ConfigTest extends TestCase
{
    private mixed $saved;

    protected function setUp(): void
    {
        $this->saved = $_ENV['AUTH_ENABLED'] ?? null;
    }

    protected function tearDown(): void
    {
        if ($this->saved === null) {
            unset($_ENV['AUTH_ENABLED']);
        } else {
            $_ENV['AUTH_ENABLED'] = $this->saved;
        }
    }

    /** @return array<string, array{0:string,1:bool}> */
    public static function values(): array
    {
        return [
            'true'         => ['true', true],
            'TRUE'         => ['TRUE', true],
            '1'            => ['1', true],
            'yes'          => ['yes', true],
            'on'           => ['on', true],
            'padded true'  => [' true ', true],
            'false'        => ['false', false],
            '0'            => ['0', false],
            'no'           => ['no', false],
            'off'          => ['off', false],
            'empty'        => ['', false],
            'garbage'      => ['enabled', false],
            '2'            => ['2', false],
        ];
    }

    #[DataProvider('values')]
    public function testEnabledParsesTheFlag(string $value, bool $expected): void
    {
        $_ENV['AUTH_ENABLED'] = $value;
        $this->assertSame($expected, Config::enabled());
    }

    public function testDisabledWhenUnset(): void
    {
        unset($_ENV['AUTH_ENABLED']);
        $this->assertFalse(Config::enabled());
    }
}
