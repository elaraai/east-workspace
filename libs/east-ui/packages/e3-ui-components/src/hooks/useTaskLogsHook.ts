/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StringType, equalFor } from '@elaraai/east';
import type { QueryOverrides } from './types.js';
import { pollRequestOptions, taskLogs } from '@elaraai/e3-api-client';
import type { LogOptions, RequestOptions, TaskLogChunk } from '@elaraai/e3-api-client';

// Beast2 decoder has stack overflow with large strings, so fetch in chunks
const CHUNK_SIZE = 64 * 1024; // 64KB per chunk
const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB max total

/** How often a task's log is polled while it changes: every second. */
export const LOG_POLL_MS = 1000;

/** The longest a task's log waits between polls: 5 s, which it backs off to
 *  while nothing changes. */
export const LOG_POLL_BACKOFF_MS = 5000;

/** How often a task's log is polled once its execution has ended and the log
 *  is read: every half minute, for another execution of the task. */
export const LOG_POLL_ENDED_MS = 30_000;

/** How a task's log is polled: how often while it changes, and the longest
 *  it waits while nothing does. */
export interface LogPollOptions {
    /** How often the log is polled while it changes, in milliseconds
     *  (default {@link LOG_POLL_MS}) */
    pollMs?: number;
    /** The longest the log waits between polls while nothing changes, in
     *  milliseconds (default {@link LOG_POLL_BACKOFF_MS}) */
    backoffMs?: number;
    /** How often the log is polled once its execution has ended and the log
     *  is read, in milliseconds (default {@link LOG_POLL_ENDED_MS}) */
    endedMs?: number;
}

/**
 * A task's log as far as it has been read: one execution's, from its first
 * byte, at most 10 MB of it.
 */
export interface TaskLogRead {
    /** The log's text, as far as it has been read */
    data: string;
    /** The inputs hash of the execution it is the log of */
    inputsHash: string;
    /** The id of the execution it is the log of */
    executionId: string;
    /** The byte the next read starts at */
    offset: number;
    /** The log's size when it was last read */
    totalSize: number;
    /** Whether the last read reached the log's end */
    complete: boolean;
    /** Whether the execution has ended: its log grows no more */
    ended: boolean;
}

const sameString = equalFor(StringType);

/**
 * Reads a task's log on from where the last read stopped: only what is new,
 * a 64 KB chunk at a time, up to 10 MB in all. Each poll's first read names no
 * execution, so it finds the task's current one: when that is another
 * execution than the one read so far, the log starts over from its first
 * byte, every read after naming it. Past 10 MB, a poll reads no bytes, and
 * only finds whether the execution has changed or ended.
 *
 * @param read - Reads a chunk of the task's log (the client's `taskLogs`,
 *   bound to the task)
 * @param stream - The stream
 * @param held - The log as far as the last poll read it; none for the first
 * @returns The log as far as it is read now, and whether the poll found
 *   anything new: bytes, another execution, or the execution's end
 */
export async function readTaskLogOn(
    read: (options: LogOptions) => Promise<TaskLogChunk>,
    stream: 'stdout' | 'stderr',
    held: TaskLogRead | undefined,
): Promise<{ log: TaskLogRead; changed: boolean }> {
    const capped = held !== undefined && held.data.length >= MAX_TOTAL_SIZE;
    let chunk = await read({ stream, offset: held?.offset ?? 0, limit: capped ? 0 : CHUNK_SIZE });
    let log: TaskLogRead;
    if (held !== undefined && sameString(held.inputsHash, chunk.inputsHash) && sameString(held.executionId, chunk.executionId)) {
        log = held;
    } else {
        // The first poll, or another execution's log: from its first byte
        const execution = { inputsHash: chunk.inputsHash, executionId: chunk.executionId };
        if (Number(chunk.offset) !== 0) chunk = await read({ stream, offset: 0, limit: CHUNK_SIZE, execution });
        log = { data: '', ...execution, offset: 0, totalSize: 0, complete: false, ended: false };
    }
    const before = log;
    for (;;) {
        // Advance by what was actually returned, not what was asked for: a
        // chunk stops short of the requested size rather than split a
        // multi-byte character across the boundary.
        const size = Number(chunk.size);
        log = {
            ...log,
            data: log.data + chunk.data,
            offset: log.offset + size,
            totalSize: Number(chunk.totalSize),
            complete: chunk.complete,
            ended: chunk.ended,
        };
        if (chunk.complete || size === 0 || log.data.length >= MAX_TOTAL_SIZE) break;
        chunk = await read({ stream, offset: log.offset, limit: CHUNK_SIZE, execution: { inputsHash: log.inputsHash, executionId: log.executionId } });
    }
    const changed = before !== held || log.offset !== before.offset || log.ended !== before.ended;
    return { log, changed };
}

