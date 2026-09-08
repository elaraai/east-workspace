/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sessions — `openSession(target)` resolves a repository argument exactly
 * as `e3` does (`parseRepoLocationSync` from `@elaraai/e3-cli/internal`),
 * then binds an {@link Api}:
 *
 * - **local** — an embedded `@elaraai/e3-api-server` over the repository
 *   (`startRepoServer`, the same bootstrap `e3-ui shot --from-task` and the
 *   VS Code extension use); `repo = 'default'`; `stop()` on exit.
 * - **remote** `https://host/repos/<repo>` — `getValidToken(origin)` now and
 *   **per request**, so a long session survives token expiry.
 * - **bare origin** `https://host` — the repositories view; `/repo <name>`
 *   binds one.
 *
 * Refusals map to the three screens: not a repository (`repoGet` /
 * `repoStatus` fail), not logged in (`getValidToken` throws — the box
 * prefills `/login <origin>`), unreachable (the probe exhausts its retries).
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { parseRepoLocationSync, getValidToken, getCredential, decodeJwtPayload, formatError } from '@elaraai/e3-cli/internal';
import { repoStatus, type RepositoryStatus } from '@elaraai/e3-api-client';
import { startRepoServer, type RepoServerHandle } from '../e3-server.js';
import { createHttpApi, isApiCode, type Api } from './api.js';
import type { Refusal, SessionInfo } from './state/actions.js';

/** An open session. */
export interface Session {
    info: SessionInfo;
    api: Api;
    /** The repository status fetched while opening (local / remote). */
    status: RepositoryStatus | null;
    /** Releases the session (stops the embedded server). */
    stop(): Promise<void>;
}

/** Thrown by {@link openSession} when the target cannot be opened; carries the refusal screen. */
export class SessionRefusal extends Error {
    constructor(readonly refusal: Refusal) {
        super(refusalMessage(refusal));
        this.name = 'SessionRefusal';
    }
}

/** A one-line message for a refusal (logs, non-TTY). */
export function refusalMessage(refusal: Refusal): string {
    switch (refusal.kind) {
        case 'not-repo': return `${refusal.target} is not an e3 repository`;
        case 'not-logged-in': return `not logged in to ${refusal.origin}`;
        case 'unreachable': return `${refusal.url} is unreachable: ${refusal.error}`;
        case 'error': return refusal.message;
    }
}

/** How a target parses. */
export type Target =
    | { kind: 'local'; path: string }
    | { kind: 'remote'; origin: string; repo: string }
    | { kind: 'origin'; origin: string };

/**
 * Classifies a repository argument without touching the network: e3-cli's
 * grammar for local paths and `https://host/repos/<repo>`, plus a bare
 * `https://host` as an origin.
 *
 * @param target - The argument
 * @returns The classification
 * @throws {SessionRefusal} `not-repo` when a local path is not a repository
 */
export function parseTarget(target: string): Target {
    if (/^https?:\/\//.test(target)) {
        const url = new URL(target);
        if (/^\/repos\/[^/]+/.test(url.pathname)) {
            const location = parseRepoLocationSync(target);
            if (location.type === 'remote') return { kind: 'remote', origin: location.baseUrl, repo: location.repo };
        }
        return { kind: 'origin', origin: url.origin };
    }
    try {
        const location = parseRepoLocationSync(target);
        if (location.type === 'local') return { kind: 'local', path: location.path };
    } catch {
        throw new SessionRefusal({ kind: 'not-repo', target: target === '.' ? path.resolve('.') : target });
    }
    throw new SessionRefusal({ kind: 'not-repo', target });
}

/** The label a target shows in the breadcrumb. */
export function targetLabel(target: Target): string {
    switch (target.kind) {
        case 'local': return path.basename(target.path) || target.path;
        case 'remote': return target.repo;
        case 'origin': return new URL(target.origin).host;
    }
}

/** The signed-in identity of a saved credential (its JWT's email or subject). */
export function identityOf(origin: string): string | null {
    const credential = getCredential(origin);
    if (credential === null) return null;
    try {
        const payload = decodeJwtPayload(credential.accessToken);
        const email = payload['email'];
        const sub = payload['sub'];
        return typeof email === 'string' ? email : typeof sub === 'string' ? sub : null;
    } catch {
        return null;
    }
}

/** Options for {@link openSession}. */
export interface OpenSessionOptions {
    /** Progress steps for the launch screen. */
    onStep?: ((step: string) => void) | undefined;
    /** Starts the embedded server (injectable for tests). */
    startServer?: ((repoPath: string) => Promise<RepoServerHandle>) | undefined;
    /** Resolves a remote token (injectable for tests). */
    token?: ((origin: string) => Promise<string>) | undefined;
}

