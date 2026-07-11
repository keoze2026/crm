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

    /**
     * Build the otpauth://totp/... URI the authenticator app scans.
     *
     * Written by hand (rather than otphp's getProvisioningUri) for maximum app
     * compatibility: a LITERAL ':' between issuer and account — some apps (Authy,
     * Microsoft, FreeOTP, Aegis) reject the "%3A" that generic encoders emit and report
     * "invalid QR / cannot interpret" — plus the standard SHA1/6-digit/30s parameters
     * spelled out explicitly so nothing is left to a stricter parser's defaults.
     */
    public static function provisioningUri(string $secret, string $accountLabel): string
    {
        $issuer  = rawurlencode(self::ISSUER);
        $account = rawurlencode($accountLabel);
        $query   = http_build_query([
            'secret'    => $secret,
            'issuer'    => self::ISSUER,
            'algorithm' => 'SHA1',
            'digits'    => 6,
            'period'    => 30,
        ], '', '&', PHP_QUERY_RFC3986);

        return "otpauth://totp/{$issuer}:{$account}?{$query}";
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
