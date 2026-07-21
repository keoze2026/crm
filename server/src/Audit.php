<?php

declare(strict_types=1);

namespace App;

use App\Auth\Auth;

/**
 * Audit trail writer. Two entry points:
 *
 *  - Audit::begin() stashes the request envelope; Audit::flush() (a shutdown hook) writes one
 *    row for every authenticated *mutating* request (POST/PUT/PATCH/DELETE), reading the final
 *    HTTP status. Registering at the router choke point means a new controller can never forget
 *    to log. Auth endpoints are skipped here and logged explicitly instead.
 *  - Audit::record() writes a row immediately, used by AuthController for login/logout/enrol.
 *
 * Secrets are stripped from `details` before anything is written.
 */
final class Audit
{
    private const SECRET_KEYS = ['password', 'totp_secret', 'secret', 'token', 'enroll_token'];

    /** First-path-segment → singular entity type. */
    private const ENTITY_MAP = [
        'buyers'           => 'buyer',
        'campaigns'        => 'campaign',
        'destinations'     => 'destination',
        'records'          => 'record',
        'vendors'          => 'vendor',
        'vendor-payments'  => 'vendor-payment',
        'portal-expenses'  => 'portal-expense',
    ];

    /** @var array{method:string,path:string,body:array<string,mixed>}|null */
    private static ?array $context = null;

    /** Stash the current request so the shutdown hook can log it. */
    public static function begin(string $method, string $path, array $body): void
    {
        self::$context = compact('method', 'path', 'body');
    }

    /** Shutdown hook: log the mutating request if a user is authenticated. */
    public static function flush(): void
    {
        $ctx = self::$context;
        if ($ctx === null) {
            return;
        }

        $method = $ctx['method'];
        if (!in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            return; // never log reads
        }
        if (str_starts_with($ctx['path'], '/auth') || str_starts_with($ctx['path'], '/admin')) {
            return; // auth + admin events are logged explicitly with precise action names
        }
        if (str_starts_with($ctx['path'], '/audit-logs')) {
            return; // managing the log itself shouldn't spam the log
        }

        $user = Auth::user();
        if ($user === null) {
            return; // unauthenticated / rejected request — nothing to attribute
        }

        [$entityType, $entityId] = self::entity($ctx['path']);
        $action = ($entityType ?? 'request') . '.' . self::verb($method);

        self::write([
            'action'      => $action,
            'method'      => $method,
            'path'        => $ctx['path'],
            'entity_type' => $entityType,
            'entity_id'   => $entityId,
            'details'     => self::sanitize($ctx['body']),
            'status_code' => http_response_code() ?: null,
            'user'        => $user,
        ]);
    }

    /**
     * Immediate write for an explicit event (auth flow, admin action).
     *
     * @param array<string,mixed> $ctx keys: action, method, path, entity_type, entity_id,
     *                                  details, status_code, user
     */
    public static function record(string $action, array $ctx = []): void
    {
        $ctx['action'] = $action;
        $ctx['user']   = $ctx['user'] ?? Auth::user() ?? Auth::rawUser();
        if (isset($ctx['details'])) {
            $ctx['details'] = self::sanitize($ctx['details']);
        }
        self::write($ctx);
    }

    /** @param array<string,mixed> $ctx */
    private static function write(array $ctx): void
    {
        try {
            $user = $ctx['user'] ?? null;
            $stmt = Database::connection()->prepare(
                'INSERT INTO audit_log
                    (user_id, user_email, action, method, path, entity_type, entity_id, details, status_code, ip, user_agent)
                 VALUES
                    (:uid, :email, :action, :method, :path, :etype, :eid, :details, :status, :ip, :ua)'
            );
            $details = $ctx['details'] ?? null;
            $stmt->execute([
                ':uid'     => $user['id']    ?? null,
                ':email'   => $user['email'] ?? null,
                ':action'  => $ctx['action'],
                ':method'  => $ctx['method'] ?? ($_SERVER['REQUEST_METHOD'] ?? null),
                ':path'    => $ctx['path'] ?? null,
                ':etype'   => $ctx['entity_type'] ?? null,
                ':eid'     => $ctx['entity_id'] ?? null,
                ':details' => $details ? json_encode($details, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : null,
                ':status'  => $ctx['status_code'] ?? (http_response_code() ?: null),
                ':ip'      => $_SERVER['REMOTE_ADDR'] ?? null,
                ':ua'      => $_SERVER['HTTP_USER_AGENT'] ?? null,
            ]);
        } catch (\Throwable) {
            // Auditing must never break the request; swallow write failures.
        }
    }

    /** @return array{0:?string,1:?int}  [entityType, entityId] derived from the path. */
    private static function entity(string $path): array
    {
        $segments = explode('/', trim($path, '/'));
        $first    = $segments[0] ?? '';

        // First numeric segment is the entity id (e.g. /buyers/12 -> 12).
        $entityId = null;
        foreach ($segments as $seg) {
            if (ctype_digit($seg)) {
                $entityId = (int) $seg;
                break;
            }
        }

        return [self::ENTITY_MAP[$first] ?? ($first ?: null), $entityId];
    }

    private static function verb(string $method): string
    {
        return match ($method) {
            'POST'          => 'create',
            'PUT', 'PATCH'  => 'update',
            'DELETE'        => 'delete',
            default         => strtolower($method),
        };
    }

    /**
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    private static function sanitize(array $data): array
    {
        foreach (self::SECRET_KEYS as $key) {
            if (array_key_exists($key, $data)) {
                $data[$key] = '***';
            }
        }
        return $data;
    }
}
