/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Synthetic workspaces for the frame, byte and budget specs: a dashboard
 * of `N` tasks and `M` inputs shaped like `dashboard.spec.tsx`'s fixture
 * (every status kind, a failed last run with one event pair per task), as
 * the store actions that populate it. Test-only.
 *
 * @packageDocumentation
 */

import { ArrayType, DictType, FloatType, StringType, StructType, none, some, toEastTypeValue, variant } from '@elaraai/east';
import type { Action } from '../state/actions.js';

const rowsType = toEastTypeValue(ArrayType(StructType({ sku: StringType, units: FloatType })));
const forecastType = toEastTypeValue(DictType(StringType, StructType({ units: FloatType })));

/** A task's status by its index: up-to-date, waiting, failed, ready, in-progress, in turn. */
function statusOf(i: number, iso: (msAgo: number) => string): unknown {
    switch (i % 5) {
        case 0: return variant('up-to-date', { cached: i % 10 === 0 });
        case 1: return variant('waiting', { reason: `Waiting for task 'task_${i - 1}'` });
        case 2: return variant('failed', { exitCode: 2n, completedAt: none });
        case 3: return variant('ready', null);
        default: return variant('in-progress', { pid: some(4242n), startedAt: some(iso(9_000)) });
    }
}

/**
 * The actions that populate a dashboard of `tasks` tasks and `inputs`
 * inputs in workspace `main`, polled at `now - 400`.
 *
 * @param tasks - Tasks (`task_0` … each depending on the previous)
 * @param inputs - Inputs (`in_0` …, every third one stale)
 * @param now - The clock the fixture's instants are relative to
 * @returns The actions, in dispatch order
 */
export function dashboardFixture(tasks: number, inputs: number, now: number): Action[] {
    const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();
    const taskList = Array.from({ length: tasks }, (_, i) => ({
        name: `task_${i}`,
        hash: `hash-${i}`,
        status: statusOf(i, iso),
        inputs: [`.inputs.in_${i % Math.max(1, inputs)}`, ...(i > 0 ? [`.tasks.task_${i - 1}.output`] : [])],
        output: `.tasks.task_${i}.output`,
        dependsOn: i > 0 ? [`task_${i - 1}`] : [],
    }));
    const ds = (path: string, status: string, hash: string | null, producedBy: string | null) =>
        ({ path, status: variant(status, null), hash: hash !== null ? some(hash) : none, isTaskOutput: producedBy !== null, producedBy: producedBy !== null ? some(producedBy) : none });
    const datasets = [
        ...Array.from({ length: inputs }, (_, j) => ds(`.inputs.in_${j}`, j % 3 === 0 ? 'stale' : 'up-to-date', `in-hash-${j}`, null)),
        ...taskList.map(t => ds(t.output, 'up-to-date', `out-${t.name}`, t.name)),
    ];
    const count = (type: string): bigint => BigInt(taskList.filter(t => (t.status as { type: string }).type === type).length);
    const dcount = (type: string): bigint => BigInt(datasets.filter(d => (d.status as { type: string }).type === type).length);
    const status = {
        workspace: 'main',
        lock: none,
        datasets,
        tasks: taskList,
        summary: {
            datasets: { total: BigInt(datasets.length), unset: dcount('unset'), stale: dcount('stale'), upToDate: dcount('up-to-date') },
            tasks: { total: BigInt(tasks), upToDate: count('up-to-date'), ready: count('ready'), waiting: count('waiting'), inProgress: count('in-progress'), failed: count('failed'), error: 0n, staleRunning: 0n },
        },
    };
    const entry = (path: string, type: unknown, size: number, hash: string) =>
        variant('dataset', { path, type, hash: some(hash), size: some(BigInt(size)) });
    const entries = [
        ...Array.from({ length: inputs }, (_, j) => entry(`inputs.in_${j}`, rowsType, 10_000 + j * 997, `in-hash-${j}`)),
        ...taskList.map((t, i) => entry(`tasks.${t.name}`, forecastType, 1_000_000 + i * 12_345, `out-${t.name}`)),
    ];
    const events: unknown[] = [];
    taskList.forEach((t, i) => {
        events.push(variant('start', { task: t.name, timestamp: iso(120_000 - i * 10) }));
        if ((t.status as { type: string }).type === 'failed') events.push(variant('failed', { task: t.name, timestamp: iso(119_000 - i * 10), duration: 800, exitCode: 2n }));
        else events.push(variant('complete', { task: t.name, timestamp: iso(119_000 - i * 10), duration: 3_100 }));
    });
    const execution = {
        status: variant('failed', null),
        startedAt: iso(120_000),
        completedAt: some(iso(81_600)),
        summary: some({ executed: BigInt(tasks), cached: 1n, failed: count('failed'), skipped: 0n, duration: 38_400 }),
        events: [],
        totalEvents: BigInt(events.length),
    };
    return [
        { type: 'data/workspaces', workspaces: [{ name: 'main', deployed: true, packageName: some('demand'), packageVersion: some('1.4.2') }] as never },
        { type: 'data/workspaceState', ws: 'main', state: { packageName: 'demand', packageVersion: '1.4.2', packageHash: 'p', deployedAt: new Date(now - 3 * 86_400_000), currentRunId: none } as never },
        { type: 'data/status', ws: 'main', result: status as never, at: now - 400 },
        { type: 'data/datasets', ws: 'main', entries: entries as never },
        { type: 'data/taskList', ws: 'main', tasks: taskList.map(t => ({ name: t.name, hash: t.hash, kind: none })) as never },
        { type: 'data/execution', ws: 'main', state: execution as never, events: events as never, startedAt: execution.startedAt },
    ];
}
