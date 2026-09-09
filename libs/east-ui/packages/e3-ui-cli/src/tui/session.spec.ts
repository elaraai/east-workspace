/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Session specs — target classification (e3's grammar plus a bare
 * origin), and `openSession` over a tiny local HTTP server that speaks
 * the e3 wire format: local (an injected server start), remote with a
 * saved token, a bare origin, and the three refusals.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { encodeBeast2For, ArrayType, StringType, variant } from '@elaraai/east';
import { ApiTypes } from '@elaraai/e3-api-client';
import { repoInit } from '@elaraai/e3-core';
import { openSession, parseTarget, SessionRefusal, targetLabel } from './session.js';

/** A stub e3 API server: repos, one repository's status, 401 without the right token. */
function stubServer(options: { bearer: string | null; repos: string[] }): Promise<{ origin: string; close(): Promise<void> }> {
    const repoListBody = Buffer.from(encodeBeast2For(ApiTypes.ResponseType(ArrayType(StringType)))(variant('success', options.repos)));
    const statusBody = (repo: string): Buffer => Buffer.from(encodeBeast2For(ApiTypes.ResponseType(ApiTypes.RepositoryStatusType))(
        options.repos.includes(repo)
            ? variant('success', { path: `/srv/${repo}`, objectCount: 12408n, packageCount: 2n, workspaceCount: 3n })
            : variant('error', variant('repository_not_found', { repo })),
    ));
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (options.bearer !== null && req.headers.authorization !== `Bearer ${options.bearer}`) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('missing token');
            return;
        }
        if (url.pathname === '/api/repos') {
            res.writeHead(200, { 'Content-Type': 'application/beast2' });
            res.end(repoListBody);
            return;
        }
        const status = /^\/api\/repos\/([^/]+)\/status$/.exec(url.pathname);
        if (status !== null) {
            res.writeHead(200, { 'Content-Type': 'application/beast2' });
            res.end(statusBody(decodeURIComponent(status[1]!)));
            return;
        }
        res.writeHead(404);
        res.end();
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as { port: number };
            resolve({
                origin: `http://127.0.0.1:${address.port}`,
                close: () => new Promise<void>((done) => server.close(() => done())),
            });
        });
    });
}

