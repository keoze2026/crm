<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class HealthApiTest extends ApiTestCase
{
    public function testHealthReportsConnectedDatabase(): void
    {
        $r = $this->get('/health');
        $this->assertStatus(200, $r);
        $this->assertSame(['status' => 'ok', 'database' => 'connected'], $r['json']);
    }

    public function testAuthStatusReflectsEachServersToggle(): void
    {
        $this->assertFalse($this->get('/auth/status')['json']['auth_enabled']);
        $this->assertTrue($this->get('/auth/status', true)['json']['auth_enabled']);
    }

    public function testServersUseTheTestDatabase(): void
    {
        self::resetTables('buyers');
        self::insert('buyers', ['code' => 'TST', 'name' => 'Only In Test DB']);
        $names = array_column($this->get('/buyers')['json'], 'name');
        $this->assertSame(['Only In Test DB'], $names);
    }

    public function testLoginHelperOpensAnAdminSession(): void
    {
        self::resetTables('users', 'sessions');
        $admin = self::createEnrolledUser('smokeadmin', 'admin');
        $this->loginAs($admin);
        $me = $this->get('/auth/me', true);
        $this->assertStatus(200, $me);
    }

    public function testUnknownRouteIs404(): void
    {
        $this->assertStatus(404, $this->get('/no-such-route'));
    }
}
