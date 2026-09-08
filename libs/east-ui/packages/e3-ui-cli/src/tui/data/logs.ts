/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task logs — `taskLogs` in 64 KB chunks (`offset += size`) up to a 10 MB
 * cap, polled every second for the stream on screen (and every five for
 * the other stream, for its line count in the header). A stream that has
 * no run yet reads as empty with `execution_not_found` noted; a chunk
 * failure keeps what was fetched and notes the error.
 *
 * @packageDocumentation
 */

import { describeError, isApiCode, type Api } from '../api.js';
import type { LogsData } from '../state/actions.js';
import type { Store } from '../state/store.js';

/** Bytes fetched per request. */
export const LOG_CHUNK = 64 * 1024;
/** Bytes kept per stream at most. */
export const LOG_CAP = 10 * 1024 * 1024;
/** Chunks fetched per tick at most (a 5 MB backlog arrives over a few ticks, never in one). */
const CHUNKS_PER_TICK = 16;

/** A stream name. */
export type LogStream = 'stdout' | 'stderr';

/** An empty stream record. */
export function emptyLogs(): LogsData {
    return { text: '', offset: 0, totalSize: 0, complete: false, capped: false, error: null };
}

/** What the loader needs. */
export interface LogsLoaderDeps {
    store: Store;
    api: () => Api | null;
    log?: ((line: string) => void) | undefined;
}

/** The logs loader. */
export interface LogsLoader {
    /** Fetches the next chunks of a stream (up to a few per tick) and appends them. */
    tick(ws: string, task: string, stream: LogStream): Promise<void>;
    /** Drops the in-flight bookkeeping. */
    reset(): void;
}

/**
 * Creates the loader.
 *
 * @param deps - The store, the API accessor, the log
 * @returns The loader
 */
export function createLogsLoader(deps: LogsLoaderDeps): LogsLoader {
    const { store } = deps;
    const inflight = new Set<string>();
    const current = (ws: string, task: string, stream: LogStream): LogsData => store.getState().data.logs[ws]?.[task]?.[stream] ?? emptyLogs();
    return {
        async tick(ws, task, stream) {
            const api = deps.api();
            if (api === null) return;
            const key = `${ws}\n${task}\n${stream}`;
            if (inflight.has(key)) return;
            inflight.add(key);
            try {
                for (let i = 0; i < CHUNKS_PER_TICK; i++) {
                    const before = current(ws, task, stream);
                    if (before.capped) return;
                    let chunk;
                    try {
                        chunk = await api.taskLogs(ws, task, { stream, offset: before.offset, limit: LOG_CHUNK });
                    } catch (err) {
                        if (isApiCode(err, 'execution_not_found')) {
                            if (before.error !== 'no run yet' || before.totalSize !== 0) store.dispatch({ type: 'data/logs', ws, task, stream, logs: { ...before, complete: true, error: 'no run yet' } });
                            return;
                        }
                        deps.log?.(`logs ${ws}/${task}/${stream} failed: ${describeError(err)}`);
                        store.dispatch({ type: 'data/logs', ws, task, stream, logs: { ...before, error: describeError(err) } });
                        return;
                    }
                    const size = Number(chunk.size);
                    const totalSize = Number(chunk.totalSize);
                    const offset = Number(chunk.offset) + size;
                    // A shorter total than what we hold means the log was truncated (a new run): start over from zero.
                    if (totalSize < before.offset) {
                        store.dispatch({ type: 'data/logs', ws, task, stream, logs: { ...emptyLogs(), totalSize } });
                        continue;
                    }
                    const capped = offset >= LOG_CAP;
                    const next: LogsData = { text: before.text + chunk.data, offset, totalSize, complete: chunk.complete, capped, error: null };
                    const unchanged = size === 0 && before.totalSize === totalSize && before.complete === chunk.complete && before.error === null;
                    if (!unchanged) store.dispatch({ type: 'data/logs', ws, task, stream, logs: next });
                    if (chunk.complete || size === 0 || capped) return;
                }
            } finally {
                inflight.delete(key);
            }
        },
        reset() {
            inflight.clear();
        },
    };
}

/**
 * The lines of a stream's text (a trailing newline does not add an empty line).
 *
 * @param text - The text
 * @returns The lines
 */
export function logLines(text: string): string[] {
    if (text === '') return [];
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

/**
 * The line indices containing `needle` (case-insensitive).
 *
 * @param lines - The lines
 * @param needle - The search text
 * @returns The matching line indices
 */
export function findInLines(lines: readonly string[], needle: string): number[] {
    const q = needle.toLowerCase();
    if (q === '') return [];
    const out: number[] = [];
    lines.forEach((line, i) => { if (line.toLowerCase().includes(q)) out.push(i); });
    return out;
}
