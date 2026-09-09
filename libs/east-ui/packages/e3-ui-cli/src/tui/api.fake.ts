/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An in-memory {@link Api} for the frame specs — a builder
 * (`fakeRepo().workspace('main').task('forecast', { … })`) that serves
 * workspace status, `datasetGetPage` windows and `datasetFindKey` over
 * synthetic values, log chunks, executions, and a scripted dataflow whose
 * events arrive over time. Every view spec drives it.
 *
 * @packageDocumentation
 */

import {
    ApiError,
    type DataflowOptions,
    type DataflowEvent,
    type DataflowExecutionState,
    type DatasetStatusDetail,
    type ExecutionListItem,
    type ListEntry,
    type RepositoryStatus,
    type TaskDetails,
    type TaskListItem,
    type TaskStatus,
    type WorkspaceInfo,
    type WorkspaceStatusResult,
} from '@elaraai/e3-api-client';
import type { TreePath, WorkspaceState } from '@elaraai/e3-types';
import { encodeDatasetBlob } from '@elaraai/e3-types';
import {
    compareFor,
    decodeBeast2For,
    encodeBeast2For,
    isVariant,
    none,
    parseFor,
    printFor,
    some,
    toEastTypeValue,
    variant,
    type EastType,
    type EastTypeValue,
} from '@elaraai/east';
import { createHash } from 'node:crypto';
import type { Api } from './api.js';
import { dottedPath } from './api.js';

/** A task's fixture. */
export interface FakeTask {
    name: string;
    kind?: 'ui' | undefined;
    status: TaskStatus;
    inputs: string[];
    dependsOn: string[];
    /** The output's East type + value; `undefined` = no output yet. */
    output?: { type: EastType | EastTypeValue; value: unknown } | undefined;
    /** The output path (default `.tasks.<name>.output`). */
    outputPath?: string | undefined;
    /** Task metadata blob (a `ui` task's manifest). */
    metadata?: Uint8Array | undefined;
    logs?: { stdout?: string; stderr?: string } | undefined;
    executions?: ExecutionListItem[] | undefined;
    /** Marks the output as a legacy, un-pageable blob (`dataset_not_indexed`). */
    notIndexed?: boolean | undefined;
    /** Marks the output as too large to page (`dataset_too_large`). */
    tooLarge?: boolean | undefined;
}

/** An input's fixture. */
export interface FakeInput {
    name: string;
    type: EastType | EastTypeValue;
    /** `undefined` = unset. */
    value?: unknown;
    status?: 'unset' | 'stale' | 'up-to-date' | undefined;
}

/** The fake's own (mutable) record of a dataflow execution. */
export interface FakeExecution {
    status: 'running' | 'completed' | 'failed' | 'aborted';
    startedAt: string;
    completedAt: string | null;
    events: DataflowEvent[];
}

/** A workspace's fixture. */
export interface FakeWorkspace {
    name: string;
    packageName?: string | undefined;
    packageVersion?: string | undefined;
    deployedAt?: Date | undefined;
    tasks: FakeTask[];
    inputs: FakeInput[];
    lock?: { pid: number; acquiredAt: string; command: string } | undefined;
    /** The latest execution, or null for never run. */
    execution?: FakeExecution | null | undefined;
}

/** A repository fixture. */
export interface FakeRepository {
    path: string;
    objectCount: bigint;
    packageCount: bigint;
    workspaces: FakeWorkspace[];
}

