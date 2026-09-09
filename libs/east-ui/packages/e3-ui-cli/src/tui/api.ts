/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `Api` seam — the subset of `@elaraai/e3-api-client` the TUI uses,
 * bound to one session (base URL, repository, a per-request token) so the
 * views and feeds never see transport details, and so the frame specs can
 * substitute an in-memory fake (`api.fake.ts`).
 *
 * Transport is always the e3 HTTP API: an embedded `@elaraai/e3-api-server`
 * for local repositories, `getValidToken()` per request for remote ones —
 * paging, key search and byte budgets come from the server, not a second
 * implementation.
 *
 * @packageDocumentation
 */

import {
    datasetFindKey,
    datasetGet,
    datasetGetPage,
    datasetGetStatus,
    datasetListRecursive,
    datasetSet,
    dataflowCancel,
    dataflowExecuteLaunch,
    dataflowExecutePoll,
    repoList,
    repoStatus,
    taskExecutionList,
    taskGet,
    taskList,
    taskLogs,
    workspaceGet,
    workspaceList,
    workspaceStatus,
    type DataflowExecutionState,
    type DataflowOptions,
    type DatasetFindQuery,
    type DatasetFindResult,
    type DatasetPage,
    type DatasetPageWindow,
    type DatasetStatusDetail,
    type ExecutionListItem,
    type ListEntry,
    type LogChunk,
    type LogOptions,
    type RepositoryStatus,
    type RequestOptions,
    type TaskDetails,
    type TaskListItem,
    type WorkspaceInfo,
    type WorkspaceStatusResult,
} from '@elaraai/e3-api-client';
import { urlPathToTreePath, type TreePath, type WorkspaceState } from '@elaraai/e3-types';
import { formatError } from '@elaraai/e3-cli/internal';

/**
 * A dotted dataset path (`.inputs.sales`, `inputs.sales`, `.tasks.forecast.output`)
 * as a `TreePath` (through e3-types' own URL-path parser).
 *
 * @param path - The dotted path (a leading dot is optional)
 * @returns The tree path
 */
export function treePathOf(path: string): TreePath {
    return urlPathToTreePath(path.split('.').filter(s => s.length > 0).map(s => encodeURIComponent(s)).join('/'));
}

/**
 * A `TreePath` as the dotted path the status feed uses (`.inputs.sales`).
 *
 * @param path - The tree path
 * @returns The dotted path with a leading dot
 */
export function dottedPath(path: TreePath): string {
    return path.map(p => `.${p.value}`).join('');
}

/** The e3 API the TUI uses, bound to one session. */
export interface Api {
    /** Repositories on the origin (bare-origin sessions). */
    repoList(): Promise<string[]>;
    /** A repository's object / package / workspace counts. */
    repoStatus(repo: string): Promise<RepositoryStatus>;
    workspaceList(): Promise<WorkspaceInfo[]>;
    /** The deployed state (deployedAt, package hash), or null when not deployed. */
    workspaceGet(ws: string): Promise<WorkspaceState | null>;
    workspaceStatus(ws: string): Promise<WorkspaceStatusResult>;
    taskList(ws: string): Promise<TaskListItem[]>;
    taskGet(ws: string, task: string): Promise<TaskDetails>;
    taskExecutionList(ws: string, task: string): Promise<ExecutionListItem[]>;
    /** Every dataset of the workspace with its type / hash / size. */
    datasetList(ws: string): Promise<ListEntry[]>;
    datasetGetStatus(ws: string, path: TreePath): Promise<DatasetStatusDetail>;
    datasetGet(ws: string, path: TreePath): Promise<{ data: Uint8Array; hash: string; size: number }>;
    datasetGetPage(ws: string, path: TreePath, window: DatasetPageWindow): Promise<DatasetPage>;
    datasetFindKey(ws: string, path: TreePath, query: DatasetFindQuery): Promise<DatasetFindResult>;
    datasetSet(ws: string, path: TreePath, data: Uint8Array): Promise<void>;
    dataflowExecuteLaunch(ws: string, options: DataflowOptions): Promise<void>;
    dataflowExecutePoll(ws: string, offset: number): Promise<DataflowExecutionState>;
    dataflowCancel(ws: string): Promise<void>;
    taskLogs(ws: string, task: string, options: LogOptions): Promise<LogChunk>;
    /** The same origin bound to another repository (the repositories view's lazy facts). */
    withRepo(repo: string): Api;
}

