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
 *  - `vendors`         : per-vendor metadata (manual flag + `opening_advance`, the balance
 *                        the ledger starts from — signed: positive = Advance, negative = Due).
 *  - `vendor_payments` : the dated ledger rows. The "Payments" column shown in the UI is
 *                        derived (converted_calls * price) and is never stored.
 *
 * The Due/Advance balance is never typed. It is derived, and it CARRIES FORWARD across
 * viewing periods because the part of it that precedes the period is recomputed from the
 * ledger on every request (see payments()):
 *
 *     initial_advance = opening_advance + Σ(amount_paid − converted_calls × price)
 *                                           over rows dated BEFORE the period start
 *     final balance   = initial_advance + Σ amount_paid − Σ payments   (within the period)
 *     positive ⇒ Advance (the vendor holds our money) · negative ⇒ Due (we owe them)
 */
final class VendorController
{
    // ── Vendors (tab list + metadata) ───────────────────────────────────────────

    /**
     * The tab list: distinct campaign sources merged with the `vendors` table, keyed by
     * case/space-insensitive name. Discovered-only sources come back with id=null and
     * zeroed metadata; `vendors` rows carry their id, manual flag and opening advance.
     */
    public function index(): void
    {
        $pdo = Database::connection();

        // (a) Metadata rows.
        $vendors = $pdo->query(
            'SELECT id, name, is_manual, opening_advance, sort_order
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
                'id'              => (int) $v['id'],
                'name'            => $v['name'],
                'is_manual'       => (bool) $v['is_manual'],
                'opening_advance' => (float) $v['opening_advance'],
                'sort_order'      => (int) $v['sort_order'],
            ];
        }
        foreach ($sources as $name) {
            $k = $this->key($name);
            if (!isset($byKey[$k])) {
                $byKey[$k] = [
                    'id'              => null,
                    'name'            => $name,
                    'is_manual'       => false,
                    'opening_advance' => 0.0,
                    'sort_order'      => 0,
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
             RETURNING id, name, is_manual, opening_advance, sort_order'
        );
        try {
            $stmt->execute([':name' => $name]);
        } catch (\PDOException $e) {
            Http::error('A vendor with that name already exists', 409);
        }
        Http::json($this->castVendor($stmt->fetch()), 201);
    }

    /**
     * Upsert a vendor's opening advance by name — the balance its ledger starts from,
     * before any `vendor_payments` row. Works for discovered vendors too (they have no
     * `vendors` row until this is first edited). Signed: positive = Advance, negative = Due.
     *
     * Note the client sends the seed, not the figure it sees: the page shows the opening
     * balance *for the viewed period*, so it subtracts the ledger's prior-period movement
     * (`prior_net` from payments()) before saving. That keeps every other period consistent.
     */
    public function upsertMeta(): void
    {
        $body = Http::body();
        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '') {
            Http::error('Vendor name is required', 422);
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO vendors (name, opening_advance)
             VALUES (:name, :adv)
             ON CONFLICT (lower(btrim(name))) DO UPDATE SET
                opening_advance = COALESCE(:adv2, vendors.opening_advance),
                updated_at      = now()
             RETURNING id, name, is_manual, opening_advance, sort_order'
        );
        $adv = isset($body['opening_advance']) ? $this->signed($body['opening_advance']) : null;
        $stmt->execute([
            ':name' => $name,
            ':adv'  => $adv ?? 0,
            ':adv2' => $adv,
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

    /**
     * Ledger rows for one vendor within an optional date range, plus the balance carried
     * INTO that range so the page's Due/Advance figure survives a change of period.
     *
     * Returns an envelope rather than a bare array:
     *   rows            — the ledger rows inside the range
     *   opening_advance — the vendor's stored seed (`vendors.opening_advance`)
     *   prior_net       — Σ(amount_paid − converted_calls × price) for rows BEFORE `from`
     *   initial_advance — opening_advance + prior_net, i.e. the "Initial Advance" shown
     *
     * Because prior_net is recomputed here on every request, editing or back-dating an old
     * row automatically re-bases every later period — nothing is stored stale.
     */
    public function payments(): void
    {
        $vendor = trim((string) Http::query('vendor', ''));
        if ($vendor === '') {
            Http::error('A vendor is required', 422);
        }
        $from = Http::query('from');
        $to   = Http::query('to');
        $pdo  = Database::connection();

        $sql = 'SELECT id, vendor, to_char(entry_date, \'YYYY-MM-DD\') AS entry_date,
                       converted_calls, price, amount_paid, created_at, updated_at
                  FROM vendor_payments
                 WHERE lower(btrim(vendor)) = lower(btrim(:vendor))';
        $params = [':vendor' => $vendor];
        if ($from) { $sql .= ' AND entry_date >= :from'; $params[':from'] = $from; }
        if ($to)   { $sql .= ' AND entry_date <= :to';   $params[':to']   = $to; }
        $sql .= ' ORDER BY entry_date ASC, id ASC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $this->castPayments($stmt->fetchAll());

        // The seed. Discovered vendors have no `vendors` row until one is saved -> 0.
        $seed = $pdo->prepare(
            'SELECT opening_advance FROM vendors
              WHERE lower(btrim(name)) = lower(btrim(:vendor))'
        );
        $seed->execute([':vendor' => $vendor]);
        $opening = (float) ($seed->fetchColumn() ?: 0);

        // Everything the ledger moved before the range starts — the carry-forward.
        $priorNet = 0.0;
        if ($from) {
            $prior = $pdo->prepare(
                'SELECT COALESCE(SUM(amount_paid - converted_calls * price), 0)
                   FROM vendor_payments
                  WHERE lower(btrim(vendor)) = lower(btrim(:vendor))
                    AND entry_date < :from'
            );
            $prior->execute([':vendor' => $vendor, ':from' => $from]);
            $priorNet = (float) $prior->fetchColumn();
        }

        Http::json([
            'rows'            => $rows,
            'opening_advance' => $opening,
            'prior_net'       => $priorNet,
            'initial_advance' => $opening + $priorNet,
        ]);
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
            'id'              => (int) $row['id'],
            'name'            => $row['name'],
            'is_manual'       => (bool) $row['is_manual'],
            'opening_advance' => (float) $row['opening_advance'],
            'sort_order'      => (int) $row['sort_order'],
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