/** A stored dataset. */
interface Stored {
    type: EastTypeValue;
    value: unknown;
    bytes: Uint8Array;
    hash: string;
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function typeValueOf(type: EastType | EastTypeValue): EastTypeValue {
    return isVariant(type) ? (type as EastTypeValue) : toEastTypeValue(type as EastType);
}

/** Options for {@link FakeApi.run}: how the scripted dataflow plays out. */
export interface FakeRunScript {
    /** Events emitted in order, each after `stepMs` (default 0 — all at once). */
    events: DataflowEvent[];
    /** The final status. */
    final: 'completed' | 'failed' | 'aborted';
    stepMs?: number | undefined;
}

/**
 * The fake API: a builder plus the {@link Api} it serves. Mutate the
 * fixtures between polls to simulate server-side change.
 */
export class FakeApi implements Api {
    /** Repositories on the origin (the bound repository is `default`). */
    repos: Record<string, FakeRepository> = {};
    /** Every call, for assertions. */
    calls: string[] = [];
    /** Latency added to every call, in milliseconds. */
    latencyMs = 0;
    /** When set, every call rejects with it (simulates an unreachable server). */
    failWith: Error | null = null;
    /** The bound repository. */
    repo = 'default';
    /** The identity `whoami` would print. */
    identity: string | null = null;
    private readonly stores = new Map<string, Stored>();
    private readonly runTimers: ReturnType<typeof setTimeout>[] = [];

    constructor() {
        this.repos['default'] = { path: '/fake/default', objectCount: 0n, packageCount: 0n, workspaces: [] };
    }

    /** Adds (or returns) a workspace of the bound repository. */
    workspace(name: string, init: Partial<Omit<FakeWorkspace, 'name'>> = {}): FakeWorkspace {
        const repo = this.repos[this.repo]!;
        let ws = repo.workspaces.find(w => w.name === name);
        if (ws === undefined) {
            ws = { name, tasks: [], inputs: [], packageName: 'demand', packageVersion: '1.4.2', deployedAt: new Date(Date.now() - 3 * 86_400_000), execution: null, ...init };
            repo.workspaces.push(ws);
        }
        return ws;
    }

    /** Adds a task to a workspace. */
    task(ws: string, task: FakeTask): this {
        const w = this.workspace(ws);
        w.tasks = [...w.tasks.filter(t => t.name !== task.name), task];
        if (task.output !== undefined) this.store(ws, task.outputPath ?? `.tasks.${task.name}.output`, task.output.type, task.output.value);
        return this;
    }

    /** Adds an input to a workspace. */
    input(ws: string, input: FakeInput): this {
        const w = this.workspace(ws);
        w.inputs = [...w.inputs.filter(i => i.name !== input.name), input];
        if (input.value !== undefined) this.store(ws, `.inputs.${input.name}`, input.type, input.value);
        return this;
    }

    /** Stores a dataset value (as the server would, segmented for collections). */
    store(ws: string, path: string, type: EastType | EastTypeValue, value: unknown): Stored {
        const tv = typeValueOf(type);
        const bytes = encodeDatasetBlob(tv, value);
        const stored: Stored = { type: tv, value, bytes, hash: sha256(bytes) };
        this.stores.set(`${ws}${path}`, stored);
        return stored;
    }

    /** The stored dataset at a path, if any. */
    stored(ws: string, path: string): Stored | undefined {
        return this.stores.get(`${ws}${path}`);
    }

    /** Scripts a dataflow run: the next `dataflowExecuteLaunch` plays `script`. */
    private script: FakeRunScript | null = null;
    run(script: FakeRunScript): this {
        this.script = script;
        return this;
    }

    /** Stops every scripted timer (call from `afterEach`). */
    dispose(): void {
        for (const t of this.runTimers) clearTimeout(t);
        this.runTimers.length = 0;
    }

    private async call<T>(name: string, fn: () => T): Promise<T> {
        this.calls.push(name);
        if (this.latencyMs > 0) await new Promise(resolve => setTimeout(resolve, this.latencyMs));
        if (this.failWith !== null) throw this.failWith;
        return fn();
    }

    private ws(name: string): FakeWorkspace {
        const w = this.repos[this.repo]?.workspaces.find(x => x.name === name);
        if (w === undefined) throw new ApiError('workspace_not_found', { workspace: name });
        return w;
    }

    private findTask(ws: FakeWorkspace, name: string): FakeTask {
        const t = ws.tasks.find(x => x.name === name);
        if (t === undefined) throw new ApiError('task_not_found', { task: name });
        return t;
    }

