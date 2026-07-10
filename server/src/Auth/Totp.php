<?php

declare(strict_types=1);

namespace App\Auth;

use OTPHP\InternalClock;
use OTPHP\TOTP as OtpTotp;

/**
 * Thin wrapper over spomky-labs/otphp for time-based one-time passwords (RFC 6238),
 * compatible with the Google Authenticator app.
 *
 * The secret is a base32 string stored on users.totp_secret. QR rendering happens on the
 * client from the otpauth:// provisioning URI, so the server needs no image/GD dependency.
 */
final class Totp
{
    private const ISSUER = 'Platform-CRM';

    /** Leeway in seconds (< period). ~1 step of drift tolerance on each side. */
    private const LEEWAY = 29;

    /** Standard 20-byte (160-bit) secret — widely compatible with authenticator apps. */
    private const SECRET_BYTES = 20;

    /** Generate a fresh random base32 secret. */
    public static function newSecret(): string
    {
        return OtpTotp::generate(new InternalClock(), self::SECRET_BYTES)->getSecret();
    }

    /** Build the otpauth://totp/... URI the authenticator app scans. */
    public static function provisioningUri(string $secret, string $accountLabel): string
    {
        $totp = self::make($secret);
        $totp->setLabel($accountLabel);
        $totp->setIssuer(self::ISSUER);

        return $totp->getProvisioningUri();
    }

    /** Constant-time verification of a submitted 6-digit code against the secret. */
    public static function verify(string $secret, string $code): bool
    {
        $code = trim($code);
        if ($code === '' || !ctype_digit($code)) {
            return false;
        }

        return self::make($secret)->verify($code, null, self::LEEWAY);
    }

    private static function make(?string $secret): OtpTotp
    {
        $clock = new InternalClock();

        return $secret === null
            ? OtpTotp::generate($clock)
            : OtpTotp::createFromSecret($secret, $clock);
    }
}
