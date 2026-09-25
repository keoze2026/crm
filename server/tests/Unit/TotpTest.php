<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Auth\Totp;
use OTPHP\InternalClock;
use OTPHP\TOTP as OtpTotp;
use PHPUnit\Framework\TestCase;

final class TotpTest extends TestCase
{
    private static function codeAt(string $secret, int $timestamp): string
    {
        return OtpTotp::createFromSecret($secret, new InternalClock())->at($timestamp);
    }

    public function testNewSecretIsA160BitBase32String(): void
    {
        $secret = Totp::newSecret();
        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $secret);
    }

    public function testNewSecretIsRandom(): void
    {
        $this->assertNotSame(Totp::newSecret(), Totp::newSecret());
    }

    public function testProvisioningUriUsesLiteralColonAndExplicitParameters(): void
    {
        $this->assertSame(
            'otpauth://totp/Platform-CRM:alice%40example.com'
            . '?secret=JBSWY3DPEHPK3PXP&issuer=Platform-CRM&algorithm=SHA1&digits=6&period=30',
            Totp::provisioningUri('JBSWY3DPEHPK3PXP', 'alice@example.com')
        );
    }

    public function testProvisioningUriEncodesTheAccountLabel(): void
    {
        $uri = Totp::provisioningUri('JBSWY3DPEHPK3PXP', 'Jane Doe: Ops/1');
        $this->assertStringStartsWith('otpauth://totp/Platform-CRM:Jane%20Doe%3A%20Ops%2F1?', $uri);
        $this->assertSame(1, substr_count(parse_url($uri, PHP_URL_PATH) ?? '', ':'));
    }

    public function testVerifyAcceptsTheCurrentCode(): void
    {
        $secret = Totp::newSecret();
        $this->assertTrue(Totp::verify($secret, self::codeAt($secret, time())));
    }

    public function testVerifyTrimsSurroundingWhitespace(): void
    {
        $secret = Totp::newSecret();
        $this->assertTrue(Totp::verify($secret, "  " . self::codeAt($secret, time()) . "\n"));
    }

    public function testVerifyRejectsCodesOutsideTheLeeway(): void
    {
        $secret = Totp::newSecret();
        $this->assertFalse(Totp::verify($secret, self::codeAt($secret, time() - 60)));
        $this->assertFalse(Totp::verify($secret, self::codeAt($secret, time() + 60)));
    }

    public function testVerifyRejectsAnotherSecretsCode(): void
    {
        $this->assertFalse(Totp::verify(Totp::newSecret(), self::codeAt(Totp::newSecret(), time())));
    }

    public function testVerifyRejectsMalformedCodes(): void
    {
        $secret = Totp::newSecret();
        $code   = self::codeAt($secret, time());
        foreach (['', '   ', '12a456', '-12345', '12 345', '1.2345', substr($code, 0, 5), $code . '0'] as $bad) {
            $this->assertFalse(Totp::verify($secret, $bad), "accepted '{$bad}'");
        }
    }
}