    private outputPathOf(t: FakeTask): string {
        return t.outputPath ?? `.tasks.${t.name}.output`;
    }

    private datasetPathStatus(w: FakeWorkspace, path: string): { status: 'unset' | 'stale' | 'up-to-date'; hash: string | null; isTaskOutput: boolean; producedBy: string | null } {
        const task = w.tasks.find(t => this.outputPathOf(t) === path);
        const stored = this.stored(w.name, path);
        if (task !== undefined) {
            return { status: stored === undefined ? 'unset' : task.status.type === 'up-to-date' ? 'up-to-date' : 'stale', hash: stored?.hash ?? null, isTaskOutput: true, producedBy: task.name };
        }
        const input = w.inputs.find(i => `.inputs.${i.name}` === path);
        return { status: input?.status ?? (stored === undefined ? 'unset' : 'up-to-date'), hash: stored?.hash ?? null, isTaskOutput: false, producedBy: null };
    }

    private allPaths(w: FakeWorkspace): string[] {
        return [...w.inputs.map(i => `.inputs.${i.name}`), ...w.tasks.map(t => this.outputPathOf(t))];
    }

    /** A view of this fake bound to another repository. */
    withRepo(repo: string): Api {
        const bound = Object.create(this) as FakeApi;
        bound.repo = repo;
        return bound;
    }

    async repoList(): Promise<string[]> {
        return this.call('repoList', () => Object.keys(this.repos));
    }

    async repoStatus(repo: string): Promise<RepositoryStatus> {
        return this.call(`repoStatus ${repo}`, () => {
            const r = this.repos[repo];
            if (r === undefined) throw new ApiError('repository_not_found', { repo });
            return { path: r.path, objectCount: r.objectCount, packageCount: r.packageCount, workspaceCount: BigInt(r.workspaces.length) };
        });
    }

    async workspaceList(): Promise<WorkspaceInfo[]> {
        return this.call('workspaceList', () => (this.repos[this.repo]?.workspaces ?? []).map(w => ({
            name: w.name,
            deployed: w.packageName !== undefined,
            packageName: w.packageName !== undefined ? some(w.packageName) : none,
            packageVersion: w.packageVersion !== undefined ? some(w.packageVersion) : none,
        })));
    }

    async workspaceGet(ws: string): Promise<WorkspaceState | null> {
        return this.call(`workspaceGet ${ws}`, () => {
            const w = this.ws(ws);
            if (w.packageName === undefined) return null;
            return {
                packageName: w.packageName,
                packageVersion: w.packageVersion ?? '0.0.0',
                packageHash: sha256(new TextEncoder().encode(`${w.packageName}@${w.packageVersion}`)),
                deployedAt: w.deployedAt ?? new Date(0),
                currentRunId: none,
            };
        });
    }

    async workspaceStatus(ws: string): Promise<WorkspaceStatusResult> {
        return this.call(`workspaceStatus ${ws}`, () => {
            const w = this.ws(ws);
            const datasets = this.allPaths(w).map(path => {
                const s = this.datasetPathStatus(w, path);
                return { path, status: variant(s.status, null), hash: s.hash !== null ? some(s.hash) : none, isTaskOutput: s.isTaskOutput, producedBy: s.producedBy !== null ? some(s.producedBy) : none };
            });
            const tasks = w.tasks.map(t => ({
                name: t.name,
                hash: sha256(new TextEncoder().encode(t.name)),
                status: t.status,
                inputs: t.inputs,
                output: this.outputPathOf(t),
                dependsOn: t.dependsOn,
            }));
            const count = (pred: (t: FakeTask) => boolean) => BigInt(w.tasks.filter(pred).length);
            const dcount = (status: string) => BigInt(datasets.filter(d => d.status.type === status).length);
            return {
                workspace: w.name,
                lock: w.lock !== undefined ? some({ pid: BigInt(w.lock.pid), acquiredAt: w.lock.acquiredAt, bootId: none, command: some(w.lock.command) }) : none,
                datasets,
                tasks,
                summary: {
                    datasets: { total: BigInt(datasets.length), unset: dcount('unset'), stale: dcount('stale'), upToDate: dcount('up-to-date') },
                    tasks: {
                        total: BigInt(w.tasks.length),
                        upToDate: count(t => t.status.type === 'up-to-date'),
                        ready: count(t => t.status.type === 'ready'),
                        waiting: count(t => t.status.type === 'waiting'),
                        inProgress: count(t => t.status.type === 'in-progress'),
                        failed: count(t => t.status.type === 'failed'),
                        error: count(t => t.status.type === 'error'),
                        staleRunning: count(t => t.status.type === 'stale-running'),
                    },
                },
            } as WorkspaceStatusResult;
        });
    }