/** What binds the HTTP client to a session. */
export interface HttpApiConfig {
    /** The API base URL (without `/api`). */
    apiUrl: string;
    /** The repository id (`default` for a local server); null for a bare origin. */
    repo: string | null;
    /** Resolves the bearer token before each request (null for an unauthenticated local server). */
    token: () => Promise<string | null>;
}

/**
 * Binds `@elaraai/e3-api-client` to a session.
 *
 * @param config - The session's URL, repository and token source
 * @returns The bound API
 */
export function createHttpApi(config: HttpApiConfig): Api {
    const { apiUrl } = config;
    const options = async (): Promise<RequestOptions> => ({ token: await config.token() });
    const repo = (): string => {
        if (config.repo === null) throw new Error('no repository is open — /repo <name> binds one');
        return config.repo;
    };
    return {
        repoList: async () => repoList(apiUrl, await options()),
        repoStatus: async (name) => repoStatus(apiUrl, name, await options()),
        workspaceList: async () => workspaceList(apiUrl, repo(), await options()),
        workspaceGet: async (ws) => {
            try {
                return await workspaceGet(apiUrl, repo(), ws, await options());
            } catch (err) {
                if (isApiCode(err, 'workspace_not_deployed')) return null;
                throw err;
            }
        },
        workspaceStatus: async (ws) => workspaceStatus(apiUrl, repo(), ws, await options()),
        taskList: async (ws) => taskList(apiUrl, repo(), ws, await options()),
        taskGet: async (ws, task) => taskGet(apiUrl, repo(), ws, task, await options()),
        // Every attempt, not only the latest per inputs hash: the Runs tab is a history.
        taskExecutionList: async (ws, task) => taskExecutionList(apiUrl, repo(), ws, task, await options(), { all: true }),
        datasetList: async (ws) => datasetListRecursive(apiUrl, repo(), ws, [], await options()),
        datasetGetStatus: async (ws, path) => datasetGetStatus(apiUrl, repo(), ws, path, await options()),
        datasetGet: async (ws, path) => datasetGet(apiUrl, repo(), ws, path, await options()),
        datasetGetPage: async (ws, path, window) => datasetGetPage(apiUrl, repo(), ws, path, window, await options()),
        datasetFindKey: async (ws, path, query) => datasetFindKey(apiUrl, repo(), ws, path, query, await options()),
        datasetSet: async (ws, path, data) => datasetSet(apiUrl, repo(), ws, path, data, await options()),
        dataflowExecuteLaunch: async (ws, dataflowOptions) => dataflowExecuteLaunch(apiUrl, repo(), ws, dataflowOptions, await options()),
        dataflowExecutePoll: async (ws, offset) => dataflowExecutePoll(apiUrl, repo(), ws, { offset }, await options()),
        dataflowCancel: async (ws) => dataflowCancel(apiUrl, repo(), ws, await options()),
        taskLogs: async (ws, task, logOptions) => taskLogs(apiUrl, repo(), ws, task, logOptions, await options()),
        withRepo: (other) => createHttpApi({ ...config, repo: other }),
    };
}

/**
 * Whether an error is an `ApiError` (duck-typed: the client's class may be
 * a different copy in a linked workspace) carrying `code`.
 *
 * @param err - The error
 * @param code - The code to match
 * @returns `true` on a match
 */
export function isApiCode(err: unknown, code: string): boolean {
    return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'ApiError' && (err as { code?: unknown }).code === code;
}

/**
 * An error as one line for a toast or the log — e3-cli's `formatError`
 * (`Workspace not found: {"workspace":"main"}`), except that details the
 * JSON encoder refuses (a BigInt pid in a lock holder) fall back to the
 * humanized code alone instead of throwing.
 *
 * @param err - The error
 * @returns The line
 */
export function describeError(err: unknown): string {
    try {
        return formatError(err);
    } catch {
        const code = apiCode(err);
        if (code !== undefined) return code.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
        return err instanceof Error ? err.message : String(err);
    }
}

/**
 * The `code` of an `ApiError`, or undefined for any other error.
 *
 * @param err - The error
 * @returns The code
 */
export function apiCode(err: unknown): string | undefined {
    if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'ApiError') {
        const code = (err as { code?: unknown }).code;
        return typeof code === 'string' ? code : undefined;
    }
    return undefined;
}