/**
 * How long a task's log waits before its next poll: `pollMs` after a poll
 * that found something new, doubling toward `backoffMs` after each that found
 * nothing, and `endedMs` once the execution has ended and its log is read —
 * the log grows no more, and a poll looks only for another execution of the
 * task, as a read made for another reason does, a view shown again. A poll
 * that finds one starts the polls again.
 *
 * @param previous - How long the last poll waited
 * @param log - The log as the poll left it
 * @param changed - Whether the poll found anything new
 * @param pollMs - How often the log is polled while it changes
 * @param backoffMs - The longest it waits while nothing changes
 * @param endedMs - How often it is polled once the execution has ended and
 *   the log is read
 * @returns How long the next waits, in milliseconds
 */
export function nextLogPollMs(
    previous: number,
    log: TaskLogRead,
    changed: boolean,
    pollMs: number = LOG_POLL_MS,
    backoffMs: number = LOG_POLL_BACKOFF_MS,
    endedMs: number = LOG_POLL_ENDED_MS,
): number {
    if (log.ended && log.complete) return endedMs;
    if (changed) return pollMs;
    return Math.min(previous * 2, backoffMs);
}

/** What the hook answers: the log's text as far as it is read. */
export interface TaskLogsData {
    data: string;
    offset: bigint;
    size: bigint;
    totalSize: bigint;
    complete: boolean;
}

const NO_LOG: TaskLogsData = { data: '', offset: 0n, size: 0n, totalSize: 0n, complete: true };

/** A log as far as the hook has read it, and how long its next poll waits. */
interface HeldLog {
    log: TaskLogRead | undefined;
    pollMs: number;
}

/** How many logs the hook keeps as far as they were read, for the views that
 *  come back to them: the other stream, another task. */
const LOGS_HELD = 8;

/** Keeps a log as far as it is read under its key, the latest kept last, and
 *  forgets the oldest past {@link LOGS_HELD}. */
function keep(held: Map<string, HeldLog>, key: string, log: HeldLog): void {
    held.delete(key);
    held.set(key, log);
    while (held.size > LOGS_HELD) held.delete(held.keys().next().value!);
}

/**
 * Polls a task's log: only what is new each time, starting over when the
 * task's current execution changes, backing off while nothing does, and every
 * half minute once the execution has ended and its log is read, for another
 * execution ({@link readTaskLogOn}, {@link nextLogPollMs}). Each poll makes
 * one request attempt: its next poll is its retry. A log the view left — the
 * other stream, another task — is kept as far as it was read, so a view that
 * comes back to it reads on from there, as react-query shows what it read.
 *
 * @param apiUrl - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name; nothing is read while `null`
 * @param taskName - The task; nothing is read while `null`
 * @param stream - The stream
 * @param requestOptions - The requests' token and fetch
 * @param queryOptions - react-query overrides
 * @param poll - How often the log is polled while it changes, the longest it
 *   waits while nothing does, and how often it is polled once its execution
 *   has ended
 * @returns The query of the log's text as far as it is read
 */
export function useTaskLogs(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    taskName: string | null,
    stream: 'stdout' | 'stderr' = 'stdout',
    requestOptions?: RequestOptions,
    queryOptions?: QueryOverrides,
    poll: LogPollOptions = {},
) {
    const pollMs = poll.pollMs ?? LOG_POLL_MS;
    const backoffMs = poll.backoffMs ?? LOG_POLL_BACKOFF_MS;
    const endedMs = poll.endedMs ?? LOG_POLL_ENDED_MS;
    // Each log as far as it is read, and how long its next poll waits, by the
    // log's key: the query's own, kept across its polls, and kept for a log
    // the view left, so a view that comes back to it reads on from there
    const key = JSON.stringify([apiUrl, repo, workspace, taskName, stream]);
    const held = useRef(new Map<string, HeldLog>());

    return useQuery({
        queryKey: ['taskLogs', apiUrl, repo, workspace, taskName, stream],
        queryFn: async (): Promise<TaskLogsData> => {
            const at = held.current.get(key) ?? { log: undefined, pollMs };
            try {
                const { log, changed } = await readTaskLogOn(
                    (options) => taskLogs(apiUrl, repo, workspace!, taskName!, options, pollRequestOptions(requestOptions ?? { token: null })),
                    stream,
                    at.log,
                );
                at.log = log;
                at.pollMs = nextLogPollMs(at.pollMs, log, changed, pollMs, backoffMs, endedMs);
                keep(held.current, key, at);
                return { data: log.data, offset: 0n, size: BigInt(log.data.length), totalSize: BigInt(log.totalSize), complete: true };
            } catch {
                // No execution yet, or a failed read: what was read stays, and
                // the poll backs off — never sooner than the poll before it
                // waited, so an ended log's failed poll keeps its half minute
                at.pollMs = Math.max(at.pollMs, Math.min(at.pollMs * 2, backoffMs));
                keep(held.current, key, at);
                return at.log === undefined
                    ? NO_LOG
                    : { data: at.log.data, offset: 0n, size: BigInt(at.log.data.length), totalSize: BigInt(at.log.totalSize), complete: true };
            }
        },
        enabled: !!workspace && !!taskName,
        refetchInterval: () => held.current.get(key)?.pollMs ?? pollMs,
        ...queryOptions,
    });
}