    async taskList(ws: string): Promise<TaskListItem[]> {
        return this.call(`taskList ${ws}`, () => this.ws(ws).tasks.map(t => ({ name: t.name, hash: sha256(new TextEncoder().encode(t.name)), kind: t.kind !== undefined ? some(t.kind) : none })));
    }

    async taskGet(ws: string, task: string): Promise<TaskDetails> {
        return this.call(`taskGet ${ws}.${task}`, () => {
            const w = this.ws(ws);
            const t = this.findTask(w, task);
            const toPath = (p: string): TreePath => p.split('.').filter(Boolean).map(s => variant('field', s));
            return {
                name: t.name,
                hash: sha256(new TextEncoder().encode(t.name)),
                commandIr: '',
                inputs: t.inputs.map(toPath),
                output: toPath(this.outputPathOf(t)),
                kind: t.kind !== undefined ? some(t.kind) : none,
                metadata: t.metadata !== undefined ? some(t.metadata) : none,
            };
        });
    }

    async taskExecutionList(ws: string, task: string): Promise<ExecutionListItem[]> {
        return this.call(`taskExecutionList ${ws}.${task}`, () => this.findTask(this.ws(ws), task).executions ?? []);
    }

    async datasetList(ws: string): Promise<ListEntry[]> {
        return this.call(`datasetList ${ws}`, () => {
            const w = this.ws(ws);
            const entries: ListEntry[] = [];
            for (const path of this.allPaths(w)) {
                const stored = this.stored(w.name, path);
                const task = w.tasks.find(t => this.outputPathOf(t) === path);
                const declared = w.inputs.find(i => `.inputs.${i.name}` === path)?.type ?? task?.output?.type;
                const type = stored?.type ?? (declared !== undefined ? typeValueOf(declared) : toEastTypeValue({ type: 'Null' } as EastType));
                // The real listing shows a task's subtree as one leaf at `.tasks.<name>` (the output's type / hash / size).
                const listed = task !== undefined && path === `.tasks.${task.name}.output` ? `tasks.${task.name}` : path.replace(/^\./, '');
                entries.push(variant('dataset', {
                    path: listed,
                    type,
                    hash: stored !== undefined ? some(stored.hash) : none,
                    size: stored !== undefined ? some(BigInt(stored.bytes.length)) : none,
                }));
            }
            return entries;
        });
    }

    async datasetGetStatus(ws: string, path: TreePath): Promise<DatasetStatusDetail> {
        return this.call(`datasetGetStatus ${ws}${dottedPath(path)}`, () => {
            const w = this.ws(ws);
            const dotted = dottedPath(path);
            const stored = this.stored(w.name, dotted);
            const input = w.inputs.find(i => `.inputs.${i.name}` === dotted);
            const task = w.tasks.find(t => this.outputPathOf(t) === dotted);
            if (input === undefined && task === undefined) throw new ApiError('dataset_not_found', { workspace: ws, path: dotted });
            const declared = input?.type ?? task?.output?.type;
            const type = stored?.type ?? (declared !== undefined ? typeValueOf(declared) : toEastTypeValue({ type: 'Null' } as EastType));
            return {
                path: dotted,
                type,
                refType: stored === undefined ? 'unassigned' : 'value',
                hash: stored !== undefined ? some(stored.hash) : none,
                size: stored !== undefined ? some(BigInt(stored.bytes.length)) : none,
            };
        });
    }

