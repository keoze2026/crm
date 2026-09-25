<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Router;
use PHPUnit\Framework\TestCase;

/** The no-match path calls Http::error() (exit) and is covered by HealthApiTest instead. */
final class RouterTest extends TestCase
{
    /** @var array<int, array{0:string,1:array<string,string>}> */
    private array $calls = [];

    private function handler(string $name): callable
    {
        return function (array $params) use ($name): void {
            $this->calls[] = [$name, $params];
        };
    }

    public function testDispatchesToTheRouteMatchingMethodAndPathWithNoParams(): void
    {
        $r = new Router();
        $r->get('/buyers', $this->handler('index'));
        $r->dispatch('GET', '/buyers');

        $this->assertSame([['index', []]], $this->calls);
    }

    public function testExtractsNamedParamsAsStringsWithoutNumericCaptureKeys(): void
    {
        $r = new Router();
        $r->get('/buyers/{id}/rates/{rateId}', $this->handler('rate'));
        $r->dispatch('GET', '/buyers/12/rates/7');

        $this->assertSame([['rate', ['id' => '12', 'rateId' => '7']]], $this->calls);
    }

    public function testParamMatchesAnyNonSlashCharacters(): void
    {
        $r = new Router();
        $r->get('/files/{name}', $this->handler('file'));
        $r->dispatch('GET', '/files/a.b-c%20d_E');

        $this->assertSame([['file', ['name' => 'a.b-c%20d_E']]], $this->calls);
    }

    public function testParamDoesNotSpanASlash(): void
    {
        $r = new Router();
        $r->get('/buyers/{id}', $this->handler('show'));
        $r->get('/buyers/{id}/{sub}', $this->handler('nested'));
        $r->dispatch('GET', '/buyers/12/rates');

        $this->assertSame([['nested', ['id' => '12', 'sub' => 'rates']]], $this->calls);
    }

    public function testFiltersByMethod(): void
    {
        $r = new Router();
        $r->get('/buyers/{id}', $this->handler('get'));
        $r->post('/buyers/{id}', $this->handler('post'));
        $r->put('/buyers/{id}', $this->handler('put'));
        $r->patch('/buyers/{id}', $this->handler('patch'));
        $r->delete('/buyers/{id}', $this->handler('delete'));

        foreach (['DELETE', 'PATCH', 'PUT', 'POST', 'GET'] as $m) {
            $r->dispatch($m, '/buyers/3');
        }

        $this->assertSame(['delete', 'patch', 'put', 'post', 'get'], array_column($this->calls, 0));
    }

    public function testAddRegistersAnArbitraryMethod(): void
    {
        $r = new Router();
        $r->get('/x', $this->handler('get'));
        $r->add('OPTIONS', '/x', $this->handler('opt'));
        $r->dispatch('OPTIONS', '/x');

        $this->assertSame([['opt', []]], $this->calls);
    }

    public function testFirstRegisteredMatchWinsAndOnlyOneHandlerRuns(): void
    {
        $r = new Router();
        $r->get('/records/export', $this->handler('export'));
        $r->get('/records/{id}', $this->handler('show'));
        $r->dispatch('GET', '/records/export');
        $r->dispatch('GET', '/records/5');

        $this->assertSame([['export', []], ['show', ['id' => '5']]], $this->calls);
    }

    public function testParamRouteRegisteredFirstShadowsALiteralOne(): void
    {
        $r = new Router();
        $r->get('/records/{id}', $this->handler('show'));
        $r->get('/records/export', $this->handler('export'));
        $r->dispatch('GET', '/records/export');

        $this->assertSame([['show', ['id' => 'export']]], $this->calls);
    }

    public function testPatternIsAnchoredAtBothEnds(): void
    {
        $r = new Router();
        $r->get('/buyers', $this->handler('buyers'));
        $r->get('/api/buyers', $this->handler('prefixed'));
        $r->get('/buyers/{id}', $this->handler('show'));
        $r->get('/buyers/', $this->handler('trailing'));

        $r->dispatch('GET', '/api/buyers');
        $r->dispatch('GET', '/buyers/9');
        $r->dispatch('GET', '/buyers/');

        $this->assertSame(['prefixed', 'show', 'trailing'], array_column($this->calls, 0));
    }

    public function testEmptySegmentDoesNotSatisfyAParam(): void
    {
        $r = new Router();
        $r->get('/buyers/{id}/rates', $this->handler('rates'));
        $r->get('/buyers//rates', $this->handler('empty'));
        $r->dispatch('GET', '/buyers//rates');

        $this->assertSame([['empty', []]], $this->calls);
    }

    public function testSameParamRouteServesManyRequests(): void
    {
        $r = new Router();
        $r->delete('/queues/{id}', $this->handler('del'));
        $r->dispatch('DELETE', '/queues/1');
        $r->dispatch('DELETE', '/queues/2');

        $this->assertSame([['del', ['id' => '1']], ['del', ['id' => '2']]], $this->calls);
    }
}
