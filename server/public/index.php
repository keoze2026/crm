<?php

declare(strict_types=1);

use App\Controllers\AnalyticsController;
use App\Controllers\BuyerController;
use App\Controllers\CampaignController;
use App\Controllers\DestinationController;
use App\Controllers\RecordController;
use App\Database;
use App\Http;
use App\Router;
use Dotenv\Dotenv;

require __DIR__ . '/../vendor/autoload.php';

Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

// CORS (dev-friendly).
$origin = $_ENV['CORS_ORIGIN'] ?? '*';
header("Access-Control-Allow-Origin: {$origin}");
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
$router->get('/analytics/summary',       fn () => $analytics->summary());
$router->get('/analytics/trends',        fn () => $analytics->trends());
$router->get('/analytics/top-buyers',    fn () => $analytics->topBuyers());
$router->get('/analytics/top-campaigns', fn () => $analytics->topCampaigns());
$router->get('/analytics/top-sources',   fn () => $analytics->topSources());
$router->get('/analytics/report',        fn () => $analytics->report());
$router->get('/analytics/complete-report', fn () => $analytics->completeReport());

// Buyers
$buyers = new BuyerController();
$router->get('/buyers',         fn () => $buyers->index());
$router->post('/buyers',        fn () => $buyers->store());
$router->put('/buyers/{id}',    fn ($p) => $buyers->update($p));
$router->delete('/buyers/{id}', fn ($p) => $buyers->destroy($p));

// Campaigns
$campaigns = new CampaignController();
$router->get('/campaigns',         fn () => $campaigns->index());
$router->post('/campaigns',        fn () => $campaigns->store());
$router->put('/campaigns/{id}',    fn ($p) => $campaigns->update($p));
$router->delete('/campaigns/{id}', fn ($p) => $campaigns->destroy($p));

// Destinations
$destinations = new DestinationController();
$router->get('/destinations',         fn () => $destinations->index());
$router->post('/destinations',        fn () => $destinations->store());
$router->put('/destinations/{id}',    fn ($p) => $destinations->update($p));
$router->delete('/destinations/{id}', fn ($p) => $destinations->destroy($p));

// Call records
$records = new RecordController();
$router->get('/records/export',   fn () => $records->export());
$router->get('/records',          fn () => $records->index());
$router->post('/records',         fn () => $records->store());
$router->put('/records/{id}',     fn ($p) => $records->update($p));
$router->delete('/records/{id}',  fn ($p) => $records->destroy($p));

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