    async datasetGet(ws: string, path: TreePath): Promise<{ data: Uint8Array; hash: string; size: number }> {
        return this.call(`datasetGet ${ws}${dottedPath(path)}`, () => {
            const stored = this.stored(ws, dottedPath(path));
            if (stored === undefined) throw new ApiError('dataset_not_found', { workspace: ws, path: dottedPath(path) });
            return { data: stored.bytes, hash: stored.hash, size: stored.bytes.length };
        });
    }

    async datasetGetPage(ws: string, path: TreePath, window: { offset: number; limit: number; hash?: string } | { segment: number; hash?: string }) {
        return this.call(`datasetGetPage ${ws}${dottedPath(path)} ${'offset' in window ? `${window.offset}+${window.limit}` : `seg${window.segment}`}`, () => {
            const w = this.ws(ws);
            const dotted = dottedPath(path);
            const stored = this.stored(w.name, dotted);
            if (stored === undefined) throw new ApiError('dataset_not_found', { workspace: ws, path: dotted });
            const task = w.tasks.find(t => this.outputPathOf(t) === dotted);
            if (task?.notIndexed === true) throw new ApiError('dataset_not_indexed', 'this value predates paged storage');
            if (task?.tooLarge === true) throw new ApiError('dataset_too_large', 'the page byte budget was exceeded');
            if (window.hash !== undefined && window.hash !== stored.hash) throw new ApiError('dataset_hash_mismatch', 'stale hash pin');
            if (!('offset' in window)) throw new ApiError('bad_request', 'segment windows are not served by the fake');
            const t = stored.type;
            let elements: unknown[];
            let build: (slice: unknown[]) => unknown;
            if (t.type === 'Array') {
                elements = stored.value as unknown[];
                build = (slice) => slice;
            } else if (t.type === 'Dict') {
                elements = [...(stored.value as Map<unknown, unknown>).entries()];
                build = (slice) => new Map(slice as [unknown, unknown][]);
            } else if (t.type === 'Set') {
                elements = [...(stored.value as Set<unknown>).values()];
                build = (slice) => new Set(slice);
            } else {
                throw new ApiError('dataset_not_pageable', 'not a collection');
            }
            const offset = Math.max(0, Math.min(window.offset, elements.length));
            const slice = elements.slice(offset, offset + window.limit);
            const data = encodeBeast2For(t)(build(slice) as never);
            return {
                data,
                totalElements: elements.length,
                totalBytes: stored.bytes.length,
                totalExact: true,
                segmentCount: 1,
                offset,
                count: slice.length,
                hash: stored.hash,
            };
        });
    }

