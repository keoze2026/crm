<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

/**
 * Vendors (traffic sources) — the CRUD behind the Vendors page.
 *
 * A "vendor" is a traffic source. The page shows one tab per vendor; the tab set is the
 * UNION of the distinct campaign sources (call_records.source where record_type='campaign')
 * and the rows in the `vendors` table. Everything is keyed by NAME rather than a foreign
 * key, so a discovered source ("DXTST") and a hand-added vendor share one namespace.
 *
 *  - `vendors`         : per-vendor metadata (manual flag + a hand-entered Due/Advance
 *                        balance — signed: positive = Due, negative = Advance).
 *  - `vendor_payments` : the dated ledger rows. The "Payments" column shown in the UI is
 *                        derived (converted_calls * price) and is never stored.
 */
final class VendorController
{
    // ── Vendors (tab list + metadata) ───────────────────────────────────────────

    /**
     * The tab list: distinct campaign sources merged with the `vendors` table, keyed by
     * case/space-insensitive name. Discovered-only sources come back with id=null and
     * zeroed metadata; `vendors` rows carry their id, manual flag and Due/Advance balance.
     */
    public function index(): void
    {
        $pdo = Database::connection();

        // (a) Metadata rows.
        $vendors = $pdo->query(
            'SELECT id, name, is_manual, manual_due, sort_order
               FROM vendors'
        )->fetchAll();

        // (b) Distinct traffic sources actually used on the Campaigns side.
        $sources = $pdo->query(
            "SELECT DISTINCT btrim(source) AS name
               FROM call_records
              WHERE record_type = 'campaign'
                AND source IS NOT NULL
                AND btrim(source) <> ''"
        )->fetchAll(\PDO::FETCH_COLUMN);

        // Merge by normalised key; `vendors` rows win (they hold the real id + metadata).
        $byKey = [];
        foreach ($vendors as $v) {
            $byKey[$this->key($v['name'])] = [
                'id'         => (int) $v['id'],
                'name'       => $v['name'],
                'is_manual'  => (bool) $v['is_manual'],
                'manual_due' => (float) $v['manual_due'],
                'sort_order' => (int) $v['sort_order'],
            ];
        }
        foreach ($sources as $name) {
            $k = $this->key($name);
            if (!isset($byKey[$k])) {
                $byKey[$k] = [
                    'id'         => null,
                    'name'       => $name,
                    'is_manual'  => false,
                    'manual_due' => 0.0,
                    'sort_order' => 0,
                ];
            }
        }

        $out = array_values($byKey);
        usort($out, function (array $a, array $b): int {
            return [$a['sort_order'], $a['is_manual'] ? 1 : 0, strtolower($a['name'])]
               <=> [$b['sort_order'], $b['is_manual'] ? 1 : 0, strtolower($b['name'])];
        });

        Http::json($out);
    }

