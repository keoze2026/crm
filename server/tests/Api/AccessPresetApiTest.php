<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class AccessPresetApiTest extends ApiTestCase
{
    use AuthApiHelpers;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('users', 'sessions', 'audit_log', 'access_presets');
        $this->admin = $this->loginAsNewAdmin();
        self::resetTables('audit_log');
    }

    private static function preset(string $name, array $pages): array
    {
        return self::insert('access_presets', ['name' => $name, 'pages' => $pages]);
    }

    private static function presetRow(int $id): ?array
    {
        $stmt = self::db()->prepare('SELECT * FROM access_presets WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->fetch() ?: null;
    }

    public function testIndexIsAlphabeticalIgnoringCase(): void
    {
        self::preset('zeta', ['staff']);
        self::preset('Alpha', []);
        self::preset('beta', ['queues', 'reviews']);

        $r = $this->get('/admin/access-presets', true);
        $this->assertStatus(200, $r);
        $this->assertSame(['Alpha', 'beta', 'zeta'], array_column($r['json'], 'name'));
        $this->assertSame([], $r['json'][0]['pages']);
        $this->assertSame(['queues', 'reviews'], $r['json'][1]['pages']);
        $this->assertIsInt($r['json'][0]['id']);
    }

    public function testIndexIsForbiddenWithoutUsersPage(): void
    {
        $this->loginAs(self::createEnrolledUser('plain', 'member', ['staff', 'logs']));
        $this->assertStatus(403, $this->get('/admin/access-presets', true));
        $this->assertStatus(403, $this->post('/admin/access-presets', ['name' => 'X'], true));
        $this->assertSame(0, self::countRows('SELECT count(*) FROM access_presets'));
    }

    public function testStoreRequiresName(): void
    {
        $r = $this->post('/admin/access-presets', ['name' => '   ', 'pages' => ['staff']], true);
        $this->assertStatus(422, $r);
        $this->assertSame('A preset name is required', $r['json']['error']);
        $this->assertSame(0, self::countRows('SELECT count(*) FROM access_presets'));
    }

    public function testStoreSanitizesPagesAndAudits(): void
    {
        $r = $this->post('/admin/access-presets', ['name' => '  Agent ', 'pages' => ['reviews', 'hacker', 'queues', 'queues']], true);
        $this->assertStatus(201, $r);
        $this->assertSame('Agent', $r['json']['name']);
        $this->assertSame(['queues', 'reviews'], $r['json']['pages']);

        $row = self::presetRow($r['json']['id']);
        $this->assertSame(['queues', 'reviews'], json_decode($row['pages'], true));

        $audit = self::auditRows();
        $this->assertCount(1, $audit);
        $this->assertSame('access-preset.create', $audit[0]['action']);
        $this->assertSame((int) $this->admin['id'], (int) $audit[0]['user_id']);
        $this->assertSame(201, (int) $audit[0]['status_code']);
        $this->assertEquals(['name' => 'Agent', 'pages' => ['queues', 'reviews']], json_decode($audit[0]['details'], true));
    }

    public function testStoreWithoutPagesStoresEmptyList(): void
    {
        $r = $this->post('/admin/access-presets', ['name' => 'Nothing', 'pages' => 'staff'], true);
        $this->assertStatus(201, $r);
        $this->assertSame([], $r['json']['pages']);
    }

    public function testStoreRejectsDuplicateNameIgnoringCaseAndSpace(): void
    {
        self::preset('Finance', ['vendors']);
        $r = $this->post('/admin/access-presets', ['name' => ' FINANCE ', 'pages' => []], true);
        $this->assertStatus(409, $r);
        $this->assertSame(1, self::countRows('SELECT count(*) FROM access_presets'));
    }

    public function testUpdateUnknownPresetIs404(): void
    {
        $this->assertStatus(404, $this->put('/admin/access-presets/9999', ['name' => 'X'], true));
    }

    public function testUpdateRejectsBlankName(): void
    {
        $p = self::preset('Keep', ['staff']);
        $this->assertStatus(422, $this->put("/admin/access-presets/{$p['id']}", ['name' => ''], true));
        $this->assertSame('Keep', self::presetRow((int) $p['id'])['name']);
    }

    public function testUpdateRenamesAndLeavesPagesWhenAbsent(): void
    {
        $p = self::preset('Old', ['staff']);
        $r = $this->put("/admin/access-presets/{$p['id']}", ['name' => 'New'], true);
        $this->assertStatus(200, $r);
        $this->assertSame('New', $r['json']['name']);
        $this->assertSame(['staff'], $r['json']['pages']);
    }

    public function testUpdateReplacesPagesAndLeavesNameWhenAbsent(): void
    {
        $p = self::preset('Team', ['staff']);
        $r = $this->put("/admin/access-presets/{$p['id']}", ['pages' => ['logs', 'dashboard', 'zzz']], true);
        $this->assertStatus(200, $r);
        $this->assertSame('Team', $r['json']['name']);
        $this->assertSame(['dashboard', 'logs'], $r['json']['pages']);

        $audit = self::auditRows('access-preset.update');
        $this->assertCount(1, $audit);
        $this->assertSame((int) $p['id'], (int) $audit[0]['entity_id']);
        $this->assertEquals(['pages' => ['dashboard', 'logs']], json_decode($audit[0]['details'], true));
    }

    public function testUpdateCanEmptyThePages(): void
    {
        $p = self::preset('Team', ['staff']);
        $r = $this->put("/admin/access-presets/{$p['id']}", ['pages' => []], true);
        $this->assertStatus(200, $r);
        $this->assertSame([], $r['json']['pages']);
    }

    public function testUpdateRejectsNameOfAnotherPreset(): void
    {
        self::preset('Taken', []);
        $p = self::preset('Mine', []);
        $this->assertStatus(409, $this->put("/admin/access-presets/{$p['id']}", ['name' => 'taken'], true));
    }

    public function testUpdateReachesAttachedMembersLive(): void
    {
        $p = self::preset('Desk', ['queues']);
        $member = self::createEnrolledUser('member', 'member', null);
        self::db()->exec("UPDATE users SET preset_id = {$p['id']} WHERE id = {$member['id']}");

        $this->put("/admin/access-presets/{$p['id']}", ['pages' => ['queues', 'staff']], true);

        $this->loginAs($member);
        $this->assertSame(['queues', 'staff'], $this->get('/auth/me', true)['json']['user']['permissions']);
        $this->assertStatus(200, $this->get('/staff-leaves', true));
    }

    public function testDestroyUnknownPresetIs404(): void
    {
        $r = $this->delete('/admin/access-presets/9999', true);
        $this->assertStatus(404, $r);
        $this->assertSame([], self::auditRows());
    }

    public function testDestroyCopiesPagesOntoMembersSoAccessIsKept(): void
    {
        $p     = self::preset('Desk', ['queues']);
        $other = self::preset('Other', ['staff']);
        $a = self::createEnrolledUser('a', 'member', ['staff']);
        $b = self::createEnrolledUser('b', 'member', null);
        $c = self::createEnrolledUser('c', 'member', ['vendors']);
        self::db()->exec("UPDATE users SET preset_id = {$p['id']} WHERE id IN ({$a['id']}, {$b['id']})");
        self::db()->exec("UPDATE users SET preset_id = {$other['id']} WHERE id = {$c['id']}");

        $r = $this->delete("/admin/access-presets/{$p['id']}", true);
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => true, 'members_detached' => 2], $r['json']);

        $this->assertNull(self::presetRow((int) $p['id']));
        foreach ([$a, $b] as $u) {
            $row = self::userRow((int) $u['id']);
            $this->assertNull($row['preset_id']);
            $this->assertSame(['queues'], json_decode($row['permissions'], true));
        }
        $cRow = self::userRow((int) $c['id']);
        $this->assertSame((int) $other['id'], (int) $cRow['preset_id']);
        $this->assertSame(['vendors'], json_decode($cRow['permissions'], true));

        $audit = self::auditRows('access-preset.delete');
        $this->assertCount(1, $audit);
        $this->assertEquals(['name' => 'Desk', 'members_kept_access' => 2], json_decode($audit[0]['details'], true));

        // b had no own list; without the copy it would have fallen back to DEFAULT_USER.
        $this->loginAs($b);
        $this->assertStatus(403, $this->get('/staff-leaves', true));
        $this->assertStatus(200, $this->get('/queues', true));
    }

    public function testAdminWritesAreAuditedExactlyOnce(): void
    {
        $r = $this->post('/admin/access-presets', ['name' => 'Once', 'pages' => []], true);
        $this->put("/admin/access-presets/{$r['json']['id']}", ['name' => 'Twice'], true);
        $this->delete("/admin/access-presets/{$r['json']['id']}", true);

        $this->assertSame(
            ['access-preset.create', 'access-preset.update', 'access-preset.delete'],
            array_column(self::auditRows(), 'action')
        );
    }
}
