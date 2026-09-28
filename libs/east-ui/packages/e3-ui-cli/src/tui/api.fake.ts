/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An in-memory {@link Api} for the frame specs — a builder
 * (`fakeRepo().workspace('main').task('forecast', { … })`) that serves
 * workspace status and what holds a workspace, `datasetGetPage` windows and `datasetFindKey` over
 * synthetic values — a record's rows, and its indexes' windows in index
 * order — log chunks, executions, a record's signature and commits, and a
 * scripted dataflow whose events arrive over time. Every view spec drives it.
 *
 * @packageDocumentation
 */

import {
    ApiError,
    type DataflowBudget,
    type DataflowOptions,
    type DataflowEvent,
    type DataflowExecutionState,
    type DatasetStatusDetail,
    type ExecutionListItem,
    type ListEntry,
    type LockStatus,
    type RecordCommitInfo,
    type RecordHistoryResult,
    type RecordSignature,
    type RepositoryStatus,
    type SplitProgress,
    type TaskDetails,
    type TaskListItem,
    type TaskStatus,
    type UnitWait,
    type WorkspaceInfo,
    type WorkspaceStatusResult,
} from '@elaraai/e3-api-client';
import type { DataManifest, TreePath, WorkspaceState } from '@elaraai/e3-types';
import { encodeDatasetBlob, indexWindowType } from '@elaraai/e3-types';
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
    status: TaskStatus;
    inputs: string[];
    dependsOn: string[];
    /** The output's East type + value; `undefined` = no output yet. */
    output?: { type: EastType | EastTypeValue; value: unknown } | undefined;
    /** The output path (default `.tasks.<name>.output`). */
    outputPath?: string | undefined;
    /** A `ui` task's data manifest; absent for a data task. */
    manifest?: DataManifest | undefined;
    logs?: { stdout?: string; stderr?: string } | undefined;
    executions?: ExecutionListItem[] | undefined;
    /** Marks the output as a legacy, un-pageable blob (`dataset_not_indexed`). */
    notIndexed?: boolean | undefined;
    /** Marks the output as too large to page (`dataset_too_large`). */
    tooLarge?: boolean | undefined;
    /** The peak memory, in bytes, of the execution the task's status comes from. */
    peakBytes?: number | undefined;
}

/** An input's fixture. */
export interface FakeInput {
    name: string;
    type: EastType | EastTypeValue;
    /** `undefined` = unset. */
    value?: unknown;
    status?: 'unset' | 'stale' | 'up-to-date' | undefined;
}

/** An index of a record's fixture: its key and projection, and the entries a row makes. */
export interface FakeIndex {
    name: string;
    keyType: EastType;
    /** The projection's type; `Null` for an index whose reads join the rows. */
    valueType: EastType;
    multi?: boolean | undefined;
    /** A row's entries: each index key it sorts under, with what the index projects. */
    entries: (key: unknown, row: unknown) => { ik: unknown; value: unknown }[];
}

/** A record's fixture. */
export interface FakeRecord {
    name: string;
    /** The record's type (a Dict for a record with indexes). */
    type: EastType;
    /** `undefined` = no state. */
    value?: unknown;
    mutations?: { name: string; form: 'reduce' | 'edit' | 'patch' }[] | undefined;
    indexes?: FakeIndex[] | undefined;
    /** Its commits, newest first. */
    commits?: RecordCommitInfo[] | undefined;
}

/** The fake's own (mutable) record of a dataflow execution. */
export interface FakeExecution {
    status: 'running' | 'completed' | 'failed' | 'aborted';
    startedAt: string;
    completedAt: string | null;
    events: DataflowEvent[];
    /** The tasks and units waiting for room, which the poll serves while the run runs. */
    waiting?: UnitWait[] | undefined;
    /** Each split task's progress, which the poll serves while the run runs. */
    splits?: SplitProgress[] | undefined;
}

