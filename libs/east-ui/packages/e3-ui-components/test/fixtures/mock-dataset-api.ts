/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `MockDatasetApi` — deterministic, in-process synthetic
 * {@link DatasetApi}. Tests pre-seed values, inspect calls, inject
 * failures, and pause/resume async calls to exercise the cache's
 * optimistic-update + rollback paths.
 */

import { variant } from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import type { DatasetStatusInfo } from "@elaraai/e3-api-client";
import type { DatasetApi } from "../../src/platform/dataset-store.js";

function pathKey(workspace: string, path: TreePath): string {
    const segs = path.map(p => (p as { value: string }).value).join(".");
    return segs ? `${workspace}::${segs}` : workspace;
}

export interface ApiCall {
    workspace: string;
    path?: TreePath;
    value?: Uint8Array;
}

export interface MockDatasetApi extends DatasetApi {
    /** Pre-seed the server with a value at (workspace, path). Updates
     *  the workspaceStatus response so subsequent polls observe it. */
    seed(workspace: string, path: TreePath, value: Uint8Array, hash?: string): void;
    /** Drop the seeded value (simulating server-side delete). */
    unseed(workspace: string, path: TreePath): void;
    /** Inspect every call received, in order. */
    readonly calls: {
        get: ApiCall[];
        set: ApiCall[];
        launchDataflow: ApiCall[];
        listRoot: ApiCall[];
        listAt: ApiCall[];
        workspaceStatus: ApiCall[];
    };
    /** Make the next N calls of `method` reject with `error`. */
    failNext(method: keyof DatasetApi, error: Error, n?: number): void;
    /** Pause the next call to `method` until the returned `resume()`
     *  (or `reject(err)`) is invoked. Useful for testing optimistic
     *  rollback ordering. */
    pauseNext(method: keyof DatasetApi): {
        resume(value?: unknown): void;
        reject(error: Error): void;
    };
    /** Override the path-statuses returned by the next
     *  `workspaceStatus` call for `workspace`. By default the mock
     *  reports `up-to-date` for everything currently seeded. */
    setWorkspaceStatusOverride(workspace: string, datasets: DatasetStatusInfo[]): void;
    /** Clear a previously-set override. */
    clearWorkspaceStatusOverride(workspace: string): void;
}

interface PauseGate {
    promise: Promise<void>;
    resume: () => void;
    reject: (e: Error) => void;
}

export function createMockDatasetApi(): MockDatasetApi {
    const seeded = new Map<string, { workspace: string; path: TreePath; value: Uint8Array; hash: string }>();
    const calls: MockDatasetApi["calls"] = {
        get: [], set: [], launchDataflow: [],
        listRoot: [], listAt: [], workspaceStatus: [],
    };
    const failures: { [K in keyof DatasetApi]?: { error: Error; remaining: number } } = {};
    const pauseGates: { [K in keyof DatasetApi]?: PauseGate[] } = {};
    const statusOverrides = new Map<string, DatasetStatusInfo[]>();

    let nextHashCounter = 0;
    const nextHash = () => `mock-hash-${++nextHashCounter}`;

    function consumeFailure(method: keyof DatasetApi): Error | null {
        const f = failures[method];
        if (!f || f.remaining <= 0) return null;
        f.remaining--;
        if (f.remaining === 0) delete failures[method];
        return f.error;
    }

    function consumePause(method: keyof DatasetApi): PauseGate | null {
        const list = pauseGates[method];
        if (!list || list.length === 0) return null;
        return list.shift()!;
    }

    async function gateAndCheck(method: keyof DatasetApi): Promise<void> {
        const pause = consumePause(method);
        if (pause) await pause.promise;
        const fail = consumeFailure(method);
        if (fail) throw fail;
    }

    return {
        async get(workspace, path) {
            calls.get.push({ workspace, path });
            await gateAndCheck("get");
            const entry = seeded.get(pathKey(workspace, path));
            if (!entry) throw new Error(`MockDatasetApi.get: nothing seeded at ${pathKey(workspace, path)}`);
            return { data: entry.value, hash: entry.hash };
        },

        async set(workspace, path, value) {
            calls.set.push({ workspace, path, value });
            await gateAndCheck("set");
            seeded.set(pathKey(workspace, path), { workspace, path, value, hash: nextHash() });
        },

        async launchDataflow(workspace) {
            calls.launchDataflow.push({ workspace });
            await gateAndCheck("launchDataflow");
        },

        async listRoot(workspace) {
            calls.listRoot.push({ workspace });
            await gateAndCheck("listRoot");
            const out = new Set<string>();
            for (const e of seeded.values()) {
                if (e.workspace !== workspace) continue;
                const root = (e.path[0] as { value: string } | undefined)?.value;
                if (root) out.add(root);
            }
            return [...out];
        },

        async listAt(workspace, path) {
            calls.listAt.push({ workspace, path });
            await gateAndCheck("listAt");
            return [];
        },

        async workspaceStatus(workspace) {
            calls.workspaceStatus.push({ workspace });
            await gateAndCheck("workspaceStatus");
            const override = statusOverrides.get(workspace);
            if (override) return { datasets: override };
            const datasets: DatasetStatusInfo[] = [];
            for (const e of seeded.values()) {
                if (e.workspace !== workspace) continue;
                const segs = e.path.map(p => (p as { value: string }).value).join(".");
                datasets.push({
                    path: segs ? `.${segs}` : "",
                    status: variant("up-to-date", null),
                    hash: variant("some", e.hash),
                    isTaskOutput: false,
                    producedBy: variant("none", null),
                });
            }
            return { datasets };
        },

        // Test helpers ---------------------------------------------------

        seed(workspace, path, value, hash) {
            seeded.set(pathKey(workspace, path), {
                workspace, path, value, hash: hash ?? nextHash(),
            });
        },
        unseed(workspace, path) {
            seeded.delete(pathKey(workspace, path));
        },
        calls,
        failNext(method, error, n = 1) {
            failures[method] = { error, remaining: n };
        },
        pauseNext(method) {
            let resolve!: () => void;
            let reject!: (e: Error) => void;
            const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
            const gate: PauseGate = { promise, resume: resolve, reject };
            (pauseGates[method] ??= []).push(gate);
            return {
                resume: (_v?: unknown) => gate.resume(),
                reject: (e: Error) => gate.reject(e),
            };
        },
        setWorkspaceStatusOverride(workspace, datasets) {
            statusOverrides.set(workspace, datasets);
        },
        clearWorkspaceStatusOverride(workspace) {
            statusOverrides.delete(workspace);
        },
    };
}