    async datasetFindKey(ws: string, path: TreePath, query: { key: string } | { prefix: string } | { fields: string[]; prefix?: string }) {
        return this.call(`datasetFindKey ${ws}${dottedPath(path)} ${JSON.stringify(query)}`, () => {
            const stored = this.stored(ws, dottedPath(path));
            if (stored === undefined) throw new ApiError('dataset_not_found', { workspace: ws, path: dottedPath(path) });
            const t = stored.type;
            const keyType = t.type === 'Dict' ? (t.value as { key: EastTypeValue }).key : t.type === 'Set' ? (t.value as EastTypeValue) : null;
            if (keyType === null) throw new ApiError('dataset_not_keyed', 'not a Set or Dict');
            const keys = t.type === 'Dict' ? [...(stored.value as Map<unknown, unknown>).keys()] : [...(stored.value as Set<unknown>).values()];
            const cmp = compareFor(keyType);
            let lower: (k: unknown) => boolean;
            let upper: (k: unknown) => boolean;
            if ('key' in query) {
                const parsed = parseFor(keyType)(query.key);
                if (!parsed.success) throw new ApiError('bad_request', `unparsable key ${query.key}`);
                lower = (k) => cmp(k, parsed.value) >= 0;
                upper = (k) => cmp(k, parsed.value) > 0;
            } else if ('fields' in query) {
                const meta = keyType.type === 'Struct' ? (keyType.value as { name: string; type: EastTypeValue }[]) : [];
                const values = query.fields.map((f, i) => { const p = parseFor(meta[i]!.type)(f); if (!p.success) throw new ApiError('bad_request', `unparsable field ${f}`); return p.value; });
                const lead = (k: unknown): number => {
                    for (let i = 0; i < values.length; i++) {
                        const c = compareFor(meta[i]!.type)((k as Record<string, unknown>)[meta[i]!.name], values[i]);
                        if (c !== 0) return c;
                    }
                    return 0;
                };
                const prefix = query.prefix;
                const pf = meta[values.length];
                lower = (k) => { const c = lead(k); return c !== 0 ? c > 0 : prefix === undefined || pf === undefined || String((k as Record<string, unknown>)[pf.name]) >= prefix; };
                upper = (k) => { const c = lead(k); if (c !== 0) return c > 0; if (prefix === undefined || pf === undefined) return false; const v = String((k as Record<string, unknown>)[pf.name]); return v > prefix && !v.startsWith(prefix); };
            } else {
                const prefix = query.prefix;
                lower = (k) => String(k) >= prefix;
                upper = (k) => String(k) > prefix && !String(k).startsWith(prefix);
            }
            let row = keys.findIndex(lower);
            if (row === -1) row = keys.length;
            let count = 0;
            while (row + count < keys.length && !upper(keys[row + count])) count++;
            return { found: count > 0, row, count, hash: stored.hash };
        });
    }

    async datasetSet(ws: string, path: TreePath, data: Uint8Array): Promise<void> {
        return this.call(`datasetSet ${ws}${dottedPath(path)}`, () => {
            const w = this.ws(ws);
            const dotted = dottedPath(path);
            const input = w.inputs.find(i => `.inputs.${i.name}` === dotted);
            if (input === undefined) throw new ApiError('permission_denied', { path: dotted });
            const tv = typeValueOf(input.type);
            const value = decodeBeast2For(tv)(data);
            this.stores.set(`${ws}${dotted}`, { type: tv, value, bytes: data, hash: sha256(data) });
            input.value = value;
            input.status = 'up-to-date';
        });
    }

    async dataflowExecuteLaunch(ws: string, options: DataflowOptions = {}): Promise<void> {
        const flags = `${options.force === true ? ' --force' : ''}${options.filter != null ? ` --filter ${options.filter}` : ''}${options.concurrency != null ? ` --concurrency ${options.concurrency}` : ''}`;
        return this.call(`dataflowExecuteLaunch ${ws}${flags}`, () => {
            const w = this.ws(ws);
            if (w.lock !== undefined) throw new ApiError('workspace_locked', { workspace: ws, holder: variant('known', { pid: BigInt(w.lock.pid), acquiredAt: w.lock.acquiredAt, bootId: none, command: some(w.lock.command) }) });
            if (w.execution?.status === 'running') throw new ApiError('workspace_locked', { workspace: ws, holder: variant('unknown', null) });
            const script = this.script ?? { events: [], final: 'completed' as const };
            const state: FakeExecution = { status: 'running', startedAt: new Date().toISOString(), completedAt: null, events: [] };
            w.execution = state;
            const step = script.stepMs ?? 0;
            const finish = (): void => {
                state.status = script.final;
                state.completedAt = new Date().toISOString();
            };
            if (step === 0) {
                state.events.push(...script.events);
                finish();
                return;
            }
            script.events.forEach((event, i) => {
                this.runTimers.push(setTimeout(() => {
                    if (w.execution !== state) return;
                    state.events.push(event);
                    if (i === script.events.length - 1) finish();
                }, step * (i + 1)));
            });
        });
    }