/** The error text of a connection failure (`ECONNREFUSED`, `fetch failed`, …). */
function connectionError(err: unknown): string {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code !== undefined) return cause.code;
    if (cause?.message !== undefined) return cause.message;
    return formatError(err);
}

/**
 * Opens a session.
 *
 * @param target - The repository argument
 * @param options - Progress callback and injectable seams
 * @returns The session
 * @throws {SessionRefusal} With the refusal screen to show
 */
export async function openSession(target: string, options: OpenSessionOptions = {}): Promise<Session> {
    const parsed = parseTarget(target);
    const step = options.onStep ?? (() => undefined);
    if (parsed.kind === 'local') {
        step('starting embedded e3 api server');
        const start = options.startServer ?? startRepoServer;
        let server: RepoServerHandle;
        try {
            server = await start(parsed.path);
        } catch (err) {
            throw new SessionRefusal({ kind: 'error', message: `could not start the embedded server: ${formatError(err)}` });
        }
        step(`embedded e3 api server · ${server.apiUrl.replace(/^https?:\/\//, '')}`);
        const api = createHttpApi({ apiUrl: server.apiUrl, repo: server.repo, token: async () => null });
        let status: RepositoryStatus | null = null;
        try {
            status = await repoStatus(server.apiUrl, server.repo, { token: null });
        } catch {
            await server.stop();
            throw new SessionRefusal({ kind: 'not-repo', target: parsed.path });
        }
        return {
            info: {
                kind: 'local',
                label: targetLabel(parsed),
                repo: server.repo,
                apiUrl: server.apiUrl,
                path: parsed.path,
                origin: null,
                identity: null,
                stateKey: parsed.path,
                target,
            },
            api,
            status,
            stop: () => server.stop(),
        };
    }

    const origin = parsed.origin;
    const tokenOf = options.token ?? getValidToken;
    step(`resolving the saved credential for ${origin}`);
    let token: string;
    try {
        token = await tokenOf(origin);
    } catch {
        throw new SessionRefusal({ kind: 'not-logged-in', origin, repo: parsed.kind === 'remote' ? parsed.repo : null });
    }
    const api = createHttpApi({ apiUrl: origin, repo: parsed.kind === 'remote' ? parsed.repo : null, token: () => tokenOf(origin) });
    if (parsed.kind === 'remote') {
        step(`reading ${origin}/repos/${parsed.repo}`);
        let status: RepositoryStatus;
        try {
            status = await repoStatus(origin, parsed.repo, { token });
        } catch (err) {
            if (isApiCode(err, 'repository_not_found')) throw new SessionRefusal({ kind: 'not-repo', target });
            if (isApiCode(err, 'unauthorized') || (err as { name?: string }).name === 'AuthError') {
                throw new SessionRefusal({ kind: 'not-logged-in', origin, repo: parsed.repo });
            }
            throw new SessionRefusal({ kind: 'unreachable', url: `${origin}/api/repos/${parsed.repo}/status`, error: connectionError(err), attempts: 4 });
        }
        return {
            info: {
                kind: 'remote',
                label: targetLabel(parsed),
                repo: parsed.repo,
                apiUrl: origin,
                path: null,
                origin,
                identity: identityOf(origin),
                stateKey: `${origin}/repos/${parsed.repo}`,
                target,
            },
            api,
            status,
            stop: async () => undefined,
        };
    }
    step(`reading the repositories on ${origin}`);
    try {
        await api.repoList();
    } catch (err) {
        if ((err as { name?: string }).name === 'AuthError') throw new SessionRefusal({ kind: 'not-logged-in', origin, repo: null });
        throw new SessionRefusal({ kind: 'unreachable', url: `${origin}/api/repos`, error: connectionError(err), attempts: 4 });
    }
    return {
        info: {
            kind: 'origin',
            label: targetLabel(parsed),
            repo: null,
            apiUrl: origin,
            path: null,
            origin,
            identity: identityOf(origin),
            stateKey: origin,
            target,
        },
        api,
        status: null,
        stop: async () => undefined,
    };
}

/**
 * Binds a repository on an origin session (`/repo <name>` in the repos view).
 *
 * @param session - The origin session
 * @param repo - The repository name
 * @returns A remote session over that repository
 * @throws {SessionRefusal} When the repository does not exist
 */
export async function bindRepo(session: Session, repo: string, options: OpenSessionOptions = {}): Promise<Session> {
    if (session.info.origin === null) throw new SessionRefusal({ kind: 'error', message: 'not an origin session' });
    return openSession(`${session.info.origin}/repos/${repo}`, options);
}
