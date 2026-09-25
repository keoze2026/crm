<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Database;
use PDO;
use PHPUnit\Framework\TestCase;

final class DatabaseTest extends TestCase
{
    protected function setUp(): void
    {
        try {
            Database::connection();
        } catch (\PDOException $e) {
            $this->markTestSkipped('Test database not available: ' . $e->getMessage());
        }
    }

    public function testConnectionIsReusedAndTargetsTheTestDatabase(): void
    {
        $a = Database::connection();
        $this->assertSame($a, Database::connection());
        $this->assertSame(getenv('TEST_DB_NAME'), $a->query('SELECT current_database()')->fetchColumn());
    }

    public function testConnectionThrowsOnErrorsAndFetchesAssoc(): void
    {
        $pdo = Database::connection();
        $this->assertSame(PDO::ERRMODE_EXCEPTION, $pdo->getAttribute(PDO::ATTR_ERRMODE));
        $this->assertSame(['one' => 1], $pdo->query('SELECT 1 AS one')->fetch());
    }

    public function testIsHealthyWhenReachable(): void
    {
        $this->assertTrue(Database::isHealthy());
    }

    public function testIsNotHealthyWhenTheDatabaseCannotBeReached(): void
    {
        $prop      = new \ReflectionProperty(Database::class, 'connection');
        $saved     = $prop->getValue();
        $savedName = $_ENV['DB_NAME'];
        try {
            $prop->setValue(null, null);
            $_ENV['DB_NAME'] = 'crm_no_such_db_test';
            $this->assertFalse(Database::isHealthy());
        } finally {
            $_ENV['DB_NAME'] = $savedName;
            $prop->setValue(null, $saved);
        }
    }
}
