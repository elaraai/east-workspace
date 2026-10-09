/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { rackBodyLimit } from './body-limit.js';

it('bounds actual request bytes before decoding, regardless of Content-Length', async () => {
    const app = new Hono();
    let decoded = 0;
    app.use('*', rackBodyLimit(4));
    app.post('/', async c => { decoded++; return c.text(await c.req.text()); });
    const ok = await app.request('/', { method: 'POST', body: 'four' });
    assert.equal(await ok.text(), 'four');
    for (const headers of [new Headers(), new Headers({ 'content-length': '1' })]) {
        const rejected = await app.request('/', { method: 'POST', body: 'too large', headers });
        assert.equal(rejected.status, 413);
    }
    assert.equal(decoded, 1);
});

it('times out stalled bodies and cancels their streams', async () => {
    const app = new Hono();
    app.use('*', rackBodyLimit(4, 10));
    app.post('/', c => c.text('unexpected'));
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const request = new Request('http://localhost/', { method: 'POST', body, duplex: 'half' } as RequestInit);
    assert.equal((await app.request(request)).status, 408);
    assert.ok(cancelled);
});
