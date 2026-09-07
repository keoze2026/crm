<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Audit;
use App\Auth\Pages;
use App\Database;
use App\Http;

/**
 * Named page-access presets for the Users page. An admin builds a preset once ("Agent",
 * "Finance", …) and picks it when creating an account instead of ticking boxes each time.
 *
 * A preset is a LIVE link, not a template. Accounts are attached to it (users.preset_id) and
 * every query that loads a user reads the preset's pages through COALESCE(ap.pages,
 * u.permissions), so adding a page here grants it to every member on their next request —
 * they see it after a refresh, with no per-user edit and no new enrolment link.
 *
 * Admin-only: these live under the /admin/ prefix, which AuthMiddleware gates on the `users`
 * page permission. Because Audit::flush() skips /admin (those events are logged with precise
 * action names instead), every write here records its own audit entry.
 */
final class AccessPresetController
{
    /** GET /admin/access-presets — every preset, alphabetical. */
    public function index(): void
    {
        $stmt = Database::connection()->query(
            'SELECT id, name, pages, created_at, updated_at FROM access_presets ORDER BY lower(name)'
        );
        Http::json(array_map([$this, 'cast'], $stmt->fetchAll()));
    }

    /** POST /admin/access-presets {name, pages[]} — create a preset. */
    public function store(): void
    {
        $body  = Http::body();
        $name  = trim((string) ($body['name'] ?? ''));
        $pages = $this->pages($body);

        if ($name === '') {
            Http::error('A preset name is required', 422);
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO access_presets (name, pages) VALUES (:name, :pages::jsonb)
             RETURNING id, name, pages, created_at, updated_at'
        );
        try {
            $stmt->execute([':name' => $name, ':pages' => json_encode($pages)]);
        } catch (\PDOException) {
            Http::error('A preset with that name already exists', 409);
        }

        $preset = $this->cast($stmt->fetch());
        Audit::record('access-preset.create', [
            'entity_type' => 'access-preset',
            'entity_id'   => $preset['id'],
            'details'     => ['name' => $name, 'pages' => $pages],
            'status_code' => 201,
        ]);
        Http::json($preset, 201);
    }

    /** PUT /admin/access-presets/{id} {name?, pages?} — rename and/or re-scope a preset. */
    public function update(array $params): void
    {
        $id   = (int) $params['id'];
        $body = Http::body();

        // Present key => change it; absent => leave alone.
        $hasName  = array_key_exists('name', $body);
        $name     = $hasName ? trim((string) $body['name']) : null;
        $hasPages = array_key_exists('pages', $body) && is_array($body['pages']);
        $pages    = $hasPages ? $this->pages($body) : null;

        if ($hasName && $name === '') {
            Http::error('A preset name is required', 422);
        }

        $stmt = Database::connection()->prepare(
            'UPDATE access_presets SET
                name       = COALESCE(:name, name),
                pages      = CASE WHEN :has_pages::boolean THEN :pages::jsonb ELSE pages END,
                updated_at = now()
              WHERE id = :id
              RETURNING id, name, pages, created_at, updated_at'
        );
        try {
            $stmt->execute([
                ':id'        => $id,
                ':name'      => $name,
                ':has_pages' => $hasPages ? 't' : 'f',
                ':pages'     => $pages !== null ? json_encode($pages) : null,
            ]);
        } catch (\PDOException) {
            Http::error('A preset with that name already exists', 409);
        }

        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Preset not found', 404);
        }

        $preset = $this->cast($row);
        Audit::record('access-preset.update', [
            'entity_type' => 'access-preset',
            'entity_id'   => $id,
            'details'     => array_filter(['name' => $name, 'pages' => $pages], static fn ($v) => $v !== null),
            'status_code' => 200,
        ]);
        Http::json($preset);
    }

    /**
     * DELETE /admin/access-presets/{id} — remove a preset.
     *
     * Members keep exactly the access they had: the preset's pages are copied onto their own
     * `permissions` column before it goes. Without that step the FK's ON DELETE SET NULL would
     * leave them with no preset AND no list, which falls back to Pages::DEFAULT_USER — quietly
     * granting MORE than the preset did. Both statements run in one transaction so members can
     * never be left detached-but-not-copied.
     */
    public function destroy(array $params): void
    {
        $id  = (int) $params['id'];
        $pdo = Database::connection();

        $pdo->beginTransaction();
        try {
            $copy = $pdo->prepare(
                'UPDATE users
                    SET permissions = (SELECT pages FROM access_presets WHERE id = :id),
                        updated_at  = now()
                  WHERE preset_id = :id'
            );
            $copy->execute([':id' => $id]);
            $kept = $copy->rowCount();

            $stmt = $pdo->prepare('DELETE FROM access_presets WHERE id = :id RETURNING name');
            $stmt->execute([':id' => $id]);
            $row = $stmt->fetch();
            if (!$row) {
                $pdo->rollBack();
                Http::error('Preset not found', 404);
            }
            $pdo->commit();
        } catch (\PDOException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        Audit::record('access-preset.delete', [
            'entity_type' => 'access-preset',
            'entity_id'   => $id,
            'details'     => ['name' => $row['name'], 'members_kept_access' => $kept],
            'status_code' => 200,
        ]);
        Http::json(['deleted' => true, 'members_detached' => $kept]);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    /**
     * The submitted page keys, filtered to the ones the app actually has.
     *
     * @param array<string,mixed> $body
     * @return array<int,string>
     */
    private function pages(array $body): array
    {
        return is_array($body['pages'] ?? null) ? Pages::sanitize($body['pages']) : [];
    }

    /** @param array<string,mixed> $r */
    private function cast(array $r): array
    {
        $r['id']    = (int) $r['id'];
        $pages      = is_string($r['pages']) ? json_decode($r['pages'], true) : $r['pages'];
        $r['pages'] = is_array($pages) ? $pages : [];
        return $r;
    }
}