/** A workspace's fixture. */
export interface FakeWorkspace {
    name: string;
    packageName?: string | undefined;
    packageVersion?: string | undefined;
    deployedAt?: Date | undefined;
    tasks: FakeTask[];
    inputs: FakeInput[];
    records?: FakeRecord[] | undefined;
    lock?: { pid: number; acquiredAt: string; command: string } | undefined;
    /** What holds the workspace exclusively, as the lock route serves it: a deploy, and how far it has got. */
    lockStatus?: LockStatus | undefined;
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

/** The root rows of a stored collection, or null for any other root. */
function countOf(stored: Stored): number | null {
    if (stored.type.type === 'Array') return (stored.value as unknown[]).length;
    if (stored.type.type === 'Dict') return (stored.value as Map<unknown, unknown>).size;
    if (stored.type.type === 'Set') return (stored.value as Set<unknown>).size;
    return null;
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
    /** When set, a call whose name begins with `prefix` waits for `until`
     *  before it answers: a response a spec holds back until it has seen what
     *  the view shows without it. */
    hold: { prefix: string; until: Promise<void> } | null = null;
    /** When set, every call rejects with it (simulates an unreachable server). */
    failWith: Error | null = null;
    /** What the server's byte budget does to wide rows: no page window carries more than this many rows (null = as asked). */
    pageRowCap: number | null = null;
    /** Whether the status reports the stored geometry (`rows` / `segments`), as the real server does for an indexed collection. */
    geometry = false;
    /** The bound repository. */
    repo = 'default';
    /** The identity `whoami` would print. */
    identity: string | null = null;
    /** The server's budget, which the poll and `dataflowBudget` serve; null for a server whose runners hold none. */
    budget: DataflowBudget | null = null;
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

    /** Adds a record to a workspace. */
    record(ws: string, record: FakeRecord): this {
        const w = this.workspace(ws);
        w.records = [...(w.records ?? []).filter(r => r.name !== record.name), record];
        if (record.value !== undefined) this.store(ws, `.records.${record.name}`, record.type, record.value);
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
        if (this.hold !== null && name.startsWith(this.hold.prefix)) await this.hold.until;
        if (this.failWith !== null) throw this.failWith;
        return fn();
    }

    private ws(name: string): FakeWorkspace {
        const w = this.repos[this.repo]?.workspaces.find(x => x.name === name);
        if (w === undefined) throw new ApiError('workspace_not_found', { workspace: name });
        return w;
    }

    /** A workspace with a package deployed: one with none has no status, tasks or datasets, as on the server. */
    private deployed(name: string): FakeWorkspace {
        const w = this.ws(name);
        if (w.packageName === undefined) throw new ApiError('workspace_not_deployed', { workspace: name });
        return w;
    }

    private findTask(ws: FakeWorkspace, name: string): FakeTask {
        const t = ws.tasks.find(x => x.name === name);
        if (t === undefined) throw new ApiError('task_not_found', { task: name });
        return t;
    }

    private findRecord(ws: FakeWorkspace, name: string): FakeRecord {
        const r = ws.records?.find(x => x.name === name);
        if (r === undefined) throw new ApiError('dataset_not_found', { workspace: ws.name, path: name });
        return r;
    }

    /** The record at a dataset path, if any. */
    private recordAt(ws: FakeWorkspace, path: string): FakeRecord | undefined {
        return ws.records?.find(r => `.records.${r.name}` === path);
    }

    /** A record's index entries in index order: by index key, then by the row's key. */
    private indexEntries(record: FakeRecord, index: FakeIndex, value: Map<unknown, unknown>): { ik: unknown; key: unknown; value: unknown; row: unknown }[] {
        const byIk = compareFor(toEastTypeValue(index.keyType));
        const byKey = compareFor(toEastTypeValue((record.type as unknown as { key: EastType }).key));
        const out: { ik: unknown; key: unknown; value: unknown; row: unknown }[] = [];
        for (const [key, row] of value) {
            for (const entry of index.entries(key, row)) out.push({ ik: entry.ik, key, value: entry.value, row });
        }
        return out.sort((a, b) => byIk(a.ik, b.ik) || byKey(a.key, b.key));
    }

    /** A record's index named by a page window or a key search. */
    private indexOf(w: FakeWorkspace, path: string, name: string): { record: FakeRecord; index: FakeIndex } {
        const record = this.recordAt(w, path);
        const index = record?.indexes?.find(i => i.name === name);
        if (record === undefined || index === undefined) throw new ApiError('bad_request', `${path} has no index ${name}`);
        return { record, index };
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
        return [...w.inputs.map(i => `.inputs.${i.name}`), ...w.tasks.map(t => this.outputPathOf(t)), ...(w.records ?? []).map(r => `.records.${r.name}`)];
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
            const w = this.deployed(ws);
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
                peakBytes: t.peakBytes !== undefined ? some(BigInt(t.peakBytes)) : none,
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

    async workspaceLock(ws: string): Promise<LockStatus | null> {
        // The route answers for any name: nothing holds a workspace that does not exist.
        return this.call(`workspaceLock ${ws}`, () => this.repos[this.repo]?.workspaces.find(w => w.name === ws)?.lockStatus ?? null);
    }

    async taskList(ws: string): Promise<TaskListItem[]> {
        return this.call(`taskList ${ws}`, () => this.deployed(ws).tasks.map(t => ({
            name: t.name,
            hash: sha256(new TextEncoder().encode(t.name)),
            role: t.manifest !== undefined ? variant('ui', t.manifest) : variant('data', null),
        })));
    }

    async taskGet(ws: string, task: string): Promise<TaskDetails> {
        return this.call(`taskGet ${ws}.${task}`, () => {
            const w = this.ws(ws);
            const t = this.findTask(w, task);
            const toPath = (p: string): TreePath => p.split('.').filter(Boolean).map(s => variant('field', s));
            return {
                name: t.name,
                hash: sha256(new TextEncoder().encode(t.name)),
                body: variant('east', { program: '' }),
                runner: variant('east_node', { platforms: [] }),
                inputs: t.inputs.map(p => ({ path: toPath(p), partition: none })),
                output: { path: toPath(this.outputPathOf(t)), kind: variant('value', null) },
                role: t.manifest !== undefined ? variant('ui', t.manifest) : variant('data', null),
            };
        });
    }

    async taskExecutionList(ws: string, task: string): Promise<ExecutionListItem[]> {
        return this.call(`taskExecutionList ${ws}.${task}`, () => this.findTask(this.ws(ws), task).executions ?? []);
    }

    async datasetList(ws: string): Promise<ListEntry[]> {
        return this.call(`datasetList ${ws}`, () => {
            const w = this.deployed(ws);
            const entries: ListEntry[] = [];
            for (const path of this.allPaths(w)) {
                const stored = this.stored(w.name, path);
                const task = w.tasks.find(t => this.outputPathOf(t) === path);
                const declared = w.inputs.find(i => `.inputs.${i.name}` === path)?.type ?? task?.output?.type ?? this.recordAt(w, path)?.type;
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
            const record = this.recordAt(w, dotted);
            if (input === undefined && task === undefined && record === undefined) throw new ApiError('dataset_not_found', { workspace: ws, path: dotted });
            const declared = input?.type ?? task?.output?.type ?? record?.type;
            const type = stored?.type ?? (declared !== undefined ? typeValueOf(declared) : toEastTypeValue({ type: 'Null' } as EastType));
            const rows = this.geometry && stored !== undefined ? countOf(stored) : null;
            return {
                path: dotted,
                type,
                refType: stored === undefined ? 'unassigned' : 'value',
                hash: stored !== undefined ? some(stored.hash) : none,
                size: stored !== undefined ? some(BigInt(stored.bytes.length)) : none,
                // One segment stands in for the stored geometry when it is modelled at all.
                segments: rows !== null ? some(1n) : none,
                rows: rows !== null ? some(BigInt(rows)) : none,
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

    /** The stored bytes in chunks of this many, as a stream arrives in several. */
    streamChunkBytes = 64 * 1024;

    async datasetGetStream(ws: string, path: TreePath): Promise<{ hash: string; chunks: AsyncIterable<Uint8Array> }> {
        return this.call(`datasetGetStream ${ws}${dottedPath(path)}`, () => {
            const stored = this.stored(ws, dottedPath(path));
            if (stored === undefined) throw new ApiError('dataset_not_found', { workspace: ws, path: dottedPath(path) });
            const { bytes } = stored;
            const size = this.streamChunkBytes;
            return {
                hash: stored.hash,
                chunks: (async function* () {
                    for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
                })(),
            };
        });
    }

    async datasetGetPage(ws: string, path: TreePath, window: ({ offset: number; limit: number } | { segment: number }) & { hash?: string; index?: string; join?: boolean }) {
        const through = window.index !== undefined ? ` #${window.index}${window.join === true ? '+join' : ''}` : '';
        return this.call(`datasetGetPage ${ws}${dottedPath(path)} ${'offset' in window ? `${window.offset}+${window.limit}` : `seg${window.segment}`}${through}`, () => {
            const w = this.ws(ws);
            const dotted = dottedPath(path);
            const stored = this.stored(w.name, dotted);
            if (stored === undefined) throw new ApiError('dataset_not_found', { workspace: ws, path: dotted });
            const task = w.tasks.find(t => this.outputPathOf(t) === dotted);
            if (task?.notIndexed === true) throw new ApiError('dataset_not_indexed', 'this value predates paged storage');
            if (task?.tooLarge === true) throw new ApiError('dataset_too_large', 'the page byte budget was exceeded');
            if (window.hash !== undefined && window.hash !== stored.hash) throw new ApiError('dataset_hash_mismatch', 'stale hash pin');
            if (!('offset' in window)) throw new ApiError('bad_request', 'segment windows are not served by the fake');
            if (window.index !== undefined) {
                // An index's window: its entries in index order, the row each names
                // filled in when the read joins, and the index's own totals.
                const { record, index } = this.indexOf(w, dotted, window.index);
                const dict = record.type as unknown as { key: EastType; value: EastType };
                const encode = encodeBeast2For(indexWindowType(dict.key, index.keyType, index.valueType, dict.value));
                const entries = this.indexEntries(record, index, stored.value as Map<unknown, unknown>)
                    .map(e => ({ ik: e.ik, key: e.key, value: e.value, row: window.join === true ? some(e.row) : none }));
                const offset = Math.max(0, Math.min(window.offset, entries.length));
                const limit = this.pageRowCap === null ? window.limit : Math.min(window.limit, Math.max(1, this.pageRowCap));
                const slice = entries.slice(offset, offset + limit);
                return {
                    data: encode(slice as never),
                    totalElements: entries.length,
                    totalBytes: encode(entries as never).length,
                    totalExact: true,
                    segmentCount: 1,
                    offset,
                    count: slice.length,
                    hash: stored.hash,
                };
            }
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
            const limit = this.pageRowCap === null ? window.limit : Math.min(window.limit, Math.max(1, this.pageRowCap));
            const slice = elements.slice(offset, offset + limit);
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

    async datasetFindKey(ws: string, path: TreePath, query: ({ key: string } | { prefix: string } | { fields: string[]; prefix?: string }) & { hash?: string; index?: string }) {
        return this.call(`datasetFindKey ${ws}${dottedPath(path)} ${JSON.stringify(query)}`, () => {
            const stored = this.stored(ws, dottedPath(path));
            if (stored === undefined) throw new ApiError('dataset_not_found', { workspace: ws, path: dottedPath(path) });
            const t = stored.type;
            let keyType: EastTypeValue | null;
            let keys: unknown[];
            if (query.index !== undefined) {
                // An index is searched by its own key, over its own rows.
                const { record, index } = this.indexOf(this.ws(ws), dottedPath(path), query.index);
                keyType = toEastTypeValue(index.keyType);
                keys = this.indexEntries(record, index, stored.value as Map<unknown, unknown>).map(e => e.ik);
            } else {
                keyType = t.type === 'Dict' ? (t.value as { key: EastTypeValue }).key : t.type === 'Set' ? (t.value as EastTypeValue) : null;
                keys = t.type === 'Dict' ? [...(stored.value as Map<unknown, unknown>).keys()] : [...(stored.value as Set<unknown>).values()];
            }
            if (keyType === null) throw new ApiError('dataset_not_keyed', 'not a Set or Dict');
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
        const flags = `${options.force === true ? ' --force' : ''}${options.filter != null ? ` --filter ${options.filter}` : ''}`;
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
                budget: this.budget !== null ? some(this.budget) : none,
                waiting: state.waiting ?? [],
                splits: state.splits ?? [],
            } as DataflowExecutionState;
        });
    }

    async dataflowBudget(ws: string): Promise<DataflowBudget | null> {
        return this.call(`dataflowBudget ${ws}`, () => {
            this.ws(ws);
            return this.budget;
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

    async recordDescribe(ws: string, record: string): Promise<RecordSignature> {
        return this.call(`recordDescribe ${ws}.${record}`, () => {
            const r = this.findRecord(this.ws(ws), record);
            return {
                name: r.name,
                mutations: (r.mutations ?? []).map(m => ({ name: m.name, argTypes: [], form: m.form })),
                indexes: (r.indexes ?? []).map(i => ({ name: i.name, keyType: toEastTypeValue(i.keyType), valueType: toEastTypeValue(i.valueType), multi: i.multi ?? false })),
            };
        });
    }

    async recordHistory(ws: string, record: string, page: { limit: number; from?: string }): Promise<RecordHistoryResult> {
        return this.call(`recordHistory ${ws}.${record} ${page.from ?? 'head'}+${page.limit}`, () => {
            const commits = this.findRecord(this.ws(ws), record).commits ?? [];
            const start = page.from === undefined ? 0 : commits.findIndex(c => c.hash === page.from);
            if (start === -1) throw new ApiError('object_not_found', { hash: page.from ?? '' });
            return { commits: commits.slice(start, start + page.limit) };
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

/**
 * A Dict<String, Struct> of `n` rows each carrying a `note` of `noteChars`
 * incompressible characters — the wide rows a byte-sized page shortens.
 */
export function wideDictOf(n: number, noteChars: number): { type: EastType; value: Map<string, { store: string; units: bigint; note: string }> } {
    const { DictType, StringType, StructType, IntegerType } = eastTypes();
    const type = DictType(StringType, StructType({ store: StringType, units: IntegerType, note: StringType }));
    const value = new Map<string, { store: string; units: bigint; note: string }>();
    const stores = ['Bakery', 'Deli', 'Produce'];
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let seed = 0x2545f491;
    const next = (): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return (seed >>> 16) % alphabet.length;
    };
    for (let i = 0; i < n; i++) {
        let note = '';
        for (let j = 0; j < noteChars; j++) note += alphabet[next()];
        value.set(`k${String(i).padStart(5, '0')}`, { store: stores[i % 3]!, units: BigInt(1000 + (i * 37) % 400), note });
    }
    return { type, value };
}

/**
 * A record's chain of `n` commits, newest first, a minute apart up to
 * `newest`: the oldest is `$init`, the rest `set_status` by two actors. A
 * commit's hash follows from its place counted from the oldest, so a chain
 * one commit longer shares every hash but the new head's.
 */
export function commitChain(n: number, newest: Date): RecordCommitInfo[] {
    const hashOf = (seq: number): string => sha256(new TextEncoder().encode(`commit ${seq}`));
    return Array.from({ length: n }, (_, i) => {
        const seq = n - 1 - i;
        return {
            hash: hashOf(seq),
            parent: seq > 0 ? some(hashOf(seq - 1)) : none,
            state: sha256(new TextEncoder().encode(`state ${seq}`)),
            mutation: seq === 0 ? '$init' : 'set_status',
            actor: seq % 2 === 0 ? 'alice' : 'bob',
            at: new Date(newest.getTime() - i * 60_000),
            delta: none,
        };
    });
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
