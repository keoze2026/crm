<?php

declare(strict_types=1);

use App\Audit;
use App\Auth\Auth;
use App\Auth\AuthMiddleware;
use App\Auth\Config;
use App\Controllers\AnalyticsController;
use App\Controllers\AttendanceController;
use App\Controllers\AuditController;
use App\Controllers\AuthController;
use App\Controllers\BuyerController;
use App\Controllers\CampaignController;
use App\Controllers\DestinationController;
use App\Controllers\PortalExpenseController;
use App\Controllers\RecordController;
use App\Controllers\UserController;
use App\Controllers\VendorController;
use App\Database;
use App\Http;
use App\Router;
use Dotenv\Dotenv;

require __DIR__ . '/../vendor/autoload.php';

Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

// Master toggle: when off, the app behaves exactly as it did before auth existed.
$authEnabled = Config::enabled();

// CORS. Cookies require a concrete origin + credentials, so the header set depends on the
// toggle: locked-down when auth is on, wide-open (as before) when it is off.
if ($authEnabled) {
    header('Access-Control-Allow-Origin: ' . ($_ENV['CORS_ORIGIN'] ?? 'http://localhost:5173'));
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
} else {
    header('Access-Control-Allow-Origin: ' . ($_ENV['CORS_ORIGIN'] ?? '*'));
}
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Normalise path: drop query string and the /api prefix.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
$path = preg_replace('#^/api#', '', $path);
$path = rtrim($path, '/') ?: '/';
$method = $_SERVER['REQUEST_METHOD'];

$router = new Router();

// Health
$router->get('/health', fn () => Http::json([
    'status'   => 'ok',
    'database' => Database::isHealthy() ? 'connected' : 'unavailable',
]));

// Analytics
$analytics = new AnalyticsController();
$router->get('/analytics/summary',         fn () => $analytics->summary());
$router->get('/analytics/trends',          fn () => $analytics->trends());
$router->get('/analytics/top-buyers',      fn () => $analytics->topBuyers());
$router->get('/analytics/top-campaigns',   fn () => $analytics->topCampaigns());
$router->get('/analytics/top-sources',     fn () => $analytics->topSources());
$router->get('/analytics/report',          fn () => $analytics->report());
$router->get('/analytics/complete-report', fn () => $analytics->completeReport());

// Buyers
$buyers = new BuyerController();
$router->get('/buyers',         fn () => $buyers->index());
$router->post('/buyers',        fn () => $buyers->store());
$router->put('/buyers/{id}',    fn ($p) => $buyers->update($p));
$router->delete('/buyers/{id}', fn ($p) => $buyers->destroy($p));

// Campaigns
$campaigns = new CampaignController();
$router->get('/campaigns',              fn () => $campaigns->index());
$router->get('/campaigns/{id}/sources', fn ($p) => $campaigns->sources($p));
$router->post('/campaigns',             fn () => $campaigns->store());
$router->put('/campaigns/{id}',    fn ($p) => $campaigns->update($p));
$router->delete('/campaigns/{id}', fn ($p) => $campaigns->destroy($p));

// Destinations
$destinations = new DestinationController();
$router->get('/destinations',         fn () => $destinations->index());
$router->post('/destinations',        fn () => $destinations->store());
$router->put('/destinations/{id}',    fn ($p) => $destinations->update($p));
$router->delete('/destinations/{id}', fn ($p) => $destinations->destroy($p));

// Portal expenses (monthly provider expenses)
$portalExpenses = new PortalExpenseController();
$router->get('/portal-expenses',         fn () => $portalExpenses->index());
$router->post('/portal-expenses',        fn () => $portalExpenses->store());
$router->put('/portal-expenses/{id}',    fn ($p) => $portalExpenses->update($p));
$router->delete('/portal-expenses/{id}', fn ($p) => $portalExpenses->destroy($p));

// Vendors (traffic-source payment sheets)
$vendors = new VendorController();
$router->get('/vendors',                 fn () => $vendors->index());
$router->post('/vendors',                fn () => $vendors->store());
$router->put('/vendors',                 fn () => $vendors->upsertMeta());
$router->delete('/vendors/{id}',         fn ($p) => $vendors->destroy($p));
$router->get('/vendor-payments',         fn () => $vendors->payments());
$router->post('/vendor-payments',        fn () => $vendors->storePayment());
$router->put('/vendor-payments/{id}',    fn ($p) => $vendors->updatePayment($p));
$router->delete('/vendor-payments/{id}', fn ($p) => $vendors->destroyPayment());

// Call records
$records = new RecordController();
$router->get('/records/export',   fn () => $records->export());
$router->get('/records',          fn () => $records->index());
$router->post('/records',         fn () => $records->store());
$router->put('/records/{id}',     fn ($p) => $records->update($p));
$router->delete('/records/{id}',  fn ($p) => $records->destroy($p));

// Attendance
$attendance = new AttendanceController();
$router->get('/attendance/staff',      fn () => $attendance->staff());
$router->get('/attendance/roster',     fn () => $attendance->roster());
$router->get('/attendance/live',       fn () => $attendance->live());
$router->get('/attendance/days',       fn () => $attendance->days());
$router->get('/attendance/summary',    fn () => $attendance->summary());
$router->get('/attendance/breaks',     fn () => $attendance->breaks());
$router->get('/attendance/exceptions', fn () => $attendance->exceptions());

// Auth status is always available so the frontend can discover whether auth is enforced.
$auth = new AuthController();
$router->get('/auth/status', fn () => $auth->status());

// The rest of the auth/audit/admin surface only exists when auth is enabled; otherwise these
// routes 404 exactly as they did before the feature was added.
if ($authEnabled) {
    $router->post('/auth/login',          fn () => $auth->login());
    $router->post('/auth/verify-totp',    fn () => $auth->verifyTotp());
    $router->post('/auth/enroll/start',   fn () => $auth->enrollStart());
    $router->post('/auth/enroll/confirm', fn () => $auth->enrollConfirm());
    $router->post('/auth/logout',         fn () => $auth->logout());
    $router->get('/auth/me',              fn () => $auth->me());

    $auditCtrl = new AuditController();
    $router->get('/audit-logs/actions', fn () => $auditCtrl->actions());
    $router->get('/audit-logs/export',  fn () => $auditCtrl->export());
    $router->get('/audit-logs',         fn () => $auditCtrl->index());
    $router->delete('/audit-logs/{id}', fn ($p) => $auditCtrl->destroy($p));
    $router->delete('/audit-logs',      fn () => $auditCtrl->clear());

    $users = new UserController();
    $router->get('/admin/users',                  fn () => $users->index());
    $router->post('/admin/users',                 fn () => $users->store());
    $router->patch('/admin/users/{id}',           fn ($p) => $users->update($p));
    $router->post('/admin/users/{id}/reset-totp', fn ($p) => $users->resetTotp($p));
    $router->delete('/admin/users/{id}',          fn ($p) => $users->destroy($p));

    // Authenticate the request and enforce access before dispatch. The audit trail is
    // written from a shutdown hook so it captures the final HTTP status even though the
    // response helpers call exit().
    Auth::attempt();
    AuthMiddleware::guard($method, $path);
    Audit::begin($method, $path, Http::body());
    register_shutdown_function([Audit::class, 'flush']);
}

try {
    $router->dispatch($method, $path);
} catch (\Throwable $e) {
    $debug = ($_ENV['APP_ENV'] ?? 'production') === 'development';
    Http::error(
        $debug ? $e->getMessage() : 'Internal server error',
        500,
        $debug ? ['trace' => explode("\n", $e->getTraceAsString())] : []
    );
}