    /** Add a manually-entered vendor (a traffic source not present in Campaigns). */
    public function store(): void
    {
        $body = Http::body();
        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '') {
            Http::error('Vendor name is required', 422);
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO vendors (name, is_manual)
             VALUES (:name, true)
             RETURNING id, name, is_manual, manual_due, sort_order'
        );
        try {
            $stmt->execute([':name' => $name]);
        } catch (\PDOException $e) {
            Http::error('A vendor with that name already exists', 409);
        }
        Http::json($this->castVendor($stmt->fetch()), 201);
    }

    /**
     * Upsert a vendor's hand-entered Due/Advance balance by name. Works for discovered
     * vendors too (they have no `vendors` row until this is first edited). `manual_due` is
     * signed: positive = amount Due, negative = Advance.
     */
    public function upsertMeta(): void
    {
        $body = Http::body();
        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '') {
            Http::error('Vendor name is required', 422);
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO vendors (name, manual_due)
             VALUES (:name, :due)
             ON CONFLICT (lower(btrim(name))) DO UPDATE SET
                manual_due = COALESCE(:due2, vendors.manual_due),
                updated_at = now()
             RETURNING id, name, is_manual, manual_due, sort_order'
        );
        $due = isset($body['manual_due']) ? $this->signed($body['manual_due']) : null;
        $stmt->execute([
            ':name' => $name,
            ':due'  => $due ?? 0,
            ':due2' => $due,
        ]);
        Http::json($this->castVendor($stmt->fetch()));
    }

    /** Delete a manually-added vendor and its ledger rows. Discovered vendors are kept. */
    public function destroy(array $params): void
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare('SELECT name, is_manual FROM vendors WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Vendor not found', 404);
        }
        if (!$row['is_manual']) {
            Http::error('Only manually-added vendors can be deleted', 422);
        }

        // No FK between the tables — remove the ledger rows by name, then the vendor.
        $del = $pdo->prepare('DELETE FROM vendor_payments WHERE lower(btrim(vendor)) = lower(btrim(:name))');
        $del->execute([':name' => $row['name']]);
        $pdo->prepare('DELETE FROM vendors WHERE id = :id')->execute([':id' => (int) $params['id']]);

        Http::json(['deleted' => true]);
    }

    // ── Vendor payments (dated ledger rows) ─────────────────────────────────────

    /** Ledger rows for one vendor within an optional date range. */
    public function payments(): void
    {
        $vendor = trim((string) Http::query('vendor', ''));
        if ($vendor === '') {
            Http::error('A vendor is required', 422);
        }
        $from = Http::query('from');
        $to   = Http::query('to');

        $sql = 'SELECT id, vendor, to_char(entry_date, \'YYYY-MM-DD\') AS entry_date,
                       converted_calls, price, amount_paid, created_at, updated_at
                  FROM vendor_payments
                 WHERE lower(btrim(vendor)) = lower(btrim(:vendor))';
        $params = [':vendor' => $vendor];
        if ($from) { $sql .= ' AND entry_date >= :from'; $params[':from'] = $from; }
        if ($to)   { $sql .= ' AND entry_date <= :to';   $params[':to']   = $to; }
        $sql .= ' ORDER BY entry_date ASC, id ASC';

        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($this->castPayments($stmt->fetchAll()));
    }

    public function storePayment(): void
    {
        $body   = Http::body();
        $vendor = trim((string) ($body['vendor'] ?? ''));
        $date   = $this->date($body['entry_date'] ?? null);
        if ($vendor === '') {
            Http::error('A vendor is required', 422);
        }
        if ($date === null) {
            Http::error('A valid entry date is required', 422);
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO vendor_payments (vendor, entry_date, converted_calls, price, amount_paid)
             VALUES (:vendor, :date, :calls, :price, :paid)
             RETURNING id, vendor, to_char(entry_date, \'YYYY-MM-DD\') AS entry_date,
                       converted_calls, price, amount_paid, created_at, updated_at'
        );
        $stmt->execute([
            ':vendor' => $vendor,
            ':date'   => $date,
            ':calls'  => $this->count($body['converted_calls'] ?? 0),
            ':price'  => $this->money($body['price']            ?? 0),
            ':paid'   => $this->money($body['amount_paid']      ?? 0),
        ]);
        Http::json($this->castPayments([$stmt->fetch()])[0], 201);
    }

    public function updatePayment(array $params): void
    {
        $body = Http::body();
        $date = array_key_exists('entry_date', $body) ? $this->date($body['entry_date']) : null;

        $stmt = Database::connection()->prepare(
            'UPDATE vendor_payments SET
                entry_date      = COALESCE(:date,  entry_date),
                converted_calls = COALESCE(:calls, converted_calls),
                price           = COALESCE(:price, price),
                amount_paid     = COALESCE(:paid,  amount_paid),
                updated_at      = now()
             WHERE id = :id
             RETURNING id, vendor, to_char(entry_date, \'YYYY-MM-DD\') AS entry_date,
                       converted_calls, price, amount_paid, created_at, updated_at'
        );
        $stmt->execute([
            ':id'    => (int) $params['id'],
            ':date'  => $date,
            ':calls' => isset($body['converted_calls']) ? $this->count($body['converted_calls']) : null,
            ':price' => isset($body['price'])           ? $this->money($body['price'])           : null,
            ':paid'  => isset($body['amount_paid'])     ? $this->money($body['amount_paid'])     : null,
        ]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Payment row not found', 404);
        }
        Http::json($this->castPayments([$row])[0]);
    }

    public function destroyPayment(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM vendor_payments WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    /** Normalised match key for a vendor name: lower-cased, trimmed. */
    private function key(string $name): string
    {
        return strtolower(trim($name));
    }

    /** Coerce a numeric input to a non-negative float (empty/invalid -> 0). */
    private function money(mixed $value): float
    {
        $n = is_numeric($value) ? (float) $value : 0.0;
        return $n < 0 ? 0.0 : $n;
    }

    /** Coerce a numeric input to a signed float (empty/invalid -> 0); allows negatives. */
    private function signed(mixed $value): float
    {
        return is_numeric($value) ? (float) $value : 0.0;
    }

    /** Coerce a numeric input to a non-negative integer count (empty/invalid -> 0). */
    private function count(mixed $value): int
    {
        $n = is_numeric($value) ? (int) $value : 0;
        return $n < 0 ? 0 : $n;
    }

    /** Validate a YYYY-MM-DD date string; returns it normalised or null. */
    private function date(mixed $value): ?string
    {
        if (!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
            return null;
        }
        if (!checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return null;
        }
        return $value;
    }

    private function castVendor(array $row): array
    {
        return [
            'id'         => (int) $row['id'],
            'name'       => $row['name'],
            'is_manual'  => (bool) $row['is_manual'],
            'manual_due' => (float) $row['manual_due'],
            'sort_order' => (int) $row['sort_order'],
        ];
    }

    private function castPayments(array $rows): array
    {
        foreach ($rows as &$r) {
            if (!$r) {
                continue;
            }
            $r['id']              = (int) $r['id'];
            $r['converted_calls'] = (int) $r['converted_calls'];
            $r['price']           = (float) $r['price'];
            $r['amount_paid']     = (float) $r['amount_paid'];
        }
        return $rows;
    }
}