    async dataflowExecutePoll(ws: string, offset: number): Promise<DataflowExecutionState> {
        return this.call(`dataflowExecutePoll ${ws} ${offset}`, () => {
            const w = this.ws(ws);
            const state = w.execution;
            if (state === null || state === undefined) throw new ApiError('execution_not_found', { task: ws });
            const done = state.events;
            return {
                status: variant(state.status, null),
                startedAt: state.startedAt,
                completedAt: state.completedAt !== null ? some(state.completedAt) : none,
                summary: state.status === 'running' ? none : some({
                    executed: BigInt(done.filter(e => e.type === 'complete').length),
                    cached: BigInt(done.filter(e => e.type === 'cached').length),
                    failed: BigInt(done.filter(e => e.type === 'failed' || e.type === 'error').length),
                    skipped: BigInt(done.filter(e => e.type === 'input_unavailable').length),
                    duration: state.completedAt !== null ? Date.parse(state.completedAt) - Date.parse(state.startedAt) : 0,
                }),
                events: done.slice(offset),
                totalEvents: BigInt(done.length),
            } as DataflowExecutionState;
        });
    }

    async dataflowCancel(ws: string): Promise<void> {
        return this.call(`dataflowCancel ${ws}`, () => {
            const w = this.ws(ws);
            const state = w.execution;
            if (state === null || state === undefined || state.status !== 'running') throw new ApiError('internal', { message: 'No active execution' });
            this.dispose();
            state.status = 'aborted';
            state.completedAt = new Date().toISOString();
        });
    }

    async taskLogs(ws: string, task: string, options: { stream?: 'stdout' | 'stderr'; offset?: number; limit?: number }) {
        return this.call(`taskLogs ${ws}.${task} ${options.stream ?? 'stdout'} ${options.offset ?? 0}`, () => {
            const t = this.findTask(this.ws(ws), task);
            const text = t.logs?.[options.stream ?? 'stdout'] ?? '';
            if (t.executions !== undefined && t.executions.length === 0 && text === '') throw new ApiError('execution_not_found', { task });
            const bytes = new TextEncoder().encode(text);
            const offset = Math.max(0, Math.min(options.offset ?? 0, bytes.length));
            const limit = options.limit ?? 65_536;
            let end = Math.min(bytes.length, offset + limit);
            // Never split a multi-byte character (the real server's rule).
            while (end < bytes.length && end > offset && (bytes[end]! & 0xc0) === 0x80) end--;
            const slice = bytes.subarray(offset, end);
            return {
                data: new TextDecoder().decode(slice),
                offset: BigInt(offset),
                size: BigInt(slice.length),
                totalSize: BigInt(bytes.length),
                complete: end >= bytes.length,
            };
        });
    }
}

/**
 * A fake repository builder.
 *
 * @returns A fresh fake API
 */
export function fakeRepo(): FakeApi {
    return new FakeApi();
}

/** A Dict<String, Struct> of `n` synthetic forecast rows (`k0000` …). */
export function dictOf(n: number): { type: EastType; value: Map<string, { store: string; day: Date; units: bigint }> } {
    const { DictType, StringType, StructType, DateTimeType, IntegerType } = eastTypes();
    const type = DictType(StringType, StructType({ store: StringType, day: DateTimeType, units: IntegerType }));
    const value = new Map<string, { store: string; day: Date; units: bigint }>();
    const stores = ['Bakery', 'Deli', 'Produce'];
    for (let i = 0; i < n; i++) {
        value.set(`k${String(i).padStart(4, '0')}`, { store: stores[i % 3]!, day: new Date(Date.UTC(2025, 8, 1 + (i % 28))), units: BigInt(1000 + (i * 37) % 400) });
    }
    return { type, value };
}

/** The East type constructors the fixtures use (kept in one place). */
function eastTypes() {
    // Imported lazily to keep this module's static imports to values only.
    return east;
}

import * as east from '@elaraai/east';

/** Prints an East value for assertions. */
export function printValue(type: EastType | EastTypeValue, value: unknown): string {
    return printFor(typeValueOf(type))(value as never);
}