describe('parseTarget', () => {
    let scratch: string;
    let repo: string;
    let previousEnv: string | undefined;
    before(() => {
        scratch = fs.mkdtempSync(path.join(tmpdir(), 'e3-ui-session-'));
        repo = path.join(scratch, 'repo');
        fs.mkdirSync(repo);
        repoInit(repo);
        previousEnv = process.env['E3_REPO'];
        delete process.env['E3_REPO'];
    });
    after(() => {
        if (previousEnv !== undefined) process.env['E3_REPO'] = previousEnv;
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    test('a local repository path', () => {
        assert.deepEqual(parseTarget(repo), { kind: 'local', path: repo });
        assert.equal(targetLabel({ kind: 'local', path: repo }), 'repo');
    });

    test('a path that is not a repository refuses with not-repo', () => {
        assert.throws(() => parseTarget(path.join(scratch, 'nope')), (err: unknown) =>
            err instanceof SessionRefusal && err.refusal.kind === 'not-repo' && err.refusal.target === path.join(scratch, 'nope'));
    });

    test('https://host/repos/<repo> and a bare origin', () => {
        assert.deepEqual(parseTarget('https://e3.example.com/repos/demo'), { kind: 'remote', origin: 'https://e3.example.com', repo: 'demo' });
        assert.deepEqual(parseTarget('https://e3.example.com/repos/demo/workspaces/main'), { kind: 'remote', origin: 'https://e3.example.com', repo: 'demo' });
        assert.deepEqual(parseTarget('https://e3.example.com'), { kind: 'origin', origin: 'https://e3.example.com' });
        assert.deepEqual(parseTarget('https://e3.example.com/'), { kind: 'origin', origin: 'https://e3.example.com' });
        assert.equal(targetLabel({ kind: 'remote', origin: 'https://e3.example.com', repo: 'demo' }), 'demo');
        assert.equal(targetLabel({ kind: 'origin', origin: 'https://e3.example.com:8443' }), 'e3.example.com:8443');
    });
});

/** The stub server's accepted bearer token. */
const bearer = ['tok', '1'].join('-');

describe('openSession', () => {
    test('local: starts the embedded server, reads the status, stops on stop()', async () => {
        const stub = await stubServer({ bearer: null, repos: ['default'] });
        const scratch = fs.mkdtempSync(path.join(tmpdir(), 'e3-ui-session-'));
        const repo = path.join(scratch, 'demo-repo');
        fs.mkdirSync(repo);
        repoInit(repo);
        const previousEnv = process.env['E3_REPO'];
        delete process.env['E3_REPO'];
        let stopped = 0;
        const steps: string[] = [];
        try {
            const session = await openSession(repo, {
                onStep: (s) => steps.push(s),
                startServer: async () => ({ apiUrl: stub.origin, repo: 'default', stop: async () => { stopped++; } }),
            });
            assert.equal(session.info.kind, 'local');
            assert.equal(session.info.label, 'demo-repo');
            assert.equal(session.info.repo, 'default');
            assert.equal(session.info.apiUrl, stub.origin);
            assert.equal(session.info.path, repo);
            assert.equal(session.info.stateKey, repo);
            assert.equal(session.status?.objectCount, 12408n);
            assert.match(steps[0]!, /starting embedded e3 api server/);
            await session.stop();
            assert.equal(stopped, 1);
        } finally {
            if (previousEnv !== undefined) process.env['E3_REPO'] = previousEnv;
            await stub.close();
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });

    test('remote: resolves the token per request and reads the repository', async () => {
        const stub = await stubServer({ bearer, repos: ['demo'] });
        let resolved = 0;
        try {
            const session = await openSession(`${stub.origin}/repos/demo`, { token: async () => { resolved++; return bearer; } });
            assert.equal(session.info.kind, 'remote');
            assert.equal(session.info.repo, 'demo');
            assert.equal(session.info.origin, stub.origin);
            assert.equal(session.info.label, 'demo');
            assert.equal(session.info.stateKey, `${stub.origin}/repos/demo`);
            assert.equal(session.status?.workspaceCount, 3n);
            const before = resolved;
            await session.api.repoList();
            assert.equal(resolved, before + 1, 'every request re-resolves the token');
        } finally {
            await stub.close();
        }
    });

    test('a bare origin opens without a bound repository', async () => {
        const stub = await stubServer({ bearer, repos: ['demo', 'forecasting'] });
        try {
            const session = await openSession(stub.origin, { token: async () => bearer });
            assert.equal(session.info.kind, 'origin');
            assert.equal(session.info.repo, null);
            assert.deepEqual(await session.api.repoList(), ['demo', 'forecasting']);
            await assert.rejects(session.api.workspaceList(), /no repository is open/);
            assert.deepEqual(await session.api.withRepo('demo').repoStatus('demo'), { path: '/srv/demo', objectCount: 12408n, packageCount: 2n, workspaceCount: 3n });
        } finally {
            await stub.close();
        }
    });

    test('refusals: not logged in, repository not found, unreachable', async () => {
        const stub = await stubServer({ bearer, repos: ['demo'] });
        try {
            await assert.rejects(
                openSession(`${stub.origin}/repos/demo`, { token: async () => { throw new Error('Not logged in'); } }),
                (err: unknown) => err instanceof SessionRefusal && err.refusal.kind === 'not-logged-in' && err.refusal.origin === stub.origin && err.refusal.repo === 'demo',
            );
            await assert.rejects(
                openSession(`${stub.origin}/repos/missing`, { token: async () => bearer }),
                (err: unknown) => err instanceof SessionRefusal && err.refusal.kind === 'not-repo',
            );
            await assert.rejects(
                openSession(`${stub.origin}/repos/demo`, { token: async () => 'wrong' }),
                (err: unknown) => err instanceof SessionRefusal && err.refusal.kind === 'not-logged-in',
            );
        } finally {
            await stub.close();
        }
        // A closed port: the client's retries exhaust and the refusal names the error.
        const closed = await stubServer({ bearer: null, repos: [] });
        await closed.close();
        await assert.rejects(
            openSession(`${closed.origin}/repos/demo`, { token: async () => bearer }),
            (err: unknown) => err instanceof SessionRefusal && err.refusal.kind === 'unreachable' && /ECONNREFUSED|fetch failed/.test(err.refusal.error) && err.refusal.attempts === 4,
        );
    });
});
