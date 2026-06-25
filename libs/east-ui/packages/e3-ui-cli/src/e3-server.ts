/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Start a local e3 API server over a repository so the browser app can fetch a
 * live task's output + bound datasets — the same `@elaraai/e3-api-server`
 * single-repo bootstrap the VS Code extension uses (`startE3Server`).
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { createServer, type Server } from '@elaraai/e3-api-server';

/** A running single-repo e3 server. */
export interface RepoServerHandle {
    /** Base API URL (`http://127.0.0.1:<port>`). */
    apiUrl: string;
    /** Repo id — always `default` in single-repo mode. */
    repo: string;
    /** Stop the server. */
    stop(): Promise<void>;
}

/**
 * Start a single-repo e3 API server (CORS enabled) over a local repo path.
 *
 * @param repoPath - Local e3 repository directory
 * @returns A handle with the API URL, repo id, and a `stop()`
 */
export async function startRepoServer(repoPath: string): Promise<RepoServerHandle> {
    const server: Server = await createServer({
        singleRepoPath: path.resolve(repoPath),
        port: 0,
        host: '127.0.0.1',
        cors: true,
    });
    await server.start();
    return {
        apiUrl: `http://127.0.0.1:${server.port}`,
        repo: 'default',
        async stop() { await server.stop(); },
    };
}
