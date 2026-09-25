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

        // Converted Lead and Price are NOT stored here — they are read from the campaign
        // records for this traffic source, so the sheet charges exactly what the Campaigns
        // side charged. `payments` is the summed total_bill rather than counted × price:
        // the two are equal by definition, but taking the sum straight from the records
        // means a rounded display rate can never make this page disagree with that one.
        //
        // The row set is every DAY in range that has campaign activity for this source, plus
        // any day carrying a hand-entered payment (so a payment against an advance still
        // shows on a day the source ran nothing). vendor_payments now supplies only
        // amount_paid — one row per vendor/day, enforced by migration 026.
        $campWhere = '';
        $mineWhere = '';
        $params    = [':vendor' => $vendor];
        if ($from) {
            $campWhere .= ' AND r.record_date >= :from';
            $mineWhere .= ' AND entry_date >= :from';
            $params[':from'] = $from;
        }
        if ($to) {
            $campWhere .= ' AND r.record_date <= :to';
            $mineWhere .= ' AND entry_date <= :to';
            $params[':to'] = $to;
        }

        $sql = "
            WITH campaign AS (
                SELECT r.record_date        AS d,
                       SUM(r.counted)       AS counted,
                       SUM(r.total_bill)    AS bill
                  FROM call_records r
                 WHERE r.record_type = 'campaign'
                   AND lower(btrim(COALESCE(r.source, ''))) = lower(btrim(:vendor))
                   {$campWhere}
                 GROUP BY r.record_date
            ),
            manual AS (
                SELECT entry_date AS d, MIN(id) AS payment_id, SUM(amount_paid) AS amount_paid
                  FROM vendor_payments
                 WHERE lower(btrim(vendor)) = lower(btrim(:vendor))
                   {$mineWhere}
                 GROUP BY entry_date
            )
            SELECT to_char(COALESCE(c.d, m.d), 'YYYY-MM-DD') AS entry_date,
                   COALESCE(c.counted, 0)     AS converted_calls,
                   COALESCE(c.bill, 0)        AS payments,
                   COALESCE(m.amount_paid, 0) AS amount_paid,
                   m.payment_id
              FROM campaign c
              FULL OUTER JOIN manual m ON m.d = c.d
             ORDER BY 1
        ";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $this->castPayments($stmt->fetchAll(), $vendor);

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
            // What the ledger moved before the range opens: everything paid, less everything
            // the campaign records charged. Same two sources the visible rows are built from,
            // so the carry-forward can't drift from the column it seeds.
            $prior = $pdo->prepare(
                "SELECT COALESCE((SELECT SUM(amount_paid) FROM vendor_payments
                                   WHERE lower(btrim(vendor)) = lower(btrim(:vendor))
                                     AND entry_date < :from), 0)
                      - COALESCE((SELECT SUM(total_bill) FROM call_records
                                   WHERE record_type = 'campaign'
                                     AND lower(btrim(COALESCE(source, ''))) = lower(btrim(:vendor))
                                     AND record_date < :from), 0)"
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

        // A payment is now just "this much was paid on this day", so writing one twice sets
        // the amount rather than stacking a second row — the sheet shows one row per day and
        // migration 026 enforces that. converted_calls/price are left at their column
        // defaults: they are no longer read, the campaign records supply those figures.
        $stmt = Database::connection()->prepare(
            'INSERT INTO vendor_payments (vendor, entry_date, amount_paid)
             VALUES (:vendor, :date, :paid)
             ON CONFLICT (lower(btrim(vendor)), entry_date) DO UPDATE
                SET amount_paid = EXCLUDED.amount_paid, updated_at = now()
             RETURNING id, vendor, to_char(entry_date, \'YYYY-MM-DD\') AS entry_date, amount_paid'
        );
        $stmt->execute([
            ':vendor' => $vendor,
            ':date'   => $date,
            ':paid'   => $this->money($body['amount_paid'] ?? 0),
        ]);

        $row = $stmt->fetch();
        Http::json([
            'id'          => (int) $row['id'],
            'vendor'      => $row['vendor'],
            'entry_date'  => $row['entry_date'],
            'amount_paid' => (float) $row['amount_paid'],
        ], 201);
    }

    public function updatePayment(array $params): void
    {
        $body = Http::body();
        $date = array_key_exists('entry_date', $body) ? $this->date($body['entry_date']) : null;

        // Only the amount (and its day) is editable now; Converted Lead and Price come from
        // the campaign records and are changed on the Campaigns side, not here.
        $stmt = Database::connection()->prepare(
            'UPDATE vendor_payments SET
                entry_date  = COALESCE(:date, entry_date),
                amount_paid = COALESCE(:paid, amount_paid),
                updated_at  = now()
             WHERE id = :id
             RETURNING id, vendor, to_char(entry_date, \'YYYY-MM-DD\') AS entry_date, amount_paid'
        );
        try {
            $stmt->execute([
                ':id'   => (int) $params['id'],
                ':date' => $date,
                ':paid' => isset($body['amount_paid']) ? $this->money($body['amount_paid']) : null,
            ]);
        } catch (\PDOException $e) {
            // One payment per vendor per day (migration 026): moving onto a taken day is refused
            // rather than silently merging two amounts.
            if ($e->getCode() !== '23505') {
                throw $e;
            }
            Http::error('This vendor already has a payment on that day — edit that one instead', 409);
        }
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Payment row not found', 404);
        }
        Http::json([
            'id'          => (int) $row['id'],
            'vendor'      => $row['vendor'],
            'entry_date'  => $row['entry_date'],
            'amount_paid' => (float) $row['amount_paid'],
        ]);
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

    /**
     * Shape a ledger row for the sheet.
     *
     * `price` is derived, not stored: the rate this source actually charged that day, i.e.
     * total_bill ÷ counted. It is display-only — `payments` already carries the exact figure,
     * so nothing recomputes counted × price and picks up a rounding error.
     */
    private function castPayments(array $rows, string $vendor): array
    {
        foreach ($rows as &$r) {
            if (!$r) {
                continue;
            }
            $counted  = (int) $r['converted_calls'];
            $payments = (float) $r['payments'];

            $r['vendor']          = $vendor;
            $r['converted_calls'] = $counted;
            $r['payments']        = $payments;
            $r['price']           = $counted > 0 ? $payments / $counted : 0.0;
            $r['amount_paid']     = (float) $r['amount_paid'];
            $r['payment_id']      = $r['payment_id'] !== null ? (int) $r['payment_id'] : null;
        }
        return $rows;
    }
